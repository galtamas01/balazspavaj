// Hitelesítés: jelszó (scrypt), aláírt süti-munkamenet, Origin-ellenőrzés, belépési korlát.
// Csak Node beépített moduljait használja; az @netlify/blobs csak a korlátozónál, késleltetve töltődik be.

import { scrypt, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { error, MESSAGES } from './http.mjs';

const scryptAsync = promisify(scrypt);

export const COOKIE_NAME = 'cms_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 óra
const KEY_LENGTH = 64;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CONFIG_ERROR';
  }
}

// ---------- Jelszó ----------

// Formátum: scrypt:<só base64url>:<hash base64url>  (nincs benne $ vagy szóköz, env változóban biztonságos)
export async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scryptAsync(String(password), salt, KEY_LENGTH);
  return `scrypt:${Buffer.from(salt).toString('base64url')}:${Buffer.from(hash).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(String(password), salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

// ---------- Munkamenet-süti ----------

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConfigError('SESSION_SECRET hiányzik vagy rövidebb 32 karakternél.');
  }
  return secret;
}

function sign(payloadB64) {
  return createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

function isHttps(req) {
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return true;
  }
}

function cookieAttributes(req, maxAge) {
  // Lokális fejlesztésnél (http://localhost) a Secure attribútum nélkül működik a süti.
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

export function createSessionCookie(req, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })).toString('base64url');
  return `${COOKIE_NAME}=${payload}.${sign(payload)}; ${cookieAttributes(req, SESSION_TTL_SECONDS)}`;
}

export function clearSessionCookie(req) {
  return `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`;
}

function readCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

// Érvényes munkamenet esetén {exp}, különben null.
export function readSession(req, now = Date.now()) {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(payload), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- Védelmek ----------

// CSRF: a böngésző minden POST-nál küld Origin fejlécet; ennek a mi oldalunkra kell mutatnia.
export function checkOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const urlHost = new URL(req.url).host;
  const hostHeader = req.headers.get('host');
  return originHost === urlHost || (!!hostHeader && originHost === hostHeader);
}

// Védett GET végpontok elejére: nincs munkamenet → 401, különben null.
export function guardGet(req) {
  if (req.method !== 'GET') {
    return error(405, 'METHOD_NOT_ALLOWED', MESSAGES.METHOD_NOT_ALLOWED, { Allow: 'GET' });
  }
  if (!readSession(req)) return error(401, 'UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
  return null;
}

// Védett POST végpontok elejére: hibás Origin → 403, nincs munkamenet → 401, különben null.
export function guardPost(req) {
  if (req.method !== 'POST') {
    return error(405, 'METHOD_NOT_ALLOWED', MESSAGES.METHOD_NOT_ALLOWED, { Allow: 'POST' });
  }
  if (!checkOrigin(req)) return error(403, 'BAD_ORIGIN', MESSAGES.BAD_ORIGIN);
  if (!readSession(req)) return error(401, 'UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
  return null;
}

export function clientIp(req, context) {
  return context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
}

// ---------- Belépési korlát (Netlify Blobs) ----------

export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

async function defaultStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('cms-auth');
}

// A tárolási hiba nem akadályozza a belépést (fail-open), de naplózódik: a scrypt lassúsága így is fékez.
export function createRateLimiter(getStoreFn = defaultStore, now = () => Date.now()) {
  const keyFor = (ip) => 'login-' + createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);

  return {
    async check(ip) {
      try {
        const store = await getStoreFn();
        const rec = await store.get(keyFor(ip), { type: 'json' });
        if (!rec || now() - rec.first > WINDOW_MS) return { blocked: false };
        if (rec.count < MAX_FAILS) return { blocked: false };
        return { blocked: true, retryAfter: Math.max(1, Math.ceil((rec.first + WINDOW_MS - now()) / 1000)) };
      } catch (e) {
        console.error('rate limiter (check) hiba:', e?.message);
        return { blocked: false };
      }
    },
    async fail(ip) {
      try {
        const store = await getStoreFn();
        const key = keyFor(ip);
        const rec = await store.get(key, { type: 'json' });
        const fresh = !rec || now() - rec.first > WINDOW_MS;
        await store.setJSON(key, fresh ? { count: 1, first: now() } : { count: rec.count + 1, first: rec.first });
      } catch (e) {
        console.error('rate limiter (fail) hiba:', e?.message);
      }
    },
    async reset(ip) {
      try {
        const store = await getStoreFn();
        await store.delete(keyFor(ip));
      } catch (e) {
        console.error('rate limiter (reset) hiba:', e?.message);
      }
    },
  };
}

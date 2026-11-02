import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  readSession,
  checkOrigin,
  guardPost,
  createRateLimiter,
  MAX_FAILS,
  WINDOW_MS,
  SESSION_TTL_SECONDS,
} from '../netlify/lib/auth.mjs';
import { makeHandler } from '../netlify/functions/login.mjs';
import logout from '../netlify/functions/logout.mjs';
import session from '../netlify/functions/session.mjs';

const ORIGIN = 'https://www.balazspavaj.ro';

function req(path, { method = 'GET', headers = {}, body, origin = ORIGIN } = {}) {
  const h = new Headers(headers);
  if (origin && method !== 'GET') h.set('origin', origin);
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

class FakeStore {
  constructor() {
    this.data = new Map();
  }
  async get(key) {
    return this.data.has(key) ? structuredClone(this.data.get(key)) : null;
  }
  async setJSON(key, value) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  process.env.SESSION_SECRET = 'x'.repeat(48);
});

test('jelszó: hash és ellenőrzés', async () => {
  const hash = await hashPassword('helyes-jelszo-123');
  assert.match(hash, /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword('helyes-jelszo-123', hash), true);
  assert.equal(await verifyPassword('rossz', hash), false);
  assert.equal(await verifyPassword('helyes-jelszo-123', ''), false);
  assert.equal(await verifyPassword('helyes-jelszo-123', 'sima-szoveg'), false);
  assert.notEqual(hash, await hashPassword('helyes-jelszo-123'), 'minden hash más sót használ');
});

test('süti: érvényes, lejárt, hamisított', () => {
  const now = Date.now();
  const cookie = createSessionCookie(req('/api/login'), now).split(';')[0];
  const withCookie = (c) => req('/api/session', { headers: { cookie: c } });

  assert.ok(readSession(withCookie(cookie), now));
  assert.equal(readSession(withCookie(cookie), now + (SESSION_TTL_SECONDS + 1) * 1000), null, 'lejárt');
  assert.equal(readSession(withCookie(cookie.slice(0, -2) + 'xx'), now), null, 'hamis aláírás');
  assert.equal(readSession(withCookie('cms_session=abc'), now), null);
  assert.equal(readSession(req('/api/session'), now), null, 'nincs süti');

  process.env.SESSION_SECRET = 'y'.repeat(48);
  assert.equal(readSession(withCookie(cookie), now), null, 'más titokkal aláírt süti érvénytelen');
});

test('süti attribútumai: https-en Secure, http-n nem', () => {
  const https = createSessionCookie(req('/api/login'));
  assert.match(https, /HttpOnly/);
  assert.match(https, /SameSite=Strict/);
  assert.match(https, /Secure/);
  const http = createSessionCookie(new Request('http://localhost:8888/api/login'));
  assert.doesNotMatch(http, /Secure/);
  assert.match(clearSessionCookie(req('/api/logout')), /Max-Age=0/);
});

test('SESSION_SECRET nélkül konfigurációs hiba', () => {
  delete process.env.SESSION_SECRET;
  assert.throws(() => createSessionCookie(req('/api/login')), { code: 'CONFIG_ERROR' });
});

test('Origin-ellenőrzés', () => {
  assert.equal(checkOrigin(req('/api/login', { method: 'POST' })), true);
  assert.equal(checkOrigin(req('/api/login', { method: 'POST', origin: 'https://evil.example' })), false);
  assert.equal(checkOrigin(req('/api/login', { method: 'POST', origin: null })), false);
  assert.equal(checkOrigin(req('/api/login', { method: 'POST', origin: 'nem-url' })), false);
});

test('guardPost: metódus, origin, munkamenet', async () => {
  assert.equal((await guardPost(req('/api/x', { method: 'GET' }))).status, 405);
  assert.equal((await guardPost(req('/api/x', { method: 'POST', origin: 'https://evil.example' }))).status, 403);
  assert.equal((await guardPost(req('/api/x', { method: 'POST' }))).status, 401);
  const cookie = cookieFrom(new Response(null, { headers: { 'set-cookie': createSessionCookie(req('/api/login')) } }));
  assert.equal(guardPost(req('/api/x', { method: 'POST', headers: { cookie } })), null);
});

test('belépési korlát: 5 hiba után tilt, ablak után enged, reset töröl', async () => {
  let t = 1_000_000;
  const store = new FakeStore();
  const rl = createRateLimiter(async () => store, () => t);

  for (let i = 0; i < MAX_FAILS; i++) {
    assert.equal((await rl.check('1.2.3.4')).blocked, false);
    await rl.fail('1.2.3.4');
  }
  const blocked = await rl.check('1.2.3.4');
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= WINDOW_MS / 1000);
  assert.equal((await rl.check('5.6.7.8')).blocked, false, 'másik IP nincs tiltva');

  t += WINDOW_MS + 1;
  assert.equal((await rl.check('1.2.3.4')).blocked, false, 'az ablak lejárt');

  await rl.fail('9.9.9.9');
  await rl.reset('9.9.9.9');
  assert.equal(store.data.size, 1, 'reset után a rekord törlődik (csak az 1.2.3.4 maradt)');
});

test('belépési korlát: tárolási hiba esetén nem akadályozza a belépést', async () => {
  const broken = createRateLimiter(async () => { throw new Error('nincs blobs'); });
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal((await broken.check('1.1.1.1')).blocked, false);
    await broken.fail('1.1.1.1');
    await broken.reset('1.1.1.1');
  } finally {
    console.error = origError;
  }
});

test('login végpont: teljes folyamat', async () => {
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('helyes-jelszo-123');
  const store = new FakeStore();
  const login = makeHandler(createRateLimiter(async () => store));
  const post = (body, extra) => login(req('/api/login', { method: 'POST', body, ...extra }), { ip: '10.0.0.1' });

  assert.equal((await login(req('/api/login'), {})).status, 405);
  assert.equal((await post({ password: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ password: 'x'.repeat(201) })).status, 400);

  const bad = await post({ password: 'rossz' });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).code, 'BAD_PASSWORD');
  assert.equal(bad.headers.get('set-cookie'), null);

  const ok = await post({ password: 'helyes-jelszo-123' });
  assert.equal(ok.status, 200);
  const cookie = cookieFrom(ok);

  const check = await session(req('/api/session', { headers: { cookie } }));
  assert.deepEqual(await check.json(), { authenticated: true });
  const anon = await session(req('/api/session'));
  assert.deepEqual(await anon.json(), { authenticated: false });

  const out = await logout(req('/api/logout', { method: 'POST' }));
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('login végpont: 5 hibás próba után 429, még jó jelszóval is', async () => {
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('helyes-jelszo-123');
  const login = makeHandler(createRateLimiter(async () => store));
  const store = new FakeStore();
  const post = (password) => login(req('/api/login', { method: 'POST', body: { password } }), { ip: '10.0.0.2' });

  for (let i = 0; i < MAX_FAILS; i++) assert.equal((await post('rossz')).status, 401);
  const blocked = await post('helyes-jelszo-123');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('login végpont: hiányzó beállítás → 500 CONFIG_ERROR', async () => {
  delete process.env.ADMIN_PASSWORD_HASH;
  const login = makeHandler(createRateLimiter(async () => new FakeStore()));
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await login(req('/api/login', { method: 'POST', body: { password: 'valami' } }), {});
    assert.equal(res.status, 500);
    assert.equal((await res.json()).code, 'CONFIG_ERROR');
  } finally {
    console.error = origError;
  }
});

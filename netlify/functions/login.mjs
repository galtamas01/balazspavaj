import { json, error, MESSAGES } from '../lib/http.mjs';
import {
  ConfigError,
  checkOrigin,
  clientIp,
  createRateLimiter,
  createSessionCookie,
} from '../lib/auth.mjs';
import { createCredentials, CredentialStoreError } from '../lib/credentials.mjs';

export function makeHandler(limiter, credentials = createCredentials()) {
  return async (req, context) => {
    if (req.method !== 'POST') {
      return error(405, 'METHOD_NOT_ALLOWED', MESSAGES.METHOD_NOT_ALLOWED, { Allow: 'POST' });
    }
    if (!checkOrigin(req)) return error(403, 'BAD_ORIGIN', MESSAGES.BAD_ORIGIN);

    let password = '';
    try {
      const body = await req.json();
      if (typeof body?.password === 'string') password = body.password;
    } catch {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }
    if (!password || password.length > 200) {
      return error(400, 'BAD_REQUEST', 'Add meg a jelszót.');
    }

    try {
      const ip = clientIp(req, context);
      const state = await limiter.check(ip);
      if (state.blocked) {
        return error(429, 'TOO_MANY_ATTEMPTS', 'Túl sok próbálkozás. Próbáld újra 15 perc múlva.', {
          'Retry-After': String(state.retryAfter),
        });
      }

      const role = await credentials.verify(password);
      if (!role) {
        await limiter.fail(ip);
        return error(401, 'BAD_PASSWORD', 'Hibás jelszó.');
      }

      await limiter.reset(ip);
      return json({ ok: true }, 200, { 'Set-Cookie': createSessionCookie(req) });
    } catch (e) {
      if (e instanceof CredentialStoreError) return error(503, 'CREDENTIAL_STORE', MESSAGES.CREDENTIAL_STORE);
      if (e instanceof ConfigError) {
        console.error('Konfigurációs hiba:', e.message);
        return error(500, 'CONFIG_ERROR', MESSAGES.CONFIG_ERROR);
      }
      console.error('login hiba:', e);
      return error(500, 'SERVER_ERROR', MESSAGES.SERVER_ERROR);
    }
  };
}

export default makeHandler(createRateLimiter());

export const config = { path: '/api/login' };

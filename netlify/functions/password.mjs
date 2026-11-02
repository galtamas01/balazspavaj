// POST /api/password – az ügyfél jelszavának cseréje. Bemenet: { current, next }.
// A jelenlegi jelszót újra meg kell adni (egy elhagyott, bejelentkezett gép se tudja átvenni az irányítást).
// A mester jelszó ezzel nem módosítható, és mindig érvényes marad. A hibás "jelenlegi jelszó" ugyanúgy számít
// a belépési korlátba, mint a hibás belépés.
import { json, error, MESSAGES } from '../lib/http.mjs';
import { guardPost, clientIp, createRateLimiter, ConfigError } from '../lib/auth.mjs';
import { createCredentials, CredentialStoreError, newPasswordError } from '../lib/credentials.mjs';

export function makeHandler(limiter, credentials = createCredentials()) {
  return async (req, context) => {
    const denied = guardPost(req);
    if (denied) return denied;

    let current;
    let next;
    try {
      const body = JSON.parse(await req.text());
      if (typeof body?.current !== 'string' || typeof body?.next !== 'string') throw new Error('bad');
      ({ current, next } = body);
    } catch {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }
    if (!current || current.length > 200) return error(400, 'BAD_REQUEST', 'Add meg a jelenlegi jelszót.');
    const problem = newPasswordError(next, current);
    if (problem) return error(400, 'WEAK_PASSWORD', problem);

    try {
      const ip = clientIp(req, context);
      const state = await limiter.check(ip);
      if (state.blocked) {
        return error(429, 'TOO_MANY_ATTEMPTS', 'Túl sok próbálkozás. Próbáld újra 15 perc múlva.', {
          'Retry-After': String(state.retryAfter),
        });
      }
      if (!(await credentials.verify(current))) {
        await limiter.fail(ip);
        return error(400, 'BAD_CURRENT_PASSWORD', 'A jelenlegi jelszó hibás.');
      }
      await limiter.reset(ip);
      await credentials.setClientPassword(next);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof CredentialStoreError) return error(503, 'CREDENTIAL_STORE', MESSAGES.PASSWORD_NOT_SAVED);
      if (e instanceof ConfigError) {
        console.error('Konfigurációs hiba:', e.message);
        return error(500, 'CONFIG_ERROR', MESSAGES.CONFIG_ERROR);
      }
      console.error('password hiba:', e);
      return error(500, 'SERVER_ERROR', MESSAGES.SERVER_ERROR);
    }
  };
}

export default makeHandler(createRateLimiter());

export const config = { path: '/api/password' };

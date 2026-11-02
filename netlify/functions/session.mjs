import { json, error, MESSAGES } from '../lib/http.mjs';
import { ConfigError, readSession } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return error(405, 'METHOD_NOT_ALLOWED', MESSAGES.METHOD_NOT_ALLOWED, { Allow: 'GET' });
  }
  try {
    return json({ authenticated: readSession(req) !== null });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error('Konfigurációs hiba:', e.message);
      return error(500, 'CONFIG_ERROR', MESSAGES.CONFIG_ERROR);
    }
    console.error('session hiba:', e);
    return error(500, 'SERVER_ERROR', MESSAGES.SERVER_ERROR);
  }
};

export const config = { path: '/api/session' };

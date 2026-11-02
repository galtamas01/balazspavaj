import { json, error, MESSAGES } from '../lib/http.mjs';
import { checkOrigin, clearSessionCookie } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return error(405, 'METHOD_NOT_ALLOWED', MESSAGES.METHOD_NOT_ALLOWED, { Allow: 'POST' });
  }
  if (!checkOrigin(req)) return error(403, 'BAD_ORIGIN', MESSAGES.BAD_ORIGIN);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
};

export const config = { path: '/api/logout' };

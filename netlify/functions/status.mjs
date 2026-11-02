// GET /api/status – a havi publikálások száma és a becsült Netlify-kreditfogyás (a production deployok miatt).
import { json } from '../lib/http.mjs';
import { guardGet } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub } from '../lib/github.mjs';
import { toResponse } from '../lib/errors.mjs';

export const PUBLISH_PREFIX = 'CMS: publikálás';
export const CREDITS_PER_DEPLOY = 15; // Netlify: egy production deploy 15 kredit
export const MONTHLY_CREDITS = 300; // Netlify Free
export const WARN_AFTER = 10;

export function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export function makeHandler(getGithub, now = () => new Date()) {
  return async (req) => {
    const denied = guardGet(req);
    if (denied) return denied;
    try {
      const github = await getGithub();
      const messages = await github.listCommitMessages(github.config.mainBranch, monthStart(now()));
      const publishes = messages.filter((m) => m.startsWith(PUBLISH_PREFIX)).length;
      return json({
        ok: true,
        publishesThisMonth: publishes,
        estimatedCredits: publishes * CREDITS_PER_DEPLOY,
        monthlyCredits: MONTHLY_CREDITS,
        warnAfter: WARN_AFTER,
        previewUrl: github.config.previewUrl || '',
      });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/status' };

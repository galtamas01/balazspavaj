// GET /api/image?path=/assets/pavaje/x.webp – a piszkozat-ágon (cms-draft) lévő kép kiszolgálása az admin felületnek.
// Az újonnan feltöltött képek csak a cms-draft ágon vannak meg; az admin az éles oldalról töltődik be,
// ezért ezek miniatűrjét innen kapja (a main-ben is meglévő képeket a felület közvetlenül tölti).
import { error, MESSAGES } from '../lib/http.mjs';
import { guardGet } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub } from '../lib/github.mjs';
import { toResponse } from '../lib/errors.mjs';

export function makeHandler(getGithub) {
  return async (req) => {
    const denied = guardGet(req);
    if (denied) return denied;
    try {
      const github = await getGithub();
      const { draftBranch, assetsDir } = github.config;
      const path = new URL(req.url).searchParams.get('path') ?? '';
      const allowed = new RegExp(`^/${assetsDir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/[a-z0-9_-]+\\.webp$`);
      if (!allowed.test(path)) return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);

      const bytes = await github.readBuffer(path.slice(1), draftBranch);
      if (!bytes) return error(404, 'NOT_FOUND', 'A kép nem található.');
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(bytes.length),
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/image' };

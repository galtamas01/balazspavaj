// POST /api/discard – a nem publikált módosítások elvetése: a piszkozat-ág visszaáll az éles ág állapotára.
// Bemenet: { draftSha } (amit az ügyfél látott; ha közben változott, 409). A feltöltött, de nem publikált képek
// is eltűnnek, mert csak a piszkozat-ágon voltak meg.
import { json, error, MESSAGES } from '../lib/http.mjs';
import { guardPost } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub, GithubError, StaleBranchError } from '../lib/github.mjs';
import { toResponse } from '../lib/errors.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

export function makeHandler(getGithub) {
  return async (req) => {
    const denied = guardPost(req);
    if (denied) return denied;

    let body;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }
    if (typeof body?.draftSha !== 'string' || !SHA_RE.test(body.draftSha)) {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }

    try {
      const github = await getGithub();
      const { draftBranch, mainBranch } = github.config;
      const head = await github.getRef(draftBranch);
      if (head !== body.draftSha) throw new StaleBranchError();
      const mainSha = await github.getRef(mainBranch);
      if (!mainSha) throw new GithubError(404, `A(z) ${mainBranch} ág nem található.`);
      await github.resetBranch(draftBranch, mainSha, { force: true });
      return json({ ok: true, draftSha: mainSha });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/discard' };

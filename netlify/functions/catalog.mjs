// GET /api/catalog – a szerkesztő kiinduló adatai: a piszkozat-ág (cms-draft) és az éles ág (main) katalógusa.
// Első híváskor létrehozza a cms-draft ágat a main jelenlegi állapotából.
import { json } from '../lib/http.mjs';
import { guardGet } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub } from '../lib/github.mjs';
import { DataError, toResponse } from '../lib/errors.mjs';

async function readJson(github, path, ref, { required }) {
  const text = await github.readFile(path, ref);
  if (text === null) {
    if (required) throw new DataError(`${path} nem található (${ref}).`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${path} nem érvényes JSON (${ref}).`);
  }
}

export function makeHandler(getGithub) {
  return async (req) => {
    const denied = guardGet(req);
    if (denied) return denied;
    try {
      const github = await getGithub();
      const { draftBranch, mainBranch, productsPath, colorsPath } = github.config;

      const draftSha = await github.ensureBranch(draftBranch, mainBranch);
      const mainSha = await github.getRef(mainBranch);
      const [draftProducts, draftColors, mainProducts, mainColors] = await Promise.all([
        readJson(github, productsPath, draftSha, { required: true }),
        readJson(github, colorsPath, draftSha, { required: false }),
        readJson(github, productsPath, mainSha, { required: true }),
        readJson(github, colorsPath, mainSha, { required: false }),
      ]);

      return json({
        ok: true,
        draft: { products: draftProducts, colors: draftColors },
        main: { products: mainProducts, colors: mainColors },
        draftSha,
        mainSha,
        previewUrl: github.config.previewUrl || '',
        assetsPrefix: `/${github.config.assetsDir}/`,
      });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/catalog' };

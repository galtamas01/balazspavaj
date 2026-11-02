// POST /api/publish – a piszkozat (cms-draft) élesítése: egy összefésülő commit a main ágra → egyetlen production deploy.
// Bemenet: { draftSha, summary }. A draftSha az, amit az ügyfél utoljára látott; ha közben bármi változott, a kérés
// elutasított (409), és az ügyfél újratölti az állapotot, így sosem publikálódik olyan, amit nem látott.
import { json, error, MESSAGES } from '../lib/http.mjs';
import { guardPost } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub, MergeConflictError } from '../lib/github.mjs';
import { toResponse, DataError } from '../lib/errors.mjs';
import { syncDraft } from '../lib/sync.mjs';
import { validateCatalog, collectImagePaths } from '../../src/shared/catalog-schema.js';
import { PUBLISH_PREFIX } from './status.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function parse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${label} nem érvényes JSON.`);
  }
}

export function publishMessage(summary) {
  const text = String(summary ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return text ? `${PUBLISH_PREFIX} – ${text}` : PUBLISH_PREFIX;
}

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
      const { draftBranch, mainBranch, productsPath, colorsPath, assetsDir } = github.config;

      // 1) A piszkozatnak tartalmaznia kell az éles ág minden commitját, különben a publikálás felülírná őket.
      const sync = await syncDraft(github);
      if (sync.conflict) throw new MergeConflictError();
      if (sync.draftSha !== body.draftSha) {
        // közben mentett valaki, vagy az éles ág változása beolvadt: az ügyfél nem ezt látta
        const stale = sync.action === 'none';
        return error(409, stale ? 'STALE' : 'RELOAD', stale ? MESSAGES.STALE : MESSAGES.RELOAD);
      }

      // 2) Van-e egyáltalán mit publikálni?
      const cmp = await github.compare(sync.mainSha, sync.draftSha);
      if (cmp.files.length === 0) return error(400, 'NOTHING_TO_PUBLISH', MESSAGES.NOTHING_TO_PUBLISH);

      // 3) Utolsó védvonal: a publikálandó állapot érvényes (a mentés már ellenőrizte, de a fejlesztő is nyúlhatott hozzá).
      const [productsText, colorsText, files] = await Promise.all([
        github.readFile(productsPath, sync.draftSha),
        github.readFile(colorsPath, sync.draftSha),
        github.listFiles(sync.draftSha, assetsDir),
      ]);
      if (productsText === null) throw new DataError('products.json hiányzik.');
      const assetsPrefix = `/${assetsDir}/`;
      const draftProducts = parse(productsText, 'products.json');
      const draftColors = colorsText ? parse(colorsText, 'colors.json') : {};
      const result = validateCatalog(draftProducts, draftColors, {
        assets: new Set(files.map((p) => `/${p}`)),
        assetsPrefix,
      });
      if (!result.ok) {
        return json({ ok: false, code: 'VALIDATION', message: MESSAGES.VALIDATION, errors: result.errors, warnings: result.warnings }, 400);
      }

      // 4) Az éles oldal eddig használt, ezután már egyetlen termék által sem hivatkozott képei törlődnek (különben örökre
      //    a repóban maradnának: a mentés a main által még használt képet nem törölheti). Csak olyan fájl törlődik, amit
      //    az éles katalógus eddig tényleg használt, más fájlhoz nem nyúlunk.
      const [mainProductsText, mainColorsText] = await Promise.all([
        github.readFile(productsPath, sync.mainSha),
        github.readFile(colorsPath, sync.mainSha),
      ]);
      const stillUsed = collectImagePaths(draftProducts, draftColors);
      const existing = new Set(files);
      const unused = mainProductsText === null
        ? []
        : [...collectImagePaths(parse(mainProductsText, 'main products.json'), mainColorsText ? parse(mainColorsText, 'main colors.json') : {})]
            .filter((p) => p.startsWith(assetsPrefix) && !stillUsed.has(p) && existing.has(p.slice(1)))
            .map((p) => p.slice(1));

      // 5) Egy összefésülő commit a main-re (egyetlen production deploy), majd a piszkozat is a main-re áll.
      const published = await github.publishCommit({
        branch: mainBranch,
        baseSha: sync.mainSha,
        headSha: sync.draftSha,
        message: publishMessage(body.summary),
        deletes: unused,
      });
      try {
        await github.resetBranch(draftBranch, published.sha, { force: false });
      } catch (e) {
        // nem végzetes: a következő betöltéskor a piszkozat úgyis a main-re áll (lásd sync.mjs)
        console.error('A piszkozat-ág átállítása nem sikerült:', e.message);
      }
      return json({ ok: true, mainSha: published.sha, draftSha: published.sha });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/publish' };

// POST /api/save – a katalógus (és az új képek) mentése EGY atomi commitban a cms-draft ágra.
// Bemenet: { baseSha, products, colors, uploads: [{ path, base64 }], message }
// A szerver mindent újravalidál; a kliens ellenőrzésére nem támaszkodik.
import { json, error, MESSAGES } from '../lib/http.mjs';
import { guardPost } from '../lib/auth.mjs';
import { getConfig } from '../lib/config.mjs';
import { createGithub, StaleBranchError } from '../lib/github.mjs';
import { DataError, toResponse } from '../lib/errors.mjs';
import { validateCatalog, serializeCatalog, serializeColors, collectImagePaths } from '../../src/shared/catalog-schema.js';

export const MAX_BODY_CHARS = 6_500_000;
export const MAX_UPLOADS = 20;
export const MAX_IMAGE_BYTES = 1_500_000;
const SHA_RE = /^[0-9a-f]{40}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${label} nem érvényes JSON.`);
  }
}

function cleanMessage(message) {
  const text = String(message ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `CMS: ${text || 'mentés'}`;
}

function isWebp(buffer) {
  return (
    buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function validationResponse(errors, warnings) {
  return json({ ok: false, code: 'VALIDATION', message: MESSAGES.VALIDATION, errors, warnings }, 400);
}

export function makeHandler(getGithub) {
  return async (req) => {
    const denied = guardPost(req);
    if (denied) return denied;

    let body;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_CHARS) return error(413, 'TOO_LARGE', MESSAGES.TOO_LARGE);
      body = JSON.parse(text);
    } catch {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }
    const { baseSha, products, colors, uploads = [], message } = body ?? {};
    if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha) || !products || !colors || !Array.isArray(uploads)) {
      return error(400, 'BAD_REQUEST', MESSAGES.BAD_REQUEST);
    }
    if (uploads.length > MAX_UPLOADS) return error(413, 'TOO_LARGE', MESSAGES.TOO_LARGE);

    try {
      const github = await getGithub();
      const { draftBranch, mainBranch, productsPath, colorsPath, assetsDir } = github.config;
      const assetsPrefix = `/${assetsDir}/`;

      // 1) Csak az utoljára látott állapotra lehet építeni.
      const head = await github.getRef(draftBranch);
      if (head !== baseSha) throw new StaleBranchError();

      // 2) Feltöltések ellenőrzése (útvonal, méret, valódi WebP).
      const uploadRe = new RegExp(`^${assetsPrefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[a-z0-9_-]+\\.webp$`);
      const files = new Map();
      const uploadErrors = [];
      uploads.forEach((u, i) => {
        const path = `uploads[${i}]`;
        if (!u || typeof u.path !== 'string' || !uploadRe.test(u.path) || typeof u.base64 !== 'string') {
          uploadErrors.push({ path, message: 'Érvénytelen kép feltöltés.' });
          return;
        }
        if (files.has(u.path)) {
          uploadErrors.push({ path, message: 'Ugyanaz a képfájl kétszer szerepel.' });
          return;
        }
        if (!BASE64_RE.test(u.base64)) {
          uploadErrors.push({ path, message: 'A kép adata hibás.' });
          return;
        }
        const buffer = Buffer.from(u.base64, 'base64');
        if (buffer.length > MAX_IMAGE_BYTES) {
          uploadErrors.push({ path, message: 'A kép túl nagy (legfeljebb 1,5 MB lehet).' });
        } else if (!isWebp(buffer)) {
          uploadErrors.push({ path, message: 'A kép nem WebP formátumú.' });
        } else {
          files.set(u.path, u.base64);
        }
      });
      if (uploadErrors.length) return validationResponse(uploadErrors, []);

      // 3) Validáció a repóban ténylegesen meglévő képekkel (+ a most feltöltöttekkel).
      const existingFiles = await github.listFiles(head, assetsDir);
      const assets = new Set(existingFiles.map((p) => `/${p}`));
      for (const path of files.keys()) assets.add(path);

      const result = validateCatalog(products, colors, { assets, assetsPrefix });
      if (!result.ok) return validationResponse(result.errors, result.warnings);

      // 4) Árva képek: a régi piszkozatban hivatkozott, de az újban és az éles ágon sem használt képek törlődnek.
      const [oldProductsText, oldColorsText, mainProductsText, mainColorsText] = await Promise.all([
        github.readFile(productsPath, head),
        github.readFile(colorsPath, head),
        github.readFile(productsPath, mainBranch),
        github.readFile(colorsPath, mainBranch),
      ]);
      if (oldProductsText === null || mainProductsText === null) throw new DataError('products.json hiányzik.');

      const keep = new Set([
        ...collectImagePaths(products, colors),
        ...collectImagePaths(parseJson(mainProductsText, 'main products.json'), mainColorsText ? parseJson(mainColorsText, 'main colors.json') : {}),
      ]);
      const previouslyUsed = collectImagePaths(
        parseJson(oldProductsText, 'draft products.json'),
        oldColorsText ? parseJson(oldColorsText, 'draft colors.json') : {},
      );
      const orphans = [...previouslyUsed].filter(
        (p) => p.startsWith(assetsPrefix) && !keep.has(p) && existingFiles.includes(p.slice(1)),
      );

      // 5) Egy commit: JSON-ok (csak ha változtak) + új képek + törlések.
      const productsText = serializeCatalog(products);
      const colorsText = serializeColors(colors);
      const writes = [];
      if (productsText !== oldProductsText) writes.push({ path: productsPath, text: productsText });
      if (colorsText !== oldColorsText) writes.push({ path: colorsPath, text: colorsText });
      for (const [path, base64] of files) writes.push({ path: path.slice(1), base64 });

      const commit = await github.commitFiles({
        branch: draftBranch,
        baseSha: head,
        writes,
        deletes: orphans.map((p) => p.slice(1)),
        message: cleanMessage(message),
      });

      return json({
        ok: true,
        draftSha: commit.sha,
        changed: commit.changed,
        uploaded: files.size,
        deleted: orphans.length,
        warnings: result.warnings,
      });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export default makeHandler(async () => createGithub(getConfig()));

export const config = { path: '/api/save' };

// A szerkesztő képes mentési folyamata a valódi /api/save kezelővel és a memóriabeli GitHub-szimulátorral.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSessionCookie } from '../netlify/lib/auth.mjs';
import { createGithub } from '../netlify/lib/github.mjs';
import { makeHandler as makeCatalog } from '../netlify/functions/catalog.mjs';
import { makeHandler as makeSave } from '../netlify/functions/save.mjs';
import { makeHandler as makeImage } from '../netlify/functions/image.mjs';
import { collectImagePaths } from '../src/shared/catalog-schema.js';
import { FakeGitHub, fakeWebp } from './helpers/fake-github.mjs';
import { toForm, emptyForm, applyForm, newRow } from '../admin/lib/product-form.js';
import { assignUploadPaths, toUploadList, setSlotBlob, clearSlot, emptySlot } from '../admin/lib/image-slots.js';

const ORIGIN = 'https://www.balazspavaj.ro';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const productsText = read('produse/products.json');
const colorsText = read('produse/colors.json');
const products = JSON.parse(productsText);
const colors = JSON.parse(colorsText);
const CONFIG = {
  token: 't', owner: 'galtamas01', repo: 'balazspavaj', mainBranch: 'main', draftBranch: 'cms-draft',
  productsPath: 'produse/products.json', colorsPath: 'produse/colors.json', assetsDir: 'assets/pavaje', previewUrl: 'https://p.example',
};

let cookie;
beforeEach(() => {
  process.env.SESSION_SECRET = 'k'.repeat(48);
  cookie = createSessionCookie(new Request(`${ORIGIN}/api/login`)).split(';')[0];
});

function setup() {
  const files = { 'produse/products.json': productsText, 'produse/colors.json': colorsText };
  for (const p of collectImagePaths(products, colors)) files[p.slice(1)] = fakeWebp(p);
  const fake = new FakeGitHub({ files });
  const getGithub = async () => createGithub(CONFIG, fake.fetch);
  const catalog = makeCatalog(getGithub);
  const save = makeSave(getGithub);
  const image = makeImage(getGithub);
  const load = async () => (await catalog(new Request(`${ORIGIN}/api/catalog`, { headers: { cookie } }))).json();
  // egy mentés úgy, ahogy a szerkesztő csinálja: a betöltött állapotból, az űrlap alapján
  const submit = async (form) => {
    const state = await load();
    const uploads = await toUploadList(await assignUploadPaths(form, state.assetsPrefix));
    const result = applyForm(state.draft.products, state.draft.colors, form);
    assert.deepEqual(result.errors, [], 'az űrlap érvényes');
    const response = await save(
      new Request(`${ORIGIN}/api/save`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN },
        body: JSON.stringify({ baseSha: state.draftSha, products: result.products, colors: state.draft.colors, uploads, message: 'teszt' }),
      }),
    );
    return { response, body: await response.json(), state };
  };
  return { fake, load, submit, image };
}

const picture = (seed) => new Blob([fakeWebp(seed)], { type: 'image/webp' });

test('új termék képpel: a fájl felkerül a cms-draft ágra, a JSON hivatkozik rá', async () => {
  const { fake, load, submit } = setup();
  const form = emptyForm('borduri');
  Object.assign(form, { name: 'Bordură nouă', id: 'bordura-noua', priceFrom: '12.5', dimensions: '50x20 cm' });
  setSlotBlob(form.image, { blob: picture('uj-fo-kep'), previewUrl: '' });
  form.colors.push({ ...newRow.color('gri'), image: emptySlot() });
  setSlotBlob(form.colors[0].image, { blob: picture('uj-szin-kep'), previewUrl: '' });

  const { response, body } = await submit(form);
  assert.equal(response.status, 200);
  assert.equal(body.uploaded, 2);

  const saved = (await load()).draft.products.borduri['bordura-noua'];
  assert.match(saved.image, /^\/assets\/pavaje\/bordura-noua_[0-9a-f]{8}\.webp$/);
  assert.match(saved.colors[0].image, /^\/assets\/pavaje\/bordura-noua_gri_[0-9a-f]{8}\.webp$/);
  assert.deepEqual(fake.fileBuffer('cms-draft', saved.image.slice(1)), fakeWebp('uj-fo-kep'));
  assert.equal(fake.fileBuffer('main', saved.image.slice(1)), null, 'a main ágra nem kerül semmi');
  assert.equal(fake.commitCount('cms-draft') - fake.commitCount('main'), 1, 'egyetlen commit');
});

test('kép cseréje: a régi, már csak itt használt fájl törlődik', async () => {
  const { fake, load, submit } = setup();
  // 1) új termék saját képpel
  let form = emptyForm('borduri');
  Object.assign(form, { name: 'Teszt', id: 'teszt-termek', priceFrom: '5', dimensions: '1x1' });
  setSlotBlob(form.image, { blob: picture('elso'), previewUrl: '' });
  await submit(form);
  const first = (await load()).draft.products.borduri['teszt-termek'].image;
  assert.ok(fake.fileBuffer('cms-draft', first.slice(1)));

  // 2) a kép lecserélése
  const state = await load();
  form = toForm('borduri', 'teszt-termek', state.draft.products.borduri['teszt-termek']);
  setSlotBlob(form.image, { blob: picture('masodik'), previewUrl: '' });
  const { body } = await submit(form);
  const second = (await load()).draft.products.borduri['teszt-termek'].image;
  assert.notEqual(second, first);
  assert.equal(body.deleted, 1);
  assert.equal(fake.fileBuffer('cms-draft', first.slice(1)), null, 'a régi kép törölve');
  assert.ok(fake.fileBuffer('cms-draft', second.slice(1)));
});

test('a main ágon is használt, vagy más termék által használt kép nem törlődik', async () => {
  const { fake, load, submit } = setup();
  // az autoblocant-6cm képét lecseréljük: a régit a main-ben is használja, ezért megmarad
  let state = await load();
  const original = state.draft.products.pavaje['autoblocant-6cm'].image;
  let form = toForm('pavaje', 'autoblocant-6cm', state.draft.products.pavaje['autoblocant-6cm']);
  setSlotBlob(form.image, { blob: picture('csere'), previewUrl: '' });
  const { body } = await submit(form);
  assert.equal(body.deleted, 0);
  assert.ok(fake.fileBuffer('cms-draft', original.slice(1)), 'a main-ben használt kép megmaradt');

  // a kép eltávolítása a szín-sorból: a fájlt a többi termék tovább használja (autoblocant-8cm a 6 cm-es fájlokra mutat)
  state = await load();
  const sharedColorImage = state.draft.products.pavaje['autoblocant-8cm'].colors[1].image;
  assert.equal(sharedColorImage, state.draft.products.pavaje['autoblocant-6cm'].colors[1].image, 'valóban közös fájl');
  form = toForm('pavaje', 'autoblocant-6cm', state.draft.products.pavaje['autoblocant-6cm']);
  clearSlot(form.colors[1].image);
  await submit(form);
  assert.ok(fake.fileBuffer('cms-draft', sharedColorImage.slice(1)), 'a közös kép megmaradt');
});

test('hibás feltöltést a szerver elutasít (nem WebP), és nem commitol', async () => {
  const { fake, load, submit } = setup();
  const before = (await load()).draftSha;
  const form = emptyForm('borduri');
  Object.assign(form, { name: 'Teszt', id: 'teszt-hibas', priceFrom: '5', dimensions: '1x1' });
  setSlotBlob(form.image, { blob: new Blob([Buffer.from('ez nem webp')], { type: 'image/webp' }), previewUrl: '' });
  const { response, body } = await submit(form);
  assert.equal(response.status, 400);
  assert.equal(body.code, 'VALIDATION');
  assert.ok(body.errors[0].message.includes('WebP'));
  assert.equal(fake.head('cms-draft'), before, 'nem jött létre commit');
});

test('/api/image: a piszkozat-ág képét adja, csak bejelentkezve, csak a képmappából', async () => {
  const { fake, load, submit, image } = setup();
  const form = emptyForm('borduri');
  Object.assign(form, { name: 'Teszt', id: 'teszt-kep', priceFrom: '5', dimensions: '1x1' });
  setSlotBlob(form.image, { blob: picture('draft-only-kep'), previewUrl: '' });
  await submit(form);
  const path = (await load()).draft.products.borduri['teszt-kep'].image;

  const get = (query, headers = { cookie }) => image(new Request(`${ORIGIN}/api/image?path=${encodeURIComponent(query)}`, { headers }));
  const ok = await get(path);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/webp');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), fakeWebp('draft-only-kep'), 'a bájtok sértetlenek');

  assert.equal((await get(path, {})).status, 401);
  assert.equal((await get('/assets/pavaje/nincs-ilyen.webp')).status, 404);
  for (const bad of ['', '/produse/products.json', '/assets/pavaje/../../package.json', '/assets/pavaje/x.png', 'assets/pavaje/x.webp', '/assets/pavaje/A.webp']) {
    assert.equal((await get(bad)).status, 400, bad);
  }
  assert.equal((await image(new Request(`${ORIGIN}/api/image?path=${path}`, { method: 'POST', headers: { cookie, origin: ORIGIN } }))).status, 405);
  assert.ok(fake.head('cms-draft'));
});

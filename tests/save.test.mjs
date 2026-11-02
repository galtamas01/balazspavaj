import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSessionCookie } from '../netlify/lib/auth.mjs';
import { createGithub } from '../netlify/lib/github.mjs';
import { makeHandler as makeCatalog } from '../netlify/functions/catalog.mjs';
import { makeHandler as makeSave, MAX_IMAGE_BYTES } from '../netlify/functions/save.mjs';
import { collectImagePaths, serializeCatalog } from '../src/shared/catalog-schema.js';
import { FakeGitHub, fakeWebp } from './helpers/fake-github.mjs';

const ORIGIN = 'https://www.balazspavaj.ro';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const productsText = read('produse/products.json');
const colorsText = read('produse/colors.json');
const products = JSON.parse(productsText);
const colors = JSON.parse(colorsText);

const CONFIG = {
  token: 't',
  owner: 'galtamas01',
  repo: 'balazspavaj',
  mainBranch: 'main',
  draftBranch: 'cms-draft',
  productsPath: 'produse/products.json',
  colorsPath: 'produse/colors.json',
  assetsDir: 'assets/pavaje',
};

let cookie;
beforeEach(() => {
  process.env.SESSION_SECRET = 'k'.repeat(48);
  cookie = createSessionCookie(new Request(`${ORIGIN}/api/login`)).split(';')[0];
});

function setup({ withProducts = true } = {}) {
  const files = { 'index.html': '<html>', 'produse/colors.json': colorsText };
  if (withProducts) files['produse/products.json'] = productsText;
  for (const p of collectImagePaths(products, colors)) files[p.slice(1)] = fakeWebp(p);
  const fake = new FakeGitHub({ files });
  const getGithub = async () => createGithub(CONFIG, fake.fetch);
  const catalog = makeCatalog(getGithub);
  const save = makeSave(getGithub);

  const get = (handler, path, headers = { cookie }) => handler(new Request(`${ORIGIN}${path}`, { headers }));
  const post = (body, { headers = { cookie }, origin = ORIGIN, raw } = {}) =>
    save(
      new Request(`${ORIGIN}/api/save`, {
        method: 'POST',
        headers: { ...headers, ...(origin ? { origin } : {}) },
        body: raw ?? JSON.stringify(body),
      }),
    );
  const load = async () => (await get(catalog, '/api/catalog')).json();
  // a szerkesztő a betöltött állapotból indul, és a saját példányát módosítja
  const edit = async (mutate, extra = {}) => {
    const c = await load();
    const p = structuredClone(c.draft.products);
    const col = structuredClone(c.draft.colors);
    mutate(p, col);
    return { c, response: await post({ baseSha: c.draftSha, products: p, colors: col, uploads: [], ...extra }), p, col };
  };
  return { fake, get, post, load, edit, catalog, save };
}

const upload = (path, buffer) => ({ path, base64: buffer.toString('base64') });
const newProduct = (image) => ({ name: 'Új termék', image, price: '12,5', unit: 'mp' });

test('catalog: munkamenet kell, csak GET, és létrehozza a cms-draft ágat', async () => {
  const { fake, get, catalog } = setup();
  assert.equal((await get(catalog, '/api/catalog', {})).status, 401);
  assert.equal((await catalog(new Request(`${ORIGIN}/api/catalog`, { method: 'POST', headers: { cookie, origin: ORIGIN } }))).status, 405);
  assert.equal(fake.head('cms-draft'), null, 'hibás kérések nem hoznak létre ágat');

  const res = await get(catalog, '/api/catalog');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const data = await res.json();
  assert.deepEqual(data.draft.products, products);
  assert.deepEqual(data.draft.colors, colors);
  assert.deepEqual(data.main.products, products);
  assert.equal(data.draftSha, fake.head('cms-draft'));
  assert.equal(data.draftSha, fake.head('main'));
  assert.equal(data.mainSha, fake.head('main'));
});

test('catalog: hiányzó colors.json üres palettát ad, hiányzó products.json adathiba', async () => {
  const noColors = new FakeGitHub({ files: { 'produse/products.json': productsText } });
  const handler = makeCatalog(async () => createGithub(CONFIG, noColors.fetch));
  const data = await (await handler(new Request(`${ORIGIN}/api/catalog`, { headers: { cookie } }))).json();
  assert.deepEqual(data.draft.colors, {});

  const { get, catalog } = setup({ withProducts: false });
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await get(catalog, '/api/catalog');
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'DATA_INVALID');
  } finally {
    console.error = origError;
  }
});

test('save: változatlan tartalom → nincs commit', async () => {
  const { fake, edit } = setup();
  const { c, response } = await edit(() => {});
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.changed, false);
  assert.equal(data.draftSha, c.draftSha);
  assert.equal(fake.head('cms-draft'), c.draftSha);
});

test('save: ár módosítása egyetlen commit a cms-draft ágon, a main érintetlen', async () => {
  const { fake, edit, load } = setup();
  const mainBefore = fake.head('main');
  const { c, response } = await edit((p) => {
    p.pavaje['autoblocant-6cm'].price = '41';
  }, { message: 'Ár módosítása' });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.changed, true);
  assert.equal(fake.head('cms-draft'), data.draftSha);
  assert.notEqual(data.draftSha, c.draftSha);
  assert.equal(fake.head('main'), mainBefore);
  assert.equal(fake.message('cms-draft'), 'CMS: Ár módosítása');
  assert.equal(fake.commitCount('cms-draft'), fake.commitCount('main') + 1);

  const draftText = fake.fileAt('cms-draft', 'produse/products.json');
  const mainLines = productsText.split('\n');
  const draftLines = draftText.split('\n');
  assert.equal(draftLines.length, mainLines.length);
  assert.equal(draftLines.filter((line, i) => line !== mainLines[i]).length, 1, 'a diffben csak a módosított sor szerepel');
  assert.equal(JSON.parse(draftText).pavaje['autoblocant-6cm'].price, '41');

  const again = await load();
  assert.equal(again.draft.products.pavaje['autoblocant-6cm'].price, '41');
  assert.equal(again.main.products.pavaje['autoblocant-6cm'].price, products.pavaje['autoblocant-6cm'].price);
});

test('save: elavult baseSha → 409 STALE, semmi nem íródik', async () => {
  const { fake, edit, post } = setup();
  const { c } = await edit((p) => {
    p.pavaje['autoblocant-6cm'].price = '41';
  });
  const headAfterFirst = fake.head('cms-draft');

  const res = await post({ baseSha: c.draftSha, products, colors, uploads: [] });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'STALE');
  assert.equal(fake.head('cms-draft'), headAfterFirst);

  const other = fake.commitDirect('cms-draft', { 'masik.txt': 'x' });
  const res2 = await post({ baseSha: headAfterFirst, products, colors, uploads: [] });
  assert.equal(res2.status, 409);
  assert.equal(fake.head('cms-draft'), other);
});

test('save: érvénytelen adat → 400 VALIDATION a hibák listájával, nincs commit', async () => {
  const { fake, edit } = setup();
  const { c, response } = await edit((p) => {
    p.pavaje['autoblocant-6cm'].price = 'olcsó';
    p.pavaje['autoblocant-6cm'].colors[0].name = 'lila';
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.code, 'VALIDATION');
  assert.ok(data.errors.some((e) => e.path === 'pavaje.autoblocant-6cm.price'));
  assert.ok(data.errors.some((e) => e.path === 'pavaje.autoblocant-6cm.colors[0].name'));
  assert.equal(fake.head('cms-draft'), c.draftSha);
});

test('save: hivatkozott, de nem létező kép → 400', async () => {
  const { edit } = setup();
  const { response } = await edit((p) => {
    p.pavaje['uj-termek'] = newProduct('/assets/pavaje/nincs_ilyen.webp');
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.ok(data.errors.some((e) => e.path === 'pavaje.uj-termek.image' && e.message.includes('nem található')));
});

test('save: új kép feltöltése, majd a termék törlésekor az árva kép törlődik', async () => {
  const { fake, edit, post } = setup();
  const imagePath = '/assets/pavaje/uj-termek_ab12cd34.webp';
  const bytes = fakeWebp('uj-kep');

  const first = await edit(
    (p) => {
      p.pavaje['uj-termek'] = newProduct(imagePath);
    },
    { uploads: [upload(imagePath, bytes)] },
  );
  const firstData = await first.response.json();
  assert.equal(first.response.status, 200, JSON.stringify(firstData));
  assert.equal(firstData.uploaded, 1);
  assert.deepEqual(fake.fileBuffer('cms-draft', imagePath.slice(1)), bytes);
  assert.equal(fake.fileBuffer('main', imagePath.slice(1)), null);
  assert.equal(JSON.parse(fake.fileAt('cms-draft', 'produse/products.json')).pavaje['uj-termek'].image, imagePath);

  // a termék törlése: a kép sem az újban, sem a main-ben nincs → törlődik
  const p2 = structuredClone(first.p);
  delete p2.pavaje['uj-termek'];
  const second = await post({ baseSha: firstData.draftSha, products: p2, colors, uploads: [] });
  const secondData = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondData.deleted, 1);
  assert.equal(fake.fileBuffer('cms-draft', imagePath.slice(1)), null);
  assert.equal(fake.fileAt('cms-draft', 'produse/products.json'), productsText, 'visszaállt az eredeti katalógus, byte-azonosan');
});

test('save: a main-ben használt kép nem törlődik, még ha a piszkozatból el is tűnik a hivatkozás', async () => {
  const { fake, edit } = setup();
  const nardo = products['premium-pavaje']['pavaj-nardo'].image;
  const { response } = await edit((p) => {
    delete p['premium-pavaje']['pavaj-nardo'];
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.deleted, 0);
  assert.ok(fake.fileBuffer('cms-draft', nardo.slice(1)), 'a kép megmaradt');
  assert.equal(JSON.parse(fake.fileAt('cms-draft', 'produse/products.json'))['premium-pavaje']['pavaj-nardo'], undefined);
});

test('save: hibás feltöltések visszautasítva (nem WebP, rossz útvonal, túl nagy, duplikált)', async () => {
  const { fake, load, post } = setup();
  const c = await load();
  const base = { baseSha: c.draftSha, products, colors };
  const good = '/assets/pavaje/jo_12345678.webp';

  const cases = {
    'nem WebP': [upload(good, Buffer.from('ez nem kep'))],
    'másik mappa': [upload('/assets/masik/x.webp', fakeWebp())],
    'bejárás': [upload('/assets/pavaje/../x.webp', fakeWebp())],
    'nagybetű': [upload('/assets/pavaje/Kep.webp', fakeWebp())],
    'rossz kiterjesztés': [upload('/assets/pavaje/x.png', fakeWebp())],
    'túl nagy': [upload(good, fakeWebp('x', MAX_IMAGE_BYTES))],
    'duplikált': [upload(good, fakeWebp()), upload(good, fakeWebp())],
    'hibás base64': [{ path: good, base64: '***' }],
    'hiányzó adat': [{ path: good }],
  };
  for (const [name, uploads] of Object.entries(cases)) {
    const res = await post({ ...base, uploads });
    assert.equal(res.status, 400, name);
    assert.equal((await res.json()).code, 'VALIDATION', name);
  }
  assert.equal(fake.head('cms-draft'), c.draftSha);

  const tooMany = Array.from({ length: 21 }, (_, i) => upload(`/assets/pavaje/k${i}_12345678.webp`, fakeWebp()));
  assert.equal((await post({ ...base, uploads: tooMany })).status, 413);
});

test('save: védelmek – munkamenet, Origin, formátum', async () => {
  const { fake, load, post } = setup();
  const c = await load();
  const body = { baseSha: c.draftSha, products, colors, uploads: [] };

  assert.equal((await post(body, { headers: {} })).status, 401);
  assert.equal((await post(body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(body, { origin: null })).status, 403);
  assert.equal((await post(null, { raw: 'nem json' })).status, 400);
  assert.equal((await post({ ...body, baseSha: 'rovid' })).status, 400);
  assert.equal((await post({ baseSha: c.draftSha })).status, 400);
  assert.equal((await post(null, { raw: 'x'.repeat(6_600_000) })).status, 413);
  assert.equal(fake.head('cms-draft'), c.draftSha);
});

test('save: a commit-üzenet megtisztított, alapértelmezett szöveggel', async () => {
  const { fake, edit } = setup();
  const r1 = await edit((p) => { p.pavaje['autoblocant-6cm'].price = '41'; }, { message: 'Új ár\n\nHAMIS: sor\t' + 'x'.repeat(300) });
  assert.equal(r1.response.status, 200);
  const msg = fake.message('cms-draft');
  assert.match(msg, /^CMS: Új ár HAMIS: sor x+$/);
  assert.ok(!msg.includes('\n'));
  assert.ok(msg.length <= 105);

  const r2 = await edit((p) => { p.pavaje['autoblocant-6cm'].price = '42'; });
  assert.equal(r2.response.status, 200);
  assert.equal(fake.message('cms-draft'), 'CMS: mentés');
});

test('save: új termék és színpaletta együtt, a kimenet formátuma megmarad', async () => {
  const { fake, edit } = setup();
  const { response } = await edit(
    (p, col) => {
      col.verde = { hex: '#4a6b3a' };
      p.borduri['uj-bordura'] = { ...newProduct(''), unit: 'buc', colors: [{ name: 'verde' }] };
    },
    { message: 'Új bordura' },
  );
  assert.equal(response.status, 200);
  const productsOut = fake.fileAt('cms-draft', 'produse/products.json');
  const colorsOut = fake.fileAt('cms-draft', 'produse/colors.json');
  assert.equal(JSON.parse(colorsOut).verde.hex, '#4a6b3a');
  assert.equal(productsOut, serializeCatalog(JSON.parse(productsOut)), 'a kimenet 4 szóközös, záró újsor nélküli');
  assert.ok(!colorsOut.endsWith('\n'));
  const keys = Object.keys(JSON.parse(productsOut).borduri);
  assert.equal(keys.at(-1), 'uj-bordura', 'az új termék a kategória végére kerül');
});

test('GitHub hozzáférési hiba → 502 GITHUB_AUTH (a részletek nem szivárognak)', async () => {
  const { fake, get, catalog, load, post } = setup();
  const c = await load();
  const origError = console.error;
  console.error = () => {};
  try {
    fake.failNext = { status: 401 };
    const res = await get(catalog, '/api/catalog');
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.code, 'GITHUB_AUTH');
    assert.ok(!JSON.stringify(data).includes('szimulált'));

    fake.failNext = { status: 500 };
    const res2 = await post({ baseSha: c.draftSha, products, colors, uploads: [] });
    assert.equal(res2.status, 502);
    assert.equal((await res2.json()).code, 'GITHUB_ERROR');
  } finally {
    console.error = origError;
  }
});

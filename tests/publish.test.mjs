import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSessionCookie } from '../netlify/lib/auth.mjs';
import { createGithub, StaleBranchError } from '../netlify/lib/github.mjs';
import { makeHandler as makeCatalog } from '../netlify/functions/catalog.mjs';
import { makeHandler as makeSave } from '../netlify/functions/save.mjs';
import { makeHandler as makePublish, publishMessage } from '../netlify/functions/publish.mjs';
import { makeHandler as makeDiscard } from '../netlify/functions/discard.mjs';
import { makeHandler as makeStatus, monthStart } from '../netlify/functions/status.mjs';
import { collectImagePaths } from '../src/shared/catalog-schema.js';
import { FakeGitHub, fakeWebp } from './helpers/fake-github.mjs';

const ORIGIN = 'https://www.balazspavaj.ro';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const productsText = read('produse/products.json');
const colorsText = read('produse/colors.json');
const products = JSON.parse(productsText);
const colors = JSON.parse(colorsText);

const CONFIG = {
  token: 't', owner: 'galtamas01', repo: 'balazspavaj', mainBranch: 'main', draftBranch: 'cms-draft',
  productsPath: 'produse/products.json', colorsPath: 'produse/colors.json', assetsDir: 'assets/pavaje',
  previewUrl: 'https://cms-draft--balazspavaj.netlify.app',
};

let cookie;
beforeEach(() => {
  process.env.SESSION_SECRET = 'k'.repeat(48);
  cookie = createSessionCookie(new Request(`${ORIGIN}/api/login`)).split(';')[0];
});

function setup({ now } = {}) {
  const files = { 'index.html': '<html>v1', 'produse/colors.json': colorsText, 'produse/products.json': productsText };
  for (const p of collectImagePaths(products, colors)) files[p.slice(1)] = fakeWebp(p);
  const fake = new FakeGitHub({ files });
  const getGithub = async () => createGithub(CONFIG, fake.fetch);
  const handlers = {
    catalog: makeCatalog(getGithub),
    save: makeSave(getGithub),
    publish: makeHandler(makePublish, getGithub),
    discard: makeHandler(makeDiscard, getGithub),
    status: makeStatus(getGithub, now),
  };
  const load = async () => (await handlers.catalog(new Request(`${ORIGIN}/api/catalog`, { headers: { cookie } }))).json();
  const post = (name, body, { headers = { cookie }, origin = ORIGIN } = {}) =>
    handlers[name](new Request(`${ORIGIN}/api/${name}`, { method: 'POST', headers: { ...headers, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
  // egy szerkesztés mentése a piszkozatra (az első termék árának átírása)
  const editPrice = async (price, uploads = [], mutate = null) => {
    const c = await load();
    const p = structuredClone(c.draft.products);
    p.pavaje['autoblocant-6cm'].price = price;
    mutate?.(p);
    const res = await post('save', { baseSha: c.draftSha, products: p, colors: c.draft.colors, uploads, message: 'Módosítás: teszt' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    return (await res.json()).draftSha;
  };
  return { fake, load, post, editPrice, handlers };
}
const makeHandler = (factory, getGithub) => factory(getGithub);
const quiet = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

test('publikálás: összefésülő commit a main-re saját üzenettel, a piszkozat a main-re áll, a fájlok átkerülnek', async () => {
  const { fake, load, post, editPrice } = setup();
  await load();
  const draftSha = await editPrice('99,50');
  const mainBefore = fake.head('main');

  const res = await post('publish', { draftSha, summary: '1 módosított' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mainSha, fake.head('main'));
  assert.equal(fake.message('main'), 'CMS: publikálás – 1 módosított');
  assert.deepEqual(fake.commits.get(fake.head('main')).parents, [mainBefore, draftSha], 'merge commit: [main, draft]');
  assert.equal(JSON.parse(fake.fileAt('main', 'produse/products.json')).pavaje['autoblocant-6cm'].price, '99,50');
  assert.equal(fake.head('cms-draft'), fake.head('main'), 'a piszkozat a main-re állt');
  assert.equal(fake.fileAt('main', 'index.html'), '<html>v1');
});

test('publikálás: a feltöltött kép átkerül, a cserélt régi kép törlődik a main-ről is', async () => {
  const { fake, load, post, editPrice } = setup();
  const c = await load();
  const oldImage = c.draft.products.pavaje['autoblocant-6cm'].image;
  const newImage = '/assets/pavaje/autoblocant-6cm_aaaaaaaa.webp';
  const draftSha = await editPrice('40', [{ path: newImage, base64: fakeWebp('new').toString('base64') }], (p) => {
    p.pavaje['autoblocant-6cm'].image = newImage;
    // a régi képet más termék nem használja ebben a tesztben
    for (const items of Object.values(p)) for (const prod of Object.values(items)) {
      if (prod.image === oldImage) prod.image = newImage;
      for (const row of [...(prod.colors || []), ...(prod.sizes || [])]) if (row.image === oldImage) row.image = newImage;
    }
  });
  assert.ok(fake.fileBuffer('cms-draft', newImage.slice(1)));
  assert.equal(fake.fileBuffer('main', newImage.slice(1)), null, 'publikálás előtt még nincs a main-en');
  assert.equal((await post('publish', { draftSha, summary: 'kép' })).status, 200);
  assert.ok(fake.fileBuffer('main', newImage.slice(1)), 'publikálás után ott van');
  assert.equal(fake.fileBuffer('main', oldImage.slice(1)), null, 'a régi kép törlődött');
});

test('publikálás: elavult draftSha → 409 STALE, a main nem változik; nincs mit publikálni → 400', async () => {
  const { fake, load, post, editPrice } = setup();
  const c = await load();
  const mainBefore = fake.head('main');
  const nothing = await post('publish', { draftSha: c.draftSha });
  assert.equal(nothing.status, 400);
  assert.equal((await nothing.json()).code, 'NOTHING_TO_PUBLISH');

  const draftSha = await editPrice('77');
  await editPrice('78'); // közben másik mentés
  const stale = await post('publish', { draftSha });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'STALE');
  assert.equal(fake.head('main'), mainBefore);
});

test('a fejlesztő a main-re pusholt, a piszkozatnak nincs saját változása → a piszkozat a main-re áll (előnézet új kóddal)', async () => {
  const { fake, load } = setup();
  const first = await load();
  fake.commitDirect('main', { 'index.html': '<html>v2' });
  const next = await load();
  assert.notEqual(next.draftSha, first.draftSha);
  assert.equal(next.draftSha, fake.head('main'));
  assert.equal(next.syncConflict, false);
  assert.equal(fake.fileAt('cms-draft', 'index.html'), '<html>v2');
});

test('a fejlesztő a main-re pusholt, a piszkozatnak van saját változása → a main beolvad, a változás megmarad, publikálás az újratöltés után megy', async () => {
  const { fake, load, post, editPrice } = setup();
  await load();
  const oldDraft = await editPrice('55');
  fake.commitDirect('main', { 'index.html': '<html>v2' });

  const next = await load();
  assert.equal(next.syncConflict, false);
  assert.notEqual(next.draftSha, oldDraft, 'a draft új (összefésülő) commitra mozdult');
  assert.equal(next.draft.products.pavaje['autoblocant-6cm'].price, '55', 'a mentett módosítás megmaradt');
  assert.equal(fake.fileAt('cms-draft', 'index.html'), '<html>v2', 'a fejlesztő változása is megjelent az előnézeten');

  // a régi draftSha-val (amit az ügyfél a betöltés előtt látott) nem publikál, mert közben változott az alap
  const old = await post('publish', { draftSha: oldDraft });
  assert.equal(old.status, 409);
  assert.equal((await old.json()).code, 'STALE');
  const ok = await post('publish', { draftSha: next.draftSha, summary: 'ár' });
  assert.equal(ok.status, 200);
  assert.equal(fake.fileAt('main', 'index.html'), '<html>v2', 'a fejlesztő változása nem veszett el');
  assert.equal(JSON.parse(fake.fileAt('main', 'produse/products.json')).pavaje['autoblocant-6cm'].price, '55');
});

test('publikálás közben mozdul a main (a betöltés és a publikálás között) → RELOAD, nem publikál', async () => {
  const { fake, load, post, editPrice } = setup();
  await load();
  const draftSha = await editPrice('61');
  fake.commitDirect('main', { 'index.html': '<html>v3' }); // az ügyfél még a régi állapotot látja
  const res = await post('publish', { draftSha });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'RELOAD');
  assert.equal(fake.fileAt('main', 'index.html'), '<html>v3');
  assert.equal(JSON.parse(fake.fileAt('main', 'produse/products.json')).pavaje['autoblocant-6cm'].price, products.pavaje['autoblocant-6cm'].price, 'a main tartalma nem változott');
});

test('ütközés: a fejlesztő is ugyanazt a fájlt módosította → syncConflict, a piszkozat érintetlen, publikálni nem lehet, az elvetés kiút', async () => {
  const { fake, load, post, editPrice } = setup();
  await load();
  const draftSha = await editPrice('55');
  const changed = structuredClone(products);
  changed.pavaje['autoblocant-6cm'].price = '1';
  fake.commitDirect('main', { 'produse/products.json': JSON.stringify(changed, null, 4) });
  const mainSha = fake.head('main');

  const c = await load();
  assert.equal(c.syncConflict, true);
  assert.equal(c.draftSha, draftSha, 'a piszkozat érintetlen');
  assert.equal(c.draft.products.pavaje['autoblocant-6cm'].price, '55');

  const res = await quiet(() => post('publish', { draftSha }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'CONFLICT');
  assert.match(body.message, /fejlesztő/);
  assert.equal(fake.head('main'), mainSha, 'a main nem változott');

  assert.equal((await post('discard', { draftSha })).status, 200);
  const after = await load();
  assert.equal(after.syncConflict, false);
  assert.equal(after.draftSha, mainSha);
});

test('elvetés: a piszkozat a main-re áll, a feltöltött nem publikált kép eltűnik; elavult sha → 409', async () => {
  const { fake, load, post, editPrice } = setup();
  await load();
  const image = '/assets/pavaje/uj_bbbbbbbb.webp';
  const draftSha = await editPrice('5', [{ path: image, base64: fakeWebp('x').toString('base64') }], (p) => {
    p.pavaje['autoblocant-6cm'].colors[0].image = image;
  });
  assert.ok(fake.fileBuffer('cms-draft', image.slice(1)));

  const stale = await post('discard', { draftSha: 'a'.repeat(40) });
  assert.equal(stale.status, 409);
  assert.equal(fake.head('cms-draft'), draftSha, 'elavult kérés nem ront semmit');

  const res = await post('discard', { draftSha });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).draftSha, fake.head('main'));
  assert.equal(fake.head('cms-draft'), fake.head('main'));
  assert.equal(fake.fileBuffer('cms-draft', image.slice(1)), null);
  const c = await load();
  assert.deepEqual(c.draft.products, products);
});

test('publikálás: érvénytelen piszkozat (pl. a fejlesztő elrontotta a fájlt) nem kerül élesbe', async () => {
  const { fake, load, post } = setup();
  const c = await load();
  fake.commitDirect('cms-draft', { 'produse/products.json': '{"pavaje": {"x": {"name": "x"}}}' });
  const mainBefore = fake.head('main');
  const res = await post('publish', { draftSha: fake.head('cms-draft') });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'VALIDATION');
  assert.equal(fake.head('main'), mainBefore);
  assert.ok(c.draftSha);
});

test('github.publishCommit: ha a main közben elmozdult, StaleBranchError, és a main érintetlen', async () => {
  const { fake, load, editPrice } = setup();
  await load();
  const draftSha = await editPrice('9');
  const github = createGithub(CONFIG, fake.fetch);
  const seenMain = fake.head('main');
  fake.commitDirect('main', { 'index.html': '<html>v9' });
  const moved = fake.head('main');
  await assert.rejects(() => github.publishCommit({ branch: 'main', baseSha: seenMain, headSha: draftSha, message: 'CMS: publikálás' }), StaleBranchError);
  assert.equal(fake.head('main'), moved);
});

test('védelem: munkamenet és Origin kell, csak POST (publish/discard), csak GET (status)', async () => {
  const { handlers, post } = setup();
  for (const name of ['publish', 'discard']) {
    assert.equal((await post(name, { draftSha: 'a'.repeat(40) }, { headers: {} })).status, 401, `${name}: nincs süti`);
    assert.equal((await post(name, { draftSha: 'a'.repeat(40) }, { origin: 'https://evil.example' })).status, 403, `${name}: idegen origin`);
    assert.equal((await handlers[name](new Request(`${ORIGIN}/api/${name}`, { headers: { cookie } }))).status, 405, `${name}: GET`);
    assert.equal((await post(name, { draftSha: 'nem-sha' })).status, 400, `${name}: hibás sha`);
  }
  assert.equal((await handlers.status(new Request(`${ORIGIN}/api/status`))).status, 401);
  assert.equal((await handlers.status(new Request(`${ORIGIN}/api/status`, { method: 'POST', headers: { cookie, origin: ORIGIN } }))).status, 405);
});

test('status: csak az e havi „CMS: publikálás” commitokat számolja, 15 kredit/db', async () => {
  const now = new Date('2026-11-15T10:00:00Z');
  const { fake, load, handlers, post, editPrice } = setup({ now: () => now });
  await load();
  // múlt havi publikálás
  fake.clock = () => new Date('2026-10-20T10:00:00Z');
  fake.commitDirect('main', { 'a.txt': '1' });
  fake.commits.get(fake.head('main')).message = 'CMS: publikálás – régi';
  // ez a havi: egy fejlesztői commit (nem számít) és két publikálás
  fake.clock = () => new Date('2026-11-03T10:00:00Z');
  fake.commitDirect('main', { 'b.txt': '1' });
  for (const price of ['10', '11']) {
    fake.clock = () => new Date('2026-11-04T10:00:00Z');
    await load();
    const draftSha = await editPrice(price);
    assert.equal((await post('publish', { draftSha, summary: price })).status, 200);
  }
  const res = await handlers.status(new Request(`${ORIGIN}/api/status`, { headers: { cookie } }));
  const data = await res.json();
  assert.equal(data.publishesThisMonth, 2);
  assert.equal(data.estimatedCredits, 30);
  assert.equal(data.monthlyCredits, 300);
  assert.equal(data.warnAfter, 10);
  assert.equal(monthStart(now), '2026-11-01T00:00:00.000Z');
});

test('publishMessage: egy soros, levágott, előtaggal', () => {
  assert.equal(publishMessage(''), 'CMS: publikálás');
  assert.equal(publishMessage('2 új,\n1 módosított'), 'CMS: publikálás – 2 új, 1 módosított');
  assert.equal(publishMessage('x'.repeat(300)).length, 'CMS: publikálás – '.length + 100);
});

test('publikálás: a más termék által még használt kép megmarad, a nem képes fájlokhoz nem nyúl', async () => {
  const { fake, load, post, editPrice } = setup();
  const c = await load();
  const shared = c.draft.products.pavaje['autoblocant-6cm'].image;
  const users = JSON.stringify(c.draft.products).split(shared).length - 1;
  assert.ok(users >= 1);
  const newImage = '/assets/pavaje/autoblocant-6cm_cccccccc.webp';
  // csak a fő képet cseréljük; a régi fájlra máshol is hivatkozik valami, vagy ha nem, akkor törlődhet
  const draftSha = await editPrice('41', [{ path: newImage, base64: fakeWebp('n').toString('base64') }], (p) => {
    p.pavaje['autoblocant-6cm'].image = newImage;
  });
  const after = JSON.stringify(JSON.parse(fake.fileAt('cms-draft', 'produse/products.json')));
  const stillReferenced = after.includes(shared);
  assert.equal((await post('publish', { draftSha })).status, 200);
  assert.equal(Boolean(fake.fileBuffer('main', shared.slice(1))), stillReferenced, 'csak a már nem hivatkozott kép törlődik');
  assert.equal(fake.fileAt('main', 'index.html'), '<html>v1');
  assert.ok(fake.fileBuffer('main', 'produse/colors.json'));
});

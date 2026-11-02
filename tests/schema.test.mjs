import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CATEGORIES,
  validateCatalog,
  validateColors,
  validateProductId,
  serializeCatalog,
  serializeColors,
  canonicalizeProduct,
  collectImagePaths,
  PRICE_RE,
} from '../src/shared/catalog-schema.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const productsText = read('produse/products.json');
const colorsText = read('produse/colors.json');
const products = JSON.parse(productsText);
const colors = JSON.parse(colorsText);

const clone = () => structuredClone(products);
const errorsFor = (p, c = colors, ctx = {}) => validateCatalog(p, c, ctx).errors;
const hasError = (errors, pathPart) => errors.some((e) => e.path.includes(pathPart));

test('a jelenlegi katalógus és színpaletta hibátlan (a nevek végi szóköze figyelmeztetés)', () => {
  const result = validateCatalog(products, colors);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(
    result.warnings.some((w) => w.path === 'rigole.rigola-carosabila-65.name' && w.message.includes('szóköz')),
    'a „Rigolă carosabilă TIP 65 ” név végi szóközét jelzi',
  );
  assert.deepEqual(validateColors(colors), []);
});

test('szerializálás: a jelenlegi fájlokkal byte-azonos (4 szóköz, nyers UTF-8, nincs záró újsor)', () => {
  assert.equal(serializeCatalog(JSON.parse(productsText)), productsText);
  assert.equal(serializeColors(JSON.parse(colorsText)), colorsText);
  assert.ok(productsText.includes('roșu') && !productsText.endsWith('\n'));
});

test('szerializálás: nem rendezi át a mezőket, és túl nagy fájlt visszautasít', () => {
  const odd = { b: 1, a: { z: 1, y: 2 } };
  assert.equal(serializeCatalog(odd), JSON.stringify(odd, null, 4));
  assert.throws(() => serializeCatalog({ big: 'x'.repeat(1_000_001) }), /1 MB/);
});

test('képek: létező képekkel hibátlan, hiányzóval hibás', () => {
  const assets = collectImagePaths(products, colors);
  const ctx = { assets, assetsPrefix: '/assets/pavaje/' };
  assert.ok(assets.size > 20);
  assert.deepEqual(errorsFor(products, colors, ctx), []);

  const p = clone();
  p.pavaje['autoblocant-6cm'].image = '/assets/pavaje/nincs-ilyen.webp';
  assert.ok(hasError(errorsFor(p, colors, ctx), 'pavaje.autoblocant-6cm.image'));
});

test('ár: elfogadott és elutasított formák', () => {
  for (const ok of ['55', '55,50', '6,5', '40 - 50', '6,5 - 10']) assert.match(ok, PRICE_RE, ok);
  for (const bad of ['', 'abc', '55.5', '55,555', '-5', '40-50', ' 55', '55 RON']) assert.doesNotMatch(bad, PRICE_RE, bad);

  const p = clone();
  p.borduri['bordura-mic'].price = '55.5';
  assert.ok(hasError(errorsFor(p), 'borduri.bordura-mic.price'));
});

test('mértékegység, név és méret mezők', () => {
  let p = clone();
  p.pavaje['autoblocant-6cm'].unit = 'kg';
  assert.ok(hasError(errorsFor(p), 'unit'));

  p = clone();
  p.pavaje['autoblocant-6cm'].name = '<b>Pavaj</b>';
  assert.ok(hasError(errorsFor(p), 'name'));

  // felesleges szóköz: csak figyelmeztetés (a meglévő adatban is van ilyen), a csak szóközből álló név hiba
  p = clone();
  p.pavaje['autoblocant-6cm'].name = ' szóköz elöl';
  let r = validateCatalog(p, colors);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.path === 'pavaje.autoblocant-6cm.name' && w.message.includes('szóköz')));

  p = clone();
  p.pavaje['autoblocant-6cm'].name = '   ';
  assert.ok(hasError(errorsFor(p), 'name'));

  p = clone();
  p.pavaje['autoblocant-6cm'].name = 'x';
  assert.ok(hasError(errorsFor(p), 'name'));

  p = clone();
  p.pavaje['autoblocant-6cm'].dimensions = 'x'.repeat(61);
  assert.ok(hasError(errorsFor(p), 'dimensions'));
});

test('azonosító: formátum és egyediség kategóriákon át', () => {
  for (const bad of ['123', 'Nagybetu', 'szóköz van', '-kezdo', 'veg-', 'dupla--kotojel', '__proto__', '']) {
    assert.ok(validateProductId(bad).length > 0, bad);
  }
  for (const ok of ['pavaj-aviro-6', 'a1', 'paleti']) assert.deepEqual(validateProductId(ok), [], ok);

  const p = clone();
  p.borduri['autoblocant-6cm'] = structuredClone(p.pavaje['autoblocant-6cm']);
  const errors = errorsFor(p);
  assert.ok(errors.some((e) => e.path === 'borduri.autoblocant-6cm' && e.message.includes('pavaje')));
});

test('kategóriák: ismeretlen és hiányzó', () => {
  let p = clone();
  p.ujkategoria = {};
  assert.ok(hasError(errorsFor(p), 'ujkategoria'));

  p = clone();
  delete p.rigole;
  assert.ok(hasError(errorsFor(p), 'rigole'));

  assert.ok(validateCatalog(null, colors).errors.length > 0);
  assert.deepEqual(CATEGORIES, Object.keys(products));
});

test('színek: paletta, ismétlés, üres lista, ár', () => {
  let p = clone();
  p.pavaje['autoblocant-6cm'].colors.push({ name: 'lila' });
  assert.ok(errorsFor(p).some((e) => e.message.includes('lila')));

  p = clone();
  p.pavaje['autoblocant-6cm'].colors.push({ name: 'gri' });
  assert.ok(errorsFor(p).some((e) => e.message.includes('kétszer')));

  p = clone();
  p.pavaje['autoblocant-6cm'].colors = [];
  assert.ok(hasError(errorsFor(p), 'colors'));

  p = clone();
  p.pavaje['autoblocant-6cm'].colors[0].price = 'sok';
  assert.ok(hasError(errorsFor(p), 'colors[0].price'));

  p = clone();
  p.pavaje['autoblocant-6cm'].colors[0] = 'gri';
  assert.ok(hasError(errorsFor(p), 'colors[0]'));
});

test('méretek és típusok', () => {
  let p = clone();
  p['premium-pavaje']['pavaj-aviro-6'].sizes.push({ name: 'Nagy' });
  assert.ok(hasError(errorsFor(p), 'sizes[3].dimensions'));

  p = clone();
  p.rigole['capac-rigola-carosabila-49'].type.push({ name: 'nearmat', price: '10' });
  assert.ok(errorsFor(p).some((e) => e.message.includes('kétszer')));

  p = clone();
  p.rigole['capac-rigola-carosabila-49'].type[0].price = '';
  assert.ok(hasError(errorsFor(p), 'type[0].price'));
});

test('képútvonal: bejárás és mappán kívüli út tiltott', () => {
  const ctx = { assetsPrefix: '/assets/pavaje/' };
  for (const bad of ['/assets/../x.webp', '/assets//x.webp', 'assets/pavaje/x.webp', '/assets/pavaje/x.exe', 'http://evil.example/x.webp']) {
    const p = clone();
    p.pavaje['autoblocant-6cm'].image = bad;
    assert.ok(hasError(errorsFor(p, colors, ctx), 'image'), bad);
  }
  const p = clone();
  p.pavaje['autoblocant-6cm'].image = '/assets/category_pavaj.webp';
  assert.ok(errorsFor(p, colors, ctx).some((e) => e.message.includes('/assets/pavaje/')));
});

test('figyelmeztetések: szín+típus és szín+méretkép', () => {
  let p = clone();
  p.pavaje['autoblocant-6cm'].type = [{ name: 'a', price: '10' }];
  let result = validateCatalog(p, colors);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.path === 'pavaje.autoblocant-6cm' && w.message.includes('típus')));

  result = validateCatalog(products, colors);
  assert.ok(result.warnings.some((w) => w.path === 'premium-pavaje.pavaj-aviro-6' && w.message.includes('méret')));
});

test('színpaletta ellenőrzése', () => {
  assert.ok(validateColors({ x: { hex: 'piros' } }).length > 0);
  assert.ok(validateColors({ x: { hex: '#fff' } }).length > 0);
  assert.ok(validateColors({ x: { hex: '#ffffff', border: 'igen' } }).length > 0);
  assert.ok(validateColors({ '<b>': { hex: '#ffffff' } }).length > 0);
  assert.ok(validateColors([]).length > 0);
  assert.deepEqual(validateColors({ ok: { hex: '#A1B2C3', border: true } }), []);
});

test('canonicalizeProduct és collectImagePaths', () => {
  const out = canonicalizeProduct({ type: [], price: '1', extra: 'x', name: 'N', unit: 'mp' });
  assert.deepEqual(Object.keys(out), ['name', 'price', 'unit', 'type', 'extra']);

  const paths = collectImagePaths(
    { pavaje: { a: { image: '/assets/pavaje/a.webp', colors: [{ image: '/assets/pavaje/b.webp' }, { name: 'x' }], sizes: [{ image: '/assets/pavaje/c.webp' }] } } },
    { gri: { image: '/assets/pavaje/d.webp' } },
  );
  assert.deepEqual([...paths].sort(), ['/assets/pavaje/a.webp', '/assets/pavaje/b.webp', '/assets/pavaje/c.webp', '/assets/pavaje/d.webp']);
});

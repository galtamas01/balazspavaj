import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeHex, luminance, suggestBorder, paletteUsage, colorNameError, hexError,
  addColor, updateColor, renameColor, removeColor,
} from '../admin/lib/palette-ops.js';
import { ChangeError } from '../admin/lib/catalog-ops.js';
import { createStore } from '../admin/lib/state.js';
import { parseRoute } from '../admin/lib/router.js';
import { validateCatalog, serializeColors } from '../src/shared/catalog-schema.js';

const products = JSON.parse(readFileSync(new URL('../produse/products.json', import.meta.url), 'utf8'));
const colors = JSON.parse(readFileSync(new URL('../produse/colors.json', import.meta.url), 'utf8'));

test('normalizeHex: #rgb, # nélküli, nagybetűs kód → #rrggbb; érvénytelenre null', () => {
  assert.equal(normalizeHex('#4A6B3A'), '#4a6b3a');
  assert.equal(normalizeHex('4a6b3a'), '#4a6b3a');
  assert.equal(normalizeHex(' #abc '), '#aabbcc');
  for (const bad of ['', '#12', '#12345', '#gggggg', 'piros', null, undefined]) assert.equal(normalizeHex(bad), null, String(bad));
});

test('világos szín: a fehér és a nagyon világos kap keretet, a többi nem (a mostani paletta egyezik)', () => {
  assert.ok(luminance('#ffffff') > 0.99 && luminance('#000000') === 0);
  assert.equal(suggestBorder('#ffffff'), true);
  assert.equal(suggestBorder('#f4f4f4'), true);
  // a mostani paletta: pontosan az `alb` volt keretes
  for (const [name, def] of Object.entries(colors)) assert.equal(suggestBorder(def.hex), Boolean(def.border), name);
});

test('paletteUsage: termékenként egyszer számol, a valódi adatban minden szín használt', () => {
  const usage = paletteUsage(products);
  assert.ok(usage.size > 0);
  for (const name of usage.keys()) assert.ok(name in colors, `a termékek színe a palettán van: ${name}`);
  for (const users of usage.values()) assert.equal(new Set(users.map((u) => `${u.category}/${u.id}`)).size, users.length);
});

test('colorNameError: üres, túl hosszú, < >, idézőjel, ismétlődés (kis-nagybetűtől függetlenül)', () => {
  assert.equal(colorNameError(colors, 'verde'), '');
  assert.match(colorNameError(colors, '  '), /meg kell adni/);
  assert.match(colorNameError(colors, 'x'.repeat(41)), /legfeljebb 40/);
  assert.match(colorNameError(colors, 'a<b'), /nem használható/);
  assert.match(colorNameError(colors, 'a"b'), /idézőjel/);
  assert.match(colorNameError(colors, 'GRI'), /már van/);
  assert.match(colorNameError(colors, 'roșu'), /már van/);
  assert.equal(colorNameError(colors, 'gri', { except: 'gri' }), '', 'a saját neve nem ütközés');
  assert.equal(hexError('#4a6b3a'), '');
  assert.match(hexError('zöld'), /#rrggbb/);
});

test('addColor: a paletta végére kerül, kisbetűs kód, keret csak ha kell; az eredeti nem változik', () => {
  const before = structuredClone(colors);
  const next = addColor(colors, ' verde ', { hex: '#4A6B3A', border: false });
  assert.deepEqual(colors, before);
  assert.deepEqual(Object.keys(next), [...Object.keys(colors), 'verde']);
  assert.deepEqual(next.verde, { hex: '#4a6b3a' });
  assert.deepEqual(addColor(colors, 'crem', { hex: '#fffdf5', border: true }).crem, { hex: '#fffdf5', border: true });
  assert.throws(() => addColor(colors, 'gri', { hex: '#000000' }), ChangeError);
  assert.throws(() => addColor(colors, 'x', { hex: 'nem-szin' }), ChangeError);
});

test('az új szín a termékekkel együtt hibátlanul validál, és a mentett fájl a régi formátumot tartja', () => {
  const next = addColor(colors, 'verde', { hex: '#4a6b3a' });
  const product = structuredClone(products);
  product.pavaje['autoblocant-6cm'].colors.push({ name: 'verde' });
  const result = validateCatalog(product, next);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const text = serializeColors(next);
  assert.ok(text.includes('    "verde": {\n        "hex": "#4a6b3a"\n    }'));
  assert.equal(text.endsWith('\n'), false);
  // a régi szín változatlanul, byte-azonosan íródik vissza
  assert.ok(text.startsWith(serializeColors(colors).slice(0, -2)));
});

test('updateColor: a számszerűen változatlan kód az eredeti szövegét tartja; border be/ki; ismeretlen mező megmarad', () => {
  const same = updateColor(colors, 'dune', { hex: '#d8c5b4', border: false });
  assert.equal(same.dune.hex, '#D8C5B4');
  assert.deepEqual(same, colors);
  const changed = updateColor(colors, 'dune', { hex: '#112233', border: true });
  assert.deepEqual(changed.dune, { hex: '#112233', border: true });
  assert.deepEqual(updateColor(changed, 'dune', { hex: '#112233', border: false }).dune, { hex: '#112233' });
  const withImage = updateColor({ x: { hex: '#000000', image: '/assets/pavaje/x.webp' } }, 'x', { hex: '#ffffff', border: true });
  assert.deepEqual(withImage.x, { hex: '#ffffff', image: '/assets/pavaje/x.webp', border: true });
  assert.throws(() => updateColor(colors, 'nincs', { hex: '#000000' }), ChangeError);
});

test('renameColor: a paletta sorrendje és minden termék hivatkozása átíródik, a többi nem változik', () => {
  const users = paletteUsage(products).get('gri');
  const { colors: nextColors, products: nextProducts, affected } = renameColor(colors, products, 'gri', 'gri deschis');
  assert.equal(affected, users.length);
  assert.deepEqual(Object.keys(nextColors).map((k) => (k === 'gri deschis' ? 'gri' : k)), Object.keys(colors), 'a sorrend megmaradt');
  assert.deepEqual(nextColors['gri deschis'], colors.gri);
  assert.equal(paletteUsage(nextProducts).get('gri'), undefined);
  assert.equal(paletteUsage(nextProducts).get('gri deschis').length, users.length);
  assert.equal(validateCatalog(nextProducts, nextColors).ok, true);
  // minden más termékmező változatlan
  const strip = (p) => JSON.stringify(p).replaceAll('gri deschis', 'gri');
  assert.equal(strip(nextProducts), JSON.stringify(products));
  assert.throws(() => renameColor(colors, products, 'gri', 'alb'), ChangeError);
  assert.throws(() => renameColor(colors, products, 'gri', 'ALB'), ChangeError);
  assert.equal(renameColor(colors, products, 'gri', 'gri').affected, 0);
  assert.equal(renameColor(colors, products, 'gri', ' gri ').affected, 0, 'a szóköz levágása után ugyanaz a név');
});

test('removeColor: használt szín nem törölhető (hibaüzenet a darabszámmal), használaton kívüli igen', () => {
  assert.throws(() => removeColor(colors, products, 'gri'), (e) => e instanceof ChangeError && /használja \d+ termék/.test(e.message));
  const extended = addColor(colors, 'verde', { hex: '#4a6b3a' });
  const without = removeColor(extended, products, 'verde');
  assert.deepEqual(without, colors);
  assert.deepEqual(removeColor(colors, products, 'nincs-ilyen'), colors, 'már törölt szín: nincs teendő');
});

test('store.saveCatalog: a paletta és a termékek egy mentésben mennek; 409 után a módosítás az újratöltött adaton ismétlődik', async () => {
  const calls = [];
  let draft = { products: { pavaje: { a: { name: 'A', price: '1', colors: [{ name: 'gri' }] } } }, colors: { gri: { hex: '#808080' } } };
  let sha = 'd1';
  const api = async (name, options) => {
    calls.push([name, options?.body]);
    if (name === 'catalog') return { ok: true, draft, main: draft, draftSha: sha, mainSha: 'm1' };
    if (options.body.baseSha !== sha) {
      const error = new Error('stale');
      error.status = 409;
      throw error;
    }
    sha = 'd2';
    return { ok: true, draftSha: 'd2', changed: true, warnings: [] };
  };
  const store = createStore(api);
  await store.load();
  // közben más is mentett: a piszkozat és az sha megváltozik
  draft = { products: draft.products, colors: { gri: { hex: '#808080' }, alb: { hex: '#ffffff', border: true } } };
  sha = 'd9';
  await store.saveCatalog({
    apply: (d) => {
      const renamed = renameColor(d.colors, d.products, 'gri', 'gri deschis');
      return { products: renamed.products, colors: renamed.colors };
    },
    message: 'Szín átnevezve',
  });
  const saves = calls.filter(([name]) => name === 'save');
  assert.equal(saves.length, 2);
  assert.deepEqual(Object.keys(saves[1][1].colors), ['gri deschis', 'alb'], 'az újratöltött palettán ismétlődött meg');
  assert.equal(saves[1][1].products.pavaje.a.colors[0].name, 'gri deschis');
  assert.deepEqual(Object.keys(store.get().draft.colors), ['gri deschis', 'alb']);
  assert.equal(store.get().draftSha, 'd2');
});

test('útvonal: #/szinek a palettára vezet, mellékútvonallal nem', () => {
  assert.deepEqual(parseRoute('#/szinek'), { name: 'palette' });
  assert.equal(parseRoute('#/szinek/valami'), null);
});

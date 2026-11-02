import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slugify, freeId } from '../admin/lib/slug.js';
import { normalizeNumber, normalizePrice, samePrice, splitPrice, buildPrice } from '../admin/lib/price.js';
import { diffCatalog, productStatus, deepEqual } from '../admin/lib/diff.js';
import {
  addProduct, replaceProduct, renameProductId, removeProduct, moveProduct, duplicateOf, findProduct, takenIds, countProducts, ChangeError,
} from '../admin/lib/catalog-ops.js';
import { emptyForm, toForm, fromForm, applyForm, newRow } from '../admin/lib/product-form.js';
import { parseRoute } from '../admin/lib/router.js';
import { assetUrl } from '../admin/lib/assets.js';
import { slotFromPath } from '../admin/lib/image-slots.js';
import { serializeCatalog } from '../src/shared/catalog-schema.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const products = JSON.parse(read('produse/products.json'));
const colors = JSON.parse(read('produse/colors.json'));
const ids = (p, c) => Object.keys(p[c]);

test('slug: ékezetek, szóközök, a magyar és román betűk', () => {
  assert.equal(slugify('Pavaj Aviro 6 cm'), 'pavaj-aviro-6-cm');
  assert.equal(slugify('Rigolă carosabilă TIP 65 '), 'rigola-carosabila-tip-65');
  assert.equal(slugify('Țiglă Șoim Școală'), 'tigla-soim-scoala');
  assert.equal(slugify('Őszi űrlap – 10 m²'), 'oszi-urlap-10-m2');
  assert.equal(slugify('  --  '), '');
  assert.equal(slugify('x'.repeat(200)).length, 80);
  assert.equal(slugify(null), '');
});

test('slug: foglalt azonosítóhoz számot fűz', () => {
  assert.equal(freeId('paleti', new Set()), 'paleti');
  assert.equal(freeId('paleti', new Set(['paleti'])), 'paleti-2');
  assert.equal(freeId('paleti', new Set(['paleti', 'paleti-2'])), 'paleti-3');
  assert.equal(freeId('', new Set()), 'termek');
});

test('ár: számok normalizálása', () => {
  const ok = { '55': '55', '55.5': '55,50', '55,5': '55,50', '55,50': '55,50', '55,00': '55', '6,5': '6,50', '007': '7', ' 12 ': '12', '0,5': '0,50' };
  for (const [input, expected] of Object.entries(ok)) assert.equal(normalizeNumber(input).value, expected, input);
  for (const bad of ['', 'abc', '55,555', '-5', '5 5', '55 RON', '0', '0,00', ',5']) {
    assert.ok(normalizeNumber(bad).error, bad);
  }
});

test('ár: tartomány, ellenőrzés és összehasonlítás', () => {
  assert.equal(normalizePrice('40-50').value, '40 - 50');
  assert.equal(normalizePrice('40 – 50,5').value, '40 - 50,50');
  assert.ok(normalizePrice('50 - 40').error.includes('tartomány'));
  assert.ok(normalizePrice('1 - 2 - 3').error);
  assert.ok(normalizePrice('40 - ').error);
  assert.equal(samePrice('6,5 - 10', '6,50 - 10'), true);
  assert.equal(samePrice('6,5', '7'), false);
  assert.deepEqual(splitPrice('40 - 50'), { mode: 'range', from: '40', to: '50' });
  assert.deepEqual(splitPrice('64'), { mode: 'single', from: '64', to: '' });
});

test('ár: a módosítatlan ár az eredeti szöveg marad', () => {
  assert.equal(buildPrice({ mode: 'range', from: '6,5', to: '10' }, '6,5 - 10').value, '6,5 - 10');
  assert.equal(buildPrice({ mode: 'range', from: '6,5', to: '11' }, '6,5 - 10').value, '6,50 - 11');
  assert.equal(buildPrice({ mode: 'single', from: '55.5', to: '' }, '55').value, '55,50');
  assert.ok(buildPrice({ mode: 'range', from: '5', to: '' }, '5').error.includes('mindkét'));
});

test('diff: új, módosított, törölt, átrendezett', () => {
  const main = { products: structuredClone(products), colors };
  const draft = { products: structuredClone(products), colors: structuredClone(colors) };
  assert.equal(diffCatalog(main, draft).count, 0);

  draft.products.pavaje['autoblocant-6cm'].price = '99';
  draft.products.borduri['uj-bordura'] = { name: 'Új', price: '1', unit: 'buc', dimensions: '1' };
  delete draft.products.rigole.paleti;
  draft.products['premium-pavaje'] = Object.fromEntries(Object.entries(draft.products['premium-pavaje']).reverse());
  const d = diffCatalog(main, draft);
  assert.deepEqual(d.changed, [{ category: 'pavaje', id: 'autoblocant-6cm' }]);
  assert.deepEqual(d.added, [{ category: 'borduri', id: 'uj-bordura' }]);
  assert.deepEqual(d.removed, [{ category: 'rigole', id: 'paleti' }]);
  assert.deepEqual(d.reordered, ['premium-pavaje']);
  assert.equal(d.count, 4);
  assert.equal(productStatus(d, 'borduri', 'uj-bordura'), 'new');
  assert.equal(productStatus(d, 'pavaje', 'autoblocant-6cm'), 'changed');
  assert.equal(productStatus(d, 'pavaje', 'autoblocant-8cm'), null);

  draft.colors.lila = { hex: '#800080' };
  assert.equal(diffCatalog(main, draft).colorsChanged, true);
  assert.ok(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
});

test('katalógusműveletek: másolaton dolgoznak, a sorrendet megőrzik', () => {
  const before = JSON.stringify(products);
  const product = { name: 'Új bordura', price: '12', unit: 'buc', dimensions: '1x1' };

  const added = addProduct(products, 'borduri', 'bordura-uj', product);
  assert.deepEqual(ids(added, 'borduri'), [...ids(products, 'borduri'), 'bordura-uj']);
  assert.deepEqual(Object.keys(added.borduri['bordura-uj']), ['name', 'dimensions', 'price', 'unit']);
  assert.throws(() => addProduct(products, 'borduri', 'paleti', product), ChangeError); // más kategóriában is foglalt
  assert.throws(() => addProduct(products, 'ismeretlen', 'x', product), ChangeError);

  const renamed = renameProductId(products, 'pavaje', 'autoblocant-8cm', 'autoblocant-8-uj');
  assert.deepEqual(ids(renamed, 'pavaje'), ['autoblocant-6cm', 'autoblocant-8-uj', 'autoblocant-10cm', 'pavaj-dreptunghi-6cm', 'pavaj-dreptunghi-mic-8cm']);
  assert.throws(() => renameProductId(products, 'pavaje', 'autoblocant-8cm', 'paleti'), ChangeError);

  const replaced = replaceProduct(products, 'rigole', 'paleti', { ...products.rigole.paleti, price: '60' });
  assert.deepEqual(ids(replaced, 'rigole'), ids(products, 'rigole'));
  assert.equal(replaced.rigole.paleti.price, '60');
  assert.throws(() => replaceProduct(products, 'rigole', 'nincs', {}), ChangeError);

  assert.deepEqual(ids(removeProduct(products, 'rigole', 'paleti'), 'rigole'), ids(products, 'rigole').filter((i) => i !== 'paleti'));
  assert.deepEqual(ids(removeProduct(products, 'rigole', 'nincs'), 'rigole'), ids(products, 'rigole')); // idempotens

  assert.deepEqual(ids(moveProduct(products, 'pavaje', 'autoblocant-8cm', -1), 'pavaje').slice(0, 2), ['autoblocant-8cm', 'autoblocant-6cm']);
  assert.deepEqual(ids(moveProduct(products, 'pavaje', 'autoblocant-6cm', -1), 'pavaje'), ids(products, 'pavaje')); // a szélén nem mozdul
  assert.deepEqual(ids(moveProduct(products, 'pavaje', 'pavaj-dreptunghi-mic-8cm', 1), 'pavaje'), ids(products, 'pavaje'));

  assert.equal(JSON.stringify(products), before, 'az eredeti nem változott');
  assert.equal(findProduct(products, 'paleti').category, 'rigole');
  assert.equal(findProduct(products, 'nincs'), null);
  assert.equal(countProducts(products), 20);
  assert.equal(takenIds(products).size, 20);
  assert.equal(duplicateOf(products.pavaje['autoblocant-6cm']).name, 'Pavaj autoblocant 6 cm (copie)');
});

test('űrlap: minden valódi termék változtatás nélkül ugyanaz marad (a név végi szóköz kivételével)', () => {
  let checked = 0;
  for (const [category, items] of Object.entries(products)) {
    for (const [id, product] of Object.entries(items)) {
      const form = toForm(category, id, product);
      const { product: out, errors } = fromForm(form);
      assert.deepEqual(errors, [], `${category}.${id}`);
      const expected = structuredClone(product);
      expected.name = expected.name.trim();
      assert.equal(JSON.stringify(out), JSON.stringify(expected), `${category}.${id}`);
      checked += 1;
    }
  }
  assert.equal(checked, 20);
});

test('űrlap: a változatlan mentés a teljes katalógust byte-azonosan hagyja (a név szóközén kívül)', () => {
  let current = structuredClone(products);
  for (const [category, items] of Object.entries(products)) {
    for (const id of Object.keys(items)) {
      const result = applyForm(current, colors, toForm(category, id, current[category][id]));
      assert.deepEqual(result.errors, [], `${category}.${id}`);
      current = result.products;
    }
  }
  const expected = structuredClone(products);
  expected.rigole['rigola-carosabila-65'].name = 'Rigolă carosabilă TIP 65';
  assert.equal(serializeCatalog(current), serializeCatalog(expected));
});

test('szerkesztés: ár, szín ára és kép megőrzése', () => {
  const original = products['premium-pavaje']['pavaj-aviro-6'];
  const form = toForm('premium-pavaje', 'pavaj-aviro-6', original);
  form.priceFrom = '66.5';
  form.colors[0].price = '70';
  form.sizes[1].dimensions = '30x30x6';
  const result = applyForm(products, colors, form);
  assert.deepEqual(result.errors, []);
  const saved = result.products['premium-pavaje']['pavaj-aviro-6'];
  assert.equal(saved.price, '66,50');
  assert.equal(saved.colors[0].price, '70');
  assert.equal(saved.colors[0].image, original.colors[0].image, 'a szín képe megmarad');
  assert.equal(saved.sizes[1].dimensions, '30x30x6');
  assert.equal(saved.sizes[1].name, original.sizes[1].name);
  assert.ok(result.warnings.some((w) => w.message.includes('méret')), 'szín+méretkép figyelmeztetés');
});

test('szerkesztés: hibák a mezők útvonalán', () => {
  const form = toForm('pavaje', 'autoblocant-6cm', products.pavaje['autoblocant-6cm']);
  form.name = ' ';
  form.priceMode = 'range';
  form.priceFrom = '50';
  form.priceTo = '40';
  form.colors[0].name = 'lila';
  form.colors[1].price = 'sok';
  const { errors, products: out } = applyForm(products, colors, form);
  assert.equal(out, null);
  const paths = errors.map((e) => e.path);
  for (const expected of ['name', 'price', 'colors[0].name', 'colors[1].price']) assert.ok(paths.includes(expected), expected);
  assert.equal(new Set(paths).size, paths.length, 'nincs duplikált útvonal');
});

test('új termék: azonosító, ütközés, kötelező mezők', () => {
  let form = emptyForm('borduri');
  form.name = 'Bordură nouă 50';
  form.id = 'bordura-noua-50';
  form.priceFrom = '12.5';
  form.dimensions = '50x20x8 cm';
  form.image = slotFromPath('/assets/pavaje/bordura-noua-50_ab12cd34.webp');
  let result = applyForm(products, colors, form);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.products.borduri['bordura-noua-50']), ['name', 'image', 'dimensions', 'price', 'unit']);
  assert.equal(result.products.borduri['bordura-noua-50'].price, '12,50');
  assert.equal(result.products.borduri['bordura-noua-50'].image, '/assets/pavaje/bordura-noua-50_ab12cd34.webp');
  assert.equal(ids(result.products, 'borduri').at(-1), 'bordura-noua-50');

  form.id = 'paleti'; // más kategóriában foglalt
  result = applyForm(products, colors, form);
  assert.ok(result.errors.some((e) => e.path === 'id' && e.message.includes('használatban')));

  form = emptyForm('borduri');
  result = applyForm(products, colors, form);
  assert.ok(['id', 'name', 'price', 'dimensions', 'image'].every((p) => result.errors.some((e) => e.path === p)));

  form = emptyForm('borduri');
  Object.assign(form, { name: 'Teszt', id: '123', priceFrom: '5', dimensions: 'x' });
  assert.ok(applyForm(products, colors, form).errors.some((e) => e.path === 'id'), 'csak számjegyű azonosító elutasítva');
});

test('új termék több mérettel, színnel és típussal', () => {
  const form = emptyForm('rigole');
  Object.assign(form, { name: 'Rigolă test', id: 'rigola-test', priceMode: 'range', priceFrom: '10', priceTo: '20', sizeMode: 'multi', image: slotFromPath('/assets/pavaje/rigola-test_00000000.webp') });
  form.sizes.push({ ...newRow.size(), name: 'Mic', dimensions: '10x10' });
  form.types.push({ ...newRow.type(), name: 'zincat', price: '15.5' });
  const ok = applyForm(products, colors, form);
  assert.deepEqual(ok.errors, []);
  const saved = ok.products.rigole['rigola-test'];
  assert.deepEqual(saved.sizes, [{ name: 'Mic', dimensions: '10x10' }]);
  assert.deepEqual(saved.type, [{ name: 'zincat', price: '15,50' }]);
  assert.equal(saved.price, '10 - 20');
  assert.equal('dimensions' in saved, false);

  form.sizes.length = 0;
  assert.ok(applyForm(products, colors, form).errors.some((e) => e.path === 'sizes'));
});

test('másolat és azonosító-csere', () => {
  const source = products.pavaje['autoblocant-6cm'];
  const form = toForm('pavaje', '', duplicateOf(source), { isNew: true });
  assert.equal(form.id, '');
  form.id = 'autoblocant-6cm-copie';
  const result = applyForm(products, colors, form);
  assert.deepEqual(result.errors, []);
  const copy = result.products.pavaje['autoblocant-6cm-copie'];
  assert.equal(copy.name, 'Pavaj autoblocant 6 cm (copie)');
  assert.equal(copy.image, source.image, 'a kép ugyanarra a fájlra mutat');
  assert.equal(copy.colors[2].image, source.colors[2].image);

  const edit = toForm('pavaje', 'autoblocant-8cm', products.pavaje['autoblocant-8cm']);
  edit.id = 'autoblocant-8-uj';
  const renamed = applyForm(products, colors, edit);
  assert.deepEqual(renamed.errors, []);
  assert.deepEqual(ids(renamed.products, 'pavaje')[1], 'autoblocant-8-uj');
});

test('útvonalak', () => {
  assert.deepEqual(parseRoute('#/termekek'), { name: 'list', category: 'pavaje' });
  assert.deepEqual(parseRoute('#/termekek/borduri'), { name: 'list', category: 'borduri' });
  assert.deepEqual(parseRoute('#/termek/rigole/paleti'), { name: 'edit', category: 'rigole', id: 'paleti' });
  assert.deepEqual(parseRoute('#/uj/pavaje'), { name: 'new', category: 'pavaje', from: '' });
  assert.deepEqual(parseRoute('#/uj/pavaje/autoblocant-6cm'), { name: 'new', category: 'pavaje', from: 'autoblocant-6cm' });
  for (const bad of ['', '#', '#/', '#/termekek/nincs', '#/termek/pavaje', '#/termek/nincs/x', '#/uj', '#/uj/nincs', '#/x', '#/termek/pavaje/%E0%A4%A']) {
    assert.equal(parseRoute(bad), null, bad);
  }
});

test('képcímek: ami a main-ben is megvan, közvetlen; a többi az /api/image-en át', () => {
  const main = new Set(['/assets/pavaje/a.webp']);
  assert.equal(assetUrl('/assets/pavaje/a.webp', main), '/assets/pavaje/a.webp');
  assert.equal(assetUrl('/assets/pavaje/uj_1234abcd.webp', main), '/api/image?path=%2Fassets%2Fpavaje%2Fuj_1234abcd.webp');
  assert.equal(assetUrl('', main), '');
  assert.equal(assetUrl('/assets/pavaje/a.webp', undefined), '/assets/pavaje/a.webp');
});

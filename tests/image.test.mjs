import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeSize, checkFile, ImageError, MAX_SIDE, MAX_INPUT_BYTES } from '../admin/lib/image.js';
import {
  emptySlot, slotFromPath, hasImage, imagePath, setSlotBlob, clearSlot, slotsOf, shortHash, assignUploadPaths, blobToBase64, toUploadList, releaseAll,
} from '../admin/lib/image-slots.js';
import { emptyForm, toForm, fromForm, applyForm, newRow } from '../admin/lib/product-form.js';
import { findProduct } from '../admin/lib/catalog-ops.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const products = JSON.parse(read('produse/products.json'));
const colors = JSON.parse(read('produse/colors.json'));
const blob = (text) => new Blob([text], { type: 'image/webp' });
const PREFIX = '/assets/pavaje/';

test('átméretezés: a hosszabb oldal legfeljebb 1600 px, nagyítás nincs, arány megmarad', () => {
  assert.deepEqual(computeSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(computeSize(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(computeSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(computeSize(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(computeSize(10000, 1), { width: MAX_SIDE, height: 1 });
  assert.deepEqual(computeSize(4000, 3000, 1200), { width: 1200, height: 900 });
});

test('fájlellenőrzés: formátum, HEIC és méret', () => {
  assert.doesNotThrow(() => checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 5_000_000 }));
  assert.doesNotThrow(() => checkFile({ name: 'a.png', type: 'image/png', size: 1 }));
  assert.doesNotThrow(() => checkFile({ name: 'a.webp', type: 'image/webp', size: 1 }));
  const code = (file) => {
    try {
      checkFile(file);
    } catch (e) {
      assert.ok(e instanceof ImageError);
      return e.code;
    }
    return null;
  };
  assert.equal(code({ name: 'IMG_1.HEIC', type: '', size: 1 }), 'HEIC');
  assert.equal(code({ name: 'x.jpg', type: 'image/heic', size: 1 }), 'HEIC');
  assert.equal(code({ name: 'x.heif', type: 'image/heif', size: 1 }), 'HEIC');
  assert.equal(code({ name: 'x.gif', type: 'image/gif', size: 1 }), 'TYPE');
  assert.equal(code({ name: 'x.pdf', type: 'application/pdf', size: 1 }), 'TYPE');
  assert.equal(code({ name: 'x.jpg', type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 }), 'TOO_BIG_INPUT');
});

test('képhely: létrehozás, csere, eltávolítás', () => {
  const slot = slotFromPath('/assets/pavaje/a.webp');
  assert.equal(hasImage(slot), true);
  assert.equal(imagePath(slot), '/assets/pavaje/a.webp');
  assert.equal(hasImage(emptySlot()), false);

  setSlotBlob(slot, { blob: blob('x'), previewUrl: 'blob:1', info: 'kész' });
  assert.equal(slot.path, '/assets/pavaje/a.webp', 'a régi útvonal a mentésig megvan');
  assert.equal(imagePath(slot), '/assets/pavaje/a.webp', 'útvonal-kijelölés nélkül a régi marad');

  clearSlot(slot);
  assert.equal(hasImage(slot), false);
  assert.equal(imagePath(slot), '');
});

test('hash és base64: determinisztikus, a tartalomtól függ', async () => {
  const a = await shortHash(blob('egy'));
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, await shortHash(blob('egy')));
  assert.notEqual(a, await shortHash(blob('ketto')));
  assert.equal(await blobToBase64(new Blob([Uint8Array.from([0, 1, 2, 250, 255])])), Buffer.from([0, 1, 2, 250, 255]).toString('base64'));
  const big = new Uint8Array(100_000).map((_, i) => i % 251);
  assert.equal(await blobToBase64(new Blob([big])), Buffer.from(big).toString('base64'), 'nagy tartalomnál is helyes');
});

test('feltöltési útvonalak: azonosító + szín/méret + hash, azonos kép egyszer', async () => {
  const form = emptyForm('borduri');
  form.id = 'bordura-noua';
  form.image = slotFromPath('');
  setSlotBlob(form.image, { blob: blob('fo'), previewUrl: '' });
  form.colors.push({ ...newRow.color('roșu'), image: { ...emptySlot() } });
  setSlotBlob(form.colors[0].image, { blob: blob('szin'), previewUrl: '' });
  form.sizeMode = 'multi';
  form.sizes.push({ ...newRow.size(), name: 'Mic', image: emptySlot() });
  form.sizes.push({ ...newRow.size(), name: 'Mic', image: emptySlot() });
  setSlotBlob(form.sizes[0].image, { blob: blob('meret'), previewUrl: '' });
  setSlotBlob(form.sizes[1].image, { blob: blob('meret'), previewUrl: '' });

  const uploads = await assignUploadPaths(form, PREFIX);
  const main = form.image.assigned;
  assert.match(main, /^\/assets\/pavaje\/bordura-noua_[0-9a-f]{8}\.webp$/);
  assert.match(form.colors[0].image.assigned, /^\/assets\/pavaje\/bordura-noua_rosu_[0-9a-f]{8}\.webp$/);
  assert.match(form.sizes[0].image.assigned, /^\/assets\/pavaje\/bordura-noua_mic_[0-9a-f]{8}\.webp$/);
  assert.equal(form.sizes[0].image.assigned, form.sizes[1].image.assigned);
  assert.equal(uploads.size, 3, 'a két azonos méretkép egy fájl');

  const list = await toUploadList(uploads);
  assert.ok(list.every((u) => /^[A-Za-z0-9+/]+=*$/.test(u.base64) && u.path.startsWith(PREFIX)));

  // újra kiosztáskor a régi kijelölés törlődik, ha a kép közben eltűnt
  clearSlot(form.image);
  await assignUploadPaths(form, PREFIX);
  assert.equal(form.image.assigned, '');
  releaseAll(form);
  assert.equal(slotsOf(form).length, 4);
});

test('űrlap: a kép cseréje, eltávolítása és megtartása a termék JSON-ban', async () => {
  const id = 'autoblocant-6cm';
  const original = products.pavaje[id];

  // változatlan: a képek ugyanazok
  let form = toForm('pavaje', id, original);
  assert.equal(fromForm(form).product.image, original.image);
  assert.equal(fromForm(form).product.colors[1].image, original.colors[1].image);

  // fő kép cseréje
  form = toForm('pavaje', id, original);
  setSlotBlob(form.image, { blob: blob('uj-kep'), previewUrl: '' });
  await assignUploadPaths(form, PREFIX);
  const replaced = applyForm(products, colors, form);
  assert.deepEqual(replaced.errors, []);
  assert.match(replaced.products.pavaje[id].image, /^\/assets\/pavaje\/autoblocant-6cm_[0-9a-f]{8}\.webp$/);
  assert.equal(replaced.products.pavaje[id].colors[0].image, original.colors[0].image, 'a színek képe érintetlen');

  // szín képének eltávolítása: a mező kimarad, a többi marad
  form = toForm('pavaje', id, original);
  clearSlot(form.colors[0].image);
  const removed = fromForm(form).product;
  assert.equal('image' in removed.colors[0], false);
  assert.equal(removed.colors[1].image, original.colors[1].image);

  // új szín képpel
  form = toForm('pavaje', id, original);
  form.colors.push({ ...newRow.color('mist'), image: emptySlot() });
  setSlotBlob(form.colors.at(-1).image, { blob: blob('mist-kep'), previewUrl: '' });
  await assignUploadPaths(form, PREFIX);
  const added = fromForm(form).product.colors.at(-1);
  assert.match(added.image, /^\/assets\/pavaje\/autoblocant-6cm_mist_[0-9a-f]{8}\.webp$/);
});

test('kép nélkül menthető, de figyelmeztetést ad (új és meglévő terméknél is)', () => {
  const form = emptyForm('borduri');
  Object.assign(form, { name: 'Teszt', id: 'teszt', priceFrom: '5', dimensions: '1x1' });
  const bare = applyForm(products, colors, form);
  assert.equal(bare.errors.some((e) => e.path === 'image'), false, 'nem hiba');
  assert.ok(bare.products, 'kép nélkül is létrejön a termék');
  assert.ok(bare.warnings.some((w) => w.path === 'image'), 'de figyelmeztet');

  setSlotBlob(form.image, { blob: blob('k'), previewUrl: '' });
  assert.equal(applyForm(products, colors, form).warnings.some((w) => w.path === 'image'), false, 'a kiválasztott (még nem feltöltött) kép is megfelel');

  const existing = toForm('borduri', 'bordura-mic', products.borduri['bordura-mic']);
  clearSlot(existing.image);
  assert.equal(applyForm(products, colors, existing).errors.some((e) => e.path === 'image'), false, 'meglévő termék kép nélkül is menthető');
  assert.ok(applyForm(products, colors, existing).warnings.some((w) => w.path === 'image'));
});

test('másolat: a képek ugyanarra a fájlra mutatnak, útvonal-kijelölés nélkül is', () => {
  const found = findProduct(products, 'pavaj-aviro-6');
  const form = toForm(found.category, '', structuredClone(found.product), { isNew: true });
  form.id = 'pavaj-aviro-6-copie';
  const result = applyForm(products, colors, form);
  assert.deepEqual(result.errors, []);
  const copy = result.products['premium-pavaje']['pavaj-aviro-6-copie'];
  assert.equal(copy.image, found.product.image);
  assert.deepEqual(copy.sizes.map((s) => s.image), found.product.sizes.map((s) => s.image));
});

// A katalógus (products.json tartalma) módosító műveletei. Mindegyik tiszta függvény: másolaton dolgozik,
// az eredeti objektumot nem változtatja, a kategóriák és termékek sorrendjét megőrzi.
import { CATEGORIES, canonicalizeProduct } from '../../src/shared/catalog-schema.js';

export class ChangeError extends Error {}

const copy = (value) => structuredClone(value);

export function takenIds(products) {
  const ids = new Set();
  for (const items of Object.values(products || {})) for (const id of Object.keys(items || {})) ids.add(id);
  return ids;
}

export function findProduct(products, id) {
  for (const category of Object.keys(products || {})) {
    if (Object.prototype.hasOwnProperty.call(products[category], id)) {
      return { category, id, product: products[category][id] };
    }
  }
  return null;
}

export function countProducts(products) {
  return Object.values(products || {}).reduce((sum, items) => sum + Object.keys(items || {}).length, 0);
}

function categoryOf(products, category) {
  if (!CATEGORIES.includes(category) || !products[category]) throw new ChangeError('Ismeretlen kategória.');
  return products[category];
}

// Új termék a kategória végére. Az azonosító nem lehet foglalt (kategóriákon át sem).
export function addProduct(products, category, id, product) {
  const next = copy(products);
  const items = categoryOf(next, category);
  if (takenIds(next).has(id)) throw new ChangeError(`Az azonosító (${id}) már használatban van.`);
  items[id] = canonicalizeProduct(copy(product));
  return next;
}

// A termék cseréje a saját helyén (a sorrend nem változik).
export function replaceProduct(products, category, id, product) {
  const next = copy(products);
  const items = categoryOf(next, category);
  if (!Object.prototype.hasOwnProperty.call(items, id)) {
    throw new ChangeError('A termék közben megszűnt. Frissítsd az oldalt.');
  }
  items[id] = copy(product);
  return next;
}

// Azonosító-csere a termék helyének megtartásával.
export function renameProductId(products, category, oldId, newId) {
  if (oldId === newId) return copy(products);
  const next = copy(products);
  const items = categoryOf(next, category);
  if (!Object.prototype.hasOwnProperty.call(items, oldId)) {
    throw new ChangeError('A termék közben megszűnt. Frissítsd az oldalt.');
  }
  if (takenIds(next).has(newId)) throw new ChangeError(`Az azonosító (${newId}) már használatban van.`);
  next[category] = Object.fromEntries(Object.entries(items).map(([key, value]) => [key === oldId ? newId : key, value]));
  return next;
}

export function removeProduct(products, category, id) {
  const next = copy(products);
  const items = categoryOf(next, category);
  if (!Object.prototype.hasOwnProperty.call(items, id)) return next; // már törölve: nincs teendő
  delete items[id];
  return next;
}

// Egy hellyel feljebb (delta = -1) vagy lejjebb (delta = +1) a kategórián belül.
export function moveProduct(products, category, id, delta) {
  const next = copy(products);
  const items = categoryOf(next, category);
  const entries = Object.entries(items);
  const from = entries.findIndex(([key]) => key === id);
  if (from === -1) throw new ChangeError('A termék közben megszűnt. Frissítsd az oldalt.');
  const to = from + delta;
  if (to < 0 || to >= entries.length) return next;
  [entries[from], entries[to]] = [entries[to], entries[from]];
  next[category] = Object.fromEntries(entries);
  return next;
}

// Másolat előkészítése: a név román marad („… (copie)”), a képek ugyanarra a fájlra mutatnak.
export function duplicateOf(product) {
  const clone = copy(product);
  clone.name = `${String(clone.name).trim()} (copie)`;
  return clone;
}

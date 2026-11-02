import { CATEGORIES } from '../../src/shared/catalog-schema.js';

export const DEFAULT_HASH = `#/termekek/${CATEGORIES[0]}`;

// Hash-útvonalak: #/szinek, #/jelszo, #/termekek[/<kategória>], #/termek/<kategória>/<azonosító>, #/uj/<kategória>[/<másolandó azonosító>].
// Ismeretlen útvonalra null.
export function parseRoute(hash) {
  let parts;
  try {
    parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [name, category, id] = parts;
  if (name === 'szinek' && parts.length === 1) return { name: 'palette' };
  if (name === 'jelszo' && parts.length === 1) return { name: 'password' };
  if (name === 'termekek' && parts.length <= 2 && (parts.length === 1 || CATEGORIES.includes(category))) {
    return { name: 'list', category: category ?? CATEGORIES[0] };
  }
  if (name === 'termek' && parts.length === 3 && CATEGORIES.includes(category)) return { name: 'edit', category, id };
  if (name === 'uj' && parts.length <= 3 && CATEGORIES.includes(category)) return { name: 'new', category, from: id || '' };
  return null;
}

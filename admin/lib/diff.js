// A piszkozat (cms-draft) és az éles ág (main) katalógusának összehasonlítása.
// Ebből látszik, mi „Új”, „Módosított” vagy törölt a publikálásig.

const isObject = (v) => v !== null && typeof v === 'object';

// Mélységi egyenlőség a kulcsok sorrendjétől függetlenül (a sorrendet külön kezeljük).
export function deepEqual(a, b) {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

export function diffCatalog(main, draft) {
  const added = [];
  const changed = [];
  const removed = [];
  const reordered = [];
  const categories = new Set([...Object.keys(main?.products || {}), ...Object.keys(draft?.products || {})]);

  for (const category of categories) {
    const before = main?.products?.[category] || {};
    const after = draft?.products?.[category] || {};
    for (const id of Object.keys(after)) {
      if (!(id in before)) added.push({ category, id });
      else if (!deepEqual(before[id], after[id])) changed.push({ category, id });
    }
    for (const id of Object.keys(before)) if (!(id in after)) removed.push({ category, id });

    const common = Object.keys(before).filter((id) => id in after);
    const afterOrder = Object.keys(after).filter((id) => id in before);
    if (common.some((id, i) => id !== afterOrder[i])) reordered.push(category);
  }

  const colorsChanged = !deepEqual(main?.colors || {}, draft?.colors || {});
  const count = added.length + changed.length + removed.length + reordered.length + (colorsChanged ? 1 : 0);
  return { added, changed, removed, reordered, colorsChanged, count };
}

// 'new' | 'changed' | null egy termékhez a listában.
export function productStatus(diff, category, id) {
  if (diff.added.some((e) => e.category === category && e.id === id)) return 'new';
  if (diff.changed.some((e) => e.category === category && e.id === id)) return 'changed';
  return null;
}

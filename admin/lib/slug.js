// Azonosító (webcím-rész) készítése a terméknévből: kisbetű, ékezet nélkül, kötőjellel tagolva.
// Az azonosító a termék URL-jének része (…produs.html?cat=…&id=<azonosító>), ezért a létrehozása után zárolt.

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD') // ă → a + ◌̆, ș → s + ◌̦, ² → 2
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

// Ha a név azonosítója már foglalt, számot fűz hozzá (-2, -3…). Másolatnál használjuk.
export function freeId(base, taken) {
  const root = base || 'termek';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, 76)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('Nem sikerült szabad azonosítót találni.');
}

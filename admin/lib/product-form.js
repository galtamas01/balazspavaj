// A terméklap szerkesztő űrlapmodellje és az átalakítások a products.json-beli termék és az űrlap között.
// Tiszta függvények (nincs DOM), így Node-ban tesztelhetők.
//
// Alapelvek:
//  - A meglévő terméknél a változatlan mezők a helyükön, az eredeti formában maradnak (diff-barát, a nem
//    szerkesztett adatok – pl. képek – sosem vesznek el).
//  - A szerkesztő által nem ismert mezőket (pl. a sorok képét) a sorok `orig` objektuma viszi tovább.
import { validateCatalog } from '../../src/shared/catalog-schema.js';
import { normalizePrice, buildPrice, samePrice, splitPrice } from './price.js';
import { slugify } from './slug.js';
import { emptySlot, slotFromPath, imagePath, hasImage } from './image-slots.js';
import { addProduct, replaceProduct, renameProductId, ChangeError } from './catalog-ops.js';

const clone = (value) => structuredClone(value);

export function emptyForm(category) {
  return {
    category,
    isNew: true,
    originalId: '',
    id: '',
    idManual: false,
    base: null,
    image: emptySlot(),
    name: '',
    unit: 'mp',
    priceMode: 'single',
    priceFrom: '',
    priceTo: '',
    sizeMode: 'single',
    dimensions: '',
    sizes: [],
    colors: [],
    types: [],
  };
}

// A meglévő (vagy másolandó) termékből űrlapmodell. Másolatnál isNew=true és az azonosító üres (a névből készül).
export function toForm(category, id, product, { isNew = false } = {}) {
  const price = splitPrice(product.price);
  return {
    category,
    isNew,
    originalId: isNew ? '' : id,
    id: isNew ? '' : id,
    idManual: false,
    base: clone(product),
    image: slotFromPath(product.image),
    name: String(product.name ?? ''),
    unit: product.unit ?? 'mp',
    priceMode: price.mode,
    priceFrom: price.from,
    priceTo: price.to,
    sizeMode: Array.isArray(product.sizes) ? 'multi' : 'single',
    dimensions: String(product.dimensions ?? ''),
    sizes: (product.sizes || []).map((s) => ({ name: String(s.name ?? ''), dimensions: String(s.dimensions ?? ''), image: slotFromPath(s.image), orig: clone(s) })),
    colors: (product.colors || []).map((c) => ({ name: String(c.name ?? ''), price: String(c.price ?? ''), image: slotFromPath(c.image), orig: clone(c) })),
    types: (product.type || []).map((t) => ({ name: String(t.name ?? ''), price: String(t.price ?? ''), orig: clone(t) })),
  };
}

// Új sor értékei az ismétlődő listákba.
export const newRow = {
  size: () => ({ name: '', dimensions: '', image: emptySlot(), orig: null }),
  color: (name = '') => ({ name, price: '', image: emptySlot(), orig: null }),
  type: () => ({ name: '', price: '', orig: null }),
};

// Szín- és méretsor képe: ha van, beírja; ha nincs, a mezőt elhagyja.
function setImage(entry, slot) {
  const path = imagePath(slot);
  if (path) entry.image = path;
  else delete entry.image;
}

// Az űrlapmodellből termék. A hibák mező-útvonalai a séma útvonalaival egyeznek (pl. colors[0].price).
export function fromForm(form) {
  const errors = [];
  const product = form.base ? clone(form.base) : {};

  product.name = form.name.trim();
  product.unit = form.unit;
  if (product.name === '') errors.push({ path: 'name', message: 'Add meg a termék nevét (románul, ahogy a weboldalon megjelenik).' });

  const price = buildPrice({ mode: form.priceMode, from: form.priceFrom, to: form.priceTo }, form.base?.price);
  if (price.error) errors.push({ path: 'price', message: price.error });
  else product.price = price.value;

  if (form.sizeMode === 'multi') {
    delete product.dimensions;
    if (form.sizes.length === 0) {
      delete product.sizes;
      errors.push({ path: 'sizes', message: 'Adj meg legalább egy méretet, vagy válaszd az „Egy fix méret” lehetőséget.' });
    } else {
      product.sizes = form.sizes.map((row) => {
        const entry = row.orig ? clone(row.orig) : {};
        entry.name = row.name.trim();
        entry.dimensions = row.dimensions.trim();
        setImage(entry, row.image);
        return entry;
      });
    }
  } else {
    delete product.sizes;
    product.dimensions = form.dimensions.trim();
    if (product.dimensions === '') errors.push({ path: 'dimensions', message: 'Add meg a méretet (pl. 20x10x6 cm).' });
  }

  if (form.colors.length > 0) {
    product.colors = form.colors.map((row, i) => {
      const entry = row.orig ? clone(row.orig) : {};
      entry.name = row.name;
      setImage(entry, row.image);
      const text = row.price.trim();
      if (text === '') {
        delete entry.price;
      } else {
        const result = normalizePrice(text);
        if (result.error) errors.push({ path: `colors[${i}].price`, message: result.error });
        else entry.price = samePrice(row.orig?.price, result.value) ? row.orig.price : result.value;
      }
      return entry;
    });
  } else {
    delete product.colors;
  }

  if (form.types.length > 0) {
    product.type = form.types.map((row, i) => {
      const entry = row.orig ? clone(row.orig) : {};
      entry.name = row.name.trim();
      const result = normalizePrice(row.price);
      if (result.error) errors.push({ path: `type[${i}].price`, message: result.error });
      else entry.price = samePrice(row.orig?.price, result.value) ? row.orig.price : result.value;
      return entry;
    });
  } else {
    delete product.type;
  }

  product.image = imagePath(form.image);
  return { product, errors };
}

export const IMAGE_MISSING_WARNING = 'A termékhez nincs kép feltöltve.';

// Van-e a terméknek bármilyen képe (fő kép, vagy szín-/méretsor képe, ami a fő kép helyett szolgál).
export function hasAnyImage(form) {
  if (hasImage(form.image)) return true;
  return [...form.colors, ...form.sizes].some((row) => hasImage(row.image));
}

// Az űrlap alkalmazása a katalógusra + teljes ellenőrzés (ugyanaz a séma, mint a szerveren).
// Visszaad: { products: új katalógus | null, errors: [{path,message}], warnings: [{path,message}], id }
// A hibák útvonalai a termékhez képest relatívak (pl. "price", "colors[0].name"); a termék egészére
// vonatkozó üzenet útvonala '' (az azonosító hibáié 'id').
export function applyForm(products, colors, form) {
  const { product, errors: local } = fromForm(form);
  const id = form.id.trim();
  const errors = [...local];
  const warnings = [];
  // Kép nélkül is menthető, de a terméklap és a lista kép nélkül hiányosan néz ki: figyelmeztetés, nem hiba.
  if (!hasAnyImage(form)) warnings.push({ path: 'image', message: IMAGE_MISSING_WARNING });

  if (!id) {
    errors.push({ path: 'id', message: 'Az azonosító a névből készül, adj meg egy nevet.' });
    return { products: null, errors, warnings, id };
  }

  let next = null;
  try {
    if (form.isNew) {
      next = addProduct(products, form.category, id, product);
    } else {
      next = replaceProduct(products, form.category, form.originalId, product);
      if (id !== form.originalId) next = renameProductId(next, form.category, form.originalId, id);
    }
  } catch (e) {
    if (!(e instanceof ChangeError)) throw e;
    errors.push({ path: 'id', message: e.message });
  }

  if (next) {
    const prefix = `${form.category}.${id}`;
    const result = validateCatalog(next, colors);
    const known = new Set(errors.map((e) => e.path));
    const relative = (path) => (path === prefix ? '' : path.startsWith(`${prefix}.`) ? path.slice(prefix.length + 1) : null);

    for (const issue of result.errors) {
      const rel = relative(issue.path);
      if (rel === null) {
        errors.push({ path: issue.path, message: issue.message }); // másik terméké: nem a szerkesztőben javítható
        continue;
      }
      const path = rel === '' ? 'id' : rel;
      if (known.has(path)) continue; // mezőnként egy üzenet elég
      known.add(path);
      errors.push({ path, message: issue.message });
    }
    for (const issue of result.warnings) {
      const rel = relative(issue.path);
      if (rel !== null) warnings.push({ path: rel, message: issue.message });
    }
  }

  return { products: errors.length === 0 ? next : null, errors, warnings, id };
}

// Az azonosító automatikus javaslata a névből (új terméknél, amíg kézzel nem írták át).
export function suggestId(name) {
  return slugify(name);
}

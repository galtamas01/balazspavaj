// A katalógus (products.json) és a színpaletta (colors.json) közös validációja és szerializálása.
// Ugyanezt a modult használja a böngésző (admin felület) és a szerver (Netlify Functions),
// ezért függőség nélküli ES modul. A szerver a kliens ellenőrzésétől függetlenül MINDIG újravalidál.
// A hibaüzenetek magyarul vannak, mert az ügyfél látja őket.

export const CATEGORIES = ['pavaje', 'premium-pavaje', 'borduri', 'rigole'];
export const UNITS = ['mp', 'buc'];

// "55", "55,50", "6,5", tartomány: "40 - 50"
export const PRICE_RE = /^\d+(,\d{1,2})?( - \d+(,\d{1,2})?)?$/;
// az azonosító az URL része; legalább egy betű kell bele (a csak számjegyű kulcsokat a JS átrendezné)
export const PRODUCT_ID_RE = /^(?=.*[a-z])[a-z0-9]+(-[a-z0-9]+)*$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const IMAGE_RE = /^\/assets\/([a-z0-9_-]+\/)*[a-z0-9_-]+\.(webp|png|jpe?g)$/;
export const MAX_JSON_BYTES = 1_000_000;

// Új termék mezősorrendje. A meglévő termékeknél a sorrend nem egységes, ezért a szerializálás
// SOHA nem rendez át: azt az sorrendet írja vissza, ami az objektumban van (diff-barát).
export const PRODUCT_FIELD_ORDER = ['name', 'image', 'dimensions', 'price', 'unit', 'colors', 'sizes', 'type'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A szöveg elején/végén lévő szóköz a meglévő adatokban előfordul (pl. „... TIP 65 ”), ezért a `warn` listával
// hívva csak figyelmeztetés (a szerkesztő mentéskor amúgy is levágja); anélkül hiba.
function checkText(issues, path, value, label, { max, required = true, warn } = {}) {
  if (value === undefined || value === null) {
    if (required) issues.push({ path, message: `${label}: kötelező megadni.` });
    return false;
  }
  if (typeof value !== 'string') {
    issues.push({ path, message: `${label}: szöveget adj meg.` });
    return false;
  }
  if (required && value.trim() === '') {
    issues.push({ path, message: `${label}: kötelező megadni.` });
    return false;
  }
  if (value !== value.trim()) {
    const issue = { path, message: `${label}: szóköz van az elején vagy a végén.` };
    if (warn) warn.push(issue);
    else {
      issues.push(issue);
      return false;
    }
  }
  if (/[<>]/.test(value)) {
    issues.push({ path, message: `${label}: a < és > jel nem használható.` });
    return false;
  }
  if (max && value.length > max) {
    issues.push({ path, message: `${label}: legfeljebb ${max} karakter lehet.` });
    return false;
  }
  return true;
}

function checkPrice(issues, path, value, label = 'Ár') {
  if (typeof value !== 'string' || !PRICE_RE.test(value)) {
    issues.push({
      path,
      message: `${label}: számot adj meg tizedesvesszővel (pl. 55 vagy 55,50), vagy tartományt (pl. 40 - 50).`,
    });
    return false;
  }
  return true;
}

function checkImage(issues, path, value, ctx) {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) {
    issues.push({ path, message: 'Kép: érvénytelen útvonal.' });
    return;
  }
  if (ctx.assetsPrefix) {
    if (!value.startsWith(ctx.assetsPrefix)) {
      issues.push({ path, message: `Kép: a ${ctx.assetsPrefix} mappában kell lennie.` });
    } else if (ctx.assets && !ctx.assets.has(value)) {
      issues.push({ path, message: 'Kép: a fájl nem található.' });
    }
  }
}

function checkUniqueNames(issues, path, list) {
  const seen = new Set();
  list.forEach((entry, i) => {
    if (!isObject(entry) || typeof entry.name !== 'string') return;
    if (seen.has(entry.name)) {
      issues.push({ path: `${path}[${i}].name`, message: `„${entry.name}” kétszer szerepel.` });
    }
    seen.add(entry.name);
  });
}

function validateList(issues, path, value, label) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${label}: lista kell legyen.` });
    return null;
  }
  if (value.length === 0) {
    issues.push({ path, message: `${label}: ha nincs elem, hagyd el a mezőt.` });
    return null;
  }
  return value;
}

// ---------- Színpaletta ----------

export function validateColors(colors) {
  const issues = [];
  if (!isObject(colors)) {
    issues.push({ path: 'colors', message: 'A színpaletta hibás szerkezetű.' });
    return issues;
  }
  for (const [name, def] of Object.entries(colors)) {
    const path = `colors.${name}`;
    if (!checkText(issues, path, name, 'Színnév', { max: 40 })) continue;
    if (!isObject(def)) {
      issues.push({ path, message: `${name}: hibás szerkezet.` });
      continue;
    }
    if (typeof def.hex !== 'string' || !HEX_RE.test(def.hex)) {
      issues.push({ path: `${path}.hex`, message: `${name}: a színkód #rrggbb formátumú legyen (pl. #808080).` });
    }
    if (def.border !== undefined && typeof def.border !== 'boolean') {
      issues.push({ path: `${path}.border`, message: `${name}: a keret igen/nem érték legyen.` });
    }
    if (def.image !== undefined) checkImage(issues, `${path}.image`, def.image, {});
  }
  return issues;
}

// ---------- Termék ----------

// Egy termék ellenőrzése. A product-ID-t külön a validateProductId ellenőrzi.
// ctx: { colors (paletta), assets (Set a létező képekről), assetsPrefix ('/assets/pavaje/') }
export function validateProduct(product, path, ctx = {}, issues = [], warnings = []) {
  if (!isObject(product)) {
    issues.push({ path, message: 'A termék hibás szerkezetű.' });
    return { issues, warnings };
  }
  const palette = isObject(ctx.colors) ? ctx.colors : {};

  checkText(issues, `${path}.name`, product.name, 'Név', { max: 100, warn: warnings });
  if (product.name !== undefined && typeof product.name === 'string' && product.name.trim().length < 2) {
    issues.push({ path: `${path}.name`, message: 'Név: legalább 2 karakter kell.' });
  }
  checkPrice(issues, `${path}.price`, product.price);
  if (!UNITS.includes(product.unit)) {
    issues.push({ path: `${path}.unit`, message: 'Mértékegység: m² (mp) vagy darab (buc) lehet.' });
  }
  checkImage(issues, `${path}.image`, product.image, ctx);
  if (product.dimensions !== undefined) {
    checkText(issues, `${path}.dimensions`, product.dimensions, 'Méret', { max: 60, required: false, warn: warnings });
  }

  const colors = validateList(issues, `${path}.colors`, product.colors, 'Színek');
  if (colors) {
    colors.forEach((c, i) => {
      const p = `${path}.colors[${i}]`;
      if (!isObject(c)) {
        issues.push({ path: p, message: 'Szín: hibás szerkezet.' });
        return;
      }
      if (typeof c.name !== 'string' || !has(palette, c.name)) {
        issues.push({ path: `${p}.name`, message: `Szín: „${c.name ?? ''}” nincs a színpalettán.` });
      }
      checkImage(issues, `${p}.image`, c.image, ctx);
      if (c.price !== undefined) checkPrice(issues, `${p}.price`, c.price, 'Szín ára');
    });
    checkUniqueNames(issues, `${path}.colors`, colors);
  }

  const sizes = validateList(issues, `${path}.sizes`, product.sizes, 'Méretek');
  if (sizes) {
    sizes.forEach((s, i) => {
      const p = `${path}.sizes[${i}]`;
      if (!isObject(s)) {
        issues.push({ path: p, message: 'Méret: hibás szerkezet.' });
        return;
      }
      checkText(issues, `${p}.name`, s.name, 'Méret neve', { max: 40, warn: warnings });
      checkText(issues, `${p}.dimensions`, s.dimensions, 'Méret', { max: 60, warn: warnings });
      checkImage(issues, `${p}.image`, s.image, ctx);
    });
    checkUniqueNames(issues, `${path}.sizes`, sizes);
  }

  const types = validateList(issues, `${path}.type`, product.type, 'Típusok');
  if (types) {
    types.forEach((t, i) => {
      const p = `${path}.type[${i}]`;
      if (!isObject(t)) {
        issues.push({ path: p, message: 'Típus: hibás szerkezet.' });
        return;
      }
      checkText(issues, `${p}.name`, t.name, 'Típus neve', { max: 40, warn: warnings });
      checkPrice(issues, `${p}.price`, t.price, 'Típus ára');
    });
    checkUniqueNames(issues, `${path}.type`, types);
  }

  // Figyelmeztetések (nem blokkolnak): a weboldal jelenlegi működésének korlátai (lásd PROJECT_LOGIC 8.4)
  if (colors && types) {
    warnings.push({
      path,
      message: 'Szín és típus együtt: színváltáskor a weboldalon a típus ára elveszhet.',
    });
  }
  if (colors && sizes && sizes.some((s) => isObject(s) && s.image)) {
    warnings.push({
      path,
      message: 'Szín és méret együtt: a méretekhez megadott képek nem jelennek meg a weboldalon.',
    });
  }
  return { issues, warnings };
}

export function validateProductId(id, path = 'id') {
  const issues = [];
  if (typeof id !== 'string' || id.length > 80 || !PRODUCT_ID_RE.test(id)) {
    issues.push({
      path,
      message: 'Azonosító: csak kisbetű, szám és kötőjel lehet, legalább egy betűvel (pl. pavaj-aviro-6).',
    });
  }
  return issues;
}

// ---------- Teljes katalógus ----------

export function validateCatalog(products, colors, ctx = {}) {
  const issues = [];
  const warnings = [];

  issues.push(...validateColors(colors));

  if (!isObject(products)) {
    issues.push({ path: 'products', message: 'A katalógus hibás szerkezetű.' });
    return { ok: false, errors: issues, warnings };
  }

  for (const key of Object.keys(products)) {
    if (!CATEGORIES.includes(key)) {
      issues.push({ path: key, message: `Ismeretlen kategória: ${key}.` });
    }
  }

  const seenIds = new Map();
  for (const category of CATEGORIES) {
    const items = products[category];
    if (!isObject(items)) {
      issues.push({ path: category, message: `A(z) ${category} kategória hiányzik vagy hibás.` });
      continue;
    }
    for (const [id, product] of Object.entries(items)) {
      const path = `${category}.${id}`;
      issues.push(...validateProductId(id, path));
      if (seenIds.has(id)) {
        issues.push({
          path,
          message: `Az azonosító (${id}) már használatban van a(z) ${seenIds.get(id)} kategóriában.`,
        });
      } else {
        seenIds.set(id, category);
      }
      validateProduct(product, path, { ...ctx, colors }, issues, warnings);
    }
  }

  return { ok: issues.length === 0, errors: issues, warnings };
}

// ---------- Szerializálás ----------
// Formátum (a jelenlegi fájlokkal byte-azonos): 4 szóköz, nyers UTF-8, LF, záró újsor nélkül.

function serialize(value) {
  const text = JSON.stringify(value, null, 4);
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    throw new Error('A katalógus mérete meghaladja az 1 MB-os korlátot.');
  }
  return text;
}

export const serializeCatalog = serialize;
export const serializeColors = serialize;

// Új termék mezősorrendje; ismeretlen mezők a végére kerülnek.
export function canonicalizeProduct(product) {
  const out = {};
  for (const key of PRODUCT_FIELD_ORDER) if (product[key] !== undefined) out[key] = product[key];
  for (const key of Object.keys(product)) if (!(key in out) && product[key] !== undefined) out[key] = product[key];
  return out;
}

// Az összes hivatkozott képút (termék, szín, méret, paletta).
export function collectImagePaths(products, colors) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v !== '') out.add(v);
  };
  if (isObject(products)) {
    for (const items of Object.values(products)) {
      if (!isObject(items)) continue;
      for (const p of Object.values(items)) {
        if (!isObject(p)) continue;
        add(p.image);
        for (const list of [p.colors, p.sizes]) {
          if (Array.isArray(list)) for (const e of list) if (isObject(e)) add(e.image);
        }
      }
    }
  }
  if (isObject(colors)) for (const def of Object.values(colors)) if (isObject(def)) add(def.image);
  return out;
}

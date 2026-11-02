// A színpaletta (colors.json) módosító műveletei. Tiszta függvények: másolaton dolgoznak, az eredetit nem
// változtatják, a paletta és a termékek sorrendjét megőrzik. A szín neve a kulcs, és pontosan ez áll a
// termékek `colors[].name` mezőjében, ezért átnevezéskor mindkét helyen át kell írni.
import { validateColors, HEX_RE } from '../../src/shared/catalog-schema.js';
import { ChangeError } from './catalog-ops.js';

const copy = (value) => structuredClone(value);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fold = (name) => String(name).trim().toLowerCase();

// #rgb, #rrggbb vagy # nélküli kód → #rrggbb (kisbetűvel). Érvénytelen bemenetre null.
export function normalizeHex(input) {
  let text = String(input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(text)) text = [...text].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return `#${text.toLowerCase()}`;
}

export const sameHex = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Relatív fényesség (0 = fekete, 1 = fehér, WCAG képlet).
export function luminance(hex) {
  if (!HEX_RE.test(hex)) return 0;
  const channel = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

// A világos (fehérhez közeli) színű körre keret kell, különben eltűnik a fehér háttéren.
export const suggestBorder = (hex) => luminance(hex) >= 0.8;

// Mely termékek használják a színt: Map(szín neve → [{ category, id, name }]) a termékek sorrendjében.
export function paletteUsage(products) {
  const usage = new Map();
  for (const [category, items] of Object.entries(products || {})) {
    for (const [id, product] of Object.entries(items || {})) {
      for (const color of product?.colors || []) {
        const key = typeof color === 'object' ? color?.name : color;
        if (typeof key !== 'string') continue;
        if (!usage.has(key)) usage.set(key, []);
        const list = usage.get(key);
        if (!list.some((entry) => entry.category === category && entry.id === id)) {
          list.push({ category, id, name: String(product.name ?? id).trim() });
        }
      }
    }
  }
  return usage;
}

// A név ellenőrzése: üres/túl hosszú/< > ugyanazokkal a szabályokkal, mint a szerveren, és nincs már ilyen
// nevű szín (kis- és nagybetűre való tekintet nélkül, mert a weboldal is kisbetűsít). `except`: a módosított
// szín jelenlegi neve. Visszaad: hibaüzenet vagy '' ha rendben.
export function colorNameError(colors, name, { except = null } = {}) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') return 'A szín nevét meg kell adni.';
  const issues = validateColors({ [trimmed]: { hex: '#000000' } }).filter((issue) => issue.path === `colors.${trimmed}`);
  if (issues.length) return issues[0].message;
  const clash = Object.keys(colors || {}).find((key) => key !== except && fold(key) === fold(trimmed));
  if (clash) return `Ilyen nevű szín már van a palettán (${clash}).`;
  return '';
}

export function hexError(input) {
  return normalizeHex(input) ? '' : 'A színkód #rrggbb formátumú legyen, pl. #4a6b3a.';
}

function definition(hex, border, base = {}) {
  const def = { ...base, hex };
  if (border) def.border = true;
  else delete def.border;
  return def;
}

// Új szín a paletta végére. `border`: világos színnél keretet kap a kör.
export function addColor(colors, name, { hex, border = false }) {
  const next = copy(colors);
  const trimmed = String(name).trim();
  const nameIssue = colorNameError(next, trimmed);
  if (nameIssue) throw new ChangeError(nameIssue);
  const normalized = normalizeHex(hex);
  if (!normalized) throw new ChangeError(hexError(hex));
  next[trimmed] = definition(normalized, border);
  return next;
}

// A szín kódjának és keretének módosítása. A számszerűen változatlan kód az eredeti szövegét tartja meg
// (pl. #D8C5B4 nem lesz #d8c5b4), így a mentés csak a valódi változást írja át. Ismeretlen mezők (pl. image) megmaradnak.
export function updateColor(colors, name, { hex, border = false }) {
  if (!has(colors, name)) throw new ChangeError('A szín közben megszűnt. Frissítsd az oldalt.');
  const next = copy(colors);
  const normalized = normalizeHex(hex);
  if (!normalized) throw new ChangeError(hexError(hex));
  const old = next[name];
  next[name] = definition(old.hex && sameHex(old.hex, normalized) ? old.hex : normalized, border, old);
  return next;
}

// Átnevezés a paletta és az összes termék hivatkozásaiban, a paletta sorrendjének megtartásával.
// Visszaad: { colors, products, affected } (affected: hány termék módosult).
export function renameColor(colors, products, oldName, newName) {
  if (!has(colors, oldName)) throw new ChangeError('A szín közben megszűnt. Frissítsd az oldalt.');
  const trimmed = String(newName).trim();
  if (trimmed === oldName) return { colors: copy(colors), products: copy(products), affected: 0 };
  const nameIssue = colorNameError(colors, trimmed, { except: oldName });
  if (nameIssue) throw new ChangeError(nameIssue);

  const nextColors = Object.fromEntries(Object.entries(copy(colors)).map(([key, def]) => [key === oldName ? trimmed : key, def]));
  const nextProducts = copy(products);
  let affected = 0;
  for (const items of Object.values(nextProducts)) {
    for (const product of Object.values(items || {})) {
      let touched = false;
      for (const color of product?.colors || []) {
        if (color && color.name === oldName) {
          color.name = trimmed;
          touched = true;
        }
      }
      if (touched) affected += 1;
    }
  }
  return { colors: nextColors, products: nextProducts, affected };
}

// Törlés csak akkor, ha egy termék sem használja.
export function removeColor(colors, products, name) {
  if (!has(colors, name)) return copy(colors); // már törölve: nincs teendő
  const users = paletteUsage(products).get(name) || [];
  if (users.length) {
    throw new ChangeError(`A(z) ${name} színt még használja ${users.length} termék, ezért nem törölhető.`);
  }
  const next = copy(colors);
  delete next[name];
  return next;
}

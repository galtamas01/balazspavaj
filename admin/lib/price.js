// Ár-szövegek feldolgozása. A weboldal árai román formájú szövegek: tizedesvessző, tartomány „40 - 50”.
// A szerkesztő elfogadja a tizedespontot is („55.5”), és mentéskor román alakra hozza („55,50”).

const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;

// Egy számot normalizál: "55.5" → "55,50", "55,00" → "55", "6,5" → "6,50". Hibás bemenetre {error}.
export function normalizeNumber(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { error: 'Add meg az árat.' };
  if (!NUMBER_RE.test(text)) return { error: 'Számot adj meg, pl. 55 vagy 55,50.' };
  const [intPart, frac = ''] = text.replace('.', ',').split(',');
  if (frac.length > 2) return { error: 'Legfeljebb 2 tizedesjegy lehet (pl. 55,50).' };
  const int = intPart.replace(/^0+(?=\d)/, '');
  if (/^0*$/.test(frac)) {
    if (int === '0') return { error: 'Az ár nem lehet nulla.' };
    return { value: int };
  }
  return { value: `${int},${frac.padEnd(2, '0')}` };
}

const toNumber = (normalized) => Number(normalized.replace(',', '.'));

// Egy ár vagy tartomány („40 - 50”, „40-50”, „40 – 50”) normalizálása.
export function normalizePrice(raw) {
  const text = String(raw ?? '').trim();
  const parts = text.split(/\s*[-–—]\s*/);
  if (parts.length > 2) return { error: 'Egy számot vagy tartományt adj meg (pl. 40 - 50).' };
  const results = parts.map(normalizeNumber);
  const failed = results.find((r) => r.error);
  if (failed) return { error: failed.error };
  if (results.length === 2) {
    if (toNumber(results[0].value) > toNumber(results[1].value)) {
      return { error: 'A tartomány eleje nem lehet nagyobb a végénél.' };
    }
    return { value: `${results[0].value} - ${results[1].value}` };
  }
  return { value: results[0].value };
}

// Két ár-szöveg számszerűen azonos-e („6,5” és „6,50” igen). A módosítatlan ár így nem íródik át.
export function samePrice(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = normalizePrice(a);
  const y = normalizePrice(b);
  return !x.error && !y.error && x.value === y.value;
}

// A meglévő ár szétbontása a szerkesztő mezőihez: {mode:'single'|'range', from, to}.
export function splitPrice(price) {
  const parts = String(price ?? '').split(/\s*[-–—]\s*/);
  if (parts.length === 2) return { mode: 'range', from: parts[0], to: parts[1] };
  return { mode: 'single', from: parts[0] ?? '', to: '' };
}

// A szerkesztő mezőiből ár-szöveg. Ha számszerűen megegyezik az eredetivel, az eredeti marad
// (a „6,5 - 10” ne íródjon át „6,50 - 10”-re, ha senki nem nyúlt hozzá).
export function buildPrice({ mode, from, to }, original) {
  if (mode === 'range' && (String(from).trim() === '' || String(to).trim() === '')) {
    return { error: 'Add meg a tartomány mindkét végét.' };
  }
  const raw = mode === 'range' ? `${String(from).trim()} - ${String(to).trim()}` : from;
  const result = normalizePrice(raw);
  if (result.error) return result;
  if (typeof original === 'string' && samePrice(original, result.value)) return { value: original };
  return result;
}

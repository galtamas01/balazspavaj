// Képfeldolgozás a böngészőben: a feltöltött fotó átméretezése és WebP-re alakítása (a repóba csak ez kerül).
// A tiszta részek (computeSize, checkFile) Node-ban is tesztelhetők; a convertToWebp böngészőt igényel.

export const MAX_SIDE = 1600; // a hosszabb oldal legfeljebb ennyi pixel
export const MAX_INPUT_BYTES = 40_000_000;
export const MAX_OUTPUT_BYTES = 1_400_000; // a szerver 1,5 MB-ot enged, ebből marad tartalék
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Egyre kisebb méret / minőség, amíg a kép a korlát alá nem kerül.
const ATTEMPTS = [
  [MAX_SIDE, 0.82],
  [MAX_SIDE, 0.7],
  [1200, 0.7],
  [1000, 0.6],
];

// code: HEIC | TYPE | TOO_BIG_INPUT | DECODE | NO_WEBP | TOO_BIG_OUTPUT
export class ImageError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function computeSize(width, height, maxSide = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function checkFile(file) {
  const name = String(file.name ?? '').toLowerCase();
  const type = String(file.type ?? '').toLowerCase();
  if (/hei[cf]/.test(type) || /\.(heic|heif)$/.test(name)) throw new ImageError('HEIC');
  if (!ALLOWED_TYPES.includes(type)) throw new ImageError('TYPE');
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('TOO_BIG_INPUT');
}

// Visszaad: { blob (image/webp), width, height }. A telefonos fotók EXIF-tájolását figyelembe veszi.
export async function convertToWebp(file) {
  checkFile(file);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError('DECODE');
  }
  try {
    for (const [maxSide, quality] of ATTEMPTS) {
      const { width, height } = computeSize(bitmap.width, bitmap.height, maxSide);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') throw new ImageError('NO_WEBP'); // a böngésző nem tud WebP-t kódolni
      if (blob.size <= MAX_OUTPUT_BYTES) return { blob, width, height };
    }
    throw new ImageError('TOO_BIG_OUTPUT');
  } finally {
    bitmap.close?.();
  }
}

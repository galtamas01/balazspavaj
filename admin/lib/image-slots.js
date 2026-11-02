// A termék képhelyei (fő kép, szín- és méretképek) az űrlapmodellben, és a feltöltendő képek előkészítése.
// Egy képhely (slot): { path, blob, previewUrl, info, assigned }
//  - path:        a repóban már meglévő kép útvonala ('' ha nincs)
//  - blob:        az újonnan kiválasztott, már WebP-re alakított kép (a mentésig csak a böngészőben él)
//  - previewUrl:  a blob helyi előnézeti címe
//  - assigned:    a mentéskor a tartalomból és a terméknévből képzett végleges útvonal
import { slugify } from './slug.js';

export const emptySlot = () => ({ path: '', blob: null, previewUrl: '', info: '', assigned: '' });
export const slotFromPath = (path) => ({ ...emptySlot(), path: typeof path === 'string' ? path : '' });
export const hasImage = (slot) => Boolean(slot && (slot.blob || slot.path));
export const imagePath = (slot) => (slot ? slot.assigned || slot.path || '' : '');

export function releaseSlot(slot) {
  if (slot.previewUrl) globalThis.URL?.revokeObjectURL?.(slot.previewUrl);
  slot.previewUrl = '';
}

export function setSlotBlob(slot, { blob, previewUrl, info = '' }) {
  releaseSlot(slot);
  Object.assign(slot, { blob, previewUrl, info, assigned: '' });
}

export function clearSlot(slot) {
  releaseSlot(slot);
  Object.assign(slot, { path: '', blob: null, info: '', assigned: '' });
}

// Az űrlap összes képhelye a hozzájuk tartozó névrésszel (a fájlnévhez).
export function slotsOf(form) {
  const out = [{ slot: form.image, part: '' }];
  form.colors.forEach((row) => out.push({ slot: row.image, part: row.name }));
  form.sizes.forEach((row, i) => out.push({ slot: row.image, part: row.name || `meret-${i + 1}` }));
  return out.filter((entry) => entry.slot);
}

export function releaseAll(form) {
  for (const { slot } of slotsOf(form)) releaseSlot(slot);
}

export async function shortHash(blob) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Minden új képhez végleges útvonalat rendel: <azonosító>[_<szín vagy méret>]_<tartalom-hash>.webp.
// A hash miatt a fájlnév cache-biztos és ütközésmentes; ugyanaz a kép ugyanarra a fájlra kerül.
// Visszaad: Map(útvonal → blob) a feltöltendő képekről.
export async function assignUploadPaths(form, assetsPrefix) {
  const uploads = new Map();
  for (const { slot, part } of slotsOf(form)) {
    slot.assigned = '';
    if (!slot.blob) continue;
    const name = [form.id, slugify(part), await shortHash(slot.blob)].filter(Boolean).join('_');
    slot.assigned = `${assetsPrefix}${name}.webp`;
    uploads.set(slot.assigned, slot.blob);
  }
  return uploads;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function toUploadList(uploads) {
  const list = [];
  for (const [path, blob] of uploads) list.push({ path, base64: await blobToBase64(blob) });
  return list;
}

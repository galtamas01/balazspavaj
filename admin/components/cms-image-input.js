import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { convertToWebp, ImageError } from '/admin/lib/image.js';
import { setSlotBlob, clearSlot, hasImage } from '/admin/lib/image-slots.js';
import { assetUrl } from '/admin/lib/assets.js';
import { store } from '/admin/lib/catalog.js';

const T = LABELS.image;

// Képválasztó egy képhelyhez: előnézet, kép kiválasztása / cseréje / eltávolítása.
// A kép azonnal átméreteződik és WebP-re alakul a böngészőben; a mentésig nem kerül sehová.
// Használat: el.configure({ slot, errorKey, compact, onChange }) – a slot az űrlapmodell képhelye.
class CmsImageInput extends HTMLElement {
  configure({ slot, errorKey = '', compact = false, onChange = () => {} }) {
    // Figyelem: a `slot` az HTMLElement beépített tulajdonsága (szöveggé alakítaná), ezért a mező neve `imageSlot`.
    Object.assign(this, { imageSlot: slot, errorKey, compact, onChange, busy: false });
    this.addEventListener('click', (event) => this.onClick(event));
    this.addEventListener('change', (event) => this.onFile(event));
    this.render();
    return this;
  }

  render(message = '') {
    const src = this.imageSlot.previewUrl || assetUrl(this.imageSlot.path, store.get().mainImages);
    const has = hasImage(this.imageSlot);
    this.className = `cms-image-input${this.compact ? ' cms-image-input-compact' : ''}`;
    this.innerHTML = `
      <div class="cms-image-preview">
        ${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy">` : `<span class="cms-muted">${escapeHtml(T.none)}</span>`}
      </div>
      <div class="cms-image-controls">
        <div class="cms-image-buttons">
          <button type="button" class="cms-btn" data-action="pick" ${this.busy ? 'disabled' : ''}>${escapeHtml(has ? T.replace : T.pick)}</button>
          <button type="button" class="cms-btn" data-action="remove" ${has && !this.busy ? '' : 'hidden'}>${escapeHtml(T.remove)}</button>
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
        <p class="cms-hint" role="status">${escapeHtml(this.busy ? T.processing : message || this.imageSlot.info)}</p>
        <p class="cms-field-error" data-error-for="${escapeHtml(this.errorKey)}" hidden></p>
      </div>`;
  }

  onClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || !this.contains(button)) return;
    if (button.dataset.action === 'pick') {
      this.querySelector('input[type=file]').click();
    } else if (button.dataset.action === 'remove') {
      clearSlot(this.imageSlot);
      this.render();
      this.onChange();
    }
  }

  async onFile(event) {
    const input = event.target;
    if (input.type !== 'file' || !input.files?.length) return;
    const file = input.files[0];
    this.busy = true;
    this.render();
    try {
      const { blob, width, height } = await convertToWebp(file);
      setSlotBlob(this.imageSlot, {
        blob,
        previewUrl: URL.createObjectURL(blob),
        info: T.ready(width, height, Math.max(1, Math.round(blob.size / 1024))),
      });
      this.busy = false;
      this.render();
      this.onChange();
    } catch (error) {
      this.busy = false;
      this.render();
      const slot = this.querySelector('.cms-field-error');
      if (!(error instanceof ImageError)) console.error('Képfeldolgozási hiba:', error);
      slot.textContent = error instanceof ImageError ? T.errors[error.code] ?? T.errors.DECODE : T.errors.DECODE;
      slot.hidden = false;
    }
  }
}

customElements.define('cms-image-input', CmsImageInput);

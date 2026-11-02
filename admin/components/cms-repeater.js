import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';

// Általános ismétlődő sorlista (méretek, színek, típusok). A sorok adatait a hívó tartja (items tömb),
// a sor mezőit a renderRow adja vissza HTML-ként (data-bind attribútumokkal), a szerkesztő köti a modellhez.
// Átrendezésnél / törlésnél / hozzáadásnál a tömböt helyben módosítja és 'cms-repeater-change' eseményt küld.
class CmsRepeater extends HTMLElement {
  configure({ items, renderRow, newItem, addLabel, emptyText = '', max = 30, minItems = 0, afterRender = null }) {
    Object.assign(this, { items, renderRow, newItem, addLabel, emptyText, max, minItems, afterRender });
    this.render();
    this.addEventListener('click', (event) => this.onClick(event));
    return this;
  }

  render({ focusIndex = null } = {}) {
    const t = LABELS.editor;
    const rows = this.items
      .map(
        (item, i) => `
        <div class="cms-row" data-index="${i}">
          <div class="cms-row-fields">${this.renderRow(item, i)}</div>
          <div class="cms-row-actions">
            <button type="button" class="cms-icon-btn" data-action="up" aria-label="${escapeHtml(t.up)}" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="cms-icon-btn" data-action="down" aria-label="${escapeHtml(t.down)}" ${i === this.items.length - 1 ? 'disabled' : ''}>▼</button>
            <button type="button" class="cms-icon-btn cms-icon-btn-danger" data-action="remove" aria-label="${escapeHtml(t.remove)}" ${this.items.length <= this.minItems ? 'disabled' : ''}>✕</button>
          </div>
        </div>`,
      )
      .join('');
    this.innerHTML = `
      ${this.items.length === 0 && this.emptyText ? `<p class="cms-muted cms-repeater-empty">${escapeHtml(this.emptyText)}</p>` : ''}
      <div class="cms-rows">${rows}</div>
      <button type="button" class="cms-btn cms-repeater-add" data-action="add" ${this.items.length >= this.max ? 'disabled' : ''}>${escapeHtml(this.addLabel)}</button>
    `;
    if (this.afterRender) this.afterRender(this);
    if (focusIndex !== null) this.querySelector(`.cms-row[data-index="${focusIndex}"] input, .cms-row[data-index="${focusIndex}"] select`)?.focus();
  }

  onClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || !this.contains(button)) return;
    const row = button.closest('.cms-row');
    const index = row ? Number(row.dataset.index) : -1;
    const action = button.dataset.action;
    let focusIndex = null;

    if (action === 'add') {
      const item = this.newItem(this.items);
      if (item === null) return;
      this.items.push(item);
      focusIndex = this.items.length - 1;
    } else if (action === 'remove' && index >= 0 && this.items.length > this.minItems) {
      this.items.splice(index, 1);
    } else if (action === 'up' && index > 0) {
      [this.items[index - 1], this.items[index]] = [this.items[index], this.items[index - 1]];
    } else if (action === 'down' && index >= 0 && index < this.items.length - 1) {
      [this.items[index + 1], this.items[index]] = [this.items[index], this.items[index + 1]];
    } else {
      return;
    }
    this.render({ focusIndex });
    this.dispatchEvent(new CustomEvent('cms-repeater-change', { bubbles: true, detail: { action } }));
  }
}

customElements.define('cms-repeater', CmsRepeater);

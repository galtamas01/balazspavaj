import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { store } from '/admin/lib/catalog.js';
import { diffCatalog, productStatus } from '/admin/lib/diff.js';
import { moveProduct, removeProduct } from '/admin/lib/catalog-ops.js';
import { confirmDialog } from '/admin/lib/dialog.js';
import { notify } from '/admin/components/cms-toast.js';
import { assetUrl } from '/admin/lib/assets.js';
import { CATEGORIES } from '/src/shared/catalog-schema.js';

const L = LABELS.list;

// Terméklista: kategória fülek, keresés, soronkénti műveletek (szerkesztés, duplikálás, törlés, sorrend).
class CmsProductList extends HTMLElement {
  connectedCallback() {
    this.category = this.getAttribute('category');
    this.query = '';
    this.innerHTML = `
      <section class="cms-list">
        <h1 class="cms-title">${escapeHtml(L.title)}</h1>
        <div class="cms-tabs" role="tablist" aria-label="${escapeHtml(L.title)}"></div>
        <div class="cms-toolbar">
          <label class="cms-visually-hidden" for="cms-search">${escapeHtml(L.search)}</label>
          <input class="cms-input cms-search" id="cms-search" type="search" placeholder="${escapeHtml(L.searchPlaceholder)}" autocomplete="off">
          <a class="menu-button cms-add" href="#/uj/${escapeHtml(this.category)}">${escapeHtml(L.add)}</a>
        </div>
        <ul class="cms-items" aria-live="polite"></ul>
      </section>
    `;
    this.search = this.querySelector('#cms-search');
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.renderRows();
    });
    this.addEventListener('click', (event) => this.onClick(event));
    this.unsubscribe = store.subscribe(() => this.renderRows());
    this.renderRows();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  renderTabs() {
    const { draft } = store.get();
    this.querySelector('.cms-tabs').innerHTML = CATEGORIES.map((category) => {
      const count = Object.keys(draft.products[category] || {}).length;
      const current = category === this.category;
      return `<a class="cms-tab" role="tab" href="#/termekek/${category}" ${current ? 'aria-selected="true" aria-current="page"' : 'aria-selected="false"'}>
        ${escapeHtml(LABELS.categories[category])} <span class="cms-tab-count">${count}</span></a>`;
    }).join('');
  }

  renderRows() {
    this.renderTabs();
    const state = store.get();
    const items = Object.entries(state.draft.products[this.category] || {});
    const diff = diffCatalog(state.main, state.draft);
    const searching = this.query !== '';
    const visible = searching
      ? items.filter(([id, p]) => String(p.name).toLowerCase().includes(this.query) || id.includes(this.query))
      : items;

    const list = this.querySelector('.cms-items');
    if (visible.length === 0) {
      list.innerHTML = `<li class="cms-empty">${escapeHtml(searching ? L.noMatch : L.empty)}</li>`;
      return;
    }
    list.innerHTML = visible
      .map(([id, product]) => {
        const index = items.findIndex(([key]) => key === id);
        return this.rowHtml({ id, product, index, last: items.length - 1, diff, busy: state.busy, searching, previewUrl: state.previewUrl, mainImages: state.mainImages });
      })
      .join('');
  }

  rowHtml({ id, product, index, last, diff, busy, searching, previewUrl, mainImages }) {
    const status = productStatus(diff, this.category, id);
    const image = assetUrl(product.image || product.colors?.find((c) => c.image)?.image || '', mainImages);
    const unit = LABELS.unitShort[product.unit] ?? product.unit;
    const meta = [`${escapeHtml(product.price)} RON / ${escapeHtml(unit)}`];
    if (product.colors?.length) meta.push(escapeHtml(L.colorsCount(product.colors.length)));
    if (product.sizes?.length) meta.push(escapeHtml(L.sizesCount(product.sizes.length)));
    if (product.type?.length) meta.push(escapeHtml(L.typesCount(product.type.length)));
    const edit = `#/termek/${encodeURIComponent(this.category)}/${encodeURIComponent(id)}`;
    const move = searching || busy;
    const previewLink = previewUrl
      ? `<a class="cms-btn" href="${escapeHtml(previewUrl)}/produse/produs.html?cat=${encodeURIComponent(this.category)}&amp;id=${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHtml(L.preview)}</a>`
      : '';
    return `
      <li class="cms-item" data-id="${escapeHtml(id)}">
        ${image ? `<img class="cms-thumb" src="${escapeHtml(image)}" alt="" width="64" height="64" loading="lazy">` : '<span class="cms-thumb cms-thumb-empty" aria-hidden="true"></span>'}
        <div class="cms-item-main">
          <a class="cms-item-name" href="${edit}">${escapeHtml(String(product.name).trim())}</a>
          <p class="cms-item-meta">${meta.join(' · ')}${status ? ` <span class="cms-badge cms-badge-${status}">${escapeHtml(L.badge[status])}</span>` : ''}</p>
        </div>
        <div class="cms-item-actions">
          <a class="cms-btn cms-btn-primary" href="${edit}">${escapeHtml(L.edit)}</a>
          <a class="cms-btn" href="#/uj/${escapeHtml(this.category)}/${encodeURIComponent(id)}">${escapeHtml(L.duplicate)}</a>
          ${previewLink}
          <button type="button" class="cms-btn cms-btn-danger-outline" data-action="remove" ${busy ? 'disabled' : ''}>${escapeHtml(L.remove)}</button>
          <span class="cms-item-order">
            <button type="button" class="cms-icon-btn" data-action="up" aria-label="${escapeHtml(L.up)}" ${move || index === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="cms-icon-btn" data-action="down" aria-label="${escapeHtml(L.down)}" ${move || index === last ? 'disabled' : ''}>▼</button>
          </span>
        </div>
      </li>`;
  }

  async onClick(event) {
    const button = event.target.closest('button[data-action]');
    const row = button?.closest('.cms-item');
    if (!button || !row || button.disabled) return;
    const id = row.dataset.id;
    const product = store.get().draft.products[this.category]?.[id];
    if (!product) return;
    const name = String(product.name).trim();
    const category = this.category;

    try {
      if (button.dataset.action === 'remove') {
        const ok = await confirmDialog({
          title: L.deleteTitle,
          messageHtml: L.deleteText(escapeHtml(name)),
          confirmLabel: L.deleteConfirm,
          danger: true,
        });
        if (!ok) return;
        await store.save({ apply: (products) => removeProduct(products, category, id), message: LABELS.editor.commit.removed(name) });
        notify(L.deleted(name));
      } else {
        const delta = button.dataset.action === 'up' ? -1 : 1;
        await store.save({ apply: (products) => moveProduct(products, category, id, delta), message: LABELS.editor.commit.moved(name) });
      }
    } catch (error) {
      if (error.status === 401) {
        this.dispatchEvent(new CustomEvent('cms-session-expired', { bubbles: true }));
        return;
      }
      notify(error.message, { type: 'error' });
    }
  }
}

customElements.define('cms-product-list', CmsProductList);

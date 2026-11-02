import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { store } from '/admin/lib/catalog.js';
import { confirmDialog } from '/admin/lib/dialog.js';
import { notify } from '/admin/components/cms-toast.js';
import { addColor, updateColor, renameColor, removeColor, paletteUsage, colorNameError, hexError, normalizeHex, suggestBorder } from '/admin/lib/palette-ops.js';
import { deepEqual } from '/admin/lib/diff.js';

const L = LABELS.palette;

// Színpaletta: lista (kör, név, kód, „Használja: N termék”), új szín felvétele, szerkesztés, átnevezés, törlés.
// Minden művelet azonnal ment (egy commit), mint a terméklistán a törlés és a sorrendváltás.
class CmsColorPalette extends HTMLElement {
  connectedCallback() {
    this.editing = null; // a most szerkesztett szín neve
    this.editValues = null; // a szerkesztő űrlap félkész tartalma újrarajzoláskor
    this.open = new Set(); // azok a színek, amelyeknél látszik a használó termékek listája
    this.innerHTML = `
      <section class="cms-palette">
        <h1 class="cms-title">${escapeHtml(L.title)}</h1>
        <p class="cms-muted">${escapeHtml(L.intro)}</p>
        <form class="cms-card cms-color-form" id="cms-color-new" novalidate>
          <h2 class="cms-card-title">${escapeHtml(L.addTitle)}</h2>
          ${this.formFieldsHtml('new', { name: '', hex: '#808080', border: false })}
          <div class="cms-color-form-actions">
            <button class="menu-button cms-color-submit" type="submit">${escapeHtml(L.add)}</button>
          </div>
        </form>
        <ul class="cms-colors" aria-live="polite"></ul>
      </section>
    `;
    this.newForm = this.querySelector('#cms-color-new');
    this.bindForm(this.newForm, { auto: true });
    this.newForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onAdd();
    });
    this.addEventListener('click', (event) => this.onClick(event));
    this.unsubscribe = store.subscribe(() => this.renderRows());
    this.renderRows();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  // ---------- Megjelenítés ----------

  formFieldsHtml(key, { name, hex, border }) {
    return `
      <div class="cms-field">
        <label class="cms-label" for="cms-color-name-${key}">${escapeHtml(L.name)}</label>
        <input class="cms-input" id="cms-color-name-${key}" data-role="name" type="text" value="${escapeHtml(name)}" autocomplete="off" maxlength="60">
        ${key === 'new' ? `<p class="cms-hint">${escapeHtml(L.nameHint)}</p>` : ''}
        <p class="cms-field-error" data-error="name" hidden></p>
      </div>
      <div class="cms-field">
        <label class="cms-label" for="cms-color-hex-${key}">${escapeHtml(L.hex)}</label>
        <div class="cms-color-pick">
          <input class="cms-color-picker" type="color" data-role="picker" value="${escapeHtml(normalizeHex(hex) || '#808080')}" aria-label="${escapeHtml(L.pick)}">
          <input class="cms-input" id="cms-color-hex-${key}" data-role="hex" type="text" value="${escapeHtml(hex)}" autocomplete="off" spellcheck="false" maxlength="7">
          <span class="cms-swatch cms-swatch-large ${border ? 'cms-swatch-border' : ''}" data-role="swatch" style="background:${escapeHtml(normalizeHex(hex) || '#808080')}" aria-hidden="true"></span>
        </div>
        <p class="cms-hint">${escapeHtml(L.hexHint)}</p>
        <p class="cms-field-error" data-error="hex" hidden></p>
      </div>
      <label class="cms-check">
        <input type="checkbox" data-role="border" ${border ? 'checked' : ''}>
        <span>${escapeHtml(L.border)}</span>
      </label>
      <p class="cms-hint">${escapeHtml(L.borderHint)}</p>`;
  }

  // A színválasztó, a kódmező és az élő minta összekötése. `auto`: új szín esetén a keret a fényességből javasolt,
  // amíg a felhasználó kézzel át nem állítja.
  bindForm(form, { auto = false } = {}) {
    const get = (role) => form.querySelector(`[data-role="${role}"]`);
    const state = { manualBorder: !auto };
    const refresh = () => {
      const hex = normalizeHex(get('hex').value);
      get('swatch').style.background = hex || 'transparent';
      get('swatch').classList.toggle('cms-swatch-border', get('border').checked);
    };
    get('picker').addEventListener('input', () => {
      get('hex').value = get('picker').value;
      if (!state.manualBorder) get('border').checked = suggestBorder(get('picker').value);
      refresh();
    });
    get('hex').addEventListener('input', () => {
      const hex = normalizeHex(get('hex').value);
      if (hex) {
        get('picker').value = hex;
        if (!state.manualBorder) get('border').checked = suggestBorder(hex);
      }
      refresh();
    });
    get('border').addEventListener('change', () => {
      state.manualBorder = true;
      refresh();
    });
  }

  readForm(form) {
    const get = (role) => form.querySelector(`[data-role="${role}"]`);
    return { name: get('name').value.trim(), hex: get('hex').value, border: get('border').checked };
  }

  showFormErrors(form, errors) {
    for (const el of form.querySelectorAll('[data-error]')) {
      const message = errors[el.dataset.error] || '';
      el.textContent = message;
      el.hidden = !message;
    }
    const first = Object.keys(errors).find((key) => errors[key]);
    if (first) form.querySelector(`[data-role="${first}"]`)?.focus();
  }

  renderRows() {
    const state = store.get();
    const colors = state.draft.colors;
    const usage = paletteUsage(state.draft.products);
    const names = Object.keys(colors);
    const list = this.querySelector('.cms-colors');
    // újrarajzolásnál (pl. mentés közben) a szerkesztő űrlap tartalma ne vesszen el
    const open = list.querySelector('.cms-color-edit');
    if (open) this.editValues = this.readForm(open);
    if (this.editing && !colors[this.editing]) this.editing = null;
    if (!this.editing) this.editValues = null;
    if (names.length === 0) {
      list.innerHTML = `<li class="cms-empty">${escapeHtml(L.empty)}</li>`;
      return;
    }
    list.innerHTML = names.map((name) => this.rowHtml(name, colors[name], usage.get(name) || [], state.busy)).join('');
    const form = list.querySelector('.cms-color-edit');
    if (form) {
      this.bindForm(form);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.onSave(form.dataset.name);
      });
    }
  }

  rowHtml(name, def, users, busy) {
    const editing = this.editing === name;
    const opened = this.open.has(name);
    const used = users.length > 0;
    const hex = def.hex || '';
    return `
      <li class="cms-color-row" data-name="${escapeHtml(name)}">
        <div class="cms-color-main">
          <span class="cms-swatch cms-swatch-large ${def.border ? 'cms-swatch-border' : ''}" style="background:${escapeHtml(hex)}" aria-hidden="true"></span>
          <div class="cms-color-text">
            <strong class="cms-color-name">${escapeHtml(name)}</strong>
            <span class="cms-muted cms-color-hex">${escapeHtml(hex)}</span>
            ${used
              ? `<button type="button" class="cms-link-button cms-color-usage-toggle" data-action="usage" aria-expanded="${opened}">${escapeHtml(L.usedBy(users.length))}</button>`
              : `<span class="cms-muted">${escapeHtml(L.unused)}</span>`}
          </div>
          <div class="cms-color-actions">
            <button type="button" class="cms-btn" data-action="edit" ${busy ? 'disabled' : ''}>${escapeHtml(L.edit)}</button>
            <button type="button" class="cms-btn cms-btn-danger-outline" data-action="remove" ${busy || used ? 'disabled' : ''} ${used ? `title="${escapeHtml(L.removeBlocked)}"` : ''}>${escapeHtml(L.remove)}</button>
          </div>
        </div>
        ${used && opened ? `
          <div class="cms-color-usage">
            <p class="cms-hint">${escapeHtml(L.usersTitle)}</p>
            <ul>${users.map((u) => `<li><a href="#/termek/${encodeURIComponent(u.category)}/${encodeURIComponent(u.id)}">${escapeHtml(u.name)}</a> <span class="cms-muted">(${escapeHtml(LABELS.categories[u.category] ?? u.category)})</span></li>`).join('')}</ul>
          </div>` : ''}
        ${editing ? `
          <form class="cms-color-edit" data-name="${escapeHtml(name)}" novalidate>
            ${this.formFieldsHtml('edit', this.editValues ?? { name, hex, border: Boolean(def.border) })}
            <div class="cms-color-form-actions">
              <button class="menu-button cms-color-submit" type="submit" ${busy ? 'disabled' : ''}>${escapeHtml(L.save)}</button>
              <button class="cms-btn" type="button" data-action="cancel">${escapeHtml(L.cancel)}</button>
            </div>
          </form>` : ''}
      </li>`;
  }

  // ---------- Műveletek ----------

  fail(error) {
    if (error.status === 401) {
      this.dispatchEvent(new CustomEvent('cms-session-expired', { bubbles: true }));
      return;
    }
    notify(error.message, { type: 'error' });
  }

  async onAdd() {
    if (store.get().busy) return;
    const form = this.newForm;
    const { name, hex, border } = this.readForm(form);
    const errors = { name: colorNameError(store.get().draft.colors, name), hex: hexError(hex) };
    this.showFormErrors(form, errors);
    if (errors.name || errors.hex) return;
    const normalized = normalizeHex(hex);
    try {
      await store.saveCatalog({
        apply: (draft) => ({ products: draft.products, colors: addColor(draft.colors, name, { hex: normalized, border }) }),
        message: L.commit.added(name),
      });
      notify(`${L.added(name)}. ${L.previewRefresh}`);
      this.resetNewForm();
    } catch (error) {
      this.fail(error);
    }
  }

  resetNewForm() {
    const form = this.newForm;
    const get = (role) => form.querySelector(`[data-role="${role}"]`);
    get('name').value = '';
    get('hex').value = '#808080';
    get('picker').value = '#808080';
    get('border').checked = false;
    get('swatch').style.background = '#808080';
    get('swatch').classList.remove('cms-swatch-border');
    this.showFormErrors(form, {});
  }

  async onSave(name) {
    const state = store.get();
    if (state.busy) return;
    const form = this.querySelector('.cms-color-edit');
    const { name: newName, hex, border } = this.readForm(form);
    const errors = { name: colorNameError(state.draft.colors, newName, { except: name }), hex: hexError(hex) };
    this.showFormErrors(form, errors);
    if (errors.name || errors.hex) return;

    const normalized = normalizeHex(hex);
    const renamed = newName !== name;
    const users = paletteUsage(state.draft.products).get(name) || [];

    // változatlan adat: nincs mit menteni
    const old = state.draft.colors[name];
    const unchanged = !renamed && deepEqual(updateColor(state.draft.colors, name, { hex: normalized, border })[name], old);
    if (unchanged) {
      this.editing = null;
      notify(L.noChange);
      this.renderRows();
      return;
    }

    if (renamed && users.length) {
      const ok = await confirmDialog({
        title: L.renameTitle,
        messageHtml: L.renameText(escapeHtml(name), escapeHtml(newName), users.length),
        confirmLabel: L.renameConfirm,
      });
      if (!ok) return;
    }

    try {
      await store.saveCatalog({
        apply: (draft) => {
          let { colors, products } = draft;
          let key = name;
          if (renamed) {
            ({ colors, products } = renameColor(colors, products, name, newName));
            key = newName;
          }
          return { products, colors: updateColor(colors, key, { hex: normalized, border }) };
        },
        message: renamed ? L.commit.renamed(name, newName) : L.commit.changed(name),
      });
      this.editing = null;
      this.editValues = null;
      this.open.delete(name);
      notify(`${renamed ? L.renamed(name, newName) : L.changed(name)}. ${L.previewRefresh}`);
      this.renderRows();
    } catch (error) {
      this.fail(error);
    }
  }

  async onRemove(name) {
    if (store.get().busy) return;
    const ok = await confirmDialog({
      title: L.deleteTitle,
      messageHtml: L.deleteText(escapeHtml(name)),
      confirmLabel: L.deleteConfirm,
      danger: true,
    });
    if (!ok) return;
    try {
      await store.saveCatalog({
        apply: (draft) => ({ products: draft.products, colors: removeColor(draft.colors, draft.products, name) }),
        message: L.commit.removed(name),
      });
      notify(L.deleted(name));
    } catch (error) {
      this.fail(error);
    }
  }

  onClick(event) {
    const button = event.target.closest('button[data-action]');
    const row = button?.closest('.cms-color-row');
    if (!button || !row || button.disabled) return;
    const name = row.dataset.name;
    switch (button.dataset.action) {
      case 'edit':
        this.editing = name;
        this.editValues = null;
        this.renderRows();
        this.querySelector('.cms-color-edit [data-role="name"]')?.focus();
        break;
      case 'cancel':
        this.editing = null;
        this.editValues = null;
        this.renderRows();
        break;
      case 'usage':
        if (this.open.has(name)) this.open.delete(name);
        else this.open.add(name);
        this.renderRows();
        break;
      case 'remove':
        this.onRemove(name);
        break;
      default:
    }
  }
}

customElements.define('cms-color-palette', CmsColorPalette);

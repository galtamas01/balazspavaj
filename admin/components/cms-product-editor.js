import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { store } from '/admin/lib/catalog.js';
import { emptyForm, toForm, fromForm, applyForm, newRow } from '/admin/lib/product-form.js';
import { duplicateOf, findProduct, ChangeError } from '/admin/lib/catalog-ops.js';
import { slugify } from '/admin/lib/slug.js';
import { confirmDialog } from '/admin/lib/dialog.js';
import { notify } from '/admin/components/cms-toast.js';
import '/admin/components/cms-repeater.js';

const T = LABELS.editor;
const dotted = (path) => path.replace(/\[(\d+)\]/g, '.$1');

// Az útvonal alapján értéket ír az űrlapmodellbe: setPath(form, 'colors.2.price', '55').
function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key];
  node[keys.at(-1)] = value;
}

// Termék szerkesztő és létrehozó űrlap (képek nélkül; a képfeltöltés a következő fázisban jön).
class CmsProductEditor extends HTMLElement {
  connectedCallback() {
    const category = this.getAttribute('category');
    const id = this.getAttribute('product-id');
    const from = this.getAttribute('from');
    const { draft } = store.get();

    if (id) {
      const product = draft.products[category]?.[id];
      if (!product) return this.renderNotFound(category);
      this.form = toForm(category, id, product);
    } else if (from) {
      const source = findProduct(draft.products, from);
      if (!source) return this.renderNotFound(category);
      this.form = toForm(category, '', duplicateOf(source.product), { isNew: true });
      this.form.id = slugify(this.form.name);
      store.setDirty(true);
    } else {
      this.form = emptyForm(category);
    }
    this.render();
    this.refreshPreview();
  }

  renderNotFound(category) {
    this.innerHTML = `
      <div class="cms-editor">
        <p class="cms-error" role="alert">${escapeHtml(T.notFound)}</p>
        <a class="cms-back" href="#/termekek/${escapeHtml(category || '')}">${escapeHtml(T.back)}</a>
      </div>`;
  }

  // ---------- Megjelenítés ----------

  field({ id, label, hint = '', control, errorKey, extraClass = '' }) {
    return `
      <div class="cms-field ${extraClass}">
        <label class="cms-label" for="${id}">${escapeHtml(label)}</label>
        ${control}
        ${hint ? `<p class="cms-hint">${escapeHtml(hint)}</p>` : ''}
        <p class="cms-field-error" data-error-for="${errorKey}" hidden></p>
      </div>`;
  }

  textInput({ id, bind, value, placeholder = '', inputmode = '' }) {
    return `<input class="cms-input" id="${id}" type="text" data-bind="${bind}" value="${escapeHtml(value)}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} autocomplete="off">`;
  }

  render() {
    const f = this.form;
    const unitSuffix = LABELS.unitShort[f.unit] ?? f.unit;
    this.innerHTML = `
      <div class="cms-editor">
        <a class="cms-back" href="#/termekek/${escapeHtml(f.category)}">${escapeHtml(T.back)}</a>
        <h1 class="cms-title">${escapeHtml(f.isNew ? T.newTitle : T.editTitle)}</h1>
        <div class="cms-error cms-form-errors" id="cms-form-errors" role="alert" tabindex="-1" hidden></div>
        <div class="cms-editor-grid">
          <form class="cms-editor-form" novalidate>
            <section class="cms-section">
              <h2 class="cms-section-title">${escapeHtml(T.sections.basics)}</h2>
              <p class="cms-muted">${escapeHtml(T.category)}: <strong>${escapeHtml(LABELS.categories[f.category])}</strong></p>
              ${this.field({
                id: 'cms-name',
                label: T.name,
                hint: T.nameHint,
                errorKey: 'name',
                control: this.textInput({ id: 'cms-name', bind: 'name', value: f.name }),
              })}
              <div class="cms-field">
                <span class="cms-label">${escapeHtml(T.id)}</span>
                <code class="cms-id-display" id="cms-id-display">${escapeHtml(f.id || T.idPending)}</code>
                <input class="cms-input" id="cms-id" type="text" data-bind="id" value="${escapeHtml(f.id)}" aria-label="${escapeHtml(T.id)}" autocomplete="off" hidden>
                <label class="cms-check"><input type="checkbox" id="cms-id-advanced"> <span>${escapeHtml(T.idAdvanced)}</span></label>
                <p class="cms-hint cms-hint-warn" id="cms-id-warning" hidden>${escapeHtml(T.idWarning)}</p>
                <p class="cms-field-error" data-error-for="id" hidden></p>
              </div>
              ${this.field({
                id: 'cms-unit',
                label: T.unit,
                errorKey: 'unit',
                control: `<select class="cms-input" id="cms-unit" data-bind="unit">
                  ${Object.entries(LABELS.units).map(([value, text]) => `<option value="${value}" ${f.unit === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}
                </select>`,
              })}
            </section>

            <section class="cms-section">
              <h2 class="cms-section-title">${escapeHtml(T.sections.price)}</h2>
              <div class="cms-field" data-field="price">
                <div class="cms-radios" role="radiogroup" aria-label="${escapeHtml(T.sections.price)}">
                  <label class="cms-radio"><input type="radio" name="priceMode" value="single" ${f.priceMode === 'single' ? 'checked' : ''}> <span>${escapeHtml(T.priceSingle)}</span></label>
                  <label class="cms-radio"><input type="radio" name="priceMode" value="range" ${f.priceMode === 'range' ? 'checked' : ''}> <span>${escapeHtml(T.priceRange)}</span></label>
                </div>
                <div class="cms-price-row">
                  <div class="cms-price-part">
                    <label class="cms-label" for="cms-price-from" id="cms-price-from-label">${escapeHtml(f.priceMode === 'range' ? T.priceFromRange : T.priceFrom)}</label>
                    ${this.textInput({ id: 'cms-price-from', bind: 'priceFrom', value: f.priceFrom, inputmode: 'decimal' })}
                  </div>
                  <div class="cms-price-part" id="cms-price-to-part" ${f.priceMode === 'range' ? '' : 'hidden'}>
                    <label class="cms-label" for="cms-price-to">${escapeHtml(T.priceTo)}</label>
                    ${this.textInput({ id: 'cms-price-to', bind: 'priceTo', value: f.priceTo, inputmode: 'decimal' })}
                  </div>
                  <span class="cms-price-suffix" id="cms-price-suffix">RON / ${escapeHtml(unitSuffix)}</span>
                </div>
                <p class="cms-hint">${escapeHtml(T.priceHint)}</p>
                <p class="cms-field-error" data-error-for="price" hidden></p>
              </div>
            </section>

            <section class="cms-section">
              <h2 class="cms-section-title">${escapeHtml(T.sections.image)}</h2>
              ${this.imageHtml()}
            </section>

            <section class="cms-section">
              <h2 class="cms-section-title">${escapeHtml(T.sections.size)}</h2>
              <div class="cms-radios" role="radiogroup" aria-label="${escapeHtml(T.sections.size)}">
                <label class="cms-radio"><input type="radio" name="sizeMode" value="single" ${f.sizeMode === 'single' ? 'checked' : ''}> <span>${escapeHtml(T.sizeSingle)}</span></label>
                <label class="cms-radio"><input type="radio" name="sizeMode" value="multi" ${f.sizeMode === 'multi' ? 'checked' : ''}> <span>${escapeHtml(T.sizeMulti)}</span></label>
              </div>
              <div id="cms-size-single" ${f.sizeMode === 'single' ? '' : 'hidden'}>
                ${this.field({
                  id: 'cms-dimensions',
                  label: T.dimensions,
                  hint: T.dimensionsHint,
                  errorKey: 'dimensions',
                  control: this.textInput({ id: 'cms-dimensions', bind: 'dimensions', value: f.dimensions }),
                })}
              </div>
              <div id="cms-size-multi" ${f.sizeMode === 'multi' ? '' : 'hidden'}>
                <cms-repeater id="cms-sizes"></cms-repeater>
                <p class="cms-field-error" data-error-for="sizes" hidden></p>
              </div>
            </section>

            <section class="cms-section">
              <h2 class="cms-section-title">${escapeHtml(T.sections.colors)}</h2>
              <p class="cms-muted">${escapeHtml(T.colorsIntro)}</p>
              <cms-repeater id="cms-colors"></cms-repeater>
              <button type="button" class="cms-link-button" id="cms-clear-color-prices" hidden>${escapeHtml(T.colorsClearPrices)}</button>
              <p class="cms-field-error" data-error-for="colors" hidden></p>
            </section>

            <details class="cms-section cms-advanced" ${f.types.length ? 'open' : ''}>
              <summary class="cms-section-title">${escapeHtml(T.sections.types)}</summary>
              <p class="cms-muted">${escapeHtml(T.typesIntro)}</p>
              <cms-repeater id="cms-types"></cms-repeater>
              <p class="cms-field-error" data-error-for="type" hidden></p>
            </details>

            <div class="cms-actions">
              <button type="submit" class="menu-button cms-save" id="cms-save">${escapeHtml(T.save)}</button>
              <a class="cms-btn" href="#/termekek/${escapeHtml(f.category)}">${escapeHtml(T.cancel)}</a>
            </div>
          </form>

          <aside class="cms-editor-aside" aria-label="${escapeHtml(T.sections.preview)}">
            <h2 class="cms-section-title">${escapeHtml(T.sections.preview)}</h2>
            <div class="cms-preview" id="cms-preview"></div>
          </aside>
        </div>
      </div>`;

    this.sizesRepeater = this.querySelector('#cms-sizes').configure({
      items: f.sizes,
      newItem: () => newRow.size(),
      addLabel: T.sizeAdd,
      renderRow: (row, i) => this.sizeRowHtml(row, i),
    });
    this.colorsRepeater = this.querySelector('#cms-colors').configure({
      items: f.colors,
      newItem: () => this.nextColorRow(),
      addLabel: T.colorAdd,
      emptyText: T.colorsNone,
      renderRow: (row, i) => this.colorRowHtml(row, i),
    });
    this.typesRepeater = this.querySelector('#cms-types').configure({
      items: f.types,
      newItem: () => newRow.type(),
      addLabel: T.typeAdd,
      renderRow: (row, i) => this.typeRowHtml(row, i),
    });
    this.updateColorTools();

    const form = this.querySelector('form');
    form.addEventListener('input', (event) => this.onBoundChange(event));
    form.addEventListener('change', (event) => this.onChange(event));
    form.addEventListener('submit', (event) => this.onSubmit(event));
    this.addEventListener('cms-repeater-change', () => this.onStructureChange());
    this.querySelector('#cms-clear-color-prices').addEventListener('click', () => {
      for (const row of this.form.colors) row.price = '';
      this.colorsRepeater.render();
      this.onStructureChange();
    });
  }

  imageHtml() {
    const image = this.form.base?.image;
    return `
      <div class="cms-image-note">
        ${image ? `<img class="cms-thumb cms-thumb-large" src="${escapeHtml(image)}" alt="" width="96" height="96">` : `<p class="cms-muted">${escapeHtml(T.imageNone)}</p>`}
        <p class="cms-hint">${escapeHtml(T.imageNote)}</p>
      </div>`;
  }

  sizeRowHtml(row, i) {
    return `
      ${this.field({ id: `cms-size-name-${i}`, label: T.sizeName, errorKey: `sizes.${i}.name`, extraClass: 'cms-field-grow',
        control: this.textInput({ id: `cms-size-name-${i}`, bind: `sizes.${i}.name`, value: row.name }) })}
      ${this.field({ id: `cms-size-dim-${i}`, label: T.sizeDimensions, errorKey: `sizes.${i}.dimensions`, extraClass: 'cms-field-grow',
        control: this.textInput({ id: `cms-size-dim-${i}`, bind: `sizes.${i}.dimensions`, value: row.dimensions }) })}`;
  }

  paletteOptions(selected) {
    const palette = store.get().draft.colors;
    const names = Object.keys(palette);
    const options = names.map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`);
    if (selected && !palette[selected]) {
      options.unshift(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(T.colorUnknown(selected))}</option>`);
    }
    return options.join('');
  }

  swatchHtml(name) {
    const def = store.get().draft.colors[name];
    const style = def?.hex ? `background:${escapeHtml(def.hex)}` : '';
    return `<span class="cms-swatch ${def?.border ? 'cms-swatch-border' : ''}" style="${style}" aria-hidden="true"></span>`;
  }

  colorRowHtml(row, i) {
    return `
      <div class="cms-field cms-field-grow">
        <label class="cms-label" for="cms-color-name-${i}">${escapeHtml(T.colorName)}</label>
        <div class="cms-color-select">
          ${this.swatchHtml(row.name)}
          <select class="cms-input" id="cms-color-name-${i}" data-bind="colors.${i}.name">${this.paletteOptions(row.name)}</select>
        </div>
        <p class="cms-field-error" data-error-for="colors.${i}.name" hidden></p>
      </div>
      ${this.field({ id: `cms-color-price-${i}`, label: T.colorPrice, hint: T.colorPriceHint, errorKey: `colors.${i}.price`, extraClass: 'cms-field-grow',
        control: this.textInput({ id: `cms-color-price-${i}`, bind: `colors.${i}.price`, value: row.price, inputmode: 'decimal' }) })}`;
  }

  typeRowHtml(row, i) {
    return `
      ${this.field({ id: `cms-type-name-${i}`, label: T.typeName, errorKey: `type.${i}.name`, extraClass: 'cms-field-grow',
        control: this.textInput({ id: `cms-type-name-${i}`, bind: `types.${i}.name`, value: row.name }) })}
      ${this.field({ id: `cms-type-price-${i}`, label: T.typePrice, errorKey: `type.${i}.price`, extraClass: 'cms-field-grow',
        control: this.textInput({ id: `cms-type-price-${i}`, bind: `types.${i}.price`, value: row.price, inputmode: 'decimal' }) })}`;
  }

  nextColorRow() {
    const names = Object.keys(store.get().draft.colors);
    if (names.length === 0) {
      notify(T.colorsNoPalette, { type: 'warn' });
      return null;
    }
    const used = new Set(this.form.colors.map((row) => row.name));
    return newRow.color(names.find((name) => !used.has(name)) ?? names[0]);
  }

  updateColorTools() {
    this.querySelector('#cms-clear-color-prices').hidden = !this.form.colors.some((row) => row.price.trim() !== '');
  }

  // ---------- Események ----------

  markDirty() {
    store.setDirty(true);
    this.refreshPreview();
  }

  onBoundChange(event) {
    const target = event.target;
    const bind = target.dataset?.bind;
    if (!bind) return;
    setPath(this.form, bind, target.value);

    if (bind === 'name' && this.form.isNew && !this.form.idManual) {
      this.form.id = slugify(this.form.name);
      this.updateIdDisplay();
    }
    if (bind === 'unit') {
      this.querySelector('#cms-price-suffix').textContent = `RON / ${LABELS.unitShort[this.form.unit] ?? this.form.unit}`;
    }
    if (/^colors\.\d+\.name$/.test(bind)) {
      const wrapper = target.closest('.cms-color-select');
      wrapper.querySelector('.cms-swatch').outerHTML = this.swatchHtml(target.value);
    }
    if (/^colors\.\d+\.price$/.test(bind)) this.updateColorTools();
    this.markDirty();
  }

  async onChange(event) {
    const target = event.target;
    if (target.matches('select[data-bind]')) return this.onBoundChange(event);

    if (target.name === 'priceMode') {
      this.form.priceMode = target.value;
      this.querySelector('#cms-price-to-part').hidden = target.value !== 'range';
      this.querySelector('#cms-price-from-label').textContent = target.value === 'range' ? T.priceFromRange : T.priceFrom;
      this.markDirty();
    } else if (target.name === 'sizeMode') {
      await this.switchSizeMode(target);
    } else if (target.id === 'cms-id-advanced') {
      this.form.idManual = target.checked;
      const input = this.querySelector('#cms-id');
      input.hidden = !target.checked;
      this.querySelector('#cms-id-display').hidden = target.checked;
      this.querySelector('#cms-id-warning').hidden = !(target.checked && !this.form.isNew);
      if (!target.checked && this.form.isNew) this.form.id = slugify(this.form.name);
      if (!target.checked && !this.form.isNew) this.form.id = this.form.originalId;
      input.value = this.form.id;
      this.updateIdDisplay();
      if (target.checked) input.focus();
      this.markDirty();
    }
  }

  async switchSizeMode(radio) {
    const f = this.form;
    const next = radio.value;
    if (next === f.sizeMode) return;
    if (next === 'single' && f.sizes.some((row) => row.orig?.image)) {
      const ok = await confirmDialog({
        title: T.sizesDropTitle,
        messageHtml: escapeHtml(T.sizesDropImages),
        confirmLabel: LABELS.dialog.ok,
        danger: true,
      });
      if (!ok) {
        this.querySelector('input[name="sizeMode"][value="multi"]').checked = true;
        return;
      }
    }
    f.sizeMode = next;
    if (next === 'multi' && f.sizes.length === 0) {
      f.sizes.push(newRow.size());
      this.sizesRepeater.render();
    }
    this.querySelector('#cms-size-single').hidden = next !== 'single';
    this.querySelector('#cms-size-multi').hidden = next !== 'multi';
    this.markDirty();
  }

  onStructureChange() {
    this.updateColorTools();
    this.markDirty();
  }

  updateIdDisplay() {
    const f = this.form;
    this.querySelector('#cms-id-display').textContent = f.id || T.idPending;
    const input = this.querySelector('#cms-id');
    if (input && document.activeElement !== input) input.value = f.id;
  }

  // ---------- Előnézet (a weboldal termékkártyájának egyszerű másolata) ----------

  refreshPreview() {
    const box = this.querySelector('#cms-preview');
    if (!box) return;
    const f = this.form;
    const { product } = fromForm(f);
    const palette = store.get().draft.colors;
    const unit = LABELS.unitShort[product.unit] ?? product.unit;
    const image = product.image || product.colors?.find((c) => c.image)?.image || '';
    const price = product.price ?? (f.priceMode === 'range' ? `${f.priceFrom} - ${f.priceTo}` : f.priceFrom);
    const swatches = (product.colors || [])
      .map((c) => {
        const def = palette[c.name];
        return `<span class="cms-swatch cms-swatch-large ${def?.border ? 'cms-swatch-border' : ''}" style="${def?.hex ? `background:${escapeHtml(def.hex)}` : ''}" title="${escapeHtml(c.name)}"></span>`;
      })
      .join('');
    const sizes = (product.sizes || []).map((s) => `<li>${escapeHtml(s.name)}: ${escapeHtml(s.dimensions)}</li>`).join('');
    const types = (product.type || []).map((t) => `<li>${escapeHtml(t.name)}: ${escapeHtml(t.price)} RON</li>`).join('');
    box.innerHTML = `
      ${image ? `<img class="cms-preview-image" src="${escapeHtml(image)}" alt="" loading="lazy">` : `<div class="cms-preview-image cms-preview-empty">${escapeHtml(T.previewCard.noImage)}</div>`}
      <h3 class="cms-preview-name">${escapeHtml(product.name || '—')}</h3>
      <p class="cms-preview-price">${escapeHtml(price)} RON / ${escapeHtml(unit)}</p>
      ${product.dimensions ? `<p class="cms-muted">${escapeHtml(product.dimensions)}</p>` : ''}
      ${swatches ? `<div class="cms-preview-swatches">${swatches}</div>` : ''}
      ${sizes ? `<p class="cms-label">${escapeHtml(T.previewCard.sizes)}</p><ul class="cms-preview-list">${sizes}</ul>` : ''}
      ${types ? `<p class="cms-label">${escapeHtml(T.previewCard.types)}</p><ul class="cms-preview-list">${types}</ul>` : ''}`;
  }

  // ---------- Hibák ----------

  clearErrors() {
    for (const el of this.querySelectorAll('[data-error-for]')) {
      el.hidden = true;
      el.textContent = '';
    }
    for (const el of this.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const summary = this.querySelector('#cms-form-errors');
    summary.hidden = true;
    summary.innerHTML = '';
  }

  showErrors(errors, { title = T.errorsTitle } = {}) {
    let firstField = null;
    for (const error of errors) {
      const slot = this.querySelector(`[data-error-for="${dotted(error.path)}"]`);
      if (!slot) continue;
      slot.textContent = error.message;
      slot.hidden = false;
      const field = slot.closest('.cms-field');
      if (!field) continue;
      for (const input of field.querySelectorAll('.cms-input')) input.setAttribute('aria-invalid', 'true');
      firstField ??= field.querySelector('.cms-input[aria-invalid]');
    }
    const summary = this.querySelector('#cms-form-errors');
    summary.innerHTML = `<p><strong>${escapeHtml(title)}</strong></p><ul>${errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul>`;
    summary.hidden = false;
    summary.scrollIntoView({ block: 'nearest' });
    (firstField && firstField.offsetParent !== null ? firstField : summary).focus();
  }

  setSaving(saving) {
    const button = this.querySelector('#cms-save');
    button.disabled = saving;
    button.textContent = saving ? T.saving : T.save;
  }

  // ---------- Mentés ----------

  async onSubmit(event) {
    event.preventDefault();
    if (store.get().busy) return;
    this.clearErrors();

    const f = this.form;
    const state = store.get();
    const check = applyForm(state.draft.products, state.draft.colors, f);
    if (!check.products) {
      this.showErrors(check.errors);
      return;
    }

    const name = f.name.trim();
    this.setSaving(true);
    try {
      await store.save({
        apply: (products) => {
          const result = applyForm(products, store.get().draft.colors, f);
          if (!result.products) throw new ChangeError(result.errors[0]?.message ?? T.errorsTitle);
          return result.products;
        },
        message: f.isNew ? T.commit.added(name) : T.commit.changed(name),
      });
      store.setDirty(false);
      notify(`${T.saved(name)} ${T.previewRefresh}`);
      if (check.warnings.length) {
        notify(`${T.warningsTitle} ${[...new Set(check.warnings.map((w) => w.message))].join(' ')}`, { type: 'warn' });
      }
      location.hash = `#/termekek/${f.category}`;
    } catch (error) {
      this.onSaveError(error);
    } finally {
      if (this.isConnected) this.setSaving(false);
    }
  }

  onSaveError(error) {
    if (error.status === 401) {
      this.dispatchEvent(new CustomEvent('cms-session-expired', { bubbles: true }));
      return;
    }
    const serverErrors = error.details?.errors;
    if (error.code === 'VALIDATION' && Array.isArray(serverErrors)) {
      const prefix = `${this.form.category}.${this.form.id}`;
      const mapped = serverErrors.map((e) => {
        const path = e.path === prefix ? 'id' : e.path.startsWith(`${prefix}.`) ? e.path.slice(prefix.length + 1) : e.path;
        return { path, message: e.message };
      });
      this.showErrors(mapped);
      return;
    }
    this.showErrors([{ path: '', message: error.message }], { title: T.saveFailed });
  }
}

customElements.define('cms-product-editor', CmsProductEditor);

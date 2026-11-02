import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { store } from '/admin/lib/catalog.js';
import { diffCatalog } from '/admin/lib/diff.js';
import { confirmDialog } from '/admin/lib/dialog.js';
import { notify } from '/admin/components/cms-toast.js';

const S = LABELS.statusBar;
const P = LABELS.publish;
const MAX_NAMES = 6;

const nameOf = (products, entry) => String(products?.[entry.category]?.[entry.id]?.name ?? entry.id).trim();

function namesHtml(entries, products) {
  const names = entries.map((e) => nameOf(products, e));
  const shown = names.slice(0, MAX_NAMES).map((n) => `<em>${escapeHtml(n)}</em>`).join(', ');
  return names.length > MAX_NAMES ? `${shown} ${escapeHtml(P.more(names.length - MAX_NAMES))}` : shown;
}

// Állapotsor a fejléc alatt: a nem publikált módosítások összegzése, Előnézet, Elvetés, Publikálás és a havi számláló.
class CmsPublishBar extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (event) => this.onClick(event));
    this.unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const state = store.get();
    if (state.status !== 'ready') {
      this.className = 'cms-status';
      this.innerHTML = '';
      return;
    }
    if (state.busy && state.busyKind !== 'save') {
      this.className = 'cms-status cms-status-busy';
      this.textContent = state.busyKind === 'discard' ? S.discarding : S.publishing;
      return;
    }
    if (state.busy) {
      this.className = 'cms-status cms-status-busy';
      this.textContent = S.saving;
      return;
    }

    const diff = diffCatalog(state.main, state.draft);
    const credits = this.creditsHtml(state.stats);
    if (state.syncConflict) {
      this.className = 'cms-status cms-status-conflict';
      this.innerHTML = `
        <div class="cms-status-row">
          <div class="cms-status-text"><strong>${escapeHtml(S.conflict)}</strong></div>
          <div class="cms-status-actions">
            <button type="button" class="cms-btn cms-btn-danger-outline" data-action="discard" ${state.dirty ? 'disabled' : ''}>${escapeHtml(S.discard)}</button>
          </div>
        </div>${credits}`;
      return;
    }
    if (diff.count === 0) {
      this.className = 'cms-status';
      this.innerHTML = `${escapeHtml(S.clean)}${credits}`;
      return;
    }

    const parts = [];
    if (diff.added.length) parts.push(S.parts.added(diff.added.length));
    if (diff.changed.length) parts.push(S.parts.changed(diff.changed.length));
    if (diff.removed.length) parts.push(S.parts.removed(diff.removed.length));
    if (diff.reordered.length) parts.push(S.parts.order);
    if (diff.colorsChanged) parts.push(S.parts.colors);
    const blocked = state.dirty;
    this.className = 'cms-status cms-status-pending';
    this.innerHTML = `
      <div class="cms-status-row">
        <div class="cms-status-text">
          <strong>${escapeHtml(S.pending(diff.count))}</strong> (${escapeHtml(parts.join(', '))})
          ${state.previewUrl ? `· <a href="${escapeHtml(state.previewUrl)}/" target="_blank" rel="noopener">${escapeHtml(S.preview)}</a>` : ''}
          <span class="cms-status-note">${escapeHtml(blocked ? S.needSave : S.delay)}</span>
        </div>
        <div class="cms-status-actions">
          <button type="button" class="cms-btn cms-btn-danger-outline" data-action="discard" ${blocked ? 'disabled' : ''}>${escapeHtml(S.discard)}</button>
          <button type="button" class="cms-btn cms-btn-primary" data-action="publish" ${blocked ? 'disabled' : ''}>${escapeHtml(S.publish)}</button>
        </div>
      </div>${credits}`;
  }

  creditsHtml(stats) {
    if (!stats) return '';
    const warn = stats.publishesThisMonth > stats.warnAfter;
    return `<span class="cms-status-note ${warn ? 'cms-status-warn' : ''}">${escapeHtml(S.credits(stats.publishesThisMonth, stats.estimatedCredits, stats.monthlyCredits))}${warn ? ` ${escapeHtml(S.creditsWarn)}` : ''}</span>`;
  }

  fail(error) {
    if (error.status === 401) {
      this.dispatchEvent(new CustomEvent('cms-session-expired', { bubbles: true }));
      return;
    }
    // RELOAD: az állapot közben újratöltődött, a szerver üzenete elmondja, mit tegyen
    notify(error.message, { type: error.code === 'RELOAD' || error.code === 'STALE' ? 'warn' : 'error' });
  }

  async onClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || store.get().busy) return;
    if (button.dataset.action === 'publish') await this.publish();
    else if (button.dataset.action === 'discard') await this.discard();
  }

  summaryText(diff) {
    const s = P.summary;
    const parts = [];
    if (diff.added.length) parts.push(s.added(diff.added.length));
    if (diff.changed.length) parts.push(s.changed(diff.changed.length));
    if (diff.removed.length) parts.push(s.removed(diff.removed.length));
    if (diff.reordered.length) parts.push(s.order);
    if (diff.colorsChanged) parts.push(s.colors);
    return parts.join(', ');
  }

  changesHtml(diff, state) {
    const items = [];
    if (diff.added.length) items.push(`${escapeHtml(P.added(diff.added.length))}: ${namesHtml(diff.added, state.draft.products)}`);
    if (diff.changed.length) items.push(`${escapeHtml(P.changed(diff.changed.length))}: ${namesHtml(diff.changed, state.draft.products)}`);
    if (diff.removed.length) items.push(`${escapeHtml(P.removed(diff.removed.length))}: ${namesHtml(diff.removed, state.main.products)}`);
    if (diff.reordered.length) items.push(escapeHtml(P.reordered(diff.reordered.map((c) => LABELS.categories[c] ?? c).join(', '))));
    if (diff.colorsChanged) items.push(escapeHtml(P.colors));
    return `<p>${escapeHtml(P.intro)}</p><ul class="cms-dialog-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul><p class="cms-hint">${escapeHtml(P.note)}</p>`;
  }

  async publish() {
    const state = store.get();
    const diff = diffCatalog(state.main, state.draft);
    const ok = await confirmDialog({
      title: P.title,
      messageHtml: this.changesHtml(diff, state),
      confirmLabel: P.confirm,
    });
    if (!ok) return;
    try {
      await store.publish({ summary: this.summaryText(diff) });
      notify(P.done);
    } catch (error) {
      if (error.code === 'RELOAD' || error.code === 'STALE') notify(P.reloaded, { type: 'warn' });
      else this.fail(error);
    }
  }

  async discard() {
    const state = store.get();
    const diff = diffCatalog(state.main, state.draft);
    const ok = await confirmDialog({
      title: LABELS.discard.title,
      messageHtml: escapeHtml(state.syncConflict || diff.count === 0 ? LABELS.discard.textConflict : LABELS.discard.text(this.summaryText(diff))),
      confirmLabel: LABELS.discard.confirm,
      danger: true,
    });
    if (!ok) return;
    try {
      await store.discard();
      notify(LABELS.discard.done);
      if (location.hash.startsWith('#/termek/') || location.hash.startsWith('#/uj/')) location.hash = '#/termekek';
    } catch (error) {
      this.fail(error);
    }
  }
}

customElements.define('cms-publish-bar', CmsPublishBar);

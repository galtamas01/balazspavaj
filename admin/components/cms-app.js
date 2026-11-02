import { api } from '/admin/lib/api.js';
import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { store } from '/admin/lib/catalog.js';
import { confirmDialog } from '/admin/lib/dialog.js';
import { parseRoute, DEFAULT_HASH } from '/admin/lib/router.js';
import '/admin/components/cms-toast.js';
import '/admin/components/cms-product-list.js';
import '/admin/components/cms-product-editor.js';
import '/admin/components/cms-color-palette.js';
import '/admin/components/cms-password-form.js';
import '/admin/components/cms-publish-bar.js';

// Az admin felület kerete: munkamenet, belépő képernyő, fejléc, állapotsor és az útvonalak.
class CmsApp extends HTMLElement {
  connectedCallback() {
    this.onHashChange = () => this.handleHashChange();
    this.onBeforeUnload = (event) => {
      if (store.get().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    this.addEventListener('cms-login-success', () => this.renderShell());
    this.addEventListener('cms-session-expired', () => this.renderLogin());
    window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.renderLoading();
    this.checkSession();
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.unsubscribe?.();
  }

  renderLoading() {
    this.innerHTML = `<p class="cms-center cms-muted">${escapeHtml(LABELS.loading)}</p>`;
  }

  async checkSession() {
    try {
      const { authenticated } = await api('session');
      if (authenticated) this.renderShell();
      else this.renderLogin();
    } catch (error) {
      this.renderError(error, () => this.checkSession());
    }
  }

  renderLogin() {
    this.unsubscribe?.();
    store.setDirty(false);
    this.innerHTML = '<cms-login></cms-login>';
  }

  renderError(error, retry) {
    this.innerHTML = `
      <div class="cms-center">
        <p class="cms-error" role="alert">${escapeHtml(error.message)}</p>
        <button class="menu-button" type="button" id="cms-retry">${escapeHtml(LABELS.retry)}</button>
      </div>
    `;
    this.querySelector('#cms-retry').addEventListener('click', () => {
      this.renderLoading();
      retry();
    });
  }

  renderShell() {
    const t = LABELS.shell;
    this.innerHTML = `
      <div class="cms-shell">
        <header class="cms-header">
          <div class="cms-brand">
            <img src="/assets/balazspavaj_logo.png" alt="" width="40" height="37">
            <span>${escapeHtml(LABELS.appTitle)}</span>
          </div>
          <div class="cms-menu">
            <a class="cms-menu-link" id="cms-nav-products" href="#/termekek">${escapeHtml(t.nav.products)}</a>
            <a class="cms-menu-link" id="cms-nav-colors" href="#/szinek">${escapeHtml(t.nav.colors)}</a>
            <a class="cms-menu-link" id="cms-nav-password" href="#/jelszo">${escapeHtml(t.nav.password)}</a>
            <button class="cms-link-button" type="button" id="cms-logout">${escapeHtml(t.logout)}</button>
          </div>
        </header>
        <cms-publish-bar class="cms-status" id="cms-status" role="status" aria-live="polite"></cms-publish-bar>
        <main class="cms-main" id="cms-view"></main>
      </div>
    `;
    this.view = this.querySelector('#cms-view');
    this.querySelector('#cms-logout').addEventListener('click', () => this.logout());
    this.loadCatalog();
  }

  async loadCatalog() {
    this.view.innerHTML = `<p class="cms-center cms-muted">${escapeHtml(LABELS.loading)}</p>`;
    try {
      await store.load();
    } catch (error) {
      if (error.status === 401) {
        this.renderLogin();
        return;
      }
      this.view.innerHTML = `
        <div class="cms-center">
          <p class="cms-error" role="alert"><strong>${escapeHtml(LABELS.shell.loadErrorTitle)}.</strong> ${escapeHtml(error.message)}</p>
          <button class="menu-button" type="button" id="cms-retry">${escapeHtml(LABELS.retry)}</button>
        </div>`;
      this.querySelector('#cms-retry').addEventListener('click', () => this.loadCatalog());
      return;
    }
    this.currentHash = '';
    this.route();
    store.loadStats(); // a havi publikálások száma (nem kritikus, a háttérben)
  }

  // ---------- Útvonalak ----------

  route() {
    let route = parseRoute(location.hash);
    if (!route) {
      history.replaceState(null, '', DEFAULT_HASH);
      route = parseRoute(DEFAULT_HASH);
    }
    this.currentHash = location.hash;
    this.view.innerHTML = '';
    let element;
    if (route.name === 'palette') {
      element = document.createElement('cms-color-palette');
    } else if (route.name === 'password') {
      element = document.createElement('cms-password-form');
    } else if (route.name === 'list') {
      element = document.createElement('cms-product-list');
      element.setAttribute('category', route.category);
    } else {
      element = document.createElement('cms-product-editor');
      element.setAttribute('category', route.category);
      if (route.name === 'edit') element.setAttribute('product-id', route.id);
      if (route.name === 'new' && route.from) element.setAttribute('from', route.from);
    }
    this.view.append(element);
    this.markNav(route);
    window.scrollTo(0, 0);
  }

  // A fejléc menüjében az aktuális rész jelölése.
  markNav(route) {
    const onColors = route.name === 'palette';
    const onPassword = route.name === 'password';
    for (const [id, current] of [
      ['cms-nav-products', !onColors && !onPassword],
      ['cms-nav-colors', onColors],
      ['cms-nav-password', onPassword],
    ]) {
      const link = this.querySelector(`#${id}`);
      if (!link) continue;
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  async handleHashChange() {
    if (!this.view?.isConnected || store.get().status !== 'ready') return;
    const target = location.hash;
    if (target === this.currentHash) return;
    if (store.get().dirty) {
      history.replaceState(null, '', this.currentHash || DEFAULT_HASH); // az oldal maradjon, amíg nem döntött
      const t = LABELS.shell;
      const leave = await confirmDialog({
        title: t.leaveTitle,
        messageHtml: escapeHtml(t.leaveText),
        confirmLabel: t.leaveConfirm,
        cancelLabel: t.leaveCancel,
        danger: true,
      });
      if (!leave) return;
      store.setDirty(false);
      history.replaceState(null, '', target);
    }
    this.route();
  }

  async logout() {
    if (store.get().dirty) {
      const t = LABELS.shell;
      const leave = await confirmDialog({
        title: t.leaveTitle,
        messageHtml: escapeHtml(t.leaveText),
        confirmLabel: t.leaveConfirm,
        cancelLabel: t.leaveCancel,
        danger: true,
      });
      if (!leave) return;
    }
    try {
      await api('logout', { method: 'POST' });
    } catch {
      // kilépéskor a hiba nem akadályozhatja a visszatérést a belépő képernyőre
    }
    this.renderLogin();
  }
}

customElements.define('cms-app', CmsApp);

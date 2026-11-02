import { api } from '/admin/lib/api.js';
import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';

// Az admin felület kerete: munkamenet-ellenőrzés, belépő képernyő vagy a bejelentkezett felület.
// A későbbi fázisokban ide kerül a router, a publikálási sáv és a terméklista.
class CmsApp extends HTMLElement {
  connectedCallback() {
    this.addEventListener('cms-login-success', () => this.renderShell());
    this.renderLoading();
    this.checkSession();
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
      this.renderError(error);
    }
  }

  renderLogin() {
    this.innerHTML = '<cms-login></cms-login>';
  }

  renderError(error) {
    this.innerHTML = `
      <div class="cms-center">
        <p class="cms-error" role="alert">${escapeHtml(error.message)}</p>
        <button class="menu-button" type="button" id="cms-retry">${escapeHtml(LABELS.retry)}</button>
      </div>
    `;
    this.querySelector('#cms-retry').addEventListener('click', () => {
      this.renderLoading();
      this.checkSession();
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
          <button class="cms-link-button" type="button" id="cms-logout">${escapeHtml(t.logout)}</button>
        </header>
        <main class="cms-main">
          <h1 class="cms-title">${escapeHtml(t.welcomeTitle)}</h1>
          <p class="cms-muted">${escapeHtml(t.welcomeText)}</p>
        </main>
      </div>
    `;
    this.querySelector('#cms-logout').addEventListener('click', () => this.logout());
  }

  async logout() {
    try {
      await api('logout', { method: 'POST' });
    } catch {
      // kilépéskor a hiba nem akadályozhatja a visszatérést a belépő képernyőre
    }
    this.renderLogin();
  }
}

customElements.define('cms-app', CmsApp);

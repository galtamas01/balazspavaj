import { api } from '/admin/lib/api.js';
import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';

class CmsLogin extends HTMLElement {
  connectedCallback() {
    const t = LABELS.login;
    this.innerHTML = `
      <div class="cms-login">
        <img class="cms-login-logo" src="/assets/balazspavaj_logo.png" alt="Balázs Pavaj" width="96" height="88">
        <h1 class="cms-title">${escapeHtml(t.title)}</h1>
        <p class="cms-muted">${escapeHtml(t.intro)}</p>
        <form class="cms-form" novalidate>
          <label class="cms-label" for="cms-password">${escapeHtml(t.password)}</label>
          <input class="cms-input" id="cms-password" name="password" type="password"
                 autocomplete="current-password" required autofocus>
          <p class="cms-error" id="cms-login-error" role="alert" hidden></p>
          <button class="menu-button cms-submit" type="submit">${escapeHtml(t.submit)}</button>
        </form>
      </div>
    `;
    this.form = this.querySelector('form');
    this.input = this.querySelector('#cms-password');
    this.errorBox = this.querySelector('#cms-login-error');
    this.button = this.querySelector('button[type="submit"]');
    this.form.addEventListener('submit', (event) => this.onSubmit(event));
  }

  showError(message) {
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
  }

  async onSubmit(event) {
    event.preventDefault();
    const password = this.input.value;
    this.errorBox.hidden = true;
    if (!password) {
      this.showError('Add meg a jelszót.');
      this.input.focus();
      return;
    }

    this.button.disabled = true;
    this.button.textContent = LABELS.login.submitting;
    try {
      await api('login', { method: 'POST', body: { password } });
      this.input.value = '';
      this.dispatchEvent(new CustomEvent('cms-login-success', { bubbles: true }));
    } catch (error) {
      this.showError(error.message);
      this.input.select();
    } finally {
      this.button.disabled = false;
      this.button.textContent = LABELS.login.submit;
    }
  }
}

customElements.define('cms-login', CmsLogin);

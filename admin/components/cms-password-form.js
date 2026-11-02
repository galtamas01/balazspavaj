import { api } from '/admin/lib/api.js';
import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';
import { notify } from '/admin/components/cms-toast.js';

const L = LABELS.password;
const MIN_LENGTH = 10;

// Jelszócsere: jelenlegi jelszó + kétszer az új. A szerver ellenőrzi a szabályokat, itt csak a gyors, helyi visszajelzés van.
class CmsPasswordForm extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section class="cms-password">
        <h1 class="cms-title">${escapeHtml(L.title)}</h1>
        <p class="cms-muted">${escapeHtml(L.intro)}</p>
        <form class="cms-card cms-form" novalidate>
          <div class="cms-field">
            <label class="cms-label" for="cms-pw-current">${escapeHtml(L.current)}</label>
            <input class="cms-input" id="cms-pw-current" name="current" type="password" autocomplete="current-password">
          </div>
          <div class="cms-field">
            <label class="cms-label" for="cms-pw-next">${escapeHtml(L.next)}</label>
            <input class="cms-input" id="cms-pw-next" name="next" type="password" autocomplete="new-password">
            <p class="cms-hint">${escapeHtml(L.nextHint(MIN_LENGTH))}</p>
          </div>
          <div class="cms-field">
            <label class="cms-label" for="cms-pw-repeat">${escapeHtml(L.repeat)}</label>
            <input class="cms-input" id="cms-pw-repeat" name="repeat" type="password" autocomplete="new-password">
          </div>
          <p class="cms-error" id="cms-pw-error" role="alert" hidden></p>
          <button class="menu-button cms-submit" type="submit">${escapeHtml(L.submit)}</button>
        </form>
      </section>
    `;
    this.form = this.querySelector('form');
    this.errorBox = this.querySelector('#cms-pw-error');
    this.button = this.querySelector('button[type="submit"]');
    this.form.addEventListener('submit', (event) => this.onSubmit(event));
  }

  showError(message, field) {
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
    this.form.elements[field]?.focus();
  }

  async onSubmit(event) {
    event.preventDefault();
    this.errorBox.hidden = true;
    const { current, next, repeat } = Object.fromEntries(new FormData(this.form));

    if (!current) return this.showError(L.errors.currentMissing, 'current');
    if (next.length < MIN_LENGTH) return this.showError(L.errors.tooShort(MIN_LENGTH), 'next');
    if (next !== repeat) return this.showError(L.errors.mismatch, 'repeat');
    if (next === current) return this.showError(L.errors.same, 'next');

    this.button.disabled = true;
    this.button.textContent = L.submitting;
    try {
      await api('password', { method: 'POST', body: { current, next } });
      this.form.reset();
      notify(L.done);
    } catch (error) {
      if (error.status === 401) {
        this.dispatchEvent(new CustomEvent('cms-session-expired', { bubbles: true }));
        return;
      }
      this.showError(error.message, error.code === 'BAD_CURRENT_PASSWORD' ? 'current' : 'next');
    } finally {
      this.button.disabled = false;
      this.button.textContent = L.submit;
    }
  }
}

customElements.define('cms-password-form', CmsPasswordForm);

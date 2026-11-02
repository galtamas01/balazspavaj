import { api } from '/admin/lib/api.js';
import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';

const T = LABELS.reauth;
let pending = null;

// Újrabelépés ablak lejárt munkamenetnél. Promise<boolean>: true = belépett, false = „Kilépés” vagy Esc.
// Egyszerre több kérés is kaphat 401-et: közös ablakon osztoznak.
export function reauthenticate() {
  pending ??= show().finally(() => {
    pending = null;
  });
  return pending;
}

function show() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog';
    dialog.setAttribute('aria-labelledby', 'cms-reauth-title');
    dialog.innerHTML = `
      <form class="cms-dialog-body" novalidate>
        <h2 class="cms-dialog-title" id="cms-reauth-title">${escapeHtml(T.title)}</h2>
        <div class="cms-dialog-text"><p>${escapeHtml(T.text)}</p></div>
        <label class="cms-label" for="cms-reauth-password">${escapeHtml(LABELS.login.password)}</label>
        <input class="cms-input" id="cms-reauth-password" type="password" autocomplete="current-password" autofocus>
        <p class="cms-error" role="alert" hidden></p>
        <div class="cms-dialog-actions">
          <button type="button" class="cms-btn" data-action="cancel">${escapeHtml(T.cancel)}</button>
          <button type="submit" class="cms-btn cms-btn-primary">${escapeHtml(T.submit)}</button>
        </div>
      </form>
    `;
    const form = dialog.querySelector('form');
    const input = dialog.querySelector('input');
    const errorBox = dialog.querySelector('.cms-error');
    const submit = dialog.querySelector('button[type="submit"]');
    let result = false;

    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      if (!input.value) {
        errorBox.textContent = LABELS.login.missing;
        errorBox.hidden = false;
        input.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = LABELS.login.submitting;
      try {
        await api('login', { method: 'POST', body: { password: input.value } });
        result = true;
        dialog.close();
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
        input.select();
      } finally {
        submit.disabled = false;
        submit.textContent = T.submit;
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

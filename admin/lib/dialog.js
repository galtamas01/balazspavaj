import { LABELS } from '/admin/lib/labels.js';
import { escapeHtml } from '/admin/lib/escape.js';

// Megerősítő ablak (natív <dialog>): Promise<boolean>. A `messageHtml` a hívó felelőssége (a változó részeket
// escapeHtml-en át kell vezetni). Esc vagy a „Mégse” = false. Veszélyes műveletnél a „Mégse” kapja a fókuszt.
export function confirmDialog({ title, messageHtml, confirmLabel = LABELS.dialog.ok, cancelLabel = LABELS.dialog.cancel, danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog';
    dialog.setAttribute('aria-labelledby', 'cms-dialog-title');
    dialog.innerHTML = `
      <form method="dialog" class="cms-dialog-body">
        <h2 class="cms-dialog-title" id="cms-dialog-title">${escapeHtml(title)}</h2>
        <p class="cms-dialog-text">${messageHtml}</p>
        <div class="cms-dialog-actions">
          <button type="submit" value="cancel" class="cms-btn" ${danger ? 'autofocus' : ''}>${escapeHtml(cancelLabel)}</button>
          <button type="submit" value="ok" class="cms-btn ${danger ? 'cms-btn-danger' : 'cms-btn-primary'}" ${danger ? '' : 'autofocus'}>${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'ok';
      dialog.remove();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

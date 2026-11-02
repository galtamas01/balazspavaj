// Rövid értesítések a képernyő alján. Használat: notify('Mentve.', { type: 'ok' | 'warn' | 'error' }).
class CmsToast extends HTMLElement {
  connectedCallback() {
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
  }

  show(message, { type = 'ok', timeout } = {}) {
    const item = document.createElement('div');
    item.className = `cms-toast-item cms-toast-${type}`;
    item.textContent = message;
    const remove = () => item.remove();
    item.addEventListener('click', remove);
    this.append(item);
    const ms = timeout ?? (type === 'ok' ? 4000 : 10000);
    if (ms > 0) setTimeout(remove, ms);
  }
}

customElements.define('cms-toast', CmsToast);

export function notify(message, options) {
  let host = document.querySelector('cms-toast');
  if (!host) {
    host = document.createElement('cms-toast');
    document.body.append(host);
  }
  host.show(message, options);
}

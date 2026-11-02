import { LABELS } from '/admin/lib/labels.js';

export class ApiError extends Error {
  constructor(code, message, status, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details; // pl. a mentés mezőnkénti hibái: details.errors
  }
}

const NO_REAUTH = new Set(['login', 'logout', 'session']);
const RETRY_DELAY_MS = 800;
let reauthHandler = null;

// Lejárt munkamenetnél (401) az api() ezt hívja: Promise<boolean>, true = az ügyfél újra belépett, a kérés megismétlődik.
// Így a szerkesztett, még nem mentett munka nem vész el. Ha nincs kezelő vagy false jön, a hívó a 401-et kapja.
export function setReauthHandler(handler) {
  reauthHandler = handler;
}

// Minden /api/* hívás ezen megy át. Hibánál ApiError-t dob, amelynek a message-e már magyar,
// az ügyfélnek megjeleníthető szöveg. Az olvasó (GET) hívás hálózati hibánál egyszer magától újrapróbálja.
export async function api(name, { method = 'GET', body, ...internal } = {}) {
  let response;
  try {
    response = await fetch(`/api/${name}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (method === 'GET' && !internal.networkRetried) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return api(name, { method, body, ...internal, networkRetried: true });
    }
    throw new ApiError('NETWORK', LABELS.errors.NETWORK, 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // nem JSON válasz (pl. hálózati közbeiktatott hibaoldal)
  }

  if (response.status === 401 && reauthHandler && !NO_REAUTH.has(name) && !internal.reauthed) {
    if (await reauthHandler()) return api(name, { method, body, ...internal, reauthed: true });
  }

  if (!response.ok) {
    throw new ApiError(data?.code || `HTTP_${response.status}`, data?.message || LABELS.errors.GENERIC, response.status, data);
  }
  return data;
}

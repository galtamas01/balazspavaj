import { LABELS } from '/admin/lib/labels.js';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Minden /api/* hívás ezen megy át. Hibánál ApiError-t dob, amelynek a message-e már magyar,
// az ügyfélnek megjeleníthető szöveg.
export async function api(name, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${name}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', LABELS.errors.NETWORK, 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // nem JSON válasz (pl. hálózati közbeiktatott hibaoldal)
  }

  if (!response.ok) {
    throw new ApiError(data?.code || `HTTP_${response.status}`, data?.message || LABELS.errors.GENERIC, response.status);
  }
  return data;
}

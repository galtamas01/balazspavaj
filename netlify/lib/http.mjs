// Közös válasz-segédek a Netlify Functions számára.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

// A hibaüzenet (message) magyar és az ügyfélnek szól; a code géppel olvasható.
export function error(status, code, message, extraHeaders = {}) {
  return json({ ok: false, code, message }, status, extraHeaders);
}

export const MESSAGES = {
  METHOD_NOT_ALLOWED: 'Ez a művelet nem engedélyezett.',
  BAD_ORIGIN: 'A kérés nem megbízható forrásból érkezett. Frissítsd az oldalt, és próbáld újra.',
  BAD_REQUEST: 'Hibás kérés. Frissítsd az oldalt, és próbáld újra.',
  UNAUTHORIZED: 'A munkamenet lejárt. Jelentkezz be újra.',
  CONFIG_ERROR: 'A rendszer beállítása hiányos. Szólj a fejlesztőnek.',
  SERVER_ERROR: 'Váratlan hiba történt. Próbáld újra egy perc múlva.',
};

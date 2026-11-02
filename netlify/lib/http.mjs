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
  STALE: 'Közben máshol is módosult a katalógus. Frissítsd az oldalt, és vidd át újra a módosításaidat.',
  CONFLICT: 'A weboldal kódja közben megváltozott, és ez ütközik a nem publikált módosításokkal. Ezt a fejlesztőnek kell összefésülnie. Addig publikálni nem lehet; az „Elvetés” gombbal újrakezdheted a módosításokat.',
  GITHUB_AUTH: 'A tárhely-hozzáférés nem működik (lejárt vagy hibás token?). Szólj a fejlesztőnek.',
  GITHUB_ERROR: 'A tárhely most nem érhető el. Próbáld újra egy perc múlva.',
  DATA_INVALID: 'A katalógusfájl hiányzik vagy hibás. Szólj a fejlesztőnek.',
  VALIDATION: 'A mentés nem sikerült: javítsd a jelölt mezőket.',
  TOO_LARGE: 'A feltöltés túl nagy.',
  CREDENTIAL_STORE: 'A belépés most átmenetileg nem érhető el. Próbáld újra egy perc múlva.',
  PASSWORD_NOT_SAVED: 'A jelszót most nem sikerült elmenteni. Próbáld újra egy perc múlva.',
  RELOAD: 'A weboldal közben frissült, ezért az előnézet újratöltődött. Nézd át a módosításokat, és publikálj újra.',
  NOTHING_TO_PUBLISH: 'Nincs publikálandó módosítás.',
};

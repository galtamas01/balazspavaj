// A belépési jelszavak kezelése.
//
//  - Mester jelszó (MASTER_PASSWORD_HASH, környezeti változó): a fejlesztőé, mindig működik. Az admin felületről
//    nem változtatható és nem is írható felül, ezért az ügyfél jelszócseréje sosem zárja ki a fejlesztőt.
//  - Ügyfél jelszó: kezdetben az ADMIN_PASSWORD_HASH környezeti változó; ha az ügyfél az adminban jelszót cserél,
//    az új hash a Netlify Blobs-ban tárolódik (kulcs: client-password), és onnantól az számít. Sima szövegű
//    jelszó sehol nem tárolódik, csak scrypt hash.
//
// Ha a tár (Blobs) átmenetileg nem olvasható, az ügyfél jelszavát NEM fogadjuk el (különben a régi, már lecserélt
// jelszó újra működne), a mester jelszó viszont ilyenkor is működik. Ha a Blobs a környezetben egyáltalán nincs
// beállítva (pl. helyi fejlesztés), nem lehet felülírt jelszó, ezért a környezeti változó érvényes.
import { hashPassword, verifyPassword, ConfigError } from './auth.mjs';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
const KEY = 'client-password';

// A jelszótár átmenetileg nem elérhető: nem lehet eldönteni, érvényes-e az ügyfél jelszava.
export class CredentialStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

async function defaultStore() {
  const { getStore } = await import('@netlify/blobs');
  // erős konzisztencia: a jelszócsere minden példányon azonnal érvényes legyen
  return getStore({ name: 'cms-auth', consistency: 'strong' });
}

const notConfigured = (e) => e?.name === 'MissingBlobsEnvironmentError';

export function createCredentials({ getStore = defaultStore, env = () => process.env, now = () => new Date() } = {}) {
  // Az ügyfél jelenleg érvényes hash-e: a tárban lévő, különben a környezeti változó (vagy null).
  async function clientHash() {
    let stored = null;
    try {
      const store = await getStore();
      stored = await store.get(KEY, { type: 'json' });
    } catch (e) {
      if (!notConfigured(e)) {
        console.error('jelszótár olvasási hiba:', e?.message);
        throw new CredentialStoreError('A jelszótár nem érhető el.');
      }
    }
    if (stored && typeof stored.hash === 'string') return stored.hash;
    return env().ADMIN_PASSWORD_HASH || null;
  }

  return {
    // Visszaad: 'master' | 'client' | null (hibás jelszó). Dob: ConfigError (nincs semmilyen jelszó beállítva),
    // CredentialStoreError (az ügyfél jelszava nem ellenőrizhető).
    async verify(password) {
      const master = env().MASTER_PASSWORD_HASH;
      if (master && (await verifyPassword(password, master))) return 'master';

      const hash = await clientHash();
      if (!hash) {
        if (master) return null;
        throw new ConfigError('ADMIN_PASSWORD_HASH és MASTER_PASSWORD_HASH sem található.');
      }
      return (await verifyPassword(password, hash)) ? 'client' : null;
    },

    // Új ügyfél jelszó mentése (hash-ként). Dob: CredentialStoreError, ha nem menthető.
    async setClientPassword(password) {
      const hash = await hashPassword(password);
      try {
        const store = await getStore();
        await store.setJSON(KEY, { hash, changedAt: now().toISOString() });
      } catch (e) {
        console.error('jelszótár írási hiba:', e?.message);
        throw new CredentialStoreError('A jelszó nem menthető.');
      }
    },
  };
}

// Az új jelszó ellenőrzése: visszaad egy magyar hibaüzenetet, vagy '' ha rendben van.
export function newPasswordError(password, current) {
  if (typeof password !== 'string' || password === '') return 'Add meg az új jelszót.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Az új jelszó legalább ${MIN_PASSWORD_LENGTH} karakter legyen.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Az új jelszó legfeljebb ${MAX_PASSWORD_LENGTH} karakter lehet.`;
  if (password === current) return 'Az új jelszó különbözzön a jelenlegitől.';
  if (password.trim() !== password) return 'Az új jelszó elején és végén ne legyen szóköz.';
  return '';
}

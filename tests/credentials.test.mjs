import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, createRateLimiter, ConfigError } from '../netlify/lib/auth.mjs';
import {
  createCredentials,
  CredentialStoreError,
  newPasswordError,
  MIN_PASSWORD_LENGTH,
} from '../netlify/lib/credentials.mjs';
import { makeHandler as makeLogin } from '../netlify/functions/login.mjs';
import { makeHandler as makePassword } from '../netlify/functions/password.mjs';
import { createSessionCookie } from '../netlify/lib/auth.mjs';

const ORIGIN = 'https://www.balazspavaj.ro';

class FakeStore {
  constructor() {
    this.data = new Map();
    this.failGet = null;
    this.failSet = null;
  }
  async get(key) {
    if (this.failGet) throw this.failGet;
    return this.data.has(key) ? structuredClone(this.data.get(key)) : null;
  }
  async setJSON(key, value) {
    if (this.failSet) throw this.failSet;
    this.data.set(key, structuredClone(value));
  }
  async delete(key) {
    this.data.delete(key);
  }
}

function post(path, body, headers = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const authed = () => ({ cookie: cookieOf({ headers: new Headers({ 'set-cookie': createSessionCookie(new Request(ORIGIN)) }) }) });

let store;
let env;
let credentials;
let login;
let password;

beforeEach(async () => {
  process.env.SESSION_SECRET = 'x'.repeat(48);
  store = new FakeStore();
  env = {
    ADMIN_PASSWORD_HASH: await hashPassword('ugyfel-kezdo-jelszo'),
    MASTER_PASSWORD_HASH: await hashPassword('mester-jelszo-12345'),
  };
  credentials = createCredentials({ getStore: async () => store, env: () => env });
  const limiter = createRateLimiter(async () => store);
  login = makeLogin(limiter, credentials);
  password = makePassword(limiter, credentials);
});

test('verify: kezdő ügyfél jelszó, mester jelszó és hibás jelszó', async () => {
  assert.equal(await credentials.verify('ugyfel-kezdo-jelszo'), 'client');
  assert.equal(await credentials.verify('mester-jelszo-12345'), 'master');
  assert.equal(await credentials.verify('valami-mas'), null);
});

test('jelszócsere után az új ügyfél jelszó és a mester működik, a régi nem', async () => {
  await credentials.setClientPassword('uj-ugyfel-jelszo-1');
  assert.equal(await credentials.verify('uj-ugyfel-jelszo-1'), 'client');
  assert.equal(await credentials.verify('ugyfel-kezdo-jelszo'), null);
  assert.equal(await credentials.verify('mester-jelszo-12345'), 'master');
  const saved = store.data.get('client-password');
  assert.match(saved.hash, /^scrypt:/);
  assert.ok(!JSON.stringify(saved).includes('uj-ugyfel-jelszo-1'), 'sima szöveg nem tárolódik');
});

test('verify: nincs semmilyen jelszó beállítva → ConfigError; csak mester van → ügyfél jelszó hibás', async () => {
  env = {};
  await assert.rejects(() => credentials.verify('barmi'), ConfigError);
  env = { MASTER_PASSWORD_HASH: await hashPassword('mester-jelszo-12345') };
  assert.equal(await credentials.verify('barmi'), null);
  assert.equal(await credentials.verify('mester-jelszo-12345'), 'master');
});

test('a tár hibája: az ügyfél nem léphet be, a mester igen', async () => {
  await credentials.setClientPassword('uj-ugyfel-jelszo-1');
  store.failGet = new Error('boom');
  await assert.rejects(() => credentials.verify('ugyfel-kezdo-jelszo'), CredentialStoreError);
  await assert.rejects(() => credentials.verify('uj-ugyfel-jelszo-1'), CredentialStoreError);
  assert.equal(await credentials.verify('mester-jelszo-12345'), 'master');
});

test('ha a Blobs nincs beállítva (helyi fejlesztés), a környezeti változó érvényes', async () => {
  const missing = Object.assign(new Error('nincs'), { name: 'MissingBlobsEnvironmentError' });
  store.failGet = missing;
  assert.equal(await credentials.verify('ugyfel-kezdo-jelszo'), 'client');
});

test('mentési hiba → CredentialStoreError, a régi jelszó marad', async () => {
  store.failSet = new Error('boom');
  await assert.rejects(() => credentials.setClientPassword('uj-ugyfel-jelszo-1'), CredentialStoreError);
  assert.equal(await credentials.verify('ugyfel-kezdo-jelszo'), 'client');
});

test('új jelszó szabályai', () => {
  assert.equal(newPasswordError('hosszu-jelszo-123', 'regi'), '');
  assert.match(newPasswordError('', 'x'), /Add meg/);
  assert.match(newPasswordError('rovid', 'x'), new RegExp(String(MIN_PASSWORD_LENGTH)));
  assert.match(newPasswordError('a'.repeat(201), 'x'), /legfeljebb/);
  assert.match(newPasswordError('ugyanaz-a-jelszo', 'ugyanaz-a-jelszo'), /különbözzön/);
  assert.match(newPasswordError(' szokozos-jelszo ', 'x'), /szóköz/);
});

test('login végpont: mester jelszó mindig beléptet, jelszócsere után a régi ügyfél jelszó nem', async () => {
  assert.equal((await login(post('/api/login', { password: 'ugyfel-kezdo-jelszo' }))).status, 200);
  await credentials.setClientPassword('uj-ugyfel-jelszo-1');
  assert.equal((await login(post('/api/login', { password: 'ugyfel-kezdo-jelszo' }))).status, 401);
  assert.equal((await login(post('/api/login', { password: 'uj-ugyfel-jelszo-1' }))).status, 200);
  assert.equal((await login(post('/api/login', { password: 'mester-jelszo-12345' }))).status, 200);
});

test('login végpont: tárhiba → 503 az ügyfélnek, 200 a mesternek', async () => {
  store.failGet = new Error('boom');
  const client = await login(post('/api/login', { password: 'ugyfel-kezdo-jelszo' }));
  assert.equal(client.status, 503);
  assert.equal((await client.json()).code, 'CREDENTIAL_STORE');
  assert.equal((await login(post('/api/login', { password: 'mester-jelszo-12345' }))).status, 200);
});

test('password végpont: munkamenet nélkül 401, hibás Origin 403', async () => {
  const res = await password(post('/api/password', { current: 'ugyfel-kezdo-jelszo', next: 'uj-ugyfel-jelszo-1' }));
  assert.equal(res.status, 401);
  const bad = await password(post('/api/password', { current: 'a', next: 'b' }, { ...authed(), origin: 'https://evil.example' }));
  assert.equal(bad.status, 403);
});

test('password végpont: sikeres csere, utána az új jelszóval lehet belépni', async () => {
  const res = await password(post('/api/password', { current: 'ugyfel-kezdo-jelszo', next: 'uj-ugyfel-jelszo-1' }, authed()));
  assert.equal(res.status, 200);
  assert.equal((await login(post('/api/login', { password: 'uj-ugyfel-jelszo-1' }))).status, 200);
  assert.equal((await login(post('/api/login', { password: 'ugyfel-kezdo-jelszo' }))).status, 401);
});

test('password végpont: hibás jelenlegi jelszó, gyenge új jelszó, hibás törzs', async () => {
  const wrong = await password(post('/api/password', { current: 'nem-ez-a-jelszo', next: 'uj-ugyfel-jelszo-1' }, authed()));
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).code, 'BAD_CURRENT_PASSWORD');
  assert.equal(store.data.has('client-password'), false);

  const weak = await password(post('/api/password', { current: 'ugyfel-kezdo-jelszo', next: 'rovid' }, authed()));
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).code, 'WEAK_PASSWORD');

  const bad = await password(post('/api/password', { current: 5 }, authed()));
  assert.equal(bad.status, 400);
  assert.equal(store.data.has('client-password'), false);
});

test('password végpont: a mester jelszó "jelenlegiként" új ügyfél jelszót állít (elfelejtett jelszó), a mester marad', async () => {
  const res = await password(post('/api/password', { current: 'mester-jelszo-12345', next: 'uj-ugyfel-jelszo-1' }, authed()));
  assert.equal(res.status, 200);
  assert.equal((await login(post('/api/login', { password: 'uj-ugyfel-jelszo-1' }))).status, 200);
  assert.equal((await login(post('/api/login', { password: 'mester-jelszo-12345' }))).status, 200);
});

test('password végpont: mentési hiba → 503, a jelszó nem változik; a hibás próbák korlátozva vannak', async () => {
  store.failSet = new Error('boom');
  const res = await password(post('/api/password', { current: 'ugyfel-kezdo-jelszo', next: 'uj-ugyfel-jelszo-1' }, authed()));
  assert.equal(res.status, 503);
  assert.equal((await login(post('/api/login', { password: 'ugyfel-kezdo-jelszo' }))).status, 200);

  store.failSet = null;
  for (let i = 0; i < 5; i += 1) {
    const r = await password(post('/api/password', { current: `rossz-${i}`, next: 'uj-ugyfel-jelszo-1' }, authed()), { ip: '1.2.3.4' });
    assert.equal(r.status, 400);
  }
  const blocked = await password(post('/api/password', { current: 'ugyfel-kezdo-jelszo', next: 'uj-ugyfel-jelszo-1' }, authed()), { ip: '1.2.3.4' });
  assert.equal(blocked.status, 429);
});

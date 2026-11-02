import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../admin/lib/state.js';

const catalog = (sha, price) => ({
  ok: true,
  draft: { products: { pavaje: { a: { name: 'A', price } } }, colors: {} },
  main: { products: { pavaje: { a: { name: 'A', price: '1' } } }, colors: {} },
  draftSha: sha,
  mainSha: 'm1',
  previewUrl: 'https://p.example',
});

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

test('load: az állapot feltöltése, hiba esetén error állapot', async () => {
  const store = createStore(async () => catalog('d1', '1'));
  const seen = [];
  store.subscribe((s) => seen.push(s.status));
  await store.load();
  assert.equal(store.get().status, 'ready');
  assert.equal(store.get().draftSha, 'd1');
  assert.equal(store.get().previewUrl, 'https://p.example');
  assert.deepEqual(seen, ['loading', 'ready']);

  const failing = createStore(async () => {
    throw new ApiError(502, 'GITHUB_ERROR');
  });
  await assert.rejects(failing.load());
  assert.equal(failing.get().status, 'error');
});

test('save: a baseSha-val küld, és az új sha-t átveszi', async () => {
  const calls = [];
  const api = async (name, opts) => {
    calls.push([name, opts?.body]);
    if (name === 'catalog') return catalog('d1', '1');
    return { ok: true, draftSha: 'd2', changed: true, warnings: [{ path: 'x', message: 'figy' }] };
  };
  const store = createStore(api);
  await store.load();
  const out = await store.save({
    apply: (p) => ({ ...p, pavaje: { a: { name: 'A', price: '2' } } }),
    message: 'Módosítás: A',
  });
  assert.equal(out.changed, true);
  assert.equal(out.warnings.length, 1);
  assert.equal(store.get().draftSha, 'd2');
  assert.equal(store.get().draft.products.pavaje.a.price, '2');
  assert.equal(calls[1][1].baseSha, 'd1');
  assert.equal(calls[1][1].message, 'Módosítás: A');
  assert.deepEqual(calls[1][1].uploads, []);
  assert.equal(store.get().busy, false);
});

test('save: 409 után újratölt, és a módosítást az új adaton megismétli', async () => {
  let saves = 0;
  const api = async (name, opts) => {
    if (name === 'catalog') return catalog(saves === 0 ? 'd1' : 'd5', saves === 0 ? '1' : '1');
    saves += 1;
    if (saves === 1) throw new ApiError(409, 'STALE');
    assert.equal(opts.body.baseSha, 'd5', 'az újratöltött sha-val próbálja újra');
    return { ok: true, draftSha: 'd6', changed: true, warnings: [] };
  };
  const store = createStore(api);
  await store.load();
  let applied = 0;
  await store.save({ apply: (p) => { applied += 1; return p; }, message: 'x' });
  assert.equal(applied, 2);
  assert.equal(store.get().draftSha, 'd6');
});

test('save: második 409 hibaként kijön; foglalt állapotban nem indul új mentés', async () => {
  const api = async (name) => {
    if (name === 'catalog') return catalog('d1', '1');
    throw new ApiError(409, 'STALE');
  };
  const store = createStore(api);
  await store.load();
  await assert.rejects(store.save({ apply: (p) => p, message: 'x' }), (e) => e.status === 409);
  assert.equal(store.get().busy, false);

  let release;
  const slow = createStore(async (name) => {
    if (name === 'catalog') return catalog('d1', '1');
    await new Promise((r) => { release = r; });
    return { ok: true, draftSha: 'd2', changed: false, warnings: [] };
  });
  await slow.load();
  const first = slow.save({ apply: (p) => p, message: 'a' });
  await assert.rejects(slow.save({ apply: (p) => p, message: 'b' }), /folyamatban/);
  release();
  await first;
});

test('save: ha a módosítás nem alkalmazható, hiba és nincs hálózati hívás', async () => {
  let saved = false;
  const store = createStore(async (name) => {
    if (name === 'catalog') return catalog('d1', '1');
    saved = true;
    return {};
  });
  await store.load();
  await assert.rejects(store.save({ apply: () => { throw new Error('nem megy'); }, message: 'x' }), /nem megy/);
  assert.equal(saved, false);
  assert.equal(store.get().busy, false);
});

test('dirty jelző', async () => {
  const store = createStore(async () => catalog('d1', '1'));
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.setDirty(true);
  store.setDirty(true);
  assert.equal(store.get().dirty, true);
  assert.equal(notified, 1);
});

test('save: a feltöltendő képeket elküldi, a prefixet a katalógusból veszi', async () => {
  const bodies = [];
  const api = async (name, opts) => {
    if (name === 'catalog') return { ...catalog('d1', '1'), assetsPrefix: '/assets/teszt/' };
    bodies.push(opts.body);
    return { ok: true, draftSha: 'd2', changed: true, warnings: [] };
  };
  const store = createStore(api);
  assert.equal(store.get().assetsPrefix, '/assets/pavaje/');
  await store.load();
  assert.equal(store.get().assetsPrefix, '/assets/teszt/');
  await store.save({ apply: (p) => p, message: 'x', uploads: [{ path: '/assets/teszt/a.webp', base64: 'AAAA' }] });
  assert.deepEqual(bodies[0].uploads, [{ path: '/assets/teszt/a.webp', base64: 'AAAA' }]);
});

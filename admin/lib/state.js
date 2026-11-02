// A szerkesztő közös állapota: a piszkozat és az éles katalógus, a mentés és a „nem mentett” jelző.
// Az api függvényt kívülről kapja (createStore), így Node-ban hálózat nélkül tesztelhető.
import { ChangeError } from './catalog-ops.js';
import { collectImagePaths } from '../../src/shared/catalog-schema.js';

export function createStore(api, { networkRetryDelayMs = 1500 } = {}) {
  let state = {
    status: 'idle', // idle | loading | ready | error
    error: null,
    draft: { products: {}, colors: {} },
    main: { products: {}, colors: {} },
    draftSha: '',
    mainSha: '',
    previewUrl: '',
    assetsPrefix: '/assets/pavaje/',
    mainImages: new Set(),
    syncConflict: false, // a main változásai nem olvaszthatók be a piszkozatba (lásd netlify/lib/sync.mjs)
    stats: null, // { publishesThisMonth, estimatedCredits, monthlyCredits, warnAfter }
    busy: false,
    busyKind: '', // 'save' | 'publish' | 'discard'
    dirty: false,
  };
  const listeners = new Set();

  const get = () => state;
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn(state);
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  // A szerver állapotának átvétele (betöltés, újratöltés 409 után, publikálás/elvetés után).
  function applyCatalog(data) {
    return {
      draft: data.draft,
      main: data.main,
      draftSha: data.draftSha,
      mainSha: data.mainSha,
      syncConflict: Boolean(data.syncConflict),
      previewUrl: data.previewUrl ?? state.previewUrl,
      assetsPrefix: data.assetsPrefix || state.assetsPrefix,
      mainImages: collectImagePaths(data.main.products, data.main.colors),
    };
  }

  async function load() {
    set({ status: 'loading', error: null });
    try {
      const data = await api('catalog');
      set({ status: 'ready', ...applyCatalog(data) });
    } catch (error) {
      set({ status: 'error', error });
      throw error;
    }
  }

  // Újratöltés a kezelőfelület „betöltés…” állapota nélkül.
  async function refresh() {
    set(applyCatalog(await api('catalog')));
  }

  // A havi publikálások száma (csak tájékoztatás: hiba esetén csendben kimarad).
  async function loadStats() {
    try {
      set({ stats: await api('status') });
    } catch {
      // a számláló nem kritikus
    }
  }

  // Egy módosítás mentése a piszkozatra. `apply(draft)` az aktuális piszkozaton ({ products, colors }) számolja ki
  // az újat és { products, colors }-t ad vissza; ezért ha közben máshol is mentettek (409), a módosítás az
  // újratöltött adaton megismételhető. `uploads`: [{ path, base64 }] – az új képek, ugyanabban a commitban mentődnek.
  // Visszaad: { warnings, changed }.
  async function commit({ apply, message, uploads = [] }) {
    if (state.busy) throw new ChangeError('Egy másik mentés még folyamatban van.');
    set({ busy: true, busyKind: 'save' });
    try {
      // Egy-egy újrapróba: elavult állapotnál (409) újratöltéssel, hálózati hibánál rövid várakozás után.
      // Ha az első kérés valójában célba ért, de a válasz elveszett, az újrapróba 409-et kap, újratölt, és
      // az `apply` az új adaton már nem változtat (nincs dupla commit).
      let staleRetried = false;
      let networkRetried = false;
      for (;;) {
        const { products, colors } = apply(state.draft);
        try {
          const result = await api('save', {
            method: 'POST',
            body: { baseSha: state.draftSha, products, colors, uploads, message },
          });
          set({ draft: { products, colors }, draftSha: result.draftSha });
          return { warnings: result.warnings || [], changed: Boolean(result.changed) };
        } catch (error) {
          if (error.status === 409 && !staleRetried) {
            staleRetried = true;
            await refresh();
            continue;
          }
          if (error.code === 'NETWORK' && !networkRetried) {
            networkRetried = true;
            await new Promise((resolve) => setTimeout(resolve, networkRetryDelayMs));
            continue;
          }
          throw error;
        }
      }
    } finally {
      set({ busy: false, busyKind: '' });
    }
  }

  // Publikálás: a piszkozat élesítése. `summary`: rövid összegzés a commit üzenetébe (pl. „2 új, 1 módosított”).
  // Siker után az állapot újratöltődik (a piszkozat és az éles ág azonos). Elavult állapotnál (409) is újratölt,
  // hogy az ügyfél a valós állapotot lássa, majd a hibát továbbdobja.
  async function publish({ summary = '' } = {}) {
    if (state.busy) throw new ChangeError('Egy másik művelet még folyamatban van.');
    set({ busy: true, busyKind: 'publish' });
    try {
      try {
        await api('publish', { method: 'POST', body: { draftSha: state.draftSha, summary } });
      } catch (error) {
        if (error.status === 409) await refresh().catch(() => {});
        throw error;
      }
      await refresh();
      await loadStats();
    } finally {
      set({ busy: false, busyKind: '' });
    }
  }

  // A nem publikált módosítások elvetése: a piszkozat visszaáll az éles állapotra.
  async function discard() {
    if (state.busy) throw new ChangeError('Egy másik művelet még folyamatban van.');
    set({ busy: true, busyKind: 'discard' });
    try {
      try {
        await api('discard', { method: 'POST', body: { draftSha: state.draftSha } });
      } catch (error) {
        if (error.status === 409) await refresh().catch(() => {});
        throw error;
      }
      await refresh();
    } finally {
      set({ busy: false, busyKind: '' });
    }
  }

  // Csak a termékek módosítása: `apply(products)` → új products (a paletta változatlan).
  const save = ({ apply, message, uploads = [] }) =>
    commit({ apply: (draft) => ({ products: apply(draft.products), colors: draft.colors }), message, uploads });

  // A paletta (és szükség esetén a termékek) módosítása: `apply({ products, colors })` → { products, colors }.
  const saveCatalog = ({ apply, message }) => commit({ apply, message });

  const setDirty = (dirty) => {
    if (state.dirty !== dirty) set({ dirty });
  };

  return { get, set, subscribe, load, refresh, loadStats, save, saveCatalog, publish, discard, setDirty };
}

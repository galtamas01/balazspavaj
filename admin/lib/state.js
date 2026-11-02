// A szerkesztő közös állapota: a piszkozat és az éles katalógus, a mentés és a „nem mentett” jelző.
// Az api függvényt kívülről kapja (createStore), így Node-ban hálózat nélkül tesztelhető.
import { ChangeError } from './catalog-ops.js';
import { collectImagePaths } from '../../src/shared/catalog-schema.js';

export function createStore(api) {
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
    busy: false,
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

  async function load() {
    set({ status: 'loading', error: null });
    try {
      const data = await api('catalog');
      set({
        status: 'ready',
        draft: data.draft,
        main: data.main,
        draftSha: data.draftSha,
        mainSha: data.mainSha,
        previewUrl: data.previewUrl || '',
        assetsPrefix: data.assetsPrefix || state.assetsPrefix,
        mainImages: collectImagePaths(data.main.products, data.main.colors),
      });
    } catch (error) {
      set({ status: 'error', error });
      throw error;
    }
  }

  // Egy módosítás mentése a piszkozatra. `apply(draft)` az aktuális piszkozaton ({ products, colors }) számolja ki
  // az újat és { products, colors }-t ad vissza; ezért ha közben máshol is mentettek (409), a módosítás az
  // újratöltött adaton megismételhető. `uploads`: [{ path, base64 }] – az új képek, ugyanabban a commitban mentődnek.
  // Visszaad: { warnings, changed }.
  async function commit({ apply, message, uploads = [] }) {
    if (state.busy) throw new ChangeError('Egy másik mentés még folyamatban van.');
    set({ busy: true });
    try {
      for (let attempt = 0; ; attempt += 1) {
        const { products, colors } = apply(state.draft);
        try {
          const result = await api('save', {
            method: 'POST',
            body: { baseSha: state.draftSha, products, colors, uploads, message },
          });
          set({ draft: { products, colors }, draftSha: result.draftSha });
          return { warnings: result.warnings || [], changed: Boolean(result.changed) };
        } catch (error) {
          if (error.status === 409 && attempt === 0) {
            const data = await api('catalog');
            set({ draft: data.draft, main: data.main, draftSha: data.draftSha, mainSha: data.mainSha, mainImages: collectImagePaths(data.main.products, data.main.colors) });
            continue;
          }
          throw error;
        }
      }
    } finally {
      set({ busy: false });
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

  return { get, set, subscribe, load, save, saveCatalog, setDirty };
}

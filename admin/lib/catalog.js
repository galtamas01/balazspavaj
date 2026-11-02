// A böngészőben használt közös tároló példány (az api-hívásokkal összekötve).
import { api } from '/admin/lib/api.js';
import { createStore } from '/admin/lib/state.js';

export const store = createStore(api);

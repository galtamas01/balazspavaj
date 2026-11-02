// Kivételek → HTTP válaszok. A részleteket csak a function naplóba írjuk, az ügyfél magyar üzenetet kap.
import { error, MESSAGES } from './http.mjs';
import { ConfigError } from './auth.mjs';
import { GithubError, StaleBranchError, MergeConflictError } from './github.mjs';

// A repóban lévő katalógusfájl hiányzik vagy nem értelmezhető.
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataError';
  }
}

export function toResponse(e) {
  if (e instanceof ConfigError) {
    console.error('Konfigurációs hiba:', e.message);
    return error(500, 'CONFIG_ERROR', MESSAGES.CONFIG_ERROR);
  }
  if (e instanceof StaleBranchError) return error(409, 'STALE', MESSAGES.STALE);
  if (e instanceof MergeConflictError) return error(409, 'CONFLICT', MESSAGES.CONFLICT);
  if (e instanceof DataError) {
    console.error('Adathiba:', e.message);
    return error(502, 'DATA_INVALID', MESSAGES.DATA_INVALID);
  }
  if (e instanceof GithubError) {
    console.error('GitHub hiba:', e.message, e.body);
    if (e.status === 401 || e.status === 403) return error(502, 'GITHUB_AUTH', MESSAGES.GITHUB_AUTH);
    return error(502, 'GITHUB_ERROR', MESSAGES.GITHUB_ERROR);
  }
  console.error('Váratlan hiba:', e);
  return error(500, 'SERVER_ERROR', MESSAGES.SERVER_ERROR);
}

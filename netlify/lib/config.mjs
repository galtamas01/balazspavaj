// A CMS beállításai. Csak a GITHUB_TOKEN kötelező; a többi alapértéke ennek a repónak felel meg.
import { ConfigError } from './auth.mjs';

export function getConfig(env = process.env) {
  if (!env.GITHUB_TOKEN) throw new ConfigError('GITHUB_TOKEN hiányzik.');
  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER || 'galtamas01',
    repo: env.GITHUB_REPO || 'balazspavaj',
    mainBranch: env.MAIN_BRANCH || 'main',
    draftBranch: env.DRAFT_BRANCH || 'cms-draft',
    productsPath: env.PRODUCTS_PATH || 'produse/products.json',
    colorsPath: env.COLORS_PATH || 'produse/colors.json',
    assetsDir: env.ASSETS_DIR || 'assets/pavaje',
  };
}

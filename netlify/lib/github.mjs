// GitHub REST réteg: a katalógus olvasása és mentése a repóba. Csak a szükséges műveletek vannak benne;
// a publikálás (merge/reset) a 6. fázisban kerül ide. A fetch kicserélhető, így hálózat nélkül tesztelhető.

export class GithubError extends Error {
  constructor(status, message, body = '') {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.body = body;
  }
}

// A branch közben elmozdult (valaki más mentett): a kliensnek frissítenie kell.
export class StaleBranchError extends Error {
  constructor() {
    super('A branch közben módosult.');
    this.name = 'StaleBranchError';
  }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export function createGithub(config, fetchImpl = globalThis.fetch) {
  const base = `https://api.github.com/repos/${config.owner}/${config.repo}`;

  async function request(method, path, { body, raw = false } = {}) {
    const response = await fetchImpl(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'balazspavaj-cms',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let text = '';
      try {
        text = (await response.text()).slice(0, 500);
      } catch {
        // a hibatörzs nem kötelező
      }
      throw new GithubError(response.status, `GitHub ${method} ${path} → ${response.status}`, text);
    }
    if (raw) return response.text();
    if (response.status === 204) return null;
    return response.json();
  }

  const api = {
    config,

    // A branch csúcsának commit sha-ja, vagy null, ha nincs ilyen ág.
    async getRef(branch) {
      try {
        const ref = await request('GET', `/git/ref/heads/${encodePath(branch)}`);
        return ref.object.sha;
      } catch (e) {
        if (e instanceof GithubError && e.status === 404) return null;
        throw e;
      }
    },

    // Létrehozza az ágat a másik ág jelenlegi állapotából, ha még nincs. Visszaadja a csúcs sha-ját.
    async ensureBranch(branch, fromBranch) {
      const existing = await api.getRef(branch);
      if (existing) return existing;
      const fromSha = await api.getRef(fromBranch);
      if (!fromSha) throw new GithubError(404, `A(z) ${fromBranch} ág nem található.`);
      try {
        await request('POST', '/git/refs', { body: { ref: `refs/heads/${branch}`, sha: fromSha } });
      } catch (e) {
        // két egyidejű kérés közül a második "már létezik" hibát kap
        if (e instanceof GithubError && e.status === 422) {
          const again = await api.getRef(branch);
          if (again) return again;
        }
        throw e;
      }
      return fromSha;
    },

    // A fájl szövege az adott ref-en (branch vagy commit sha), vagy null, ha nincs ilyen fájl.
    async readFile(path, ref) {
      try {
        return await request('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { raw: true });
      } catch (e) {
        if (e instanceof GithubError && e.status === 404) return null;
        throw e;
      }
    },

    // Egy mappa alatti összes fájl útvonala az adott commitban (pl. "assets/pavaje/x.webp").
    async listFiles(commitSha, dir) {
      const commit = await request('GET', `/git/commits/${commitSha}`);
      const tree = await request('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated) throw new Error('A repó fája túl nagy a listázáshoz.');
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => e.path);
    },

    // Egyetlen atomi commit a megadott ágra. writes: [{path, text} | {path, base64}], deletes: [path].
    // Ha a végeredmény azonos a kiinduló fával, nem készül commit ({changed:false}).
    async commitFiles({ branch, baseSha, writes = [], deletes = [], message }) {
      const baseCommit = await request('GET', `/git/commits/${baseSha}`);
      const entries = [];
      for (const w of writes) {
        if (w.base64 !== undefined) {
          const blob = await request('POST', '/git/blobs', { body: { content: w.base64, encoding: 'base64' } });
          entries.push({ path: w.path, mode: '100644', type: 'blob', sha: blob.sha });
        } else {
          entries.push({ path: w.path, mode: '100644', type: 'blob', content: w.text });
        }
      }
      for (const path of deletes) entries.push({ path, mode: '100644', type: 'blob', sha: null });

      const tree = await request('POST', '/git/trees', { body: { base_tree: baseCommit.tree.sha, tree: entries } });
      if (tree.sha === baseCommit.tree.sha) return { sha: baseSha, changed: false };

      const commit = await request('POST', '/git/commits', {
        body: { message, tree: tree.sha, parents: [baseSha] },
      });
      try {
        await request('PATCH', `/git/refs/heads/${encodePath(branch)}`, { body: { sha: commit.sha, force: false } });
      } catch (e) {
        if (e instanceof GithubError && (e.status === 409 || e.status === 422)) throw new StaleBranchError();
        throw e;
      }
      return { sha: commit.sha, changed: true };
    },
  };
  return api;
}

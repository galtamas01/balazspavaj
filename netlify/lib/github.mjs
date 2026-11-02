// GitHub REST réteg: a katalógus olvasása, mentése és publikálása a repóban. Csak a szükséges műveletek vannak
// benne. A fetch kicserélhető, így hálózat nélkül tesztelhető.

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

// A két ág módosításai nem fésülhetők össze automatikusan (ugyanazt a sort változtatták).
export class MergeConflictError extends Error {
  constructor() {
    super('Az ágak összefésülése ütközik.');
    this.name = 'MergeConflictError';
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
    if (raw === 'buffer') return Buffer.from(await response.arrayBuffer());
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

    // A fájl bájtjai (pl. kép) az adott ref-en, vagy null, ha nincs ilyen fájl.
    async readBuffer(path, ref) {
      try {
        return await request('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { raw: 'buffer' });
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

    // Két ág összehasonlítása: { aheadBy, behindBy, files }. aheadBy: a `head` ennyi commitja nincs a `base`-ben;
    // behindBy: a `base` ennyi commitja nincs a `head`-ben; files: a `head` nettó változásai a közös őstől.
    async compare(base, head) {
      const data = await request('GET', `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
      return { aheadBy: data.ahead_by, behindBy: data.behind_by, files: (data.files || []).map((f) => f.filename) };
    },

    // A `head` beolvasztása a `base` ágba (GitHub merge). Visszaad: az új commit sha-ja, vagy null, ha nincs mit.
    // Ütközésnél MergeConflictError.
    async mergeBranch(base, head, message) {
      try {
        const data = await request('POST', '/merges', { body: { base, head, commit_message: message } });
        return data ? data.sha : null;
      } catch (e) {
        if (e instanceof GithubError && e.status === 409) throw new MergeConflictError();
        throw e;
      }
    },

    // Publikálás: a `headSha` fája kerül a `branch` ágra egy összefésülő commitban ([baseSha, headSha] szülőkkel),
    // fast-forward nélkül, hogy a saját üzenetű commit mindig létrejöjjön (a havi számláló ezt számolja).
    // Előfeltétel: a headSha már tartalmazza a baseSha-t (a branch csúcsát, amit a hívó látott), különben a
    // baseSha tartalma elveszne. Ha a branch közben elmozdult, a frissítés nem fast-forward, ezért elutasított:
    // StaleBranchError.
    // deletes: a publikált fából törlendő fájlok (a már nem használt képek).
    async publishCommit({ branch, baseSha, headSha, message, deletes = [] }) {
      const head = await request('GET', `/git/commits/${headSha}`);
      let treeSha = head.tree.sha;
      if (deletes.length) {
        const tree = await request('POST', '/git/trees', {
          body: { base_tree: treeSha, tree: deletes.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })) },
        });
        treeSha = tree.sha;
      }
      const commit = await request('POST', '/git/commits', {
        body: { message, tree: treeSha, parents: [baseSha, headSha] },
      });
      try {
        await request('PATCH', `/git/refs/heads/${encodePath(branch)}`, { body: { sha: commit.sha, force: false } });
      } catch (e) {
        if (e instanceof GithubError && (e.status === 409 || e.status === 422)) {
          // elmozdult ág → elavult kérés; ha az ág nem mozdult, a frissítést valami más tiltja (pl. ágvédelem)
          if ((await api.getRef(branch)) !== baseSha) throw new StaleBranchError();
        }
        throw e;
      }
      return { sha: commit.sha };
    },

    // Az ág csúcsának átállítása. force: nem fast-forward átállítás is megengedett (pl. elvetés).
    async resetBranch(branch, sha, { force = true } = {}) {
      await request('PATCH', `/git/refs/heads/${encodePath(branch)}`, { body: { sha, force } });
      return sha;
    },

    // Az ág commitjainak üzenete egy időpont óta (legfeljebb 300 db), pl. a havi publikálások számolásához.
    async listCommitMessages(branch, sinceIso) {
      const out = [];
      for (let page = 1; page <= 3; page += 1) {
        const rows = await request(
          'GET',
          `/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
        );
        out.push(...rows.map((r) => r.commit.message));
        if (rows.length < 100) break;
      }
      return out;
    },
  };
  return api;
}

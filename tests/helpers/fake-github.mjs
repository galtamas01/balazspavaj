// Memóriában működő GitHub-szimulátor a CMS tesztekhez (git objektumok: blob, tree, commit, ref).
// Pontosan azokat a végpontokat érti, amelyeket a netlify/lib/github.mjs használ.
import { createHash } from 'node:crypto';

const sha1 = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex');
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export class FakeGitHub {
  constructor({ owner = 'galtamas01', repo = 'balazspavaj', files = {} } = {}) {
    this.prefix = `/repos/${owner}/${repo}`;
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.refs = new Map();
    this.calls = [];
    this.failNext = null;
    this.lastHeaders = null;
    this.counter = 0;

    const entries = new Map();
    for (const [path, content] of Object.entries(files)) {
      entries.set(path, { sha: this._blob(Buffer.from(content)), mode: '100644' });
    }
    this.refs.set('main', this._commit(this._tree(entries), [], 'initial'));
    this.fetch = this.fetch.bind(this);
  }

  _blob(buffer) {
    const sha = createHash('sha1').update(buffer).digest('hex');
    this.blobs.set(sha, buffer);
    return sha;
  }
  _tree(entries) {
    const lines = [...entries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => `${p}:${e.sha}:${e.mode}`);
    const sha = sha1('tree', ...lines);
    this.trees.set(sha, new Map(entries));
    return sha;
  }
  _commit(tree, parents, message) {
    const sha = sha1('commit', tree, ...parents, message, String(++this.counter));
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }
  _resolve(ref) {
    return this.refs.get(ref) ?? (this.commits.has(ref) ? ref : null);
  }
  _isAncestor(ancestor, of) {
    const stack = [of];
    const seen = new Set();
    while (stack.length) {
      const c = stack.pop();
      if (c === ancestor) return true;
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(...this.commits.get(c).parents);
    }
    return false;
  }

  // ---- ellenőrző segédek a tesztekhez ----
  head(branch) {
    return this.refs.get(branch) ?? null;
  }
  fileBuffer(ref, path) {
    const sha = this._resolve(ref);
    if (!sha) return null;
    const entry = this.trees.get(this.commits.get(sha).tree).get(path);
    return entry ? this.blobs.get(entry.sha) : null;
  }
  fileAt(ref, path) {
    return this.fileBuffer(ref, path)?.toString('utf8') ?? null;
  }
  message(ref) {
    return this.commits.get(this._resolve(ref)).message;
  }
  commitCount(branch) {
    let n = 0;
    let sha = this.head(branch);
    while (sha) {
      n += 1;
      sha = this.commits.get(sha).parents[0];
    }
    return n;
  }
  // Másik szerkesztő közvetlen commitja (ütközés szimulálásához). content === null → törlés.
  commitDirect(branch, changes) {
    const parent = this.head(branch);
    const entries = new Map(this.trees.get(this.commits.get(parent).tree));
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) entries.delete(path);
      else entries.set(path, { sha: this._blob(Buffer.from(content)), mode: '100644' });
    }
    const sha = this._commit(this._tree(entries), [parent], 'direct');
    this.refs.set(branch, sha);
    return sha;
  }

  // ---- a GitHub REST API ----
  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const path = decodeURIComponent(u.pathname).slice(this.prefix.length);
    this.calls.push(`${method} ${path}`);
    this.lastHeaders = init.headers;
    if (this.failNext) {
      const failure = this.failNext;
      this.failNext = null;
      return json(failure.status, { message: 'szimulált hiba' });
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    let m;

    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = this.refs.get(m[1]);
      return sha ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (this.refs.has(name)) return json(422, { message: 'Reference already exists' });
      if (!this.commits.has(body.sha)) return json(422, { message: 'Object does not exist' });
      this.refs.set(name, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === 'PATCH' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const current = this.refs.get(m[1]);
      if (!current) return json(404, { message: 'Not Found' });
      if (!this.commits.has(body.sha)) return json(422, { message: 'Object does not exist' });
      if (!body.force && !this._isAncestor(current, body.sha)) return json(422, { message: 'Update is not a fast forward' });
      this.refs.set(m[1], body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const commit = this.commits.get(m[1]);
      return commit
        ? json(200, { sha: m[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message })
        : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && path === '/git/commits') {
      if (!this.trees.has(body.tree) || !body.parents.every((p) => this.commits.has(p))) return json(422, { message: 'Invalid' });
      return json(201, { sha: this._commit(body.tree, body.parents, body.message) });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/([0-9a-f]+)$/))) {
      const tree = this.trees.get(m[1]);
      if (!tree) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: m[1],
        truncated: false,
        tree: [...tree].map(([p, e]) => ({ path: p, type: 'blob', sha: e.sha, mode: e.mode })),
      });
    }
    if (method === 'POST' && path === '/git/trees') {
      const entries = new Map(body.base_tree ? this.trees.get(body.base_tree) : []);
      for (const e of body.tree) {
        if (e.sha === null) {
          if (!entries.has(e.path)) return json(422, { message: 'GitRPC::BadObjectState' });
          entries.delete(e.path);
        } else if (e.content !== undefined) {
          entries.set(e.path, { sha: this._blob(Buffer.from(e.content, 'utf8')), mode: e.mode });
        } else {
          if (!this.blobs.has(e.sha)) return json(422, { message: 'Invalid blob' });
          entries.set(e.path, { sha: e.sha, mode: e.mode });
        }
      }
      return json(201, { sha: this._tree(entries) });
    }
    if (method === 'POST' && path === '/git/blobs') {
      const buffer = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content);
      return json(201, { sha: this._blob(buffer) });
    }
    if (method === 'GET' && (m = path.match(/^\/contents\/(.+)$/))) {
      const buffer = this.fileBuffer(u.searchParams.get('ref'), m[1]);
      return buffer ? new Response(buffer, { status: 200 }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: `Nem támogatott végpont: ${method} ${path}` });
  }
}

// Egy kis, formailag érvényes WebP-nek látszó bájtsor (RIFF....WEBP fejléc).
export function fakeWebp(seed = '', extra = 0) {
  return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(`VP8 ${seed}`), Buffer.alloc(extra)]);
}

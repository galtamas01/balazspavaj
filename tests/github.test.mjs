import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithub, GithubError, StaleBranchError } from '../netlify/lib/github.mjs';
import { getConfig } from '../netlify/lib/config.mjs';
import { ConfigError } from '../netlify/lib/auth.mjs';
import { FakeGitHub } from './helpers/fake-github.mjs';

const config = { token: 'titkos-token', owner: 'galtamas01', repo: 'balazspavaj' };

function setup(files = { 'a.txt': 'régi', 'assets/pavaje/x.webp': 'kep', 'assets/pavaje/y.webp': 'kep2', 'index.html': 'i' }) {
  const fake = new FakeGitHub({ files });
  return { fake, github: createGithub(config, fake.fetch) };
}

test('getRef: létező és hiányzó ág', async () => {
  const { fake, github } = setup();
  assert.equal(await github.getRef('main'), fake.head('main'));
  assert.equal(await github.getRef('nincs'), null);
});

test('ensureBranch: létrehozza a main állapotából, másodszor nem nyúl semmihez', async () => {
  const { fake, github } = setup();
  const sha = await github.ensureBranch('cms-draft', 'main');
  assert.equal(sha, fake.head('main'));
  assert.equal(fake.head('cms-draft'), sha);
  const before = fake.calls.length;
  assert.equal(await github.ensureBranch('cms-draft', 'main'), sha);
  assert.equal(fake.calls.slice(before).some((c) => c.startsWith('POST')), false);

  await assert.rejects(github.ensureBranch('uj', 'nincs-ilyen'), (e) => e instanceof GithubError && e.status === 404);
});

test('ensureBranch: egyidejű létrehozásnál a másodiknak sem hiba', async () => {
  const { fake, github } = setup();
  const [a, b] = await Promise.all([github.ensureBranch('cms-draft', 'main'), github.ensureBranch('cms-draft', 'main')]);
  assert.equal(a, b);
  assert.equal(fake.head('cms-draft'), a);
});

test('readFile: tartalom és 404 → null', async () => {
  const { fake, github } = setup();
  assert.equal(await github.readFile('a.txt', 'main'), 'régi');
  assert.equal(await github.readFile('a.txt', fake.head('main')), 'régi', 'commit sha-val is');
  assert.equal(await github.readFile('nincs.txt', 'main'), null);
});

test('listFiles: csak a mappa alatti fájlok', async () => {
  const { fake, github } = setup();
  assert.deepEqual((await github.listFiles(fake.head('main'), 'assets/pavaje')).sort(), ['assets/pavaje/x.webp', 'assets/pavaje/y.webp']);
  assert.deepEqual(await github.listFiles(fake.head('main'), 'assets/pav'), [], 'részleges mappanév nem találat');
});

test('commitFiles: szöveg, bináris, törlés egyetlen commitban', async () => {
  const { fake, github } = setup();
  const base = await github.ensureBranch('cms-draft', 'main');
  const result = await github.commitFiles({
    branch: 'cms-draft',
    baseSha: base,
    writes: [
      { path: 'a.txt', text: 'új' },
      { path: 'assets/pavaje/z.webp', base64: Buffer.from('binaris').toString('base64') },
    ],
    deletes: ['assets/pavaje/x.webp'],
    message: 'CMS: teszt',
  });
  assert.equal(result.changed, true);
  assert.equal(fake.head('cms-draft'), result.sha);
  assert.equal(fake.commitCount('cms-draft'), fake.commitCount('main') + 1);
  assert.equal(fake.message('cms-draft'), 'CMS: teszt');
  assert.equal(fake.fileAt('cms-draft', 'a.txt'), 'új');
  assert.equal(fake.fileAt('cms-draft', 'assets/pavaje/z.webp'), 'binaris');
  assert.equal(fake.fileAt('cms-draft', 'assets/pavaje/x.webp'), null);
  assert.equal(fake.fileAt('cms-draft', 'assets/pavaje/y.webp'), 'kep2', 'érintetlen fájl marad');
  assert.equal(fake.fileAt('main', 'a.txt'), 'régi', 'a main nem változik');
});

test('commitFiles: ha nincs valódi változás, nem készül commit', async () => {
  const { fake, github } = setup();
  const base = await github.ensureBranch('cms-draft', 'main');
  const result = await github.commitFiles({ branch: 'cms-draft', baseSha: base, writes: [{ path: 'a.txt', text: 'régi' }], message: 'CMS: semmi' });
  assert.deepEqual(result, { sha: base, changed: false });
  assert.equal(fake.head('cms-draft'), base);
});

test('commitFiles: elmozdult ág esetén StaleBranchError, nem íródik felül semmi', async () => {
  const { fake, github } = setup();
  const base = await github.ensureBranch('cms-draft', 'main');
  const other = fake.commitDirect('cms-draft', { 'masik.txt': 'valaki más' });
  await assert.rejects(
    github.commitFiles({ branch: 'cms-draft', baseSha: base, writes: [{ path: 'a.txt', text: 'enyém' }], message: 'CMS: x' }),
    StaleBranchError,
  );
  assert.equal(fake.head('cms-draft'), other);
  assert.equal(fake.fileAt('cms-draft', 'a.txt'), 'régi');
});

test('commitFiles: nem létező fájl törlése GithubError', async () => {
  const { github } = setup();
  const base = await github.ensureBranch('cms-draft', 'main');
  await assert.rejects(github.commitFiles({ branch: 'cms-draft', baseSha: base, deletes: ['nincs.txt'], message: 'x' }), (e) => e instanceof GithubError && e.status === 422);
});

test('hitelesítés: a token a fejlécben megy, a hibaüzenetben nem szerepel', async () => {
  const { fake, github } = setup();
  await github.getRef('main');
  assert.equal(fake.lastHeaders.Authorization, 'Bearer titkos-token');
  assert.equal(fake.lastHeaders['X-GitHub-Api-Version'], '2022-11-28');

  fake.failNext = { status: 401 };
  await assert.rejects(github.getRef('main'), (e) => e instanceof GithubError && e.status === 401 && !e.message.includes('titkos-token'));
});

test('config: GITHUB_TOKEN kötelező, a többi alapértelmezett', () => {
  assert.throws(() => getConfig({}), ConfigError);
  const c = getConfig({ GITHUB_TOKEN: 't' });
  assert.deepEqual(
    { owner: c.owner, repo: c.repo, main: c.mainBranch, draft: c.draftBranch, products: c.productsPath, colors: c.colorsPath, assets: c.assetsDir },
    { owner: 'galtamas01', repo: 'balazspavaj', main: 'main', draft: 'cms-draft', products: 'produse/products.json', colors: 'produse/colors.json', assets: 'assets/pavaje' },
  );
  assert.equal(getConfig({ GITHUB_TOKEN: 't', DRAFT_BRANCH: 'x' }).draftBranch, 'x');
  assert.equal(c.previewUrl, 'https://cms-draft--balazspavaj.netlify.app');
  assert.equal(getConfig({ GITHUB_TOKEN: 't', PREVIEW_URL: 'https://x.example///' }).previewUrl, 'https://x.example');
});

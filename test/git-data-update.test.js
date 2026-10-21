'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceOf, readGitIndex, updateFromGit, extractSnapshot } = require('../scripts/git-data-cli');
const runtimeId = 'a'.repeat(64), dataId = 'b'.repeat(64), commit = 'c'.repeat(40);
const sourceUrl = 'https://raw.githubusercontent.com/example/data/main/apollo/data-packages/current.json';
const archiveBytes = Buffer.from('corrupt snapshot');
const index = { schemaVersion: 'apollo.git-data-index.v1', runtimeId,
  snapshot: { path: 'apollo/data-packages/r1/contracts.tgz', dataId, sha256: 'd'.repeat(64), bytes: archiveBytes.length } };
function transport(document = index) {
  const calls = [];
  return { calls, request: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/git/ref/')) return Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: commit } });
    assert.ok(url.endsWith('?ref=' + commit));
    return url.includes('current.json') ? Response.json(document) : new Response(archiveBytes);
  } };
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-git-data-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src/data-release'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/data-release/index.js'),
    'exports.readRuntime=()=>({id:' + JSON.stringify(runtimeId) + '});exports.publicStatus=(state,extra)=>({...state,...extra});');
  return root;
}

test('Git source is restricted to a repository index and rejects credentials/traversal/other origins', () => {
  assert.equal(sourceOf(sourceUrl).repo, 'data');
  for (const url of ['http://raw.githubusercontent.com/x/y/main/a.json', 'https://example.com/x/y/main/a.json',
    'https://token@raw.githubusercontent.com/x/y/main/a.json', sourceUrl + '?token=secret']) assert.throws(() => sourceOf(url));
});

test('index and archive URLs are pinned to the resolved commit; incompatible runtime is refused', async () => {
  const network = transport();
  assert.equal((await readGitIndex(sourceUrl, runtimeId, undefined, network.request)).commit, commit);
  assert.equal(network.calls.length, 2);
  assert.match(network.calls[1].url, new RegExp('ref=' + commit + '$'));
  assert.equal(network.calls[1].options.headers.Accept, 'application/vnd.github.raw+json');
  await assert.rejects(readGitIndex(sourceUrl, 'e'.repeat(64), undefined, transport().request), /incompatible/);
});

test('check/no-op fetches only Git metadata and never downloads the archive', async t => {
  const root = await fixture(t), network = transport();
  const settings = { storeRoot: root, runtimeRoot: root };
  const ensured = { state: { current: { dataId, contentVersion: 'old' } } };
  const result = await updateFromGit({ settings, ensured, url: sourceUrl, command: 'update', producerRoot: root, request: network.request });
  assert.equal(result.updateAvailable, false);
  assert.equal(network.calls.length, 2);
  assert.deepEqual(await fs.readdir(root), ['src']);
});

test('bad archive integrity refuses installation and removes temporary downloads', async t => {
  const root = await fixture(t), network = transport();
  const settings = { storeRoot: root, runtimeRoot: root };
  const ensured = { state: { current: { dataId: 'old', contentVersion: 'old' } } };
  await assert.rejects(updateFromGit({ settings, ensured, url: sourceUrl, command: 'update', producerRoot: root, request: network.request }), /checksum/);
  assert.equal(ensured.state.current.dataId, 'old');
  assert.deepEqual(await fs.readdir(root), ['src']);
});

test('archive extraction excludes AppleDouble and refuses symlinks', async t => {
  const root = await fixture(t), source = path.join(root, 'source'), out = path.join(root, 'out'), archive = path.join(root, 'snapshot.tgz');
  await fs.mkdir(source); await fs.mkdir(out);
  await fs.writeFile(path.join(source, 'manifest.json'), '{}');
  await fs.writeFile(path.join(source, '._manifest.json'), 'metadata');
  const pack = () => execFileSync('/usr/bin/tar', ['-czf', archive, '-C', source, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  pack(); extractSnapshot(archive, out);
  assert.equal(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'), '{}');
  await assert.rejects(fs.stat(path.join(out, '._manifest.json')), { code: 'ENOENT' });
  await fs.symlink('/tmp', path.join(source, 'escape')); pack();
  assert.throws(() => extractSnapshot(archive, out), /regular files/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const release = require('../src/data-release');
const { manifestChecksum } = require('../scripts/build-knowledge-package');
const { ENGINE_VERSION, sha256File } = require('../src/knowledge-package');
const { readDataIndex } = require('../src/data-packages/artifacts');
const { parse, runCommand } = require('../scripts/data-release-cli');

function put(root, file, body) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof body === 'string' ? body : JSON.stringify(body));
}
function pins(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else { const bytes = fs.readFileSync(file); result.push({ file: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length, sha256: release.sha(bytes) }); }
    }
  }
  walk(root); return result.sort((a, b) => a.file.localeCompare(b.file));
}
function fixture(t, naming = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-data-release-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'code'), storeRoot = path.join(root, 'installed');
  put(runtimeRoot, 'dist/runtime.cjs', '// Synthetic code fixture, never executed\n');
  if (naming) for (const file of ['skills/figma-layer-name-hygiene/profile.json', 'skills/figma-layer-name-hygiene/SKILL.md', 'src/skills/layer-names/protocol.js']) {
    put(runtimeRoot, file, fs.readFileSync(path.join(process.env.APOLLO_PROJECT_ROOT || path.resolve(__dirname, '../../../projects/Apollo'), file)).toString());
  }
  const runtime = { schemaVersion: release.RUNTIME_SCHEMA, profileVersion: '0.4.1', nativeSourceHash: 'a'.repeat(64), files: pins(runtimeRoot) };
  runtime.id = release.idOf(runtime); put(runtimeRoot, 'portable-runtime.json', runtime);
  function make(version) {
    const packageRoot = path.join(root, version, 'package'), k = path.join(packageRoot, 'knowledge');
    const files = {
      'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json': { schemaVersion: 2, packages: [{ componentKey: 'fixture' }] },
      'data/design-system_ab/JSONS/apollo/designPatternRules.json': { rules: [] },
      'data/design-system_ab/redpolrules/dictionary.json': { rules: [] },
      'data/ds-ai-hub/products/ab/components/fixture/meta.json': { label: version },
      'data/ds-ai-hub/core/web/components/fixture/meta.json': {},
    };
    for (const [file, data] of Object.entries(files)) put(k, file, data);
    const artifacts = pins(k).map(p => ({ path: p.file, size: p.bytes, sha256: p.sha256 }));
    const knowledge = { schemaVersion: 'apollo.knowledge-package.v1', channel: 'stable', contentVersion: version,
      generatedAt: '2026-10-20T00:00:00Z', sourceCommits: { 'design-system_ab': '1'.repeat(40), 'ds-ai-hub': '2'.repeat(40) },
      engineCompatibility: { min: ENGINE_VERSION, max: ENGINE_VERSION }, artifacts, artifactCount: artifacts.length,
      totalBytes: artifacts.reduce((n, a) => n + a.size, 0), checksum: manifestChecksum(artifacts) };
    put(k, 'manifest.json', knowledge); put(k, 'package.json', { name: '@apollo/knowledge', version: '0.0.0-fixture' });
    const index = { schemaVersion: 'apollo.data-index.v1', profileVersion: runtime.profileVersion, contracts: [{ componentId: version }], Ready: false };
    index.id = release.idOf(index); put(packageRoot, 'contracts/manifest.json', index);
    const manifest = { schemaVersion: release.RELEASE_SCHEMA, generatedAt: knowledge.generatedAt, knowledgeVersion: version,
      dataId: index.id, runtimeId: runtime.id, profileVersion: runtime.profileVersion, nativeSourceHash: runtime.nativeSourceHash,
      sourceCommits: knowledge.sourceCommits, files: pins(packageRoot) };
    manifest.id = release.idOf(manifest); put(packageRoot, 'manifest.json', manifest);
    return { packageRoot, manifest };
  }
  const seed = make('seed');
  // Transport tests isolate B: real production installed-data validation is exercised only after its source freeze.
  const validateData = root => {
    const value = readDataIndex(root), bytes = fs.readFileSync(path.join(root, 'manifest.json'));
    return { index: value.index, assertCurrent() { assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.json')), bytes); } };
  };
  const options = { storeRoot, seedRoot: seed.packageRoot, runtimeRoot, validateData };
  async function archive(value) {
    const file = path.join(root, value.manifest.knowledgeVersion + '.tgz');
    execFileSync('/usr/bin/tar', ['-czf', file, '-C', path.dirname(value.packageRoot), 'package']);
    return { tarballPath: file, expectedIntegrity: 'sha256-' + Buffer.from(await sha256File(file), 'hex').toString('base64'), expectedContentVersion: value.manifest.id };
  }
  return { root, runtimeRoot, runtime, storeRoot, make, seed, options, archive };
}

function refreshInventory(value) {
  value.manifest.files = pins(value.packageRoot).filter(pin => pin.file !== 'manifest.json');
  value.manifest.id = release.idOf(value.manifest);
  put(value.packageRoot, 'manifest.json', value.manifest);
  return value;
}
function skillRelease(f, label) {
  const value = { packageRoot: path.join(f.root, label, 'package'), manifest: structuredClone(f.seed.manifest) };
  fs.cpSync(f.seed.packageRoot, value.packageRoot, { recursive: true });
  const folder = 'skills/figma-layer-name-hygiene/', profile = JSON.parse(fs.readFileSync(path.join(f.runtimeRoot, folder, 'profile.json')));
  const instructions = fs.readFileSync(path.join(f.runtimeRoot, folder, 'SKILL.md'), 'utf8') + '\nREMOTE_NAMING_RULE_FIXTURE\n';
  profile.version = '0.1.1';
  profile.files[0].bytes = Buffer.byteLength(instructions); profile.files[0].sha256 = release.sha(Buffer.from(instructions));
  put(value.packageRoot, folder + 'SKILL.md', instructions); put(value.packageRoot, folder + 'profile.json', profile);
  return refreshInventory(value);
}
async function namingEndpoint(t, f, releaseRoot) {
  const express = require('express'), app = express(), prompts = [];
  app.use(express.json());
  require('../src/skills/layer-names').mountLayerNameRoutes(app, {
    apolloRoot: f.runtimeRoot, releaseRoot,
    plan: async prompt => { prompts.push(prompt); return { changes: [] }; },
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeIdleConnections?.(); server.close(resolve); }));
  return { prompts, async call() {
    const snapshot = { schemaVersion: 'apollo.layer-names.v1', snapshotId: 'owned-fixture', pageId: '1:1', rootIds: ['2:1'], scopeName: 'Owned fixture', observedCount: 1, skippedCount: 0,
      nodes: [{ nodeId: '2:1', type: 'FRAME', parentId: '1:1', oldName: 'Frame 1', path: 'Frame 1', texts: ['Delivery'] }] };
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/skills/layer-names/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'owned-request', snapshot }),
    });
    return { status: response.status, body: await response.json() };
  } };
}

test('one pointer updates knowledge and installed contracts together, preserves admitted bytes and rolls back', async t => {
  const f = fixture(t), first = await release.ensureStore(f.options);
  assert.equal(first.state.current.contentVersion, f.seed.manifest.id);
  assert.equal(first.state.current.path, path.join(f.storeRoot, 'versions', f.seed.manifest.id));
  const frozen = fs.readFileSync(path.join(first.state.current.path, 'contracts/manifest.json'));
  const v2 = f.make('next'), installed = await release.installTarball({ ...f.options, ...await f.archive(v2) });
  const status = release.publicStatus(installed);
  assert.equal(status.current.contentVersion, v2.manifest.id);
  assert.equal(status.previous.contentVersion, f.seed.manifest.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(status.dataRoot, 'manifest.json'))).id, v2.manifest.dataId);
  assert.match(status.designSystemRoot, /knowledge\/data\/design-system_ab$/);
  assert.deepEqual(fs.readFileSync(path.join(first.state.current.path, 'contracts/manifest.json')), frozen);
  const back = await release.rollbackStore(f.options);
  assert.equal(back.current.contentVersion, f.seed.manifest.id);
  assert.equal(back.previous.contentVersion, v2.manifest.id);
  assert.equal((await release.ensureStore(f.options)).state.current.contentVersion, f.seed.manifest.id);
});

test('bad integrity, incompatible code, corrupt artifacts and descriptor mismatch never change current', async t => {
  const f = fixture(t); await release.ensureStore(f.options);
  const value = f.make('incoming'), archive = await f.archive(value), state = fs.readFileSync(path.join(f.storeRoot, 'state.json'));
  await assert.rejects(release.installTarball({ ...f.options, ...archive, expectedIntegrity: 'sha256-' + 'A'.repeat(43) + '=' }), { code: 'DATA_RELEASE_INTEGRITY_INVALID' });
  await assert.rejects(release.installTarball({ ...f.options, ...archive, expectedContentVersion: 'b'.repeat(64) }), { code: 'DATA_RELEASE_DESCRIPTOR_MISMATCH' });
  value.manifest.capabilities = { frontend: false }; value.manifest.id = release.idOf(value.manifest); put(value.packageRoot, 'manifest.json', value.manifest);
  await assert.rejects(release.installTarball({ ...f.options, ...await f.archive(value) }), { code: 'DATA_RELEASE_PROFILE_MISMATCH' });
  delete value.manifest.capabilities;
  value.manifest.runtimeId = 'b'.repeat(64); value.manifest.id = release.idOf(value.manifest); put(value.packageRoot, 'manifest.json', value.manifest);
  await assert.rejects(release.installTarball({ ...f.options, ...await f.archive(value) }), { code: 'DATA_RELEASE_RUNTIME_INCOMPATIBLE' });
  value.manifest.runtimeId = f.runtime.id; value.manifest.id = release.idOf(value.manifest); put(value.packageRoot, 'manifest.json', value.manifest);
  fs.appendFileSync(path.join(value.packageRoot, 'contracts/manifest.json'), ' ');
  await assert.rejects(release.installTarball({ ...f.options, ...await f.archive(value) }), { code: 'DATA_RELEASE_ARTIFACT_CHANGED' });
  assert.deepEqual(fs.readFileSync(path.join(f.storeRoot, 'state.json')), state);
});

test('offline/corrupt-current recovery returns a complete previous release and never changes its immutable version', async t => {
  const f = fixture(t); await release.ensureStore(f.options);
  const v2 = f.make('next'), installed = await release.installTarball({ ...f.options, ...await f.archive(v2) });
  const offline = await release.ensureStore(f.options); assert.equal(offline.recovered, false);
  fs.appendFileSync(path.join(installed.current.path, 'contracts/manifest.json'), ' ');
  const recovered = await release.ensureStore(f.options);
  assert.equal(recovered.recovered, true); assert.equal(recovered.state.current.contentVersion, f.seed.manifest.id);
  assert.equal(fs.existsSync(installed.current.path), true);
});

test('embedded seed is preserved outside the app code before a subsequent app replacement', async t => {
  const f = fixture(t), initial = await release.ensureStore(f.options);
  fs.rmSync(f.seed.packageRoot, { recursive: true });
  const after = await release.ensureStore(f.options);
  assert.equal(after.recovered, false);
  assert.equal(after.state.current.path, initial.state.current.path);
  assert.equal(after.state.current.contentVersion, f.seed.manifest.id);
  await release.validateRelease(after.state.current.path, f.options);
});

test('unexpected code, unsafe references, symlink ancestry and mutated runtime are rejected', async t => {
  const f = fixture(t), v = f.make('extra');
  put(v.packageRoot, 'contracts/evil.js', 'throw Error("must not run")');
  await assert.rejects(release.validateRelease(v.packageRoot, f.options), { code: 'DATA_RELEASE_INVENTORY_INVALID' });
  fs.unlinkSync(path.join(v.packageRoot, 'contracts/evil.js'));
  v.manifest.files[0].file = '../outside.json'; v.manifest.id = release.idOf(v.manifest); put(v.packageRoot, 'manifest.json', v.manifest);
  await assert.rejects(release.validateRelease(v.packageRoot, f.options), { code: 'DATA_RELEASE_EXECUTABLE_FORBIDDEN' });
  const other = f.make('symlink');
  fs.renameSync(path.join(other.packageRoot, 'contracts'), path.join(other.packageRoot, 'real-contracts'));
  fs.symlinkSync('real-contracts', path.join(other.packageRoot, 'contracts'));
  await assert.rejects(release.validateRelease(other.packageRoot, f.options), { code: 'DATA_RELEASE_ARTIFACT_CHANGED' });
  fs.appendFileSync(path.join(f.runtimeRoot, 'dist/runtime.cjs'), '// drift');
  assert.throws(() => release.readRuntime(f.runtimeRoot), { code: 'DATA_RELEASE_ARTIFACT_CHANGED' });
});

test('an interrupted updater lock is recoverable; a live updater is never stolen', async t => {
  const f = fixture(t); await release.ensureStore(f.options);
  const lock = path.join(f.storeRoot, '.update.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(release.ensureStore(f.options), { code: 'DATA_RELEASE_BUSY' }); fs.unlinkSync(lock);
  execFileSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}))', lock]);
  fs.mkdirSync(path.join(f.storeRoot, '.staging-interrupted')); put(f.storeRoot, '.staging-interrupted/partial.txt', 'partial');
  assert.equal((await release.ensureStore(f.options)).state.current.contentVersion, f.seed.manifest.id);
  assert.equal(fs.existsSync(lock), false);
});

test('descriptor pins compatible runtime and HTTPS; CLI has no authoring/skip-validation option', t => {
  const f = fixture(t), d = { schemaVersion: release.CHANNEL_SCHEMA, channel: 'stable', contentVersion: f.seed.manifest.id,
    tarballUrl: 'https://example.test/releases/data.tgz', tarballIntegrity: 'sha256-' + 'A'.repeat(43) + '=', runtimeId: f.runtime.id };
  assert.equal(release.validateDescriptor(d, f.runtime), d);
  assert.throws(() => release.validateDescriptor({ ...d, tarballUrl: 'http://example.test/data' }, f.runtime), { code: 'DATA_RELEASE_DESCRIPTOR_INVALID' });
  assert.throws(() => release.validateDescriptor({ ...d, runtimeId: 'b'.repeat(64) }, f.runtime), { code: 'DATA_RELEASE_RUNTIME_INCOMPATIBLE' });
  assert.equal(parse(['update', '--store', '/installed', '--seed', '/seed', '--runtime', '/code']).command, 'update');
  assert.throws(() => parse(['update', '--skip-validation', '1']));
});

test('remote CLI checks, downloads, validates and rolls back; offline/error keeps current and cleans download', async t => {
  const f = fixture(t), next = f.make('remote'), archive = await f.archive(next);
  const originals = { fetch: global.fetch, ensureStore: release.ensureStore, installTarball: release.installTarball, rollbackStore: release.rollbackStore };
  const token = process.env.APOLLO_DATA_TOKEN;
  t.after(() => {
    global.fetch = originals.fetch;
    for (const key of ['ensureStore', 'installTarball', 'rollbackStore']) release[key] = originals[key];
    if (token === undefined) delete process.env.APOLLO_DATA_TOKEN; else process.env.APOLLO_DATA_TOKEN = token;
  });
  for (const key of ['ensureStore', 'installTarball', 'rollbackStore']) release[key] = options => originals[key]({ ...options, validateData: f.options.validateData });
  const descriptor = { schemaVersion: release.CHANNEL_SCHEMA, channel: 'stable', contentVersion: next.manifest.id,
    runtimeId: f.runtime.id, tarballUrl: 'https://example.test/release.tgz', tarballIntegrity: archive.expectedIntegrity };
  const calls = [];
  const response = (url, body) => {
    const value = new Response(body);
    Object.defineProperty(value, 'url', { value: String(url) });
    return value;
  };
  process.env.APOLLO_DATA_TOKEN = 'own-test-token';
  global.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.headers.Authorization, 'Bearer own-test-token');
    return new URL(url).pathname.endsWith('.json') ? response(url, JSON.stringify(descriptor)) : response(url, fs.readFileSync(archive.tarballPath));
  };
  const options = { store: f.storeRoot, seed: f.seed.packageRoot, runtime: f.runtimeRoot, descriptor: 'https://example.test/stable.json' };
  assert.equal((await runCommand('check', options)).updateAvailable, true);
  assert.equal(calls.length, 1);
  assert.equal((await runCommand('update', options)).current.contentVersion, next.manifest.id);
  assert.equal((await runCommand('check', options)).updateAvailable, false);
  assert.equal(calls.filter(url => new URL(url).pathname.endsWith('.tgz')).length, 1);
  const before = fs.readFileSync(path.join(f.storeRoot, 'state.json'));
  global.fetch = async () => { throw Error('offline'); };
  await assert.rejects(runCommand('check', options), /offline/);
  assert.deepEqual(fs.readFileSync(path.join(f.storeRoot, 'state.json')), before);
  await runCommand('rollback', options);
  global.fetch = async url => new URL(url).pathname.endsWith('.json') ? response(url, JSON.stringify(descriptor)) : response(url, 'damaged archive');
  await assert.rejects(runCommand('update', options), { code: 'DATA_RELEASE_INTEGRITY_INVALID' });
  assert.equal((await runCommand('status', options)).current.contentVersion, f.seed.manifest.id);
  assert.equal(fs.readdirSync(f.storeRoot).some(file => file.startsWith('.download-')), false);
});

test('remote instructions update the actual naming endpoint on unchanged code; offline and rollback keep admitted versions', async t => {
  const f = fixture(t, true), first = await release.ensureStore(f.options);
  const { loadSkill } = require('../src/skills/layer-names');
  const old = loadSkill(f.runtimeRoot, { releaseRoot: first.state.current.path });
  const before = await (await namingEndpoint(t, f, first.state.current.path)).call();
  assert.equal(before.status, 200); assert.equal(before.body.skill.version, '0.1.0');
  const code = fs.readFileSync(path.join(f.runtimeRoot, 'portable-runtime.json'));
  const next = skillRelease(f, 'remote-skill'), archive = await f.archive(next);
  assert.equal(next.manifest.dataId, f.seed.manifest.dataId);
  assert.equal(next.manifest.knowledgeVersion, f.seed.manifest.knowledgeVersion);
  const originalFetch = global.fetch, originalEnsure = release.ensureStore, originalInstall = release.installTarball;
  t.after(() => { global.fetch = originalFetch; release.ensureStore = originalEnsure; release.installTarball = originalInstall; });
  release.ensureStore = options => originalEnsure({ ...options, validateData: f.options.validateData });
  release.installTarball = options => originalInstall({ ...options, validateData: f.options.validateData });
  const descriptor = { schemaVersion: release.CHANNEL_SCHEMA, channel: 'stable', contentVersion: next.manifest.id,
    runtimeId: f.runtime.id, tarballUrl: 'https://example.test/immutable-skill.tgz', tarballIntegrity: archive.expectedIntegrity };
  global.fetch = async url => {
    const response = new Response(new URL(url).pathname.endsWith('.json') ? JSON.stringify(descriptor) : fs.readFileSync(archive.tarballPath));
    Object.defineProperty(response, 'url', { value: String(url) }); return response;
  };
  const options = { store: f.storeRoot, seed: f.seed.packageRoot, runtime: f.runtimeRoot, descriptor: 'https://example.test/stable.json' };
  const updated = await runCommand('update', options);
  global.fetch = originalFetch;
  const endpoint = await namingEndpoint(t, f, updated.releaseRoot), result = await endpoint.call();
  assert.equal(result.status, 200); assert.equal(result.body.skill.version, '0.1.1');
  assert.match(endpoint.prompts[0], /REMOTE_NAMING_RULE_FIXTURE/);
  assert.equal(result.body.skill.sha256, release.sha(fs.readFileSync(path.join(updated.releaseRoot, 'skills/figma-layer-name-hygiene/profile.json'))));
  assert.deepEqual(fs.readFileSync(path.join(f.runtimeRoot, 'portable-runtime.json')), code);
  assert.equal(release.readRuntime(f.runtimeRoot).id, f.runtime.id); old.assertCurrent();
  const state = fs.readFileSync(path.join(f.storeRoot, 'state.json'));
  global.fetch = async () => { throw Error('offline'); };
  await assert.rejects(runCommand('check', options), /offline/);
  assert.deepEqual(fs.readFileSync(path.join(f.storeRoot, 'state.json')), state);
  global.fetch = originalFetch;
  assert.equal((await endpoint.call()).body.skill.version, '0.1.1');
  const back = await release.rollbackStore(f.options), restored = await namingEndpoint(t, f, back.current.path);
  assert.equal((await restored.call()).body.skill.version, '0.1.0');
  assert.doesNotMatch(restored.prompts[0], /REMOTE_NAMING_RULE_FIXTURE/);
  loadSkill(f.runtimeRoot, { releaseRoot: updated.releaseRoot }).assertCurrent();
});

test('a declared missing, stale or incompatible skill never replaces current or falls back silently', async t => {
  const f = fixture(t, true); await release.ensureStore(f.options);
  const before = fs.readFileSync(path.join(f.storeRoot, 'state.json')), folder = 'skills/figma-layer-name-hygiene/';
  const variants = [
    ['missing-profile', root => fs.unlinkSync(path.join(root, folder, 'profile.json')), 'LAYER_NAMES_SKILL_UNAVAILABLE'],
    ['missing-instructions', root => fs.unlinkSync(path.join(root, folder, 'SKILL.md')), 'LAYER_NAMES_SKILL_UNAVAILABLE'],
    ['stale-instructions', root => fs.appendFileSync(path.join(root, folder, 'SKILL.md'), '\nChanged'), 'LAYER_NAMES_SKILL_STALE'],
    ['incompatible-protocol', root => { const file = path.join(root, folder, 'profile.json'), profile = JSON.parse(fs.readFileSync(file)); profile.files[1].sha256 = 'f'.repeat(64); put(root, folder + 'profile.json', profile); }, 'LAYER_NAMES_SKILL_STALE'],
    ['unsupported-profile', root => { const profile = JSON.parse(fs.readFileSync(path.join(root, folder, 'profile.json'))); profile.schemaVersion = 'unsupported'; put(root, folder + 'profile.json', profile); }, 'LAYER_NAMES_SKILL_UNAVAILABLE'],
    ['invalid-version', root => { const profile = JSON.parse(fs.readFileSync(path.join(root, folder, 'profile.json'))); profile.version = ['0.1.1']; put(root, folder + 'profile.json', profile); }, 'LAYER_NAMES_SKILL_UNAVAILABLE'],
  ];
  for (const [label, change, code] of variants) {
    const value = skillRelease(f, label); change(value.packageRoot); refreshInventory(value);
    await assert.rejects(release.installTarball({ ...f.options, ...await f.archive(value) }), { code });
    assert.deepEqual(fs.readFileSync(path.join(f.storeRoot, 'state.json')), before);
    const endpoint = await namingEndpoint(t, f, value.packageRoot);
    assert.equal((await endpoint.call()).status, 503); assert.equal(endpoint.prompts.length, 0);
  }
});

test('changing even a consistently repinned release invalidates an already admitted skill', t => {
  const f = fixture(t, true), value = skillRelease(f, 'admitted');
  const skill = require('../src/skills/layer-names').loadSkill(f.runtimeRoot, { releaseRoot: value.packageRoot });
  const folder = 'skills/figma-layer-name-hygiene/', profile = JSON.parse(fs.readFileSync(path.join(value.packageRoot, folder, 'profile.json')));
  const text = 'Changed instructions with valid new hashes';
  profile.version = '0.1.2'; profile.files[0].bytes = Buffer.byteLength(text); profile.files[0].sha256 = release.sha(Buffer.from(text));
  put(value.packageRoot, folder + 'SKILL.md', text); put(value.packageRoot, folder + 'profile.json', profile); refreshInventory(value);
  assert.throws(() => skill.assertCurrent(), { code: 'LAYER_NAMES_SKILL_STALE' });
});

test('skill payloads cannot deliver executable code or choose arbitrary files', async t => {
  const f = fixture(t, true); await release.ensureStore(f.options);
  const state = fs.readFileSync(path.join(f.storeRoot, 'state.json'));
  for (const [label, file] of [['script', 'skills/figma-layer-name-hygiene/protocol.js'], ['other', 'skills/unrelated/profile.json']]) {
    const value = skillRelease(f, label); put(value.packageRoot, file, 'throw Error("EXECUTED_DATA")'); refreshInventory(value);
    await assert.rejects(release.installTarball({ ...f.options, ...await f.archive(value) }), { code: 'DATA_RELEASE_EXECUTABLE_FORBIDDEN' });
    assert.deepEqual(fs.readFileSync(path.join(f.storeRoot, 'state.json')), state);
  }
});

test('publisher builds and installs pinned source instructions against the existing portable runtime without rebuilding it', async t => {
  const f = fixture(t, true), apolloRoot = process.env.APOLLO_PROJECT_ROOT || path.resolve(__dirname, '../../../projects/Apollo');
  const runtimeRoot = path.join(f.root, 'portable');
  require('../scripts/build-portable-runtime').buildPortableRuntime({ apolloRoot, output: runtimeRoot });
  const code = fs.readFileSync(path.join(runtimeRoot, 'portable-runtime.json'));
  const runtime = require(path.join(apolloRoot, 'dist/runtime.cjs'));
  const core = require(path.join(apolloRoot, 'packages/component-contract-core/dist/core.cjs'));
  const source = require(path.join(apolloRoot, 'tests/authoring-fixtures')).source();
  const contract = runtime.loadAuthoringSource(source).contract, zip = path.join(f.root, 'owned-contract.zip');
  fs.writeFileSync(zip, core.createZip([core.textZipEntry('contract.manual.json', source.manual), core.textZipEntry('compiled/component-contract.v2.json', contract)]));
  const dataRoot = path.join(f.root, 'actual-data');
  await require('../scripts/import-data-package').importDataPackage({ root: dataRoot, apolloRoot, packages: [zip] });
  const { buildDataRelease } = require('../scripts/build-data-release');
  const options = { dataRoot, knowledgeRoot: path.join(f.seed.packageRoot, 'knowledge'), runtimeRoot,
    tarballUrl: 'https://example.test/releases/{version}/apollo-data.tgz' };
  const bundled = await buildDataRelease({ ...options, output: path.join(f.root, 'bundled-release') });
  const selected = skillRelease(f, 'pinned-source');
  const updated = await buildDataRelease({ ...options, skillsRoot: path.join(selected.packageRoot, 'skills'), output: path.join(f.root, 'updated-release') });
  assert.equal(updated.manifest.runtimeId, bundled.manifest.runtimeId);
  assert.equal(updated.manifest.dataId, bundled.manifest.dataId);
  assert.equal(updated.manifest.knowledgeVersion, bundled.manifest.knowledgeVersion);
  assert.deepEqual(fs.readFileSync(path.join(runtimeRoot, 'portable-runtime.json')), code);
  assert.deepEqual(updated.manifest.files.filter(pin => pin.file.startsWith('skills/')).map(pin => pin.file).sort(),
    ['skills/figma-layer-name-hygiene/SKILL.md', 'skills/figma-layer-name-hygiene/profile.json']);
  const settings = { runtimeRoot, seedRoot: bundled.packageRoot, storeRoot: path.join(f.root, 'actual-store') };
  await release.ensureStore(settings);
  const state = await release.installTarball({ ...settings, tarballPath: updated.tarballPath,
    expectedIntegrity: updated.descriptor.tarballIntegrity, expectedContentVersion: updated.manifest.id });
  const { loadSkill } = require('../src/skills/layer-names'), skill = loadSkill(runtimeRoot, { releaseRoot: state.current.path });
  assert.equal(skill.version, '0.1.1'); assert.match(skill.instructions, /REMOTE_NAMING_RULE_FIXTURE/); skill.assertCurrent();
  const restored = await release.rollbackStore(settings);
  assert.equal(loadSkill(runtimeRoot, { releaseRoot: restored.current.path }).version, '0.1.0');
  // The agent-loop policy is data too; the accepted v1 runtime stays byte-identical.
  const runSource=path.join(f.root,'run-source'),runFolder=path.join(runSource,'figma-layer-name-hygiene-run');
  fs.cpSync(require('../src/skills/run-skill').BUNDLED,runFolder,{recursive:true});
  const runProfile=JSON.parse(fs.readFileSync(path.join(runFolder,'profile.json')));
  const runText=fs.readFileSync(path.join(runFolder,'SKILL.md'),'utf8')+'\nREMOTE_RUN_POLICY_FIXTURE\n';
  runProfile.version='0.2.1';runProfile.instructions={sha256:release.sha(Buffer.from(runText)),bytes:Buffer.byteLength(runText)};
  put(runFolder,'SKILL.md',runText);put(runFolder,'profile.json',runProfile);
  const runRelease=await buildDataRelease({...options,skillsRoot:runSource,output:path.join(f.root,'run-release')});
  assert.equal(runRelease.manifest.runtimeId,bundled.manifest.runtimeId);
  assert.deepEqual(runRelease.manifest.files.filter(pin=>pin.file.startsWith('skills/')).map(pin=>pin.file).sort(),['skills/figma-layer-name-hygiene-run/SKILL.md','skills/figma-layer-name-hygiene-run/profile.json']);
  const installedRun=await release.installTarball({...settings,tarballPath:runRelease.tarballPath,expectedIntegrity:runRelease.descriptor.tarballIntegrity,expectedContentVersion:runRelease.manifest.id});
  const runSkill=require('../src/skills/run-skill').loadRunSkill(runtimeRoot,{releaseRoot:installedRun.current.path});
  assert.equal(runSkill.version,'0.2.1');assert.match(runSkill.instructions,/REMOTE_RUN_POLICY_FIXTURE/);runSkill.assertCurrent();
  assert.deepEqual(fs.readFileSync(path.join(runtimeRoot,'portable-runtime.json')),code);
  runProfile.wire.sha256='0'.repeat(64);put(runFolder,'profile.json',runProfile);
  await assert.rejects(buildDataRelease({...options,skillsRoot:runSource,output:path.join(f.root,'bad-wire-release')}),{code:'LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE'});
  // A declared source can never silently revert to the embedded skill.
  fs.appendFileSync(path.join(selected.packageRoot, 'skills/figma-layer-name-hygiene/SKILL.md'), '\nSource drift');
  await assert.rejects(buildDataRelease({ ...options, skillsRoot: path.join(selected.packageRoot, 'skills'), output: path.join(f.root, 'stale-source-release') }), { code: 'LAYER_NAMES_SKILL_STALE' });
  await assert.rejects(buildDataRelease({ ...options, skillsRoot: path.join(f.root, 'missing-source'), output: path.join(f.root, 'missing-source-release') }), { code: 'LAYER_NAMES_SKILL_UNAVAILABLE' });
});

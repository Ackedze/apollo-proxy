'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const knowledge = require('../knowledge-package');

const RELEASE_SCHEMA = 'apollo.proxy-data-release.v1';
const CHANNEL_SCHEMA = 'apollo.proxy-data-channel.v1';
const STORE_SCHEMA = 'apollo.proxy-data-store.v1';
const RUNTIME_SCHEMA = 'apollo.proxy-portable-runtime.v1';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const idOf = value => { const { id, ...body } = value; return sha(JSON.stringify(body)); };
const fail = code => { throw Object.assign(Error(code), { code }); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const safe = file => knowledge.isSafeRelativePath(file) && !file.split('/').includes('.');

function verifyFiles(root, files) {
  root = path.resolve(root);
  if (fs.realpathSync(root) !== root || !Array.isArray(files) || !files.length || files.length > 20000) fail('DATA_RELEASE_INVENTORY_INVALID');
  const seen = new Set();
  let total = 0;
  for (const pin of files) {
    if (!safe(pin.file) || seen.has(pin.file) || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || pin.bytes > 128 * 1024 * 1024) fail('DATA_RELEASE_INVENTORY_INVALID');
    seen.add(pin.file); total += pin.bytes;
    if (total > 512 * 1024 * 1024) fail('DATA_RELEASE_TOO_LARGE');
    const file = path.join(root, pin.file), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || stat.size !== pin.bytes || sha(fs.readFileSync(file)) !== pin.sha256) fail('DATA_RELEASE_ARTIFACT_CHANGED');
  }
  return seen;
}

function readRuntime(root) {
  const runtime = json(path.join(root, 'portable-runtime.json'));
  if (runtime.schemaVersion !== RUNTIME_SCHEMA || runtime.id !== idOf(runtime) || !/^\d+\.\d+\.\d+$/.test(runtime.profileVersion || '') || !/^[a-f0-9]{64}$/.test(runtime.nativeSourceHash || '')) fail('DATA_RELEASE_RUNTIME_INVALID');
  verifyFiles(root, runtime.files);
  if (runtime.files.some(pin => pin.file === 'dist/agent-figma-provider-descriptor.json') &&
      json(path.join(root, 'dist/agent-figma-provider-descriptor.json')).sourceHash !== runtime.nativeSourceHash) fail('DATA_RELEASE_RUNTIME_INVALID');
  return runtime;
}

function readReleaseFiles(root, runtimeRoot) {
  const manifest = json(path.join(root, 'manifest.json'));
  if (manifest.schemaVersion !== RELEASE_SCHEMA || manifest.id !== idOf(manifest) || !Number.isFinite(Date.parse(manifest.generatedAt)) || !/^[a-f0-9]{64}$/.test(manifest.dataId || '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(manifest.knowledgeVersion || '')) fail('DATA_RELEASE_MANIFEST_INVALID');
  const runtime = readRuntime(runtimeRoot);
  if (manifest.runtimeId !== runtime.id || manifest.profileVersion !== runtime.profileVersion || manifest.nativeSourceHash !== runtime.nativeSourceHash) fail('DATA_RELEASE_RUNTIME_INCOMPATIBLE');
  for (const pin of manifest.files || []) {
    const extension = path.extname(pin.file || '').toLowerCase();
    if (!/^(knowledge|contracts)\//.test(pin.file || '') || !['.json', '.md', '.yaml', '.yml', '.txt', '.zip', '.ts'].includes(extension) || extension === '.ts' && !/^contracts\/generation\/[a-f0-9]{64}\.ts$/.test(pin.file)) fail('DATA_RELEASE_EXECUTABLE_FORBIDDEN');
  }
  verifyFiles(root, manifest.files);
  return manifest;
}

async function validateRelease(root, { runtimeRoot, validateData = validateInstalledData } = {}) {
  const manifest = readReleaseFiles(root, runtimeRoot);
  const expected = new Set(['manifest.json', ...manifest.files.map(p => p.file)]);
  const actual = await knowledge.listPackageFiles(root);
  if (actual.length !== expected.size || actual.some(file => !expected.has(file))) fail('DATA_RELEASE_INVENTORY_INVALID');
  const legacy = await knowledge.validatePackageDirectory(path.join(root, 'knowledge'));
  if (legacy.contentVersion !== manifest.knowledgeVersion || JSON.stringify(legacy.sourceCommits) !== JSON.stringify(manifest.sourceCommits)) fail('DATA_RELEASE_KNOWLEDGE_MISMATCH');
  const data = await validateData(path.join(root, 'contracts'), runtimeRoot);
  if (data.index.id !== manifest.dataId || data.index.profileVersion !== manifest.profileVersion) fail('DATA_RELEASE_CONTRACT_MISMATCH');
  for (const key of ['deliveryProfile', 'parentDataId', 'capabilities']) if (JSON.stringify(manifest[key]) !== JSON.stringify(data.index[key])) fail('DATA_RELEASE_PROFILE_MISMATCH');
  data.assertCurrent();
  return manifest;
}

function validateInstalledData(root, runtimeRoot) {
  return require('../data-packages').readGenerationData({ root, apolloRoot: runtimeRoot });
}

function validateDescriptor(descriptor, runtime) {
  if (descriptor?.schemaVersion !== CHANNEL_SCHEMA || descriptor.channel !== 'stable' || !/^[a-f0-9]{64}$/.test(descriptor.contentVersion || '') || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(descriptor.tarballIntegrity || '') || new URL(descriptor.tarballUrl).protocol !== 'https:') fail('DATA_RELEASE_DESCRIPTOR_INVALID');
  if (descriptor.runtimeId !== runtime.id) fail('DATA_RELEASE_RUNTIME_INCOMPATIBLE');
  return descriptor;
}

async function writeState(root, value) {
  await fsp.mkdir(root, { recursive: true });
  const temporary = path.join(root, 'state-' + crypto.randomUUID() + '.tmp');
  try {
    await fsp.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, path.join(root, 'state.json'));
  } finally { await fsp.rm(temporary, { force: true }); }
}

async function readState(root) {
  try { const state = json(path.join(root, 'state.json')); return state.schemaVersion === STORE_SCHEMA ? state : null; }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function withLock(root, action) {
  await fsp.mkdir(root, { recursive: true });
  if (fs.realpathSync(root) !== path.resolve(root)) fail('DATA_RELEASE_STORE_UNSAFE');
  const file = path.join(root, '.update.lock');
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lock = await fsp.open(file, 'wx', 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      break;
    } catch (error) {
      if (lock) { await lock.close(); await fsp.unlink(file); throw error; }
      if (error.code !== 'EEXIST') throw error;
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) fail('DATA_RELEASE_STORE_UNSAFE');
      let owner;
      try { owner = JSON.parse(await fsp.readFile(file, 'utf8')).pid; } catch {}
      if (Number.isInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); fail('DATA_RELEASE_BUSY'); }
        catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      } else if (Date.now() - stat.mtimeMs < 60000) fail('DATA_RELEASE_BUSY');
      if ((await fsp.lstat(file)).ino !== stat.ino) fail('DATA_RELEASE_BUSY');
      await fsp.unlink(file);
    }
  }
  if (!lock) fail('DATA_RELEASE_BUSY');
  try { return await action(); }
  finally { await lock.close(); await fsp.unlink(file); }
}

function record(manifest, root, kind = 'downloaded') {
  return { contentVersion: manifest.id, path: path.resolve(root), kind, dataId: manifest.dataId, knowledgeVersion: manifest.knowledgeVersion, sourceCommits: manifest.sourceCommits, generatedAt: manifest.generatedAt, runtimeId: manifest.runtimeId };
}

async function validRecord(value, storeRoot, seedRoot, options) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.contentVersion || '') || !path.isAbsolute(value.path || '') || value.path !== path.resolve(seedRoot) && value.path !== path.join(path.resolve(storeRoot), 'versions', value.contentVersion)) return null;
  try {
    const manifest = await validateRelease(value.path, options);
    if (manifest.id !== value.contentVersion) return null;
    return record(manifest, value.path, value.kind);
  } catch { return null; }
}

async function ensureStore({ storeRoot, seedRoot, ...options }) {
  return withLock(storeRoot, async () => {
    const state = await readState(storeRoot);
    const current = await validRecord(state?.current, storeRoot, seedRoot, options);
    if (current) return { state: { ...state, current }, recovered: false };
    const previous = await validRecord(state?.previous, storeRoot, seedRoot, options);
    let fallback = previous;
    if (!fallback) {
      const manifest = await validateRelease(seedRoot, options);
      const destination = path.join(storeRoot, 'versions', manifest.id);
      if (!fs.existsSync(destination)) {
        const staging = path.join(storeRoot, '.staging-seed-' + crypto.randomUUID());
        try {
          await fsp.cp(seedRoot, staging, { recursive: true, dereference: false });
          if ((await validateRelease(staging, options)).id !== manifest.id) fail('DATA_RELEASE_VERSION_CONFLICT');
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          await fsp.rename(staging, destination);
        } finally { await fsp.rm(staging, { recursive: true, force: true }); }
      }
      if ((await validateRelease(destination, options)).id !== manifest.id) fail('DATA_RELEASE_VERSION_CONFLICT');
      fallback = record(manifest, destination, 'seed');
    }
    const next = { schemaVersion: STORE_SCHEMA, current: fallback, previous: state?.current || null };
    await writeState(storeRoot, next);
    return { state: next, recovered: true };
  });
}

async function installTarball({ storeRoot, seedRoot, tarballPath, expectedIntegrity, expectedContentVersion, ...options }) {
  return withLock(storeRoot, async () => {
    if ('sha256-' + Buffer.from(await knowledge.sha256File(tarballPath), 'hex').toString('base64') !== expectedIntegrity) fail('DATA_RELEASE_INTEGRITY_INVALID');
    knowledge.validateArchiveEntries(tarballPath);
    const staging = path.join(storeRoot, '.staging-' + crypto.randomUUID());
    await fsp.mkdir(staging);
    try {
      const extraction = spawnSync('/usr/bin/tar', ['-xzf', tarballPath, '-C', staging, '--no-same-owner'], { encoding: 'utf8' });
      if (extraction.status !== 0) fail('DATA_RELEASE_ARCHIVE_INVALID');
      const unpacked = path.join(staging, 'package');
      const manifest = await validateRelease(unpacked, options);
      if (expectedContentVersion && manifest.id !== expectedContentVersion) fail('DATA_RELEASE_DESCRIPTOR_MISMATCH');
      const destination = path.join(storeRoot, 'versions', manifest.id);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) {
        if ((await validateRelease(destination, options)).id !== manifest.id) fail('DATA_RELEASE_VERSION_CONFLICT');
      }
      else await fsp.rename(unpacked, destination);
      const old = await readState(storeRoot);
      const current = record(manifest, destination);
      const next = { schemaVersion: STORE_SCHEMA, current, previous: old?.current?.contentVersion === current.contentVersion ? old.previous || null : old?.current || null };
      await writeState(storeRoot, next);
      // Immutable versions remain available to already-admitted runs and offline rollback.
      return next;
    } finally { await fsp.rm(staging, { recursive: true, force: true }); }
  });
}

async function rollbackStore({ storeRoot, seedRoot, ...options }) {
  return withLock(storeRoot, async () => {
    const state = await readState(storeRoot);
    const previous = await validRecord(state?.previous, storeRoot, seedRoot, options);
    if (!previous) fail('DATA_RELEASE_ROLLBACK_UNAVAILABLE');
    const next = { schemaVersion: STORE_SCHEMA, current: previous, previous: state?.current || null };
    await writeState(storeRoot, next);
    return next;
  });
}

function publicStatus(state, update = {}) {
  const current = state.current;
  return {
    current, previous: state.previous, releaseRoot: current.path,
    dataRoot: path.join(current.path, 'contracts'),
    designSystemRoot: path.join(current.path, 'knowledge/data/design-system_ab'),
    dsAiHubRoot: path.join(current.path, 'knowledge/data/ds-ai-hub'),
    ...update,
  };
}

module.exports = { RELEASE_SCHEMA, CHANNEL_SCHEMA, STORE_SCHEMA, RUNTIME_SCHEMA, sha, idOf, verifyFiles, readRuntime, readReleaseFiles, validateRelease, validateDescriptor, ensureStore, installTarball, rollbackStore, readState, publicStatus };

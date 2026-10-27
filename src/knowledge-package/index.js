const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KNOWLEDGE_SCHEMA_VERSION = 'apollo.knowledge-package.v1';
const CHANNEL_SCHEMA_VERSION = 'apollo.knowledge-channel.v1';
const STORE_SCHEMA_VERSION = 'apollo.knowledge-store.v1';
const ENGINE_VERSION = '1.0.1';
const TAR_EXECUTABLE = '/usr/bin/tar';
const DATA_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml', '.txt']);

function fail(message, code = 'KNOWLEDGE_PACKAGE_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').includes('..') &&
    !value.split('/').includes('');
}

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) fail(`Invalid engine version: ${value}`, 'KNOWLEDGE_ENGINE_VERSION_INVALID');
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function assertEngineCompatible(compatibility, engineVersion = ENGINE_VERSION) {
  if (!isPlainObject(compatibility) || !compatibility.min || !compatibility.max) {
    fail('engineCompatibility.min/max are required.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  if (
    compareVersions(engineVersion, compatibility.min) < 0 ||
    compareVersions(engineVersion, compatibility.max) > 0
  ) {
    fail(
      `Knowledge package supports engine ${compatibility.min}..${compatibility.max}; running ${engineVersion}.`,
      'KNOWLEDGE_ENGINE_INCOMPATIBLE'
    );
  }
}

function validateSourceCommits(sourceCommits) {
  for (const key of ['design-system_ab', 'ds-ai-hub']) {
    if (!/^[0-9a-f]{40}$/i.test(sourceCommits?.[key] || '')) {
      fail(`sourceCommits.${key} must be a full git SHA.`, 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
    }
  }
}

function validateManifest(manifest, engineVersion = ENGINE_VERSION) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) {
    fail(`Unsupported knowledge schemaVersion: ${manifest?.schemaVersion || '<missing>'}.`, 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(manifest.contentVersion || '')) {
    fail('contentVersion is missing or unsafe.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  if (manifest.channel !== 'stable') {
    fail('Only the stable knowledge channel is supported.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt || ''))) {
    fail('generatedAt must be an ISO date.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  validateSourceCommits(manifest.sourceCommits);
  assertEngineCompatible(manifest.engineCompatibility, engineVersion);
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail('artifacts must be a non-empty array.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  if (manifest.artifactCount !== manifest.artifacts.length) {
    fail('artifactCount does not match artifacts.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    if (!isSafeRelativePath(artifact?.path) || !artifact.path.startsWith('data/')) {
      fail(`Unsafe artifact path: ${artifact?.path}.`, 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
    }
    if (!DATA_EXTENSIONS.has(path.extname(artifact.path).toLowerCase())) {
      fail(`Executable or unsupported artifact type: ${artifact.path}.`, 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
    }
    if (seen.has(artifact.path)) fail(`Duplicate artifact path: ${artifact.path}.`);
    seen.add(artifact.path);
    if (!Number.isInteger(artifact.size) || artifact.size < 0 || !/^[0-9a-f]{64}$/i.test(artifact.sha256 || '')) {
      fail(`Invalid artifact metadata: ${artifact.path}.`, 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
    }
  }
  const expectedBytes = manifest.artifacts.reduce((total, artifact) => total + artifact.size, 0);
  if (manifest.totalBytes !== expectedBytes) {
    fail('totalBytes does not match artifacts.', 'KNOWLEDGE_MANIFEST_SCHEMA_INVALID');
  }
  const canonical = manifest.artifacts
    .map((artifact) => `${artifact.path}\0${artifact.size}\0${artifact.sha256}\n`)
    .join('');
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');
  if (
    manifest.checksum?.algorithm !== 'sha256' ||
    manifest.checksum?.value !== checksum ||
    manifest.checksum?.integrity !== `sha256-${Buffer.from(checksum, 'hex').toString('base64')}`
  ) {
    fail('Manifest checksum/integrity is invalid.', 'KNOWLEDGE_MANIFEST_INTEGRITY_INVALID');
  }
  return manifest;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function listPackageFiles(root, directory = root) {
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`Symlink is forbidden in knowledge package: ${absolute}.`, 'KNOWLEDGE_EXECUTABLE_CONTENT_FORBIDDEN');
    if (entry.isDirectory()) result.push(...await listPackageFiles(root, absolute));
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join('/'));
    else fail(`Unsupported filesystem entry in knowledge package: ${absolute}.`, 'KNOWLEDGE_EXECUTABLE_CONTENT_FORBIDDEN');
  }
  return result.sort();
}

async function validatePackageDirectory(packageRoot, engineVersion = ENGINE_VERSION) {
  const resolvedRoot = path.resolve(packageRoot);
  const manifestPath = path.join(resolvedRoot, 'manifest.json');
  const manifest = validateManifest(
    JSON.parse(await fsp.readFile(manifestPath, 'utf8')),
    engineVersion
  );
  const packageMetadata = await readJson(path.join(resolvedRoot, 'package.json'));
  if (
    packageMetadata?.name !== '@apollo/knowledge' ||
    packageMetadata.scripts ||
    packageMetadata.bin ||
    packageMetadata.main
  ) {
    fail('package.json must be metadata-only and contain no executable entry points.', 'KNOWLEDGE_EXECUTABLE_CONTENT_FORBIDDEN');
  }
  const expectedFiles = new Set(['manifest.json', 'package.json', ...manifest.artifacts.map((artifact) => artifact.path)]);
  const actualFiles = await listPackageFiles(resolvedRoot);
  const unexpected = actualFiles.filter((relative) => !expectedFiles.has(relative));
  const omitted = [...expectedFiles].filter((relative) => !actualFiles.includes(relative));
  if (unexpected.length || omitted.length) {
    fail(
      `Package file inventory mismatch: unexpected=${unexpected.join(',')}; missing=${omitted.join(',')}.`,
      'KNOWLEDGE_EXECUTABLE_CONTENT_FORBIDDEN'
    );
  }
  for (const artifact of manifest.artifacts) {
    const artifactPath = path.resolve(resolvedRoot, artifact.path);
    if (!artifactPath.startsWith(`${resolvedRoot}${path.sep}`)) fail(`Artifact escapes package: ${artifact.path}.`);
    const stat = await fsp.lstat(artifactPath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== artifact.size) {
      fail(`Artifact is missing or changed: ${artifact.path}.`, 'KNOWLEDGE_ARTIFACT_INVALID');
    }
    if (await sha256File(artifactPath) !== artifact.sha256) {
      fail(`Artifact checksum mismatch: ${artifact.path}.`, 'KNOWLEDGE_ARTIFACT_INVALID');
    }
  }
  await smokeTestPackage(resolvedRoot);
  return manifest;
}

async function smokeTestPackage(packageRoot) {
  const required = [
    'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json',
    'data/design-system_ab/JSONS/apollo/designPatternRules.json',
    'data/design-system_ab/redpolrules/dictionary.json',
  ];
  for (const relativePath of required) {
    const filePath = path.join(packageRoot, relativePath);
    if (!(await fsp.stat(filePath).catch(() => null))?.isFile()) {
      fail(`Required knowledge index is missing: ${relativePath}.`, 'KNOWLEDGE_SMOKE_TEST_FAILED');
    }
  }
  const index = JSON.parse(await fsp.readFile(path.join(packageRoot, required[0]), 'utf8'));
  if (index.schemaVersion !== 2 || !Array.isArray(index.packages) || index.packages.length === 0) {
    fail('componentContractIndex failed smoke test.', 'KNOWLEDGE_SMOKE_TEST_FAILED');
  }
  const patterns = JSON.parse(await fsp.readFile(path.join(packageRoot, required[1]), 'utf8'));
  if (!Array.isArray(patterns.rules)) {
    fail('designPatternRules failed smoke test.', 'KNOWLEDGE_SMOKE_TEST_FAILED');
  }
  const publishedKeys = Object.keys(index.components || {});
  if (publishedKeys.length > 0) {
    try {
      const designSystemRoot = path.join(packageRoot, 'data', 'design-system_ab');
      const { loadPredicateRelease } = require('../predicate-engine/release-loader');
      const {
        assertReleaseRulePresentations,
        compilePredicateReleaseRules,
      } = require('../predicate-engine/release-service');
      const loaded = loadPredicateRelease(designSystemRoot, publishedKeys);
      const rules = compilePredicateReleaseRules(loaded);
      assertReleaseRulePresentations(rules);
      if (rules.length === 0) throw new Error('compiled Rule IR is empty');
    } catch (error) {
      fail(`Predicate Rule IR smoke test failed: ${error.message}`, 'KNOWLEDGE_SMOKE_TEST_FAILED');
    }
  }
  const hubRoots = [
    'data/ds-ai-hub/products/ab/components',
    'data/ds-ai-hub/core/web/components',
  ];
  for (const relativePath of hubRoots) {
    if (!(await fsp.stat(path.join(packageRoot, relativePath)).catch(() => null))?.isDirectory()) {
      fail(`Required agent knowledge root is missing: ${relativePath}.`, 'KNOWLEDGE_SMOKE_TEST_FAILED');
    }
  }
}

function validateChannelDescriptor(descriptor, engineVersion = ENGINE_VERSION) {
  if (!isPlainObject(descriptor) || descriptor.schemaVersion !== CHANNEL_SCHEMA_VERSION) {
    fail('Unsupported channel descriptor.', 'KNOWLEDGE_DESCRIPTOR_INVALID');
  }
  if (descriptor.channel !== 'stable' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(descriptor.contentVersion || '')) {
    fail('Invalid stable channel descriptor.', 'KNOWLEDGE_DESCRIPTOR_INVALID');
  }
  const url = new URL(descriptor.tarballUrl);
  if (url.protocol !== 'https:') fail('Knowledge tarball must use HTTPS.', 'KNOWLEDGE_HTTPS_REQUIRED');
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(descriptor.tarballIntegrity || '')) {
    fail('Descriptor tarballIntegrity must be sha256 SRI.', 'KNOWLEDGE_DESCRIPTOR_INVALID');
  }
  validateSourceCommits(descriptor.sourceCommits);
  if (!Number.isFinite(Date.parse(descriptor.generatedAt || '')) || !Number.isInteger(descriptor.artifactCount) || descriptor.artifactCount < 1) {
    fail('Descriptor generatedAt/artifactCount are invalid.', 'KNOWLEDGE_DESCRIPTOR_INVALID');
  }
  assertEngineCompatible(descriptor.engineCompatibility, engineVersion);
  return descriptor;
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, filePath);
}

async function readStoreState(storeRoot) {
  const statePath = path.join(storeRoot, 'state.json');
  const state = await readJson(statePath).catch(() => null);
  return state?.schemaVersion === STORE_SCHEMA_VERSION ? state : null;
}

function packageRecord(manifest, packageRoot, kind = 'downloaded') {
  return {
    contentVersion: manifest.contentVersion,
    path: path.resolve(packageRoot),
    kind,
    checksum: manifest.checksum,
    sourceCommits: manifest.sourceCommits,
    generatedAt: manifest.generatedAt,
    activatedAt: new Date().toISOString(),
  };
}

async function validateRecord(record, engineVersion) {
  if (!record?.path || !path.isAbsolute(record.path)) return null;
  try {
    const manifest = await validatePackageDirectory(record.path, engineVersion);
    return packageRecord(manifest, record.path, record.kind || 'downloaded');
  } catch {
    return null;
  }
}

async function ensureStore({ storeRoot, seedRoot, engineVersion = ENGINE_VERSION }) {
  await fsp.mkdir(path.join(storeRoot, 'versions'), { recursive: true });
  const state = await readStoreState(storeRoot);
  const current = await validateRecord(state?.current, engineVersion);
  if (current) {
    const seedManifest = await validatePackageDirectory(seedRoot, engineVersion);
    const seed = packageRecord(seedManifest, seedRoot, 'seed');
    const seedIsAtLeastAsRecent =
      Date.parse(seed.generatedAt) >= Date.parse(current.generatedAt);
    if (
      seed.contentVersion !== current.contentVersion &&
      seedIsAtLeastAsRecent
    ) {
      const activated = {
        schemaVersion: STORE_SCHEMA_VERSION,
        current: seed,
        previous: current,
      };
      await writeJsonAtomic(path.join(storeRoot, 'state.json'), activated);
      await cleanupVersions(storeRoot, activated);
      return { state: activated, recovered: true };
    }
    const validated = { ...state, current };
    await cleanupVersions(storeRoot, validated);
    return { state: validated, recovered: false };
  }
  const previous = await validateRecord(state?.previous, engineVersion);
  if (previous) {
    const recovered = { schemaVersion: STORE_SCHEMA_VERSION, current: previous, previous: null };
    await writeJsonAtomic(path.join(storeRoot, 'state.json'), recovered);
    await cleanupVersions(storeRoot, recovered);
    return { state: recovered, recovered: true };
  }
  const seedManifest = await validatePackageDirectory(seedRoot, engineVersion);
  const recovered = {
    schemaVersion: STORE_SCHEMA_VERSION,
    current: packageRecord(seedManifest, seedRoot, 'seed'),
    previous: null,
  };
  await writeJsonAtomic(path.join(storeRoot, 'state.json'), recovered);
  await cleanupVersions(storeRoot, recovered);
  return { state: recovered, recovered: true };
}

async function cleanupVersions(storeRoot, state) {
  const versionsRoot = path.join(storeRoot, 'versions');
  const keep = new Set(
    [state.current, state.previous]
      .filter((record) => record?.kind === 'downloaded')
      .map((record) => path.resolve(record.path))
  );
  for (const entry of await fsp.readdir(versionsRoot, { withFileTypes: true }).catch(() => [])) {
    const candidate = path.resolve(versionsRoot, entry.name);
    if (entry.isDirectory() && !keep.has(candidate)) await fsp.rm(candidate, { recursive: true, force: true });
  }
}

function validateArchiveEntries(tarballPath) {
  // A GUI launch may inherit the C locale, making bsdtar escape valid UTF-8 names.
  const options = { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C.UTF-8' } };
  const list = spawnSync(TAR_EXECUTABLE, ['-tf', tarballPath], options);
  if (list.status !== 0) fail(`Cannot list tarball: ${list.stderr || list.stdout}`, 'KNOWLEDGE_ARCHIVE_INVALID');
  const entries = list.stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) fail('Knowledge tarball is empty.', 'KNOWLEDGE_ARCHIVE_INVALID');
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '');
    if (!normalized || !isSafeRelativePath(normalized) || !(normalized === 'package' || normalized.startsWith('package/'))) {
      fail(`Unsafe tar entry: ${entry}.`, 'KNOWLEDGE_ARCHIVE_UNSAFE');
    }
  }
  const verbose = spawnSync(TAR_EXECUTABLE, ['-tvf', tarballPath], options);
  if (verbose.status !== 0) fail('Cannot inspect tarball entries.', 'KNOWLEDGE_ARCHIVE_INVALID');
  for (const line of verbose.stdout.split(/\r?\n/).filter(Boolean)) {
    if (!['-', 'd'].includes(line[0])) fail('Knowledge tarball may contain only regular files and directories.', 'KNOWLEDGE_ARCHIVE_UNSAFE');
  }
}

async function installTarball({
  storeRoot,
  tarballPath,
  expectedIntegrity,
  expectedContentVersion = null,
  expectedSourceCommits = null,
  engineVersion = ENGINE_VERSION,
}) {
  const digest = await sha256File(tarballPath);
  const integrity = `sha256-${Buffer.from(digest, 'hex').toString('base64')}`;
  if (integrity !== expectedIntegrity) fail('Downloaded tarball integrity mismatch.', 'KNOWLEDGE_TARBALL_INTEGRITY_INVALID');
  validateArchiveEntries(tarballPath);
  const staging = path.join(storeRoot, `.staging-${crypto.randomUUID()}`);
  await fsp.mkdir(staging, { recursive: true });
  try {
    const extraction = spawnSync(TAR_EXECUTABLE, ['-xzf', tarballPath, '-C', staging, '--no-same-owner'], { encoding: 'utf8' });
    if (extraction.status !== 0) fail(`Cannot extract knowledge tarball: ${extraction.stderr}`, 'KNOWLEDGE_ARCHIVE_INVALID');
    const unpacked = path.join(staging, 'package');
    const manifest = await validatePackageDirectory(unpacked, engineVersion);
    if (expectedContentVersion && manifest.contentVersion !== expectedContentVersion) {
      fail('Descriptor and package contentVersion do not match.', 'KNOWLEDGE_DESCRIPTOR_PACKAGE_MISMATCH');
    }
    if (expectedSourceCommits && ['design-system_ab', 'ds-ai-hub'].some(
      (key) => manifest.sourceCommits[key] !== expectedSourceCommits[key]
    )) {
      fail('Descriptor and package source commits do not match.', 'KNOWLEDGE_DESCRIPTOR_PACKAGE_MISMATCH');
    }
    const versionRoot = path.join(storeRoot, 'versions', manifest.contentVersion);
    await fsp.mkdir(path.dirname(versionRoot), { recursive: true });
    if (await fsp.stat(versionRoot).catch(() => null)) await fsp.rm(versionRoot, { recursive: true, force: true });
    await fsp.rename(unpacked, versionRoot);
    const oldState = await readStoreState(storeRoot);
    const current = packageRecord(manifest, versionRoot);
    const previous = oldState?.current?.contentVersion === current.contentVersion
      ? oldState.previous || null
      : oldState?.current || null;
    const state = { schemaVersion: STORE_SCHEMA_VERSION, current, previous };
    await writeJsonAtomic(path.join(storeRoot, 'state.json'), state);
    await cleanupVersions(storeRoot, state);
    return state;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function rollbackStore({ storeRoot, engineVersion = ENGINE_VERSION }) {
  const state = await readStoreState(storeRoot);
  const previous = await validateRecord(state?.previous, engineVersion);
  if (!previous) fail('No valid previous knowledge version is available.', 'KNOWLEDGE_ROLLBACK_UNAVAILABLE');
  const current = await validateRecord(state.current, engineVersion);
  const next = { schemaVersion: STORE_SCHEMA_VERSION, current: previous, previous: current };
  await writeJsonAtomic(path.join(storeRoot, 'state.json'), next);
  await cleanupVersions(storeRoot, next);
  return next;
}

async function fetchJson(url, token) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') fail('Knowledge descriptor must use HTTPS.', 'KNOWLEDGE_HTTPS_REQUIRED');
  parsed.searchParams.set('apolloKnowledgeCheck', `${Date.now()}-${crypto.randomUUID()}`);
  const response = await require('../http-fetch').fetch(parsed, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    redirect: 'follow',
  });
  if (!response.ok) fail(`Knowledge request failed with HTTP ${response.status}.`, 'KNOWLEDGE_DOWNLOAD_FAILED');
  if (new URL(response.url).protocol !== 'https:') fail('Knowledge descriptor redirect left HTTPS.', 'KNOWLEDGE_HTTPS_REQUIRED');
  return response.json();
}

async function downloadFile(url, targetPath, token) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') fail('Knowledge tarball must use HTTPS.', 'KNOWLEDGE_HTTPS_REQUIRED');
  const response = await require('../http-fetch').fetch(parsed, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'follow',
  });
  if (!response.ok || !response.body) fail(`Knowledge download failed with HTTP ${response.status}.`, 'KNOWLEDGE_DOWNLOAD_FAILED');
  if (new URL(response.url).protocol !== 'https:') fail('Knowledge tarball redirect left HTTPS.', 'KNOWLEDGE_HTTPS_REQUIRED');
  const handle = await fsp.open(targetPath, 'wx', 0o600);
  try {
    for await (const chunk of response.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

function publicStatus(state, update = {}) {
  const current = state?.current || null;
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    current: current ? {
      contentVersion: current.contentVersion,
      kind: current.kind,
      path: current.path,
      sourceCommits: current.sourceCommits,
      generatedAt: current.generatedAt,
    } : null,
    previous: state?.previous ? {
      contentVersion: state.previous.contentVersion,
      kind: state.previous.kind,
      generatedAt: state.previous.generatedAt,
    } : null,
    designSystemRoot: current ? path.join(current.path, 'data', 'design-system_ab') : null,
    dsAiHubRoot: current ? path.join(current.path, 'data', 'ds-ai-hub') : null,
    ...update,
  };
}

module.exports = {
  CHANNEL_SCHEMA_VERSION,
  ENGINE_VERSION,
  KNOWLEDGE_SCHEMA_VERSION,
  STORE_SCHEMA_VERSION,
  assertEngineCompatible,
  cleanupVersions,
  compareVersions,
  downloadFile,
  ensureStore,
  fetchJson,
  installTarball,
  isSafeRelativePath,
  listPackageFiles,
  publicStatus,
  readStoreState,
  rollbackStore,
  sha256File,
  smokeTestPackage,
  validateArchiveEntries,
  validateChannelDescriptor,
  validateManifest,
  validatePackageDirectory,
};

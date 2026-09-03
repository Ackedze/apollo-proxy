const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const test = require('node:test');
const {
  collectDesignSystemFiles,
  manifestChecksum,
  projectionCommit,
  walkFiles,
} = require('../scripts/build-knowledge-package');
const {
  githubRawDescriptorUrl,
  githubReleaseBaseUrl,
  githubReleaseTag,
  normalizeGitHubRepository,
  parseGitCredential,
  writeDescriptorAtomic,
} = require('../scripts/publish-knowledge-package');
const {
  ENGINE_VERSION,
  KNOWLEDGE_SCHEMA_VERSION,
  ensureStore,
  installTarball,
  rollbackStore,
  sha256File,
  validateArchiveEntries,
  validatePackageDirectory,
} = require('../src/knowledge-package');

const SOURCE_COMMITS = {
  'design-system_ab': '1'.repeat(40),
  'ds-ai-hub': '2'.repeat(40),
};

async function createPackage(root, version, compatibility = { min: ENGINE_VERSION, max: ENGINE_VERSION }) {
  const packageRoot = path.join(root, version, 'package');
  const files = {
    'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json': JSON.stringify({ schemaVersion: 2, packages: [{ componentKey: 'fixture' }] }),
    'data/design-system_ab/JSONS/apollo/designPatternRules.json': JSON.stringify({ rules: [] }),
    'data/design-system_ab/redpolrules/dictionary.json': JSON.stringify({ rules: [] }),
    'data/ds-ai-hub/products/ab/components/fixture/figma-keys.json': JSON.stringify({ componentKey: 'fixture' }),
    'data/ds-ai-hub/core/web/components/fixture/figma-keys.json': JSON.stringify({ componentKey: 'core-fixture' }),
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(packageRoot, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
  const artifacts = [];
  for (const relative of await walkFiles(path.join(packageRoot, 'data'))) {
    const filePath = path.join(packageRoot, 'data', relative);
    const stat = await fsp.stat(filePath);
    artifacts.push({
      path: path.posix.join('data', relative),
      size: stat.size,
      sha256: await sha256File(filePath),
    });
  }
  const checksum = manifestChecksum(artifacts);
  const manifest = {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    contentVersion: version,
    channel: 'stable',
    engineCompatibility: compatibility,
    sourceCommits: SOURCE_COMMITS,
    generatedAt: '2026-09-03T00:00:00.000Z',
    projection: {},
    artifactCount: artifacts.length,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.size, 0),
    artifacts,
    checksum,
  };
  await fsp.writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest));
  await fsp.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@apollo/knowledge', version: '0.0.0-test' }));
  return packageRoot;
}

async function pack(root, version) {
  const tarball = path.join(root, `${version}.tgz`);
  const result = spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', path.join(root, version), 'package'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const digest = await sha256File(tarball);
  return { tarball, integrity: `sha256-${Buffer.from(digest, 'hex').toString('base64')}` };
}

test('store activates atomically, retains current/previous only, and rolls back', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const seedRoot = await createPackage(root, 'seed');
  const storeRoot = path.join(root, 'store');
  let ensured = await ensureStore({ storeRoot, seedRoot });
  assert.equal(ensured.state.current.contentVersion, 'seed');
  for (const version of ['v1', 'v2', 'v3']) {
    await createPackage(root, version);
    const archive = await pack(root, version);
    const state = await installTarball({ storeRoot, tarballPath: archive.tarball, expectedIntegrity: archive.integrity });
    assert.equal(state.current.contentVersion, version);
  }
  const versions = await fsp.readdir(path.join(storeRoot, 'versions'));
  assert.deepEqual(versions.sort(), ['v2', 'v3']);
  const rolledBack = await rollbackStore({ storeRoot });
  assert.equal(rolledBack.current.contentVersion, 'v2');
  assert.equal(rolledBack.previous.contentVersion, 'v3');
});

test('corrupt or incompatible package never replaces current', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const seedRoot = await createPackage(root, 'seed');
  const storeRoot = path.join(root, 'store');
  await ensureStore({ storeRoot, seedRoot });
  await createPackage(root, 'bad-engine', { min: '2.0.0', max: '2.9.9' });
  const archive = await pack(root, 'bad-engine');
  await assert.rejects(
    installTarball({ storeRoot, tarballPath: archive.tarball, expectedIntegrity: archive.integrity }),
    (error) => error.code === 'KNOWLEDGE_ENGINE_INCOMPATIBLE'
  );
  await createPackage(root, 'valid-but-mismatched');
  const mismatched = await pack(root, 'valid-but-mismatched');
  await assert.rejects(
    installTarball({
      storeRoot,
      tarballPath: mismatched.tarball,
      expectedIntegrity: mismatched.integrity,
      expectedContentVersion: 'descriptor-version',
    }),
    (error) => error.code === 'KNOWLEDGE_DESCRIPTOR_PACKAGE_MISMATCH'
  );
  await assert.rejects(
    installTarball({ storeRoot, tarballPath: archive.tarball, expectedIntegrity: 'sha256-' + 'A'.repeat(43) + '=' }),
    (error) => error.code === 'KNOWLEDGE_TARBALL_INTEGRITY_INVALID'
  );
  const ensured = await ensureStore({ storeRoot, seedRoot });
  assert.equal(ensured.state.current.contentVersion, 'seed');
});

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function maliciousTarball(entryName) {
  const content = Buffer.from('escape');
  const header = Buffer.alloc(512, 0);
  header.write(entryName, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(content.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return zlib.gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

test('archive validation rejects path traversal before extraction', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const tarball = path.join(root, 'unsafe.tgz');
  await fsp.writeFile(tarball, maliciousTarball('package/../escape'));
  assert.throws(
    () => validateArchiveEntries(tarball),
    (error) => error.code === 'KNOWLEDGE_ARCHIVE_UNSAFE'
  );
});

test('artifact tampering fails package validation', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const packageRoot = await createPackage(root, 'tamper');
  await fsp.appendFile(
    path.join(packageRoot, 'data/design-system_ab/redpolrules/dictionary.json'),
    '\nchanged'
  );
  await assert.rejects(
    validatePackageDirectory(packageRoot),
    (error) => error.code === 'KNOWLEDGE_ARTIFACT_INVALID'
  );
});

test('unlisted executable content is rejected', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const packageRoot = await createPackage(root, 'extra-code');
  await fsp.writeFile(path.join(packageRoot, 'postinstall.js'), 'process.exit(0)');
  await assert.rejects(
    validatePackageDirectory(packageRoot),
    (error) => error.code === 'KNOWLEDGE_EXECUTABLE_CONTENT_FORBIDDEN'
  );
});

test('GitHub knowledge URLs target the selected repository', () => {
  assert.equal(normalizeGitHubRepository('Ackedze/design-system_ab'), 'Ackedze/design-system_ab');
  assert.equal(githubReleaseTag('v1.2.3'), 'apollo-knowledge-v1.2.3');
  assert.equal(
    githubReleaseBaseUrl('Ackedze/design-system_ab', 'apollo-knowledge-v1.2.3'),
    'https://github.com/Ackedze/design-system_ab/releases/download/apollo-knowledge-v1.2.3'
  );
  assert.equal(
    githubRawDescriptorUrl('Ackedze/design-system_ab'),
    'https://raw.githubusercontent.com/Ackedze/design-system_ab/main/apollo/knowledge/channels/stable.json'
  );
  assert.throws(() => normalizeGitHubRepository('https://github.com/Ackedze/design-system_ab'), /owner\/name/);
  assert.throws(() => githubReleaseTag('../unsafe'), /Unsafe/);
  assert.throws(() => githubRawDescriptorUrl('Ackedze/design-system_ab', '../main'), /Unsafe/);
  assert.equal(
    parseGitCredential('protocol=https\nhost=github.com\nusername=apollo\npassword=token-with-equals==\n'),
    'token-with-equals=='
  );
  assert.equal(parseGitCredential('protocol=https\nhost=github.com\n'), null);
});

test('stable descriptor is written atomically at the repository path', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-github-descriptor-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const descriptor = {
    schemaVersion: 'apollo.knowledge-channel.v1',
    channel: 'stable',
    contentVersion: 'v1',
    generatedAt: '2026-09-03T00:00:00.000Z',
    engineCompatibility: { min: ENGINE_VERSION, max: ENGINE_VERSION },
    sourceCommits: SOURCE_COMMITS,
    tarballUrl: 'https://github.com/Ackedze/design-system_ab/releases/download/apollo-knowledge-v1/apollo-knowledge-v1.tgz',
    tarballIntegrity: `sha256-${'A'.repeat(43)}=`,
    artifactCount: 1,
  };
  const target = await writeDescriptorAtomic(root, descriptor);
  assert.equal(target, path.join(root, 'apollo/knowledge/channels/stable.json'));
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), descriptor);
  assert.deepEqual(await fsp.readdir(path.dirname(target)), ['stable.json']);
});

test('delivery descriptors are excluded from the knowledge projection', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-projection-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'JSONS/apollo/indexes'), { recursive: true });
  await fsp.writeFile(
    path.join(root, 'JSONS/apollo/indexes/componentContractIndex.json'),
    JSON.stringify({ schemaVersion: 2, packages: [] })
  );
  await fsp.mkdir(path.join(root, 'apollo/knowledge/channels'), { recursive: true });
  await fsp.writeFile(path.join(root, 'apollo/runtime-rule.json'), '{}');
  await fsp.writeFile(path.join(root, 'apollo/knowledge/channels/stable.json'), '{}');
  const files = await collectDesignSystemFiles(root);
  assert.ok(files.includes('apollo/runtime-rule.json'));
  assert.ok(!files.includes('apollo/knowledge/channels/stable.json'));
});

test('a stable descriptor-only commit does not change the projected source revision', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-projection-git-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const runFixtureGit = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runFixtureGit('init');
  runFixtureGit('config', 'user.name', 'Apollo Test');
  runFixtureGit('config', 'user.email', 'apollo-test@example.invalid');
  await fsp.mkdir(path.join(root, 'apollo/knowledge/channels'), { recursive: true });
  await fsp.writeFile(path.join(root, 'apollo/runtime-rule.json'), '{}');
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'knowledge input');
  const knowledgeCommit = runFixtureGit('rev-parse', 'HEAD');
  await fsp.writeFile(path.join(root, 'apollo/knowledge/channels/stable.json'), '{}');
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'delivery descriptor');
  assert.notEqual(runFixtureGit('rev-parse', 'HEAD'), knowledgeCommit);
  assert.equal(
    projectionCommit(root, ['apollo', ':(exclude)apollo/knowledge/channels/**']),
    knowledgeCommit
  );
});

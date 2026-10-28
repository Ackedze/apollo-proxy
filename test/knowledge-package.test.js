const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const test = require('node:test');
const {
  buildKnowledgePackage,
  collectDesignSystemFiles,
  collectDsAiHubFiles,
  compactGeneratedContract,
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

async function createPackage(
  root,
  version,
  compatibility = { min: ENGINE_VERSION, max: ENGINE_VERSION },
  generatedAt = '2026-09-03T00:00:00.000Z',
  additionalFiles = {}
) {
  const packageRoot = path.join(root, version, 'package');
  const files = {
    'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json': JSON.stringify({ schemaVersion: 2, packages: [{ componentKey: 'fixture' }] }),
    'data/design-system_ab/JSONS/apollo/designPatternRules.json': JSON.stringify({ rules: [] }),
    'data/design-system_ab/redpolrules/dictionary.json': JSON.stringify({ rules: [] }),
    'data/ds-ai-hub/products/ab/components/fixture/figma-keys.json': JSON.stringify({ componentKey: 'fixture' }),
    'data/ds-ai-hub/core/web/components/fixture/figma-keys.json': JSON.stringify({ componentKey: 'core-fixture' }),
    ...additionalFiles,
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
    generatedAt,
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

test('an installed app activates an equally recent bundled seed with different knowledge', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-seed-refresh-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const firstSeed = await createPackage(root, 'seed-v1');
  const storeRoot = path.join(root, 'store');
  await ensureStore({ storeRoot, seedRoot: firstSeed });

  await createPackage(root, 'downloaded-v1');
  const archive = await pack(root, 'downloaded-v1');
  await installTarball({ storeRoot, tarballPath: archive.tarball, expectedIntegrity: archive.integrity });

  const nextSeed = await createPackage(root, 'seed-v2');
  const ensured = await ensureStore({ storeRoot, seedRoot: nextSeed });
  assert.equal(ensured.state.current.contentVersion, 'seed-v2');
  assert.equal(ensured.state.current.kind, 'seed');
  assert.equal(ensured.state.previous.contentVersion, 'downloaded-v1');
});

test('an older bundled seed never replaces newer downloaded knowledge', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-newer-download-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const seed = await createPackage(
    root,
    'seed-old',
    { min: ENGINE_VERSION, max: ENGINE_VERSION },
    '2026-09-02T00:00:00.000Z'
  );
  const storeRoot = path.join(root, 'store');
  await ensureStore({ storeRoot, seedRoot: seed });

  await createPackage(
    root,
    'downloaded-new',
    { min: ENGINE_VERSION, max: ENGINE_VERSION },
    '2026-09-04T00:00:00.000Z'
  );
  const archive = await pack(root, 'downloaded-new');
  await installTarball({ storeRoot, tarballPath: archive.tarball, expectedIntegrity: archive.integrity });

  const ensured = await ensureStore({ storeRoot, seedRoot: seed });
  assert.equal(ensured.state.current.contentVersion, 'downloaded-new');
  assert.equal(ensured.state.current.kind, 'downloaded');
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

test('a GUI C locale accepts Cyrillic and emoji paths and installs their exact bytes', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-unicode-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const relative = 'data/design-system_ab/JSONS/web/components/не-подключать/🚧OnboardingPersonalizationPage/composition-contract.json';
  await createPackage(root, 'unicode', undefined, undefined, { [relative]: '{"name":"Онбординг 🚧"}\n' });
  const archive = await pack(root, 'unicode');
  const child = spawnSync(process.execPath, ['-e', `
    require(process.argv[1]).installTarball({storeRoot:process.argv[2],tarballPath:process.argv[3],expectedIntegrity:process.argv[4]})
      .catch(e=>{console.error(e);process.exitCode=1});
  `, path.resolve(__dirname, '../src/knowledge-package'), path.join(root, 'store'), archive.tarball, archive.integrity],
  { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await fsp.readFile(path.join(root, 'store/versions/unicode', relative), 'utf8'), '{"name":"Онбординг 🚧"}\n');
});

test('UTF-8 archive listing still rejects escaped separators and control characters', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-unsafe-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  for (const entry of ['package/with\\backslash.json', 'package/line\nbreak.json', 'package/carriage\rreturn.json']) {
    const file = path.join(root, 'unsafe.tgz');
    await fsp.writeFile(file, maliciousTarball(entry));
    assert.throws(() => validateArchiveEntries(file), e => e.code === 'KNOWLEDGE_ARCHIVE_UNSAFE');
  }
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
  await fsp.mkdir(path.join(root, 'JSONS/tokens'), { recursive: true });
  await fsp.writeFile(path.join(root, 'JSONS/tokens/Base.json'), '{}');
  const files = await collectDesignSystemFiles(root);
  assert.ok(files.includes('apollo/runtime-rule.json'));
  assert.ok(files.includes('JSONS/tokens/Base.json'));
  assert.ok(!files.includes('apollo/knowledge/channels/stable.json'));
});

test('knowledge projection keeps generation semantic maps and their executable contract surface', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-generation-projection-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const packagePath = 'web/components/web-corp/FAQ';
  const packageRoot = path.join(root, 'JSONS', packagePath);
  await fsp.mkdir(path.join(root, 'JSONS/apollo/indexes'), { recursive: true });
  await fsp.mkdir(packageRoot, { recursive: true });
  await fsp.writeFile(path.join(packageRoot, 'contract.generated.json'), JSON.stringify({
    schemaVersion: 1,
    contracts: [{
      id: 'faq-desktop',
      name: '[D] FAQ',
      componentKey: 'a'.repeat(40),
      status: 'active',
      platform: 'desktop',
      role: 'main',
      figma: {
        defaultVariantKey: 'b'.repeat(40),
        variants: {
          properties: { Open: ['False', 'True'] },
          allowedCombinations: [{ Open: 'False' }, { Open: 'True' }],
          variantKeys: [{
            key: 'b'.repeat(40),
            id: '1:2',
            name: 'Open=False',
            properties: { Open: 'False' },
          }],
        },
        anatomy: [{
          id: '1:3',
          path: 'Accordion / Body / Subtitle',
          type: 'TEXT',
          characters: 'Answer',
        }],
      },
    }],
  }));
  await fsp.writeFile(
    path.join(packageRoot, 'semantic-targets.json'),
    '{"schemaVersion":"apollo.generation-semantic-target-map.v1"}\n'
  );
  await fsp.writeFile(
    path.join(root, 'JSONS/apollo/indexes/componentContractIndex.json'),
    JSON.stringify({
      schemaVersion: 2,
      packages: [{
        componentKey: 'a'.repeat(40),
        packagePath,
        artifacts: { generatedContract: 'contract.generated.json' },
      }],
    })
  );

  const files = await collectDesignSystemFiles(root);
  assert.ok(files.includes(`JSONS/${packagePath}/semantic-targets.json`));

  const source = JSON.parse(await fsp.readFile(
    path.join(packageRoot, 'contract.generated.json'),
    'utf8'
  ));
  const compact = compactGeneratedContract(source);
  assert.deepEqual(compact.contracts[0].figma.variants.properties, {
    Open: ['False', 'True'],
  });
  assert.deepEqual(compact.contracts[0].figma.variants.variantKeys, [{
    key: 'b'.repeat(40),
    properties: { Open: 'False' },
  }]);
  assert.deepEqual(compact.contracts[0].figma.anatomy, [{
    path: 'Accordion / Body / Subtitle',
    type: 'TEXT',
  }]);
  assert.equal(compact.contracts[0].figma.variants.allowedCombinations, undefined);
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

test('hub projection includes ABM pattern data recursively and keeps other ABM folders out', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-abm-projection-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const included = [
    'README.md',
    'CONTRACT.md',
    'products/ab/patterns/desktop.md',
    'core/web/components/fixture/meta.json',
    'products/abm/patterns/buttons.md',
    'products/abm/patterns/nested/evidence.json',
    'products/abm/patterns/nested/config.yaml',
    'products/abm/patterns/nested/config.yml',
    'products/abm/patterns/nested/notes.TXT',
  ];
  const excluded = [
    'products/abm/manifest.json',
    'products/abm/components/fixture/meta.json',
    'products/other/patterns/other.md',
    'products/abm/patterns/runtime.js',
    'products/abm/patterns/preview.png',
    'products/abm/patterns/.DS_Store',
  ];
  for (const relative of [...included, ...excluded]) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, 'fixture\n');
  }
  assert.deepEqual(await collectDsAiHubFiles(root), [...included].sort());

  await fsp.rm(path.join(root, 'products/abm/patterns'), { recursive: true });
  assert.deepEqual(
    await collectDsAiHubFiles(root),
    included.filter((relative) => !relative.startsWith('products/abm/')).sort()
  );
});

test('ABM pattern commits and bytes update the validated knowledge package', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-abm-package-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const designRoot = path.join(root, 'design-system_ab');
  const hubRoot = path.join(root, 'ds-ai-hub');
  const write = async (sourceRoot, relative, content) => {
    const target = path.join(sourceRoot, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  };
  const designFiles = {
    'JSONS/apollo/indexes/componentContractIndex.json': JSON.stringify({
      schemaVersion: 2,
      packages: [{ packagePath: 'web/components/fixture', artifacts: { rules: 'rules.json' } }],
    }),
    'JSONS/apollo/designPatternRules.json': '{"rules":[]}',
    'redpolrules/dictionary.json': '{"rules":[]}',
    'JSONS/web/components/fixture/rules.json': '{"rules":[]}',
  };
  for (const [relative, content] of Object.entries(designFiles)) {
    await write(designRoot, relative, content);
  }
  await write(hubRoot, 'products/ab/components/fixture/figma-keys.json', '{}');
  await write(hubRoot, 'core/web/components/fixture/figma-keys.json', '{}');
  const runFixtureGit = (...args) => {
    const result = spawnSync('git', ['-C', hubRoot, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runFixtureGit('init');
  runFixtureGit('config', 'user.name', 'Apollo Test');
  runFixtureGit('config', 'user.email', 'apollo-test@example.invalid');
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'existing knowledge');
  const options = {
    'design-system-root': designRoot,
    'design-system-commit': SOURCE_COMMITS['design-system_ab'],
    'ds-ai-hub-root': hubRoot,
    'generated-at': '2026-10-07T00:00:00.000Z',
    output: path.join(root, 'output'),
    channel: 'stable',
    minEngine: ENGINE_VERSION,
    maxEngine: ENGINE_VERSION,
    directoryOnly: true,
  };
  const baseline = await buildKnowledgePackage(options);
  const relative = 'products/abm/patterns/nested/buttons.md';
  const contents = '---\r\nplatform: [iOS, Android]\r\n---\r\n# Кнопки ABM\r\n';
  await write(hubRoot, relative, contents);
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'ABM pattern only');
  const patternCommit = runFixtureGit('rev-parse', 'HEAD');
  const updated = await buildKnowledgePackage(options);
  assert.equal(updated.manifest.sourceCommits['ds-ai-hub'], patternCommit);
  assert.notEqual(updated.manifest.contentVersion, baseline.manifest.contentVersion);
  assert.notEqual(updated.manifest.checksum.value, baseline.manifest.checksum.value);
  const artifactPath = `data/ds-ai-hub/${relative}`;
  const artifact = updated.manifest.artifacts.find((entry) => entry.path === artifactPath);
  assert.ok(artifact);
  assert.equal(artifact.sha256, await sha256File(path.join(hubRoot, relative)));
  assert.equal(artifact.size, Buffer.byteLength(contents));
  assert.equal(await fsp.readFile(path.join(updated.packageRoot, artifactPath), 'utf8'), contents);
  await validatePackageDirectory(updated.packageRoot, ENGINE_VERSION);

  await write(hubRoot, 'products/abm/components/fixture/meta.json', '{}');
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'unrelated ABM component');
  assert.notEqual(runFixtureGit('rev-parse', 'HEAD'), patternCommit);
  const unrelated = await buildKnowledgePackage(options);
  assert.equal(unrelated.manifest.sourceCommits['ds-ai-hub'], patternCommit);
  assert.equal(unrelated.manifest.contentVersion, updated.manifest.contentVersion);
  assert.equal(unrelated.manifest.checksum.value, updated.manifest.checksum.value);

  await write(hubRoot, relative, `${contents}Обновлённое правило.\r\n`);
  const edited = await buildKnowledgePackage(options);
  assert.notEqual(edited.manifest.contentVersion, updated.manifest.contentVersion);
  assert.notEqual(edited.manifest.checksum.value, updated.manifest.checksum.value);
});

test('knowledge provenance follows the declared catalog set as it grows and rejects unlisted/duplicate/missing files', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-growing-catalogs-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const base = await createPackage(root, 'base'), designRoot = path.join(root, 'design'), hubRoot = path.join(root, 'hub');
  await fsp.cp(path.join(base, 'data/design-system_ab'), designRoot, { recursive: true });
  await fsp.cp(path.join(base, 'data/ds-ai-hub'), hubRoot, { recursive: true });
  const write = async (relative, value) => { const file = path.join(designRoot, relative); await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(value)); };
  await write('JSONS/apollo/indexes/componentContractIndex.json', { schemaVersion: 2, packages: [{ packagePath: 'fixture', artifacts: {} }] });
  const catalogs = Array.from({ length: 24 }, (_, i) => ({ path: `tokens/token-${i}.json`, fileName: `Token ${i}` }));
  catalogs.push({ path: 'styles/style.json', fileName: 'Style' });
  for (const entry of catalogs) await write('JSONS/' + entry.path, { meta: { library: 'Fixture', fileName: entry.fileName }, ...(entry.path.startsWith('tokens/') ? { collections: [] } : { styles: [] }) });
  await write('JSONS/referenceSourcesMVP.json', { catalogs });
  const options = { 'design-system-root': designRoot, 'ds-ai-hub-root': hubRoot,
    'design-system-commit': SOURCE_COMMITS['design-system_ab'], 'ds-ai-hub-commit': SOURCE_COMMITS['ds-ai-hub'],
    'generated-at': '2026-10-28T00:00:00Z', output: path.join(root, 'output'), channel: 'stable',
    minEngine: ENGINE_VERSION, maxEngine: ENGINE_VERSION, directoryOnly: true };
  const built = await buildKnowledgePackage(options);
  await validatePackageDirectory(built.packageRoot);
  const provenance = JSON.parse(await fsp.readFile(path.join(built.packageRoot, 'data/design-system_ab/apollo/style-token-catalog-provenance.json')));
  assert.equal(provenance.sourcePins.length, 25);
  const loaded = require('../src/style-token-catalog/inventory').loadPackageSnapshot(built.packageRoot);
  assert.equal(loaded.rawCatalogs.size, 25); loaded.assertFresh();
  await write('JSONS/tokens/extra.json', { meta: {}, collections: [] });
  await assert.rejects(buildKnowledgePackage(options), { code: 'KNOWLEDGE_CATALOG_REFERENCE_MISMATCH' });
  await fsp.unlink(path.join(designRoot, 'JSONS/tokens/extra.json'));
  await write('JSONS/referenceSourcesMVP.json', { catalogs: [...catalogs, catalogs[0]] });
  await assert.rejects(buildKnowledgePackage(options), /Duplicate catalog/);
  await write('JSONS/referenceSourcesMVP.json', { catalogs });
  await fsp.unlink(path.join(designRoot, 'JSONS/' + catalogs[0].path));
  await assert.rejects(buildKnowledgePackage(options), { code: 'ENOENT' });
});

const {
  resolveKnowledgeRoot,
  assertCompleteKnowledgeRoot,
} = require('../src/knowledge-root');

async function syntheticRoot(t, kind) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-root-selection-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const files = kind === 'design-system_ab' ? {
    'JSONS/apollo/indexes/componentContractIndex.json': JSON.stringify({ schemaVersion: 2, packages: [{ componentKey: 'synthetic' }] }),
    'JSONS/apollo/designPatternRules.json': JSON.stringify({ rules: [] }),
    'redpolrules/dictionary.json': JSON.stringify({ rules: [] }),
    'patterns/p_synthetic.md': '# Synthetic root marker\n',
  } : {
    'products/ab/components/synthetic/figma-keys.json': '{}',
    'core/web/components/synthetic/figma-keys.json': '{}',
    'products/ab/patterns/synthetic.md': '# Synthetic root marker\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content);
  }
  return root;
}

for (const kind of ['design-system_ab', 'ds-ai-hub']) {
  test(`${kind === 'design-system_ab' ? 'component projection' : 'absent hub'} cannot shadow a complete checkout`, async t => {
    const checkoutRoot = await syntheticRoot(t, kind);
    const bundledRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-partial-root-'));
    t.after(() => fsp.rm(bundledRoot, { recursive: true, force: true }));
    await fsp.mkdir(path.join(bundledRoot, 'apollo'), { recursive: true });
    await fsp.mkdir(path.join(bundledRoot, 'web'), { recursive: true });
    await fsp.writeFile(path.join(bundledRoot, 'apollo/contract-knowledge-manifest.json'), JSON.stringify({ schemaVersion: 1, packageCount: 1 }));
    const candidate = kind === 'design-system_ab' ? bundledRoot : path.join(bundledRoot, 'missing-hub');
    assert.equal(resolveKnowledgeRoot({ kind, bundledRoot: candidate, checkoutRoot }), checkoutRoot);
  });

  test(`complete bundled ${kind} keeps priority over checkout`, async t => {
    const bundledRoot = await syntheticRoot(t, kind);
    const checkoutRoot = await syntheticRoot(t, kind);
    assert.equal(resolveKnowledgeRoot({ kind, bundledRoot, checkoutRoot }), bundledRoot);
  });

  test(`selected missing ${kind} root is never silently replaced`, async t => {
    const checkoutRoot = await syntheticRoot(t, kind);
    const selected = path.join(checkoutRoot, 'missing-current-release');
    const actual = resolveKnowledgeRoot({ kind, configuredRoot: selected, bundledRoot: checkoutRoot, checkoutRoot });
    assert.equal(actual, selected);
    assert.throws(() => assertCompleteKnowledgeRoot(actual, kind), error => (
      error.code === 'CODEX_KNOWLEDGE_INCOMPLETE' && error.status === 503
      && !error.message.includes(selected)
    ));
  });

  test(`unavailable default ${kind} roots fail bounded without merging partial trees`, async t => {
    const partial = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-partial-root-'));
    t.after(() => fsp.rm(partial, { recursive: true, force: true }));
    assert.throws(() => resolveKnowledgeRoot({ kind, bundledRoot: partial, checkoutRoot: path.join(partial, 'missing') }),
      error => error.code === 'CODEX_KNOWLEDGE_INCOMPLETE' && error.status === 503);
  });
}

for (const relative of [
  'JSONS/apollo/indexes/componentContractIndex.json',
  'JSONS/apollo/designPatternRules.json',
  'redpolrules/dictionary.json',
]) {
  test(`malformed selected ${relative} fails before checkout fallback`, async t => {
    const selected = await syntheticRoot(t, 'design-system_ab');
    const checkoutRoot = await syntheticRoot(t, 'design-system_ab');
    await fsp.writeFile(path.join(selected, relative), '{broken');
    const actual = resolveKnowledgeRoot({ kind: 'design-system_ab', configuredRoot: selected, bundledRoot: checkoutRoot, checkoutRoot });
    assert.equal(actual, selected);
    assert.throws(() => assertCompleteKnowledgeRoot(actual, 'design-system_ab'),
      error => error.code === 'CODEX_KNOWLEDGE_INCOMPLETE' && error.status === 503);
  });
}

for (const [relative, value] of [
  ['JSONS/apollo/indexes/componentContractIndex.json', { schemaVersion: 1, packages: [{ componentKey: 'synthetic' }] }],
  ['JSONS/apollo/indexes/componentContractIndex.json', { schemaVersion: 2, packages: [] }],
  ['JSONS/apollo/designPatternRules.json', { rules: {} }],
  ['redpolrules/dictionary.json', { rules: null }],
]) {
  test(`selected prerequisite shape rejects ${relative} ${JSON.stringify(value)}`, async t => {
    const selected = await syntheticRoot(t, 'design-system_ab');
    await fsp.writeFile(path.join(selected, relative), JSON.stringify(value));
    assert.throws(() => assertCompleteKnowledgeRoot(selected, 'design-system_ab'),
      error => error.code === 'CODEX_KNOWLEDGE_INCOMPLETE');
  });
}

test('selected root readiness detects drift after selection without mixing roots', async t => {
  const selected = await syntheticRoot(t, 'design-system_ab');
  const checkoutRoot = await syntheticRoot(t, 'design-system_ab');
  const actual = resolveKnowledgeRoot({ kind: 'design-system_ab', configuredRoot: selected, bundledRoot: checkoutRoot, checkoutRoot });
  assertCompleteKnowledgeRoot(actual, 'design-system_ab');
  await fsp.rm(path.join(selected, 'patterns'), { recursive: true });
  assert.throws(() => assertCompleteKnowledgeRoot(actual, 'design-system_ab'),
    error => error.code === 'CODEX_KNOWLEDGE_INCOMPLETE');
});


for (const corrupt of [false, true]) {
  test(`legacy readiness blocks selected ${corrupt ? 'malformed' : 'missing'} release while v4 module remains loadable`, async t => {
    const selected = await syntheticRoot(t, 'design-system_ab');
    const hub = await syntheticRoot(t, 'ds-ai-hub');
    if (corrupt) await fsp.writeFile(path.join(selected, 'JSONS/apollo/designPatternRules.json'), '{broken');
    const configured = corrupt ? selected : path.join(selected, 'missing-release');
    const script = `
      const server = require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});
      if (typeof server.callCodexContractExplanation !== 'function') process.exit(2);
      try { server.assertGenerationRuntimeReady(); process.exit(3); }
      catch (error) { process.stdout.write(JSON.stringify({ code: error.code, status: error.status, message: error.message })); }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: selected,
      env: { ...process.env, CODEX_DESIGN_SYSTEM: configured, CODEX_DS_AI_HUB: hub },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, 'CODEX_KNOWLEDGE_INCOMPLETE');
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(configured), false);
  });
}


for (const kind of ['design-system_ab', 'ds-ai-hub']) {
  test(`broken full bundled ${kind} is not replaced by healthy checkout`, async t => {
    const bundledRoot = await syntheticRoot(t, kind);
    const checkoutRoot = await syntheticRoot(t, kind);
    if (kind === 'design-system_ab') await fsp.writeFile(path.join(bundledRoot, 'JSONS/apollo/designPatternRules.json'), '{broken');
    else await fsp.rm(path.join(bundledRoot, 'products/ab/patterns'), { recursive: true });
    assert.throws(() => resolveKnowledgeRoot({ kind, bundledRoot, checkoutRoot }),
      error => error.code === 'CODEX_KNOWLEDGE_INCOMPLETE' && error.status === 503);
  });
}

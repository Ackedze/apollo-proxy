#!/usr/bin/env node
'use strict';
// Local release assembly only: publishing and installed stores are never touched.
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const releases = require('../src/data-release'), knowledge = require('../src/knowledge-package');
const packages = require('../src/data-packages'), protectedData = require('../src/data-packages/protected');
const { buildDataRelease, PORTABLE_PROFILE } = require('./build-data-release');
const { buildProtectedDataPackage } = require('./build-protected-data-package');
const fail = code => { throw Object.assign(Error(code), { code }); };
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

function selectContracts(base, entries) {
  const selected = base.contracts.map(old => {
    const matches = entries.filter(entry => entry.contractId === old.id);
    if (matches.length !== 1) fail('DATA_PREPARE_CONTRACT_SELECTION_INVALID');
    const entry = matches[0];
    const platform = base.catalog?.find(row => row.contractId === old.id)?.platform;
    if (entry.componentId !== old.componentId || entry.revision < old.revision || platform && platform !== entry.platform) fail('DATA_PREPARE_CONTRACT_IDENTITY_INVALID');
    return { old, entry };
  });
  if (new Set(selected.map(s => s.entry.componentId)).size !== selected.length) fail('DATA_COMPONENT_CONFLICT');
  return {
    selected,
    excluded: entries.filter(entry => !selected.some(s => s.entry.contractId === entry.contractId))
      .map(({ contractId, componentId, platform, revision }) => ({ contractId, componentId, platform, revision })),
  };
}

async function pinned(root, file, expected, pins) {
  if (!knowledge.isSafeRelativePath(file)) fail('DATA_PREPARE_PATH_INVALID');
  const target = path.resolve(root, file), stat = await fs.lstat(target);
  if (!stat.isFile() || await fs.realpath(target) !== target) fail('DATA_PREPARE_PATH_INVALID');
  const bytes = await fs.readFile(target), pin = { sha256: releases.sha(bytes), bytes: bytes.length };
  if (expected && (expected.sha256 !== pin.sha256 || expected.bytes !== undefined && expected.bytes !== pin.bytes)) fail('DATA_PREPARE_INPUT_CHANGED');
  pins.set(target, pin);
  return bytes;
}

async function inputSnapshot(config) {
  const pins = new Map(), runtime = releases.readRuntime(config.runtimeRoot);
  const baseManifest = await releases.validateRelease(config.baseRelease, { runtimeRoot: config.baseRuntimeRoot || config.runtimeRoot });
  for (const pin of baseManifest.files) pins.set(path.join(config.baseRelease, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
  await pinned(config.baseRelease, 'manifest.json', null, pins);
  const base = await json(path.join(config.baseRelease, 'contracts/manifest.json'));
  if (base.deliveryProfile !== PORTABLE_PROFILE) fail('DATA_PREPARE_PROFILE_INVALID');
  const inputs = { base: baseManifest.id, runtimeId: runtime.id, tarballUrl: config.tarballUrl }, updates = [], excluded = [];
  for (const pin of runtime.files) pins.set(path.join(config.runtimeRoot, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
  await pinned(config.runtimeRoot, 'portable-runtime.json', null, pins);
  if (config.baseRuntimeRoot) {
    const previousRuntime = releases.readRuntime(config.baseRuntimeRoot);
    for (const pin of previousRuntime.files) pins.set(path.join(config.baseRuntimeRoot, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
    await pinned(config.baseRuntimeRoot, 'portable-runtime.json', null, pins);
  }
  if (config.designSystemRoot) {
    const root = config.designSystemRoot;
    const manifest = JSON.parse(await pinned(root, 'experiments/current-contract-packages/manifest.json', null, pins));
    if (manifest.schemaVersion !== 'component-contract-package-collection.v1' || manifest.archivePathBase !== 'design-system_ab' || manifest.authoringIndex?.file !== '../../JSONS/indexes/component-contracts.index.json') fail('DATA_PREPARE_CATALOG_INVALID');
    const source = JSON.parse(await pinned(root, 'JSONS/indexes/component-contracts.index.json', manifest.authoringIndex, pins));
    if (source.schemaVersion !== 'apollo.component-contract-sources.v1' || source.pathBase !== 'design-system_ab') fail('DATA_PREPARE_CATALOG_INVALID');
    const selection = selectContracts(base, source.entries), core = require(path.join(config.runtimeRoot, 'packages/component-contract-core/dist/core.cjs'));
    excluded.push(...selection.excluded);
    inputs.contracts = [];
    for (const { old, entry } of selection.selected) {
      const archives = manifest.packages.filter(p => p.contractId === entry.contractId);
      if (archives.length !== 1) fail('DATA_PREPARE_CATALOG_INVALID');
      const archive = archives[0];
      if (archive.componentId !== entry.componentId || archive.revision !== entry.revision || archive.zipSha256 !== entry.archiveSha256 || archive.manualSourceHash !== entry.manualSourceHash || path.posix.dirname(archive.file) !== path.posix.join(path.posix.dirname(entry.manual.path), 'packages')) fail('DATA_PREPARE_CATALOG_INVALID');
      const manual = JSON.parse(await pinned(root, entry.manual.path, entry.manual, pins));
      const facts = JSON.parse(await pinned(root, entry.facts.path, entry.facts, pins));
      await pinned(root, archive.file, { sha256: archive.zipSha256, bytes: archive.bytes }, pins);
      if (manual.component?.contractId !== entry.contractId || manual.component?.componentId !== entry.componentId || manual.metadata?.revision !== entry.revision || core.stableHash(manual) !== entry.manualSourceHash) fail('DATA_PREPARE_CONTRACT_IDENTITY_INVALID');
      // The compiler defines normative fact hashing; unused library text is excluded.
      const factsHash = core.compileManualSource(manual, facts).contract.package.generatedFactsHash;
      inputs.contracts.push([entry.contractId, entry.platform, entry.revision, entry.manualSourceHash, factsHash, archive.zipSha256]);
      if (old.manualSourceHash !== entry.manualSourceHash || old.generatedFactsHash !== factsHash || old.revision !== entry.revision) updates.push({ entry, factsHash, archive: path.join(root, archive.file) });
    }
  }
  const knowledgeRoot = config.knowledgeRoot || path.join(config.baseRelease, 'knowledge');
  const defaultSkills = path.join(config.baseRelease, 'skills');
  const skillsRoot = config.skillsRoot || (sync.existsSync(defaultSkills) ? defaultSkills : undefined);
  inputs.knowledge = (await knowledge.validatePackageDirectory(knowledgeRoot)).contentVersion;
  inputs.files = [];
  for (const [kind, root] of [['knowledge', knowledgeRoot], ['skills', skillsRoot]]) {
    if (!root) continue;
    for (const file of await knowledge.listPackageFiles(root)) {
      const bytes = await pinned(root, file, null, pins);
      inputs.files.push([kind, file, releases.sha(bytes)]);
    }
  }
  const activationBytes = await pinned(path.dirname(config.activationFile), path.basename(config.activationFile), null, pins);
  const activation = protectedData.validateActivation(JSON.parse(activationBytes));
  inputs.activation = activation;
  // Detect relevant builder changes without timestamps, random encryption IVs or output metadata.
  inputs.producer = [];
  for (const directory of ['scripts', 'src/data-packages', 'src/data-release', 'src/knowledge-package', 'src/skills']) {
    for (const file of await knowledge.listPackageFiles(path.join(__dirname, '..', directory))) {
      const relative = directory + '/' + file;
      const bytes = await pinned(path.resolve(__dirname, '..'), relative, null, pins);
      inputs.producer.push([relative, releases.sha(bytes)]);
    }
  }
  return { base, baseManifest, runtime, updates, excluded, knowledgeRoot, skillsRoot, activation, pins, fingerprint: releases.idOf(inputs) };
}

async function assertInputs(snapshot) {
  for (const [file, expected] of snapshot.pins) {
    const stat = await fs.lstat(file), bytes = await fs.readFile(file);
    if (!stat.isFile() || await fs.realpath(file) !== file || releases.sha(bytes) !== expected.sha256 || bytes.length !== expected.bytes) fail('DATA_PREPARE_INPUT_CHANGED');
  }
}

async function overlayContracts(config, snapshot, work) {
  const root = path.join(work, 'contracts');
  await fs.cp(path.join(config.baseRelease, 'contracts'), root, { recursive: true });
  if (!snapshot.updates.length) return root;
  const deltaRoot = path.join(work, 'delta');
  // Supply exact retained dependency sources, without reimporting old archives.
  await fs.cp(root, deltaRoot, { recursive: true });
  const seed = structuredClone(snapshot.base);
  for (const entry of seed.contracts) delete entry.archive;
  // Only dependency compilation uses this seed; final mapping remains the exact baseline.
  seed.generation = {};
  seed.id = releases.idOf(seed);
  await fs.writeFile(path.join(deltaRoot, 'manifest.json'), JSON.stringify(seed) + '\n');
  await require('../src/data-packages/import').importDataPackage({ root: deltaRoot, apolloRoot: config.runtimeRoot, packages: snapshot.updates.map(u => u.archive) });
  const delta = await json(path.join(deltaRoot, 'manifest.json')), next = structuredClone(snapshot.base);
  if (delta.contracts.length !== snapshot.base.contracts.length) fail('DATA_PREPARE_CONTRACT_IDENTITY_INVALID');
  for (const update of snapshot.updates) {
    const incoming = delta.contracts.find(c => c.id === update.entry.contractId);
    const previous = snapshot.base.contracts.find(c => c.id === update.entry.contractId);
    if (!incoming || incoming.componentId !== update.entry.componentId || incoming.revision !== update.entry.revision || incoming.manualSourceHash !== update.entry.manualSourceHash || previous.checkingGap === null && incoming.checkingGap !== null) fail('DATA_PREPARE_CONTRACT_IDENTITY_INVALID');
    if (incoming.generatedFactsHash !== update.factsHash) fail('DATA_PREPARE_CONTRACT_FACTS_MISMATCH');
    for (const pin of [{ file: incoming.file, sha256: incoming.sha256 }, incoming.compiledCache, incoming.archive].filter(Boolean)) {
      const bytes = await pinned(deltaRoot, pin.file, pin, new Map()), target = path.join(root, pin.file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (sync.existsSync(target)) {
        if (!(await fs.readFile(target)).equals(bytes)) fail('DATA_PREPARE_ARTIFACT_CONFLICT');
      } else await fs.writeFile(target, bytes, { flag: 'wx' });
    }
    next.contracts[next.contracts.findIndex(c => c.id === incoming.id)] = incoming;
    next.catalog = next.catalog.map(row => row.contractId === incoming.id ? {
      ...row, ...Object.fromEntries(['revision', 'manualSourceHash', 'updatedAt', 'checking'].map(key => [key, delta.catalog.find(c => c.contractId === incoming.id)[key]])),
    } : row);
  }
  next.id = releases.idOf(next);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(next, null, 2) + '\n');
  packages.readGenerationData({ root, apolloRoot: config.runtimeRoot }).assertCurrent();
  return root;
}

async function passwordFrom(input, command) {
  if (command) {
    if (!Array.isArray(command) || !command.length || command.some(a => typeof a !== 'string')) fail('DATA_PREPARE_PASSWORD_COMMAND_INVALID');
    try { input = execFileSync(command[0], command.slice(1), { maxBuffer: 4096, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { fail('DATA_PREPARE_PASSWORD_COMMAND_FAILED'); }
  }
  if (input === undefined) {
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 4096) fail('DATA_ACTIVATION_INPUT_INVALID'); chunks.push(chunk); }
    input = Buffer.concat(chunks);
  }
  try {
    if (Buffer.byteLength(input) > 4096) fail('DATA_ACTIVATION_INPUT_INVALID');
    const access = JSON.parse(input);
    if (typeof access.password !== 'string') fail('DATA_ACTIVATION_INPUT_INVALID');
    return access.password;
  } finally { if (Buffer.isBuffer(input)) input.fill(0); }
}

async function prepareDataPackage(config, { passwordInput } = {}) {
  const snapshot = await inputSnapshot(config).catch(error => { error.stage = 'inputs'; throw error; });
  const output = path.resolve(config.outputRoot);
  // Reject symlink ancestors before even writing a lock inside an input tree.
  let ancestor = output;
  while (!sync.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (await fs.realpath(ancestor) !== ancestor) fail('DATA_PREPARE_OUTPUT_UNSAFE');
  if ([config.baseRelease, config.runtimeRoot, config.baseRuntimeRoot, config.designSystemRoot, config.knowledgeRoot, config.skillsRoot].filter(Boolean).some(root => output === root || output.startsWith(root + path.sep) || root.startsWith(output + path.sep))) fail('DATA_PREPARE_OUTPUT_UNSAFE');
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const lock = path.join(output, '.prepare.lock'), fd = await fs.open(lock, 'wx');
  let work, stage = 'cache';
  try {
    const last = await json(path.join(output, 'last-build.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (last?.inputFingerprint === snapshot.fingerprint) {
      for (const pin of [last.artifact, last.descriptor]) await pinned(output, pin.file, pin, new Map());
      await assertInputs(snapshot);
      return { ...last, status: 'UNCHANGED', excluded: snapshot.excluded };
    }
    const tarballUrl = config.tarballUrl.replaceAll('{version}', config.version);
    require('../src/data-packages/npm').validateReference({ name: '@apollo/data', version: config.version, tarballUrl, bytes: 1, integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), dataId: snapshot.baseManifest.id });
    const target = path.join(output, config.version);
    if (sync.existsSync(target)) fail('DATA_PREPARE_VERSION_EXISTS');
    stage = 'activation';
    const password = await passwordFrom(passwordInput, config.passwordCommand);
    protectedData.accessKey(snapshot.activation, { password });
    work = await fs.mkdtemp(path.join(output, '.prepare-'));
    stage = 'contracts';
    const dataRoot = await overlayContracts(config, snapshot, work);
    stage = 'release';
    const release = await buildDataRelease({ dataRoot, knowledgeRoot: snapshot.knowledgeRoot, skillsRoot: snapshot.skillsRoot,
      runtimeRoot: config.runtimeRoot, output: path.join(work, 'release'), profile: PORTABLE_PROFILE,
      tarballUrl: 'https://example.invalid/local-only/{version}.tgz' });
    stage = 'npm';
    const built = await buildProtectedDataPackage({ releaseRoot: release.packageRoot, runtimeRoot: config.runtimeRoot,
      output: path.join(work, 'npm'), version: config.version, tarballUrl, activation: snapshot.activation, password });
    const archive = await fs.readFile(built.tarballPath), store = path.join(work, 'verify');
    await fs.mkdir(store, { mode: 0o700 });
    stage = 'consumer';
    const result = await protectedData.installProtected({ settings: { storeRoot: store, seedRoot: path.join(work, 'empty-seed'), runtimeRoot: config.runtimeRoot },
      ensured: { state: { current: null, previous: null } }, selected: { index: built.descriptor, commit: null }, command: 'update', access: { password },
      request: async url => { if (String(url) !== tarballUrl) fail('DATA_PREPARE_VERIFICATION_URL_INVALID'); return new Response(archive); }, releases });
    if (!result.updated || result.current.contentVersion !== release.manifest.id || 'activationKey' in result) fail('DATA_PREPARE_VERIFICATION_FAILED');
    stage = 'freshness';
    await assertInputs(snapshot);
    await fs.rm(built.packageRoot, { recursive: true });
    const tarball = path.basename(built.tarballPath), descriptorBytes = await fs.readFile(path.join(work, 'npm/current.json'));
    const report = { schemaVersion: 'apollo.data-package-build.v1', status: 'PREPARED_LOCAL', inputFingerprint: snapshot.fingerprint,
      version: config.version, runtimeId: snapshot.runtime.id, runtimeChanged: snapshot.runtime.id !== snapshot.baseManifest.runtimeId,
      contentVersion: release.manifest.id, contracts: snapshot.base.contracts.length,
      updated: snapshot.updates.map(u => ({ contractId: u.entry.contractId, revision: u.entry.revision })), excluded: snapshot.excluded,
      artifact: { file: config.version + '/' + tarball, sha256: releases.sha(archive), bytes: archive.length },
      descriptor: { file: config.version + '/current.json', sha256: releases.sha(descriptorBytes), bytes: descriptorBytes.length },
      actualProtectedConsumer: 'PASS', Ready: false, published: false, installed: false };
    stage = 'output';
    await write(path.join(work, 'npm/report.json'), report);
    await fs.rename(path.join(work, 'npm'), target);
    const marker = path.join(output, '.last-build.next');
    await write(marker, report); await fs.rename(marker, path.join(output, 'last-build.json'));
    return report;
  } catch (error) { error.stage = stage; throw error; }
  finally {
    if (work) await fs.rm(work, { recursive: true, force: true });
    await fd.close(); await fs.unlink(lock);
  }
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--config': 'config', '--version': 'version' }[argv[i]];
    if (!key || !argv[i + 1]) fail('DATA_PREPARE_ARGUMENT_INVALID');
    options[key] = argv[i + 1];
  }
  const configFile = path.resolve(options.config), config = await json(configFile);
  if (config.schemaVersion !== 'apollo.data-package-build.v1') fail('DATA_PREPARE_CONFIG_INVALID');
  for (const key of ['baseRelease', 'runtimeRoot', 'baseRuntimeRoot', 'designSystemRoot', 'activationFile', 'knowledgeRoot', 'skillsRoot', 'outputRoot']) {
    if (config[key] !== undefined) config[key] = path.resolve(path.dirname(configFile), config[key]);
  }
  config.version = options.version || config.version;
  console.log(JSON.stringify(await prepareDataPackage(config)));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ code: error.code || 'DATA_PREPARE_FAILED', stage: error.stage || 'config' })); process.exitCode = 1; });
module.exports = { selectContracts, inputSnapshot, assertInputs, overlayContracts, prepareDataPackage, passwordFrom, main };

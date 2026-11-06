#!/usr/bin/env node
'use strict';
// Local release assembly only: publishing and installed stores are never touched.
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
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

async function rawCatalogInputs(root, selected, pins) {
  const result = [];
  async function add(entry, manual, file, expected, requiredVariants = [], representationIds) {
    const bytes = await pinned(root, file, expected, pins), raw = JSON.parse(bytes);
    if (!Array.isArray(raw.components)) fail('DATA_PREPARE_CATALOG_INVALID');
    for (const variantKey of requiredVariants) {
      const owners = raw.components.filter(component => component.key === variantKey || component.variants?.some(v => v.key === variantKey));
      if (owners.length !== 1 || !Array.isArray(owners[0].structure) || !owners[0].structure.length
        || owners[0].variants?.some(v => v.key === variantKey) && !Array.isArray(owners[0].variantStructures?.[variantKey])) fail('DATA_PREPARE_CATALOG_VARIANT_UNAVAILABLE');
    }
    const reps = manual.representations.filter(rep => rep.kind === 'figma' && rep.status !== 'deprecated'
      && raw.components.some(component => component.key === (rep.locator?.componentSetKey || rep.locator?.componentKey)
        || component.variants?.some(v => v.key === rep.locator?.componentKey))).map(rep => rep.id).sort();
    if (!reps.length || representationIds && (!Array.isArray(representationIds) || !representationIds.length
      || new Set(representationIds).size !== representationIds.length || representationIds.some(id => !reps.includes(id)))) fail('DATA_PREPARE_CATALOG_IDENTITY_INVALID');
    result.push({ contractId:entry.contractId, componentId:entry.componentId, revision:entry.revision,
      representationIds:representationIds || reps, source:{path:file,sha256:releases.sha(bytes),bytes:bytes.length} });
  }
  for (const { entry, manual } of selected) {
    const directory = path.posix.dirname(entry.manual.path), descriptorPath = directory + '/pilot/catalog-source.json';
    if (!sync.existsSync(path.join(root, descriptorPath))) continue;
    const descriptor = JSON.parse(await pinned(root, descriptorPath, null, pins));
    if (descriptor.schemaVersion !== 'apollo.catalog-pilot-source.v1' || descriptor.contractId !== entry.contractId
      || descriptor.componentId !== entry.componentId || descriptor.revision !== entry.revision
      || descriptor.manualSourceHash !== entry.manualSourceHash || !descriptor.catalog?.file) fail('DATA_PREPARE_CATALOG_IDENTITY_INVALID');
    const catalogPath = path.posix.normalize(path.posix.join(path.posix.dirname(descriptorPath), descriptor.catalog.file));
    await add(entry, manual, catalogPath, descriptor.catalog, [], descriptor.representationIds);
    if (!descriptor.dependencySources) continue;
    const dependencyPath = path.posix.normalize(path.posix.join(path.posix.dirname(descriptorPath), descriptor.dependencySources.file));
    const dependencies = JSON.parse(await pinned(root, dependencyPath, descriptor.dependencySources, pins));
    if (dependencies.schemaVersion !== 'apollo.titleview-pilot-dependency-sources.v1'
      || dependencies.ownerContract?.componentId !== entry.componentId || dependencies.ownerContract.revision !== entry.revision
      || dependencies.ownerContract.manualSourceHash !== entry.manualSourceHash || !Array.isArray(dependencies.contracts)) fail('DATA_PREPARE_CATALOG_IDENTITY_INVALID');
    for (const dependency of dependencies.contracts) {
      const matches = selected.filter(item => item.entry.contractId === dependency.contractId && item.entry.componentId === dependency.componentId
        && item.entry.revision === dependency.revision && item.entry.manualSourceHash === dependency.manualSourceHash);
      if (matches.length !== 1 || !Array.isArray(dependency.rawSources) || !dependency.rawSources.length) fail('DATA_PREPARE_CATALOG_IDENTITY_INVALID');
      const declared = dependency.rawSources.flatMap(source => (source.components || []).flatMap(component => (component.requiredVariants || []).map(variant => variant.key)));
      if (!Array.isArray(dependency.requiredVariantKeys) || !dependency.requiredVariantKeys.length
        || dependency.requiredVariantKeys.some(key => !declared.includes(key))) fail('DATA_PREPARE_CATALOG_VARIANT_UNAVAILABLE');
      for (const source of dependency.rawSources) await add(matches[0].entry, matches[0].manual, source.path, source,
        (source.components || []).flatMap(component => (component.requiredVariants || []).map(variant => variant.key)));
    }
  }
  return result;
}

async function overlayRawCatalogs(config, snapshot, root) {
  if (!snapshot.rawCatalogs?.length) return;
  const index = await json(path.join(root, 'manifest.json')), descriptors = [];
  for (const input of snapshot.rawCatalogs) {
    const bytes = await pinned(config.designSystemRoot, input.source.path, input.source, new Map());
    const file = 'catalogs/' + input.source.sha256 + '.json', target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive:true });
    if (sync.existsSync(target)) { if (!(await fs.readFile(target)).equals(bytes)) fail('DATA_PREPARE_ARTIFACT_CONFLICT'); }
    else await fs.writeFile(target, bytes, {flag:'wx'});
    const incoming = {contractId:input.contractId,componentId:input.componentId,revision:input.revision,
      representationIds:input.representationIds,catalog:{file,sha256:input.source.sha256,bytes:bytes.length}};
    const duplicate = descriptors.find(item => item.contractId === incoming.contractId && item.revision === incoming.revision && item.catalog.file === file);
    if (duplicate) duplicate.representationIds = [...new Set([...duplicate.representationIds,...incoming.representationIds])].sort();
    else descriptors.push(incoming);
  }
  const previous = (index.rawCatalogs || []).flatMap(item => {
    const replacements = descriptors.filter(row => row.contractId === item.contractId);
    const remaining = (item.representationIds || []).filter(id => !replacements.some(row => row.representationIds.includes(id)));
    return replacements.length ? remaining.length ? [{...item,representationIds:remaining}] : [] : [item];
  });
  index.rawCatalogs = previous.concat(descriptors); index.id = releases.idOf(index);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(index,null,2) + '\n');
}

async function inputSnapshot(config) {
  const pins = new Map(), runtime = releases.readRuntime(config.runtimeRoot);
  const baseManifest = await releases.validateRelease(config.baseRelease, { runtimeRoot: config.baseRuntimeRoot || config.runtimeRoot });
  for (const pin of baseManifest.files) pins.set(path.join(config.baseRelease, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
  await pinned(config.baseRelease, 'manifest.json', null, pins);
  const base = await json(path.join(config.baseRelease, 'contracts/manifest.json'));
  const knowledgeRoot = config.knowledgeRoot || path.join(config.baseRelease, 'knowledge');
  const auditFile = path.join(knowledgeRoot, 'data/v3-audit/manifest.json');
  const auditData = sync.existsSync(auditFile)
    ? await require('../src/audit-data/reader').createAuditDataReader({knowledgeRoot}).manifest() : null;
  if (auditData && runtime.capabilities?.auditDataPreparation !== require('../src/audit-data/protocol').SCHEMA) fail('DATA_PREPARE_AUDIT_CODE_REQUIRED');
  if (!auditData && runtime.capabilities?.auditDataPreparation) fail('DATA_PREPARE_AUDIT_DATA_REQUIRED');
  if (base.deliveryProfile !== PORTABLE_PROFILE) fail('DATA_PREPARE_PROFILE_INVALID');
  const inputs = { base: baseManifest.id, runtimeId: runtime.id, tarballUrl: config.tarballUrl, bundleRuntime: !!config.bundleRuntime,
    ...(config.incremental ? {incremental:{objectsUrl:config.incremental.objectsUrl,packUrl:config.incremental.packUrl}} : {}) }, updates = [], excluded = [], selectedManuals = [];
  let rawCatalogs = [];
  for (const pin of runtime.files) pins.set(path.join(config.runtimeRoot, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
  await pinned(config.runtimeRoot, 'portable-runtime.json', null, pins);
  if (config.baseRuntimeRoot) {
    const previousRuntime = releases.readRuntime(config.baseRuntimeRoot);
    for (const pin of previousRuntime.files) pins.set(path.join(config.baseRuntimeRoot, pin.file), { sha256: pin.sha256, bytes: pin.bytes });
    await pinned(config.baseRuntimeRoot, 'portable-runtime.json', null, pins);
  }
  // Retain the historical generation payload, but V3 audit data never refreshes
  // or compiles the retired manual-contract pilot.
  if (config.designSystemRoot && !auditData) {
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
      selectedManuals.push({entry,manual});
      const facts = JSON.parse(await pinned(root, entry.facts.path, entry.facts, pins));
      await pinned(root, archive.file, { sha256: archive.zipSha256, bytes: archive.bytes }, pins);
      if (manual.component?.contractId !== entry.contractId || manual.component?.componentId !== entry.componentId || manual.metadata?.revision !== entry.revision || core.stableHash(manual) !== entry.manualSourceHash) fail('DATA_PREPARE_CONTRACT_IDENTITY_INVALID');
      // The compiler defines normative fact hashing; unused library text is excluded.
      const factsHash = core.compileManualSource(manual, facts).contract.package.generatedFactsHash;
      inputs.contracts.push([entry.contractId, entry.platform, entry.revision, entry.manualSourceHash, factsHash, archive.zipSha256]);
      if (old.manualSourceHash !== entry.manualSourceHash || old.generatedFactsHash !== factsHash || old.revision !== entry.revision) updates.push({ entry, factsHash, archive: path.join(root, archive.file) });
    }
    rawCatalogs = await rawCatalogInputs(root, selectedManuals, pins);
    inputs.rawCatalogs = rawCatalogs;
  }
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
  for (const directory of ['scripts', 'src/data-packages', 'src/data-release', 'src/knowledge-package', 'src/style-token-catalog', 'src/skills', 'src/audit-data']) {
    for (const file of await knowledge.listPackageFiles(path.join(__dirname, '..', directory))) {
      const relative = directory + '/' + file;
      const bytes = await pinned(path.resolve(__dirname, '..'), relative, null, pins);
      inputs.producer.push([relative, releases.sha(bytes)]);
    }
  }
  return { base, baseManifest, runtime, updates, excluded, rawCatalogs, knowledgeRoot, skillsRoot, activation, pins, auditData, fingerprint: releases.idOf(inputs) };
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
  if (!snapshot.updates.length) { await overlayRawCatalogs(config,snapshot,root); return root; }
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
  await overlayRawCatalogs(config,snapshot,root);
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

async function assertOutput(config) {
  const output = path.resolve(config.outputRoot);
  let ancestor = output;
  while (!sync.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (await fs.realpath(ancestor) !== ancestor) fail('DATA_PREPARE_OUTPUT_UNSAFE');
  if (['baseRelease', 'runtimeRoot', 'baseRuntimeRoot', 'designSystemRoot', 'designSystemAbmRoot', 'knowledgeRoot', 'skillsRoot', 'apolloRoot', 'dsAiHubRoot', 'generationSkillsRoot'].map(key => config[key]).filter(Boolean).some(root => output === root || output.startsWith(root + path.sep) || root.startsWith(output + path.sep))) fail('DATA_PREPARE_OUTPUT_UNSAFE');
  return output;
}

async function prepareDataPackage(config, { passwordInput, assertSourceInputs = async () => {}, sourceBuild } = {}) {
  const snapshot = await inputSnapshot(config).catch(error => { error.stage = 'inputs'; throw error; });
  // Reject symlink ancestors before even writing a lock inside an input tree.
  const output = await assertOutput(config);
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const lock = path.join(output, '.prepare.lock'), fd = await fs.open(lock, 'wx');
  let work, stage = 'cache';
  try {
    const last = await json(path.join(output, 'last-build.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (last?.inputFingerprint === snapshot.fingerprint) {
      for (const pin of [last.artifact, last.descriptor]) await pinned(output, pin.file, pin, new Map());
      for (const pin of last.incrementalArtifacts || []) await pinned(output,pin.file,pin,new Map());
      if (last.runtime) {
        if (!knowledge.isSafeRelativePath(last.runtime.root) || releases.readRuntime(path.join(output, last.runtime.root)).id !== snapshot.runtime.id) fail('DATA_PREPARE_INPUT_CHANGED');
      }
      await assertInputs(snapshot);
      await assertSourceInputs();
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
      output: path.join(work, 'npm'), version: config.version, tarballUrl, activation: snapshot.activation, password,
      ...(config.incremental ? {incremental:{objectsUrl:config.incremental.objectsUrl,packUrl:config.incremental.packUrl,
        previousRoot:config.incremental.previousRoot || (last?.artifact ? path.dirname(path.join(output,last.artifact.file)) : undefined)}} : {}) });
    const archive = await fs.readFile(built.tarballPath), store = path.join(work, 'verify');
    await fs.mkdir(store, { mode: 0o700 });
    stage = 'consumer';
    const ensured = config.incremental
      ? await releases.ensureStore({storeRoot:store,seedRoot:config.baseRelease,runtimeRoot:config.baseRuntimeRoot || config.runtimeRoot})
      : {state:{current:null,previous:null}};
    const result = await protectedData.installProtected({ settings: { storeRoot: store, seedRoot: path.join(work, 'empty-seed'), runtimeRoot: config.runtimeRoot },
      ensured, selected: { index: built.descriptor, commit: null }, command: 'update', access: { password },
      request: async (url,options) => {
        if (String(url) === tarballUrl) return new Response(archive);
        const transport=built.descriptor.incremental;
        if (transport && String(url)===transport.manifest.url) return new Response(await fs.readFile(path.join(work,'npm/incremental.json.enc')));
        if (transport?.objectsPack && String(url)===transport.objectsPack.url) {
          const range=/^bytes=(\d+)-(\d+)$/.exec(options?.headers?.Range||'');
          if (!range) fail('DATA_PREPARE_VERIFICATION_URL_INVALID');
          const bytes=await fs.readFile(path.join(work,'npm/objects.bin')),start=Number(range[1]),end=Number(range[2]);
          if (end<start || end>=bytes.length) fail('DATA_PREPARE_VERIFICATION_URL_INVALID');
          return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}});
        }
        if (transport?.objectsUrl && String(url).startsWith(transport.objectsUrl)) {
          const file=String(url).slice(transport.objectsUrl.length);
          if (/^[a-f0-9]{64}\.enc$/.test(file)) return new Response(await fs.readFile(path.join(work,'npm/objects',file)));
        }
        fail('DATA_PREPARE_VERIFICATION_URL_INVALID');
      }, releases });
    if (!result.updated || result.current.contentVersion !== release.manifest.id || 'activationKey' in result) fail('DATA_PREPARE_VERIFICATION_FAILED');
    stage = 'freshness';
    await assertInputs(snapshot);
    await assertSourceInputs();
    await fs.rm(built.packageRoot, { recursive: true });
    if (config.bundleRuntime) {
      await fs.cp(config.runtimeRoot, path.join(work, 'npm/runtime'), { recursive: true });
      if (releases.readRuntime(path.join(work, 'npm/runtime')).id !== snapshot.runtime.id) fail('DATA_PREPARE_INPUT_CHANGED');
    }
    const tarball = path.basename(built.tarballPath), descriptorBytes = await fs.readFile(path.join(work, 'npm/current.json'));
    const incrementalArtifacts=[];
    if (built.incrementalStats) for (const file of ['incremental.json.enc',...(built.descriptor.incremental.objectsPack ? ['objects.bin'] : []),...(await fs.readdir(path.join(work,'npm/objects'))).map(file=>'objects/'+file)]) {
      const bytes=await fs.readFile(path.join(work,'npm',file));incrementalArtifacts.push({file:config.version+'/'+file,sha256:releases.sha(bytes),bytes:bytes.length});
    }
    const report = { schemaVersion: 'apollo.data-package-build.v1', status: 'PREPARED_LOCAL', inputFingerprint: snapshot.fingerprint,
      version: config.version, runtimeId: snapshot.runtime.id, runtimeChanged: snapshot.runtime.id !== snapshot.baseManifest.runtimeId,
      contentVersion: release.manifest.id, contracts: snapshot.base.contracts.length,
      updated: snapshot.updates.map(u => ({ contractId: u.entry.contractId, revision: u.entry.revision })), excluded: snapshot.excluded,
      ...(snapshot.auditData ? { auditDataId: snapshot.auditData.dataId } : {}),
      artifact: { file: config.version + '/' + tarball, sha256: releases.sha(archive), bytes: archive.length },
      descriptor: { file: config.version + '/current.json', sha256: releases.sha(descriptorBytes), bytes: descriptorBytes.length },
      ...(built.incrementalStats ? {incremental:built.incrementalStats,incrementalArtifacts,incrementalTransfer:result.transfer} : {}),
      ...(config.bundleRuntime ? { runtime: { root: config.version + '/runtime', id: snapshot.runtime.id } } : {}),
      ...(sourceBuild ? { sourceBuild } : {}),
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

async function sourceSnapshot(config) {
  const builder = require('./build-knowledge-package'), pins = new Map();
  const apolloFiles = execFileSync('git', ['-C', config.apolloRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'build.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'src', 'packages', 'scripts', 'instructions', 'skills'], { maxBuffer: 8 * 1024 * 1024 }).toString().split('\0').filter(Boolean)
    .filter(file => !file.split('/').some(part => part === 'dist' || part === 'node_modules')).sort();
  const groups = [
    ['apollo', config.apolloRoot, apolloFiles],
    ['design-system_ab', config.designSystemRoot, await builder.collectDesignSystemFiles(config.designSystemRoot)],
    ['ds-ai-hub', config.dsAiHubRoot, await builder.collectDsAiHubFiles(config.dsAiHubRoot)],
  ];
  const inputs = { commits: {}, files: [] };
  for (const [name, root, files] of groups) {
    inputs.commits[name] = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    for (const file of files) {
      const bytes = await pinned(root, file, null, pins);
      inputs.files.push([name, file, releases.sha(bytes)]);
    }
  }
  if (config.generationSkillsRoot) for (const file of await knowledge.listPackageFiles(config.generationSkillsRoot)) {
    const bytes = await pinned(config.generationSkillsRoot, file, null, pins);
    inputs.files.push(['generationSkills', file, releases.sha(bytes)]);
  }
  return { fingerprint: releases.idOf(inputs), commits: inputs.commits };
}

async function prepareFromSources(config, options = {}) {
  if (!config.apolloRoot || !config.designSystemRoot || !config.dsAiHubRoot || !(config.baseRuntimeRoot || config.runtimeRoot)) fail('DATA_PREPARE_SOURCE_CONFIG_INVALID');
  if (process.env.APOLLO_AGENT_NATIVE_SCOPE_PATH || ![undefined, '0'].includes(process.env.APOLLO_NATIVE_DIAGNOSTICS)) fail('DATA_PREPARE_BUILD_CONFIGURATION_UNSUPPORTED');
  const output = await assertOutput(config);
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const lock = path.join(output, '.source-build.lock'), fd = await fs.open(lock, 'wx');
  let work, stage = 'source-inputs';
  try {
    protectedData.validateActivation(await json(config.activationFile));
    const source = await sourceSnapshot(config);
    let auditSourcePins=[];
    const assertSourceInputs = async () => {
      if ((await sourceSnapshot(config)).fingerprint !== source.fingerprint) fail('DATA_PREPARE_SOURCE_CHANGED');
      for(const pin of auditSourcePins) {
        const stat=await fs.lstat(pin.path),bytes=await fs.readFile(pin.path);
        if(!stat.isFile()||await fs.realpath(pin.path)!==pin.path||bytes.length!==pin.bytes||releases.sha(bytes)!==pin.sha256)fail('DATA_PREPARE_SOURCE_CHANGED');
      }
    };
    work = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'apollo-data-source-')));
    stage = 'apollo-build';
    console.error(JSON.stringify({ phase: stage }));
    await execFile('npm', ['run', 'build'], { cwd: config.apolloRoot, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
    stage = 'runtime';
    console.error(JSON.stringify({ phase: stage }));
    const runtimeRoot = path.join(work, 'runtime');
    require('./build-portable-runtime').buildPortableRuntime({ apolloRoot: config.apolloRoot, output: runtimeRoot, skillsRoot: config.generationSkillsRoot });
    const auditPreparation=releases.readRuntime(runtimeRoot).capabilities?.auditDataPreparation
      ? require('../src/audit-data/builder').preparationFromRuntime(runtimeRoot) : null;
    stage = 'knowledge';
    console.error(JSON.stringify({ phase: stage }));
    const knowledgeBuilt = await require('./build-knowledge-package').buildKnowledgePackage({
      'design-system-root': config.designSystemRoot, 'ds-ai-hub-root': config.dsAiHubRoot,
      output: path.join(work, 'knowledge'), directoryOnly: true, channel: 'stable',
      minEngine: knowledge.ENGINE_VERSION, maxEngine: knowledge.ENGINE_VERSION,
      ...(auditPreparation ? { auditPreparation, 'audit-abm-root': config.designSystemAbmRoot || path.join(path.dirname(config.designSystemRoot),'desing-system_abm') } : {}),
    });
    auditSourcePins=knowledgeBuilt.auditData?.sourcePins||[];
    require('../src/style-token-catalog/inventory').loadPackageSnapshot(knowledgeBuilt.packageRoot).assertFresh();
    stage = 'source-freshness';
    await assertSourceInputs();
    stage = 'package';
    return await prepareDataPackage({ ...config, baseRuntimeRoot: config.baseRuntimeRoot || config.runtimeRoot,
      runtimeRoot, knowledgeRoot: knowledgeBuilt.packageRoot, bundleRuntime: true }, {
      ...options, assertSourceInputs, sourceBuild: { fingerprint: auditSourcePins.length ? releases.idOf({base:source.fingerprint,audit:auditSourcePins.map(p=>[p.repo,p.relative,p.sha256]).sort()}) : source.fingerprint, commits: Object.assign({},knowledgeBuilt.auditData?.manifest.sourceCommits||{},source.commits) },
    });
  } catch (error) { error.stage ||= stage; throw error; }
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
  for (const key of ['baseRelease', 'runtimeRoot', 'baseRuntimeRoot', 'designSystemRoot', 'designSystemAbmRoot', 'activationFile', 'knowledgeRoot', 'skillsRoot', 'outputRoot', 'apolloRoot', 'dsAiHubRoot', 'generationSkillsRoot']) {
    if (config[key] !== undefined) config[key] = path.resolve(path.dirname(configFile), config[key]);
  }
  if (config.incremental?.previousRoot) config.incremental.previousRoot=path.resolve(path.dirname(configFile),config.incremental.previousRoot);
  config.version = options.version || config.version;
  console.log(JSON.stringify(await (config.apolloRoot ? prepareFromSources(config) : prepareDataPackage(config))));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ code: error.code || 'DATA_PREPARE_FAILED', stage: error.stage || 'config' })); process.exitCode = 1; });
module.exports = { selectContracts, rawCatalogInputs, overlayRawCatalogs, inputSnapshot, assertInputs, overlayContracts, prepareDataPackage, prepareFromSources, sourceSnapshot, passwordFrom, main };

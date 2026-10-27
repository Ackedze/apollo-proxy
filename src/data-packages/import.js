'use strict';
// One local import: compile existing ZIPs, copy immutable data, atomically replace the index.
const fs = require('node:fs'),
  path = require('node:path');
const { sha, readDataIndex, readGenerationData } = require('./index');
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const { readDataContracts, sourceMatches } = require('./contracts');
const clone = (v) => JSON.parse(JSON.stringify(v));
async function importDataPackage({
  root,
  apolloRoot,
  packages = [],
  figma = [],
  frontend = null,
  seed = null,
}) {
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  if (fs.realpathSync(root) !== root) fail('DATA_ROOT_UNSAFE');
  const lock = path.join(root, '.import.lock'),
    fd = fs.openSync(lock, 'wx');
  try {
    const app = path.join(apolloRoot, '.'),
      runtime = require(path.join(app, 'dist/runtime.cjs')),
      core = require(path.join(
        apolloRoot,
        'packages/component-contract-core/dist/core.cjs'
      ));
    const old = fs.existsSync(path.join(root, 'manifest.json'))
        ? readDataIndex(root)
        : null,
      archiveByComponent = new Map();
    function put(bytes, suffix = 'json', directory = 'shared') {
      if (!require('./artifacts').safeArtifactPath(directory))
        fail('DATA_PACKAGE_INVALID');
      const parent = path.join(root, directory);
      fs.mkdirSync(parent, { recursive: true });
      if (fs.realpathSync(parent) !== parent) fail('DATA_ROOT_UNSAFE');
      const pin = {
          file: directory + '/' + sha(bytes) + '.' + suffix,
          sha256: sha(bytes),
          bytes: bytes.length,
        },
        file = path.join(root, pin.file);
      if (fs.existsSync(file)) {
        if (sha(fs.readFileSync(file)) !== pin.sha256)
          fail('DATA_PACKAGE_STALE');
      } else fs.writeFileSync(file, bytes, { flag: 'wx' });
      return pin;
    }
    const json = (value, directory = 'generation') =>
      put(Buffer.from(JSON.stringify(value) + '\n'), 'json', directory);
    function freeze(value) {
      if (Array.isArray(value)) return value.map(freeze);
      if (!value || typeof value !== 'object') return value;
      const copy = clone(value);
      if (copy.documentType === 'component-contract-manual') return copy;
      if (
        typeof copy.path === 'string' &&
        typeof copy.sha256 === 'string' &&
        (path.isAbsolute(copy.path) ||
          /(?:^|\/)[a-f0-9]{64}\.[a-zA-Z0-9.-]+$/.test(copy.path))
      ) {
        const file = path.isAbsolute(copy.path)
          ? copy.path
          : path.join(root, copy.path);
        if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile())
          fail('DATA_REFERENCE_INVALID');
        const bytes = fs.readFileSync(file);
        if (
          bytes.length > 128 * 1024 * 1024 ||
          sha(bytes) !== copy.sha256 ||
          (copy.bytes !== undefined && copy.bytes !== bytes.length)
        )
          fail('DATA_REFERENCE_STALE');
        const pin = put(bytes, path.extname(file).slice(1) || 'bin');
        copy.path = pin.file;
      }
      for (const k of Object.keys(copy))
        if (k !== 'path') copy[k] = freeze(copy[k]);
      return copy;
    }
    if (old)
      for (const entry of old.index.contracts) {
        if (!entry.archive) continue;
        archiveByComponent.set(entry.componentId, {
          file: path.join(root, entry.archive.file),
          pin: entry.archive,
        });
      }
    for (const file of packages) {
      const bytes = fs.readFileSync(file);
      if (bytes.length > 64 * 1024 * 1024) fail('ARCHIVE_LIMIT');
      const entries = await core.readZip(bytes);
      if (
        entries.length > 200 ||
        entries.reduce((n, e) => n + e.data.length, 0) > 128 * 1024 * 1024
      )
        fail('ENTRY_LIMIT');
      const source = runtime.sourceFromFiles(
        entries
          .filter((e) => /\.json$/i.test(e.name))
          .map((e) => ({
            name: e.name,
            text: new TextDecoder('utf-8', { fatal: true }).decode(e.data),
          }))
      );
      const directory = componentDirectory(source),
        pin = put(bytes, 'zip', directory);
      archiveByComponent.set(source.manual.component.componentId, {
        file: path.join(root, pin.file),
        pin,
      });
    }
    const records = new Map();
    if (old)
      for (const item of readDataContracts({ root, runtimeFile: path.join(app, 'dist/runtime.cjs'), includeUnsupported: true }).contracts)
        if (!item.entry.archive) records.set(item.entry.componentId, { source: item.source, cache: item.contract });
    for (const [id, archive] of archiveByComponent) {
      const bytes = fs.readFileSync(archive.file);
      if (sha(bytes) !== archive.pin.sha256) fail('DATA_PACKAGE_STALE');
      const entries = await core.readZip(bytes);
      if (
        entries.length > 200 ||
        entries.reduce((n, e) => n + e.data.length, 0) > 128 * 1024 * 1024
      )
        fail('ENTRY_LIMIT');
      const files = entries
        .filter((e) => /\.json$/i.test(e.name))
        .map((e) => ({
          name: e.name,
          text: new TextDecoder('utf-8', { fatal: true }).decode(e.data),
        }));
      const source = runtime.sourceFromFiles(files),
        caches = files
          .map((f) => JSON.parse(f.text))
          .filter(
            (c) =>
              c.documentType === 'component-contract' &&
              c.package?.componentId === id
          );
      if (caches.length > 1) fail('DATA_CONTRACT_MISMATCH');
      records.set(id, {
        source,
        cache: caches[0],
        archive: put(bytes, 'zip', componentDirectory(source)),
      });
    }
    if (!records.size) fail('DATA_PACKAGE_LIMIT');
    const retained = new Map();
    const identity = (pin) =>
      JSON.stringify([
        pin.componentId,
        pin.revision,
        pin.manualSourceHash,
        pin.compiledHash,
      ]);
    function remember(source, pin) {
      const key = identity(pin);
      if (retained.has(key)) return;
      retained.set(key, source);
      for (const dep of source.manual.componentDependencies || []) {
        const child = source.dependencies.find((s) =>
          sourceMatches(s, dep, runtime)
        );
        if (!child) fail('DATA_DEPENDENCY_MISMATCH');
        remember(child, dep);
      }
    }
    if (old)
      for (const item of readDataContracts({
        root,
        runtimeFile: path.join(app, 'dist/runtime.cjs'),
        includeUnsupported: true,
      }).contracts)
        remember(item.source, {
          componentId: item.entry.componentId,
          revision: item.entry.revision,
          manualSourceHash: item.entry.manualSourceHash,
          compiledHash: item.entry.contractHash,
        });
    function link(record, ancestors = new Set()) {
      const id = record.source.manual.component.componentId;
      if (ancestors.has(id) || ancestors.size > 4)
        fail('DATA_DEPENDENCY_CYCLE');
      const next = new Set(ancestors);
      next.add(id);
      record.source.dependencies = (
        record.source.manual.componentDependencies || []
      ).map((pin) => {
        const child = records.get(pin.componentId);
        if (child && sourceMatches(child.source, pin, runtime))
          return link(child, next);
        const frozen = retained.get(identity(pin));
        if (frozen) return clone(frozen);
        fail('DATA_DEPENDENCY_MISSING');
      });
      return record.source;
    }
    const contracts = Array.from(records.values(), (record) => {
      const source = link(record),
        cache = record.cache,
        c = source.manual.component;
      let loaded,
        checkingGap = null;
      try {
        loaded = runtime.loadAuthoringSource(source, {
          evaluationMode: 'authoring-preview',
        });
      } catch (error) {
        if (
          cache?.package.manualSourceHash !==
            runtime.contractHash(source.manual) ||
          (error.code === 'APOLLO_V4_SOURCE_INVALID' &&
            error.message !==
              'Manual и факты не воспроизводят закреплённую проекцию.') ||
          ![
            'APOLLO_V4_SOURCE_INVALID',
            'APOLLO_V4_CONTRACT_INCOMPATIBLE',
          ].includes(error.code)
        )
          throw error;
        checkingGap = { code: error.code, reason: error.message };
      }
      const contract = loaded?.contract || cache,
        sourcePin = json(source, componentDirectory(source)),
        cachePin = json(contract, componentDirectory(source)),
        dependencies = runtime.collectContractDependencies(contract);
      return {
        id: c.contractId,
        componentId: c.componentId,
        revision: source.manual.metadata.revision,
        family: c.family,
        file: sourcePin.file,
        sha256: sourcePin.sha256,
        sourceHash: runtime.contractHash(source),
        compiledCache: cachePin,
        contractHash: runtime.contractHash(contract),
        manualSourceHash: runtime.contractHash(source.manual),
        generatedFactsHash: contract.package.generatedFactsHash,
        keys: Array.from(runtime.collectContractKeys(contract)).sort(),
        scope: dependencies.length
          ? 'component-with-dependencies'
          : 'standalone-component',
        dependencies,
        published: false,
        evaluationMode: 'authoring-preview',
        ...(record.archive ? { archive: record.archive } : {}),
        checkingGap,
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const read = (pin) => (pin ? JSON.parse(old.reader.read(pin)) : null);
    let native = old ? read(old.index.generation.native) : seed?.native || null,
      semantic = old
        ? read(old.index.generation.semantic)
        : seed?.semantic || null;
    if (native) {
      const dataFields = [
        'schemaVersion',
        'sourceHash',
        'writesClosed',
        'Ready',
        'status',
        'mappings',
        'ports',
        'actionBinding',
        'limits',
        'nonActions',
        'wire',
        'versionBinding',
        'typedNativeBindings',
        'genericMapping',
      ];
      native = Object.fromEntries(
        dataFields
          .filter((key) => Object.hasOwn(native, key))
          .map((key) => [key, clone(native[key])])
      );
      delete native.typedNativeBindings?.evidence;
      if (native.typedNativeBindings?.choiceSelection)
        delete native.typedNativeBindings.choiceSelection.semanticMappingPin;
    }
    let mappings = old
      ? read(old.index.generation.mappings)
      : seed?.mappings || [];
    let front =
      frontend ||
      (old ? read(old.index.generation.frontend) : seed?.frontend || null);
    const helper =
      old && old.index.generation.bindings
        ? old.reader.read(old.index.generation.bindings)
        : Buffer.from(seed?.bindings || '');
    const rules = old
      ? read(old.index.generation.ruleLinks)
      : seed?.ruleLinks || {};
    for (const file of figma) {
      if (!native) fail('DATA_FIGMA_PROFILE_REQUIRED');
      const incoming = JSON.parse(fs.readFileSync(file)),
        current = native.genericMapping;
      if (!incoming.semantic?.mappings || !incoming.typed?.bindings)
        fail('DATA_MAPPING_INVALID');
      const replaced = new Set(
          incoming.semantic.mappings.map((m) => m.mappingId)
        ),
        oldChoices = new Set(
          current.semantic.mappings
            .filter((m) => replaced.has(m.mappingId))
            .flatMap((m) => m.choices)
        );
      const merge = (a, b, key) =>
        Array.from(new Map(a.concat(b).map((v) => [key(v), v])).values());
      current.semantic.mappings = current.semantic.mappings
        .filter((m) => !replaced.has(m.mappingId))
        .concat(incoming.semantic.mappings);
      current.typed.bindings = current.typed.bindings
        .filter((b) => !replaced.has(b.mappingId))
        .concat(incoming.typed.bindings);
      for (const key of ['choices', 'profiles'])
        current.profiles[key] = (current.profiles[key] || [])
          .filter((c) => !oldChoices.has(c.id || c.choiceId))
          .concat(incoming.profiles[key] || []);
      const incomingVersions = incoming.profiles.sourceDependencies;
      const availableVersions = contracts.flatMap(c => [{
        componentId: c.componentId, revision: c.revision,
        manualSourceHash: c.manualSourceHash, compiledHash: c.contractHash,
      }, ...c.dependencies]);
      // Keep historical versions only while an active parent still pins them.
      const retainedVersions = current.profiles.sourceDependencies.filter(d =>
        !incomingVersions.some(v => v.componentId === d.componentId && d.revision < v.revision) || availableVersions.some(v =>
          v.componentId === d.componentId && v.revision === d.revision &&
          v.manualSourceHash === d.manualSemanticHash && v.compiledHash === d.compiledSemanticHash));
      current.profiles.sourceDependencies = merge(
        retainedVersions,
        incoming.profiles.sourceDependencies,
        (v) =>
          JSON.stringify([
            v.componentId,
            v.revision,
            v.manualSemanticHash,
            v.compiledSemanticHash,
          ])
      );
      current.profiles.actualPartDefinitions = merge(
        current.profiles.actualPartDefinitions || [],
        incoming.profiles.actualPartDefinitions || [],
        (v) => v.key
      );
      current.targets.profiles = current.targets.profiles
        .filter((p) => !oldChoices.has(p.choiceId))
        .concat(incoming.targets.profiles);
      current.manuals = merge(
        current.manuals,
        incoming.manuals,
        (v) => v.pin.path + '#' + (v.manualPointer || '')
      );
      current.ruleLinks.links = merge(
        current.ruleLinks.links,
        incoming.ruleLinks.links,
        (v) => v.source.path + '#' + v.RuleID
      );
      current.denials = current.denials
        .filter((d) => !replaced.has(d.mappingId))
        .concat(incoming.denials || []);
      semantic.mappings = semantic.mappings
        .filter((m) => !replaced.has(m.mappingId))
        .concat(incoming.semantic.mappings);
      native.mappings = native.mappings
        .filter((c) => !oldChoices.has(c.id))
        .concat(
          incoming.profiles.choices.map((c) => ({
            id: c.id,
            componentKey: c.key,
            properties: c.properties,
            rootCreateAllowed: true,
          }))
        );
    }
    if (native?.genericMapping) {
      const current = native.genericMapping;
      current.manuals = current.manuals.filter(record =>
        current.profiles.sourceDependencies.some(d =>
          d.componentId === record.manual?.component?.componentId &&
          d.revision === record.manual?.metadata?.revision &&
          d.manualSemanticHash === runtime.contractHash(record.manual)) ||
        current.typed.bindings.some(b =>
          b.normativeSource.path === record.pin.path &&
          b.normativeSource.sha256 === record.pin.sha256 &&
          b.normativeSource.bytes === record.pin.bytes &&
          (!b.normativeSource.manualPointer || record.manualPointer === b.normativeSource.manualPointer)));
    }
    const frozenNative = native ? freeze(native) : null;
    if (frozenNative?.genericMapping) {
      const manuals = new Map();
      for (const record of frozenNative.genericMapping.manuals) {
        const key = record.pin.path + '#' + (record.manualPointer || ''),
          prior = manuals.get(key);
        if (
          prior &&
          runtime.contractHash(prior.manual) !==
            runtime.contractHash(record.manual)
        )
          fail('DATA_MANUAL_CONFLICT');
        if (!prior) manuals.set(key, record);
      }
      frozenNative.genericMapping.manuals = Array.from(manuals.values());
    }
    const generation = {
      mappings: json(freeze(mappings)),
      native: frozenNative ? json(frozenNative) : null,
      semantic: semantic ? json(freeze(semantic)) : null,
      frontend: front ? json(freeze(front)) : null,
      ruleLinks: json(freeze(rules)),
      bindings: put(helper, 'ts', 'generation'),
    };
    const connection = (status, reason) => ({ status, reason });
    function dependencyIds(bindings) {
      const result = new Set(),
        queue = bindings.map((b) => b.componentId);
      while (queue.length) {
        const id = queue.shift(),
          entry = contracts.find((c) => c.componentId === id);
        for (const dep of entry?.dependencies || [])
          if (!result.has(dep.componentId)) {
            result.add(dep.componentId);
            queue.push(dep.componentId);
          }
      }
      return result;
    }
    const figmaDependencies = dependencyIds(semantic?.mappings || []),
      frontDependencies = dependencyIds(front?.bindings || []);
    const catalog = contracts.map((entry) => {
      const manual = records.get(entry.componentId).source.manual,
        c = manual.component,
        m = manual.metadata,
        platform = c.platform;
      const mapped = (bindings) =>
        bindings.some(
          (b) =>
            b.componentId === c.componentId &&
            (!b.platform ||
              platform === 'universal' ||
              b.platform === 'universal' ||
              b.platform === platform)
        );
      const figmaStatus = mapped(semantic?.mappings || [])
          ? 'connected'
          : figmaDependencies.has(c.componentId)
          ? 'dependency'
          : 'not-connected',
        frontStatus = mapped(front?.bindings || [])
          ? 'connected'
          : frontDependencies.has(c.componentId)
          ? 'dependency'
          : 'not-connected';
      return {
        componentId: c.componentId,
        contractId: c.contractId,
        name: c.family,
        library: c.library || 'Не указана',
        platform,
        revision: m.revision,
        manualSourceHash: runtime.contractHash(manual),
        updatedAt: m.updatedAt || null,
        checking: connection(
          entry.checkingGap ? 'not-connected' : 'connected',
          entry.checkingGap
            ? entry.checkingGap.code + ': ' + entry.checkingGap.reason
            : 'Контракт импортирован; Draft не становится Ready.'
        ),
        figma: connection(
          figmaStatus,
          figmaStatus === 'not-connected'
            ? 'Figma mapping отсутствует.'
            : 'Mapping в установленном индексе; native проверка выполняется при генерации.'
        ),
        frontend: connection(
          frontStatus,
          frontStatus === 'not-connected'
            ? 'Публичный frontend mapping отсутствует.'
            : 'Публичный frontend mapping в установленном индексе.'
        ),
      };
    });
    catalog.sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform)
    );
    const index = {
      schemaVersion: 'apollo.data-index.v1',
      profileVersion: runtime.RUNTIME_VERSION,
      contracts,
      generation,
      catalog,
      Ready: false,
    };
    index.id = sha(JSON.stringify(index));
    // Validate through the actual consumer before publishing this index.
    const temp = path.join(root, 'manifest.next.json');
    fs.writeFileSync(temp, JSON.stringify(index, null, 2) + '\n', {
      flag: 'wx',
    });
    // Reader accepts an explicit index for prepublication; readers keep seeing the previous manifest.
    const accepted = readGenerationData({ root, apolloRoot, index });
    for (const mapping of accepted.native?.genericMapping?.semantic.mappings ||
      []) {
      const props = Object.fromEntries(
        Object.entries(mapping.defaults?.[0]?.properties || {}).filter(
          ([port]) =>
            !accepted.native.genericMapping.typed.bindings.some(
              (b) =>
                b.mappingId === mapping.mappingId &&
                b.port === port &&
                b.type === 'SLOT'
            )
        )
      );
      const target = accepted.owned.targets.componentTarget(
        { mappingId: mapping.mappingId, props, slots: {} },
        mapping.platform === 'universal' ? 'desktop' : mapping.platform
      );
      if (target.issues.length)
        throw Object.assign(Error('DATA_MAPPING_DEFAULT_UNSUPPORTED'), {
          code: 'DATA_MAPPING_DEFAULT_UNSUPPORTED',
          mappingId: mapping.mappingId,
          issues: target.issues,
        });
    }
    if (accepted.frontend)
      for (const platform of ['desktop', 'mobile-web'])
        require(path.join(
          app,
          'scripts/agent-run-inputs.cjs'
        )).projectFrontendAuthoring(
          accepted.prompt(platform),
          accepted.frontend,
          { hash: runtime.contractHash }
        );
    fs.renameSync(temp, path.join(root, 'manifest.json'));
    return {
      dataId: index.id,
      contracts: contracts.map((c) => ({
        componentId: c.componentId,
        revision: c.revision,
        checkingGap: c.checkingGap,
      })),
      runtimeChanged: false,
      restartRequired: false,
      Ready: false,
    };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
    const next = path.join(root, 'manifest.next.json');
    if (fs.existsSync(next)) fs.unlinkSync(next);
  }
}

function componentDirectory(source) {
  const id = source.manual.component.componentId,
    revision = source.manual.metadata.revision;
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(id) ||
    id === '.' ||
    id === '..' ||
    !Number.isInteger(revision) ||
    revision < 1
  )
    fail('DATA_COMPONENT_INVALID');
  return 'components/' + id + '/r' + revision;
}
module.exports = { importDataPackage };

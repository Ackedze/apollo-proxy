'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { fail, sha } = require('./artifacts');
const { readDataContracts } = require('./contracts');
function dataSemanticFacade({ semantic, native, source, base, compatibility, dataDigest, pin }) {
  if (semantic?.schemaVersion !== 'apollo.agent-figma-semantic-mapping.v1' || !Array.isArray(semantic.mappings) || !Array.isArray(native.mappings)) fail('DATA_SEMANTIC_MAPPING_INVALID');
  const ids = new Set();
  for (const mapping of semantic.mappings) {
    const genericRecords = native.genericMapping?.semantic?.mappings.filter(m => m.mappingId === mapping.mappingId) || [];
    const records = genericRecords.length ? genericRecords : base.mappings.filter(m => m.mappingId === mapping.mappingId);
    if (!mapping.mappingId || ids.has(mapping.mappingId) || records.length !== 1 || !isDeepStrictEqual(mapping, records[0]) || !Array.isArray(mapping.choices)) fail('DATA_SEMANTIC_MAPPING_INVALID');
    ids.add(mapping.mappingId);
    for (const id of mapping.choices) {
      const choices = native.mappings.filter(c => c.id === id);
      const genericProfiles = native.genericMapping?.profiles?.choices.filter(c => c.id === id) || [];
      const profiles = genericProfiles.length ? genericProfiles : source.choices.filter(c => c.id === id);
      if (choices.length !== 1 || profiles.length !== 1 || choices[0].componentKey !== profiles[0].key || !isDeepStrictEqual(choices[0].properties, profiles[0].properties) || choices[0].rootCreateAllowed !== true) fail('DATA_SEMANTIC_MAPPING_INVALID');
    }
  }
  return { schemaVersion: semantic.schemaVersion, mappings: semantic.mappings, sourceHash: compatibility, dataDigest,
    sourceRecord: { ...pin, originalSourceHash: semantic.sourceHash || null } };
}
function readGenerationData({ root, apolloRoot, index: suppliedIndex = null }) {
  const app = path.join(apolloRoot, '.'),
    loaded = readDataContracts({
      root,
      runtimeFile: path.join(app, 'dist/runtime.cjs'),
      index: suppliedIndex,
      includeUnsupported: true,
    }),
    { index, reader, runtime } = loaded;
  const json = (pin) => (pin ? JSON.parse(reader.read(pin)) : null),
    g = index.generation || {};
  const native = json(g.native),
    semantic = json(g.semantic),
    frontend = json(g.frontend),
    mappings = json(g.mappings) || [],
    ruleLinks = json(g.ruleLinks) || {};
  const bindingHelper = g.bindings
    ? reader.read(g.bindings).toString('utf8')
    : null;
  // Rewritten mapping references must stay inside this immutable data root.
  function refs(value) {
    if (Array.isArray(value)) value.forEach(refs);
    else if (value && typeof value === 'object') {
      if (value.documentType === 'component-contract-manual') return;
      if (
        typeof value.path === 'string' &&
        typeof value.sha256 === 'string' &&
        (path.isAbsolute(value.path) ||
          /(?:^|\/)[a-f0-9]{64}\.[a-zA-Z0-9.-]+$/.test(value.path))
      ) {
        const file = path.isAbsolute(value.path)
          ? path.relative(reader.root, value.path)
          : value.path;
        if (!require('./artifacts').safeArtifactPath(file))
          fail('DATA_REFERENCE_OUTSIDE_ROOT');
        reader.read({ file, sha256: value.sha256, bytes: value.bytes });
        value.path = path.join(reader.root, file);
      }
      Object.values(value).forEach(refs);
    }
  }
  [native, semantic, frontend].forEach(refs);
  if (native?.genericMapping) {
    require(path.join(
      app,
      'src/generation/agent/figma/mapping'
    )).createMappingAdapter(native.genericMapping);
    for (const dep of native.genericMapping.profiles.sourceDependencies) {
      const item = loaded.versions.find(
        (c) =>
          c.componentId === dep.componentId &&
          c.revision === dep.revision &&
          c.manualSourceHash === dep.manualSemanticHash &&
          c.compiledHash === dep.compiledSemanticHash
      );
      if (!item) fail('DATA_MAPPING_CONTRACT_STALE');
    }
  }
  const portableRuntime = fs.existsSync(path.join(app, 'portable-runtime.json')) ? require('../data-release').readRuntime(app) : null;
  const compatibility = portableRuntime?.nativeSourceHash || require(path.join(app, 'dist/agent-figma-postconditions.cjs')).SOURCE_HASH;
  if (native && native.sourceHash !== compatibility)
    fail('DATA_RUNTIME_INCOMPATIBLE');
  const prompt = (platform) => ({
    schemaVersion: 'apollo.prompt-contract-context.v1-experimental',
    platform,
    executionAllowed: false,
    registryDigest: index.id,
    dataDigest: index.id,
    contracts: loaded.contracts.map((c) => ({
      pin: {
        componentId: c.entry.componentId,
        revision: c.entry.revision,
        ...(c.entry.archive ? { archiveSha256: c.entry.archive.sha256 } : {}),
        manualSourceHash: c.entry.manualSourceHash,
        compiledHash: c.entry.contractHash,
        sourceStatus: c.contract.status,
      },
      manual: c.source.manual,
    })),
    mappings: mappings.filter(
      (m) =>
        !m.platform || m.platform === 'universal' || m.platform === platform
    ),
  });
  const sourcePins = new Map();
  const codeJSON = relative => {
    const file=path.join(app,relative),bytes=fs.readFileSync(file),digest=sha(bytes),pin=portableRuntime?.files.find(p=>p.file===relative);
    if(portableRuntime&&(!pin||pin.sha256!==digest||pin.bytes!==bytes.length))fail('DATA_MAPPING_SOURCE_STALE');
    sourcePins.set(file,digest);return JSON.parse(bytes);
  };
  const source = native ? codeJSON('src/generation/agent/figma/source.json') : null;
  const semanticMapping = native && semantic ? dataSemanticFacade({ semantic, native, source,
    base: codeJSON('instructions/agent-generation/figma-owned-mapping.json'), compatibility, dataDigest: index.id, pin: g.semantic }) : null;
  const assertCurrent = () => {
    loaded.assertCurrent();
    for (const [file,pin] of sourcePins) if (sha(fs.readFileSync(file)) !== pin) fail('DATA_MAPPING_SOURCE_STALE');
  };
  const owned = native
    ? {
        sourceHash: compatibility,
        packet: native,
        semanticMapping,
        capabilities: [],
        dataDigest: index.id,
        assertCurrent,
        readSources: Array.from(reader.pins, ([file, sha256]) => ({
          path: file,
          sha256,
        })),
        validatePostconditions() {
          fail('DATA_NATIVE_CHECKER_UNAVAILABLE');
        },
        targets: require(path.join(
          app,
          'src/generation/agent/figma/target'
        )).createFigmaTargets({
          choices: source.choices,
          genericMapping: native.genericMapping,
          capabilityPlatform: 'desktop',
        }),
      }
    : null;
  assertCurrent();
  return {
    ...loaded,
    assertCurrent,
    native,
    semantic,
    frontend,
    mappings,
    ruleLinks,
    bindingHelper,
    owned,
    prompt,
  };
}

module.exports = { readGenerationData, dataSemanticFacade };

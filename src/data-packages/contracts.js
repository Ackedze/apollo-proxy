'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sha, fail, clone, readDataIndex } = require('./artifacts');
// Bounded, process-local compilation cache. Every access still verifies immutable bytes.
const compiledReleases = new Map(),
  installedRuntimes = new Map();
function installedRuntime(file, digest) {
  const previous = installedRuntimes.get(file);
  if (previous?.digest === digest) return previous.runtime;
  delete require.cache[require.resolve(file)];
  const runtime = require(file);
  installedRuntimes.set(file, { digest, runtime });
  if (installedRuntimes.size > 8)
    installedRuntimes.delete(installedRuntimes.keys().next().value);
  return runtime;
}
function readDataContracts({
  root,
  runtimeFile,
  index: suppliedIndex = null,
  includeUnsupported = false,
}) {
  const { index, reader } = readDataIndex(root, suppliedIndex);
  runtimeFile = fs.realpathSync(runtimeFile);
  const runtimeHash = sha(fs.readFileSync(runtimeFile)),
    runtime = installedRuntime(runtimeFile, runtimeHash);
  const cacheKey = JSON.stringify([
      reader.root,
      index.id,
      runtimeFile,
      runtimeHash,
    ]),
    accepted = compiledReleases.get(cacheKey);
  if (index.profileVersion !== runtime.RUNTIME_VERSION)
    fail('DATA_RUNTIME_INCOMPATIBLE');
  const ids = new Set(),
    keys = new Set();
  const contracts = index.contracts.map((entry) => {
    if (ids.has(entry.componentId)) fail('DATA_COMPONENT_CONFLICT');
    ids.add(entry.componentId);
    const sourceBytes = reader.read({ file: entry.file, sha256: entry.sha256 }),
      cacheBytes = reader.read(entry.compiledCache);
    // A checksum-verified index pins source, compiled cache, mode and dependency closure.
    if (accepted)
      return clone(
        accepted.find((item) => item.entry.componentId === entry.componentId)
      );
    const source = JSON.parse(sourceBytes),
      cache = JSON.parse(cacheBytes);
    const loaded = entry.checkingGap
        ? null
        : runtime.loadAuthoringSource(
            source,
            entry.evaluationMode ? { evaluationMode: entry.evaluationMode } : {}
          ),
      contract = loaded?.contract || cache;
    if (
      runtime.contractHash(source) !== entry.sourceHash ||
      runtime.contractHash(contract) !== entry.contractHash ||
      runtime.contractHash(cache) !== entry.contractHash ||
      contract.package.componentId !== entry.componentId ||
      contract.package.id !== entry.id ||
      contract.package.manualSourceHash !== entry.manualSourceHash ||
      source.manual.metadata.revision !== entry.revision ||
      JSON.stringify(runtime.collectContractDependencies(contract)) !==
        JSON.stringify(entry.dependencies)
    )
      fail('DATA_CONTRACT_MISMATCH');
    const actual = Array.from(runtime.collectContractKeys(contract)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(entry.keys))
      fail('DATA_ROUTING_INVALID');
    for (const key of actual) {
      if (keys.has(key)) fail('DATA_ROUTING_INVALID');
      keys.add(key);
    }
    return {
      entry,
      source,
      contract,
      checkingAvailable: !entry.checkingGap,
      release: {
        id: index.id,
        channel: 'local-pilot',
        contractId: entry.id,
        contractHash: entry.contractHash,
        manualSourceHash: entry.manualSourceHash,
        sourceHash: entry.sourceHash,
        ...(entry.evaluationMode
          ? { evaluationMode: entry.evaluationMode }
          : {}),
      },
    };
  });
  const versions = contracts.map((c) => ({
    componentId: c.entry.componentId,
    revision: c.entry.revision,
    manualSourceHash: c.entry.manualSourceHash,
    compiledHash: c.entry.contractHash,
  }));
  for (const item of contracts)
    for (const dep of item.entry.dependencies) {
      const source = findDependencySource(item.source, dep, runtime);
      if (!source || !sourceMatches(source, dep, runtime))
        fail('DATA_DEPENDENCY_MISMATCH');
      const child = contracts.find(
        (c) =>
          c.entry.componentId === dep.componentId &&
          c.entry.revision === dep.revision &&
          c.entry.manualSourceHash === dep.manualSourceHash &&
          c.entry.contractHash === dep.compiledHash
      );
      if (child) {
        if (runtime.contractHash(source) !== child.entry.sourceHash)
          fail('DATA_DEPENDENCY_MISMATCH');
      } else {
        // The parent's frozen inline source remains authoritative when the current child advances.
        const review = runtime.reviewAuthoringSource(source);
        const version = review.components.find(
          (c) => c.componentId === dep.componentId
        );
        if (
          !version ||
          version.compiledHash !== dep.compiledHash ||
          review.components.some((c) =>
            c.issues.some((i) => i.level === 'error')
          )
        )
          fail('DATA_DEPENDENCY_MISMATCH');
        versions.push(...review.components);
      }
    }
  const assertCurrent = () => {
    reader.assertCurrent();
    if (sha(fs.readFileSync(runtimeFile)) !== runtimeHash)
      fail('DATA_RUNTIME_STALE');
  };
  const selected = includeUnsupported
    ? contracts
    : contracts.filter((c) => c.checkingAvailable);
  assertCurrent();
  if (!accepted) {
    compiledReleases.set(cacheKey, clone(contracts));
    if (compiledReleases.size > 8)
      compiledReleases.delete(compiledReleases.keys().next().value);
  }
  return {
    manifest: {
      schemaVersion: 'apollo.contract-release.v1-experimental',
      id: index.id,
      channel: 'local-pilot',
      contracts: selected.map((c) => c.entry),
    },
    contracts: selected,
    versions,
    runtime,
    assertCurrent,
    index,
    reader,
  };
}

function findDependencySource(root, pin, runtime) {
  const queue = root.dependencies.slice();
  const seen = new Set();
  while (queue.length) {
    const source = queue.shift();
    if (seen.has(source)) continue;
    seen.add(source);
    if (sourceMatches(source, pin, runtime)) return source;
    queue.push(...source.dependencies);
  }
  return null;
}
function sourceMatches(source, pin, runtime) {
  return (
    source?.manual?.component?.componentId === pin.componentId &&
    source.manual.metadata.revision === pin.revision &&
    runtime.contractHash(source.manual) === pin.manualSourceHash
  );
}
module.exports = { readDataContracts, sourceMatches };

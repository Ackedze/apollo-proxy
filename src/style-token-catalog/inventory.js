'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VERSION, HASH, KEY, fail, sha256, digest, canonical } = require('./protocol');

function pinnedFile(root, relativePath, expectedHash, expectedSize) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.split('/').some(s => !s || s === '..' || s === '.')) fail('UNSAFE_SOURCE_PATH', 500);
  let cursor = root;
  for (const part of relativePath.split('/')) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch { fail('SOURCE_UNAVAILABLE', 503); }
    if (stat.isSymbolicLink()) fail('SOURCE_SYMLINK', 409);
  }
  let bytes;
  try { bytes = fs.readFileSync(cursor); } catch { fail('SOURCE_UNAVAILABLE', 503); }
  if (bytes.length !== expectedSize || sha256(bytes) !== expectedHash) fail('SOURCE_DRIFT', 409);
  return bytes;
}
function normalizeTokens(source, document) {
  if (!document || !Array.isArray(document.collections)) fail('INVALID_TOKEN_SOURCE', 503);
  const records = [];
  const collections = [];
  const ids = new Map();
  for (const collection of document.collections) {
    if (!collection || !Array.isArray(collection.variables) || !Array.isArray(collection.modes)) fail('INVALID_TOKEN_SOURCE', 503);
    const modes = collection.modes.map(m => ({ modeId: m.modeId, name: m.name }));
    collections.push({ key: collection.key || null, name: collection.name || null,
      defaultModeId: collection.defaultModeId || null, modes,
      hiddenFromPublishing: collection.hiddenFromPublishing === true });
    for (const variable of collection.variables) {
      const record = { sourceId: source.id, sourceSha256: source.sha256,
        key: variable.key || null, name: variable.name || null, exportedId: variable.id || null,
        type: variable.resolvedType || null, scopes: Array.isArray(variable.scopes) ? variable.scopes : [],
        collectionKey: collection.key || null, collectionName: collection.name || null,
        defaultModeId: collection.defaultModeId || null, modes,
        hidden: collection.hiddenFromPublishing === true || variable.hiddenFromPublishing === true,
        valuesByMode: variable.valuesByMode || {}, actualValuesByMode: variable.actualValuesByMode || {},
        resolutionByMode: variable.resolutionByMode || {} };
      records.push(record);
      if (typeof variable.id === 'string') {
        if (!ids.has(variable.id)) ids.set(variable.id, []);
        ids.get(variable.id).push(record);
      }
    }
  }
  return { records, collections, ids };
}

function loadSnapshot(root, expectedManifestSha256, options = {}) {
  if (!HASH.test(expectedManifestSha256)) fail('SNAPSHOT_PIN_REQUIRED', 500);
  root = fs.realpathSync(root);
  const manifestPath = path.join(root, 'snapshot.json');
  if (!options.manifest) {
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail('INVALID_SNAPSHOT', 500);
  }
  const raw = options.manifest ? Buffer.from(canonical(options.manifest)) : fs.readFileSync(manifestPath);
  if (sha256(raw) !== expectedManifestSha256) fail('SNAPSHOT_DRIFT', 409);
  const manifest = JSON.parse(raw);
  if (manifest.protocolVersion !== VERSION || !manifest.knowledge || typeof manifest.knowledge.contentVersion !== 'string' || !Array.isArray(manifest.sources) || manifest.sources.length > 64) fail('INVALID_SNAPSHOT', 500);
  const sources = new Map();
  const tokenData = new Map();
  const pins = options.manifest ? [] : [{ root, relativePath: 'snapshot.json', sha256: expectedManifestSha256, size: raw.length }];
  // An explicit existing immutable package root reuses its token files. Never
  // derive this root from a request, default checkout path or previous package.
  const sourceRoot = options.packageRoot === undefined ? root : fs.realpathSync(options.packageRoot);
  if (options.packageRoot !== undefined) {
    const stat = fs.lstatSync(path.join(sourceRoot,'manifest.json'));
    if (!stat.isFile() || stat.isSymbolicLink() || !HASH.test(manifest.knowledge.manifestSha256)) fail('PACKAGE_MANIFEST_PIN_REQUIRED',500);
    const bytes = pinnedFile(sourceRoot,'manifest.json',manifest.knowledge.manifestSha256,stat.size);
    const packageManifest = JSON.parse(bytes);
    if (packageManifest.contentVersion !== manifest.knowledge.contentVersion || canonical(packageManifest.sourceCommits) !== canonical(manifest.knowledge.sourceCommits)) fail('PACKAGE_VERSION_MISMATCH',409);
    pins.push({root:sourceRoot,relativePath:'manifest.json',sha256:manifest.knowledge.manifestSha256,size:bytes.length});
  }
  for (const pin of manifest.evidenceFiles || []) {
    pinnedFile(root, pin.relativePath, pin.sha256, pin.size);
    pins.push(Object.assign({root},pin));
  }
  const evidenceHashes = new Set((manifest.evidenceFiles || []).map(p => p.sha256));
  for (const source of manifest.sources) {
    if (typeof source.id !== 'string' || sources.has(source.id) || !['tokens', 'styles'].includes(source.kind) || !['available', 'not-packaged'].includes(source.availability)) fail('INVALID_SNAPSHOT', 500);
    if (source.context !== null && (!source.context || typeof source.context.ds !== 'string' || typeof source.context.platform !== 'string' || !Array.isArray(source.context.themes) || !source.contextEvidence || !evidenceHashes.has(source.contextEvidence.sha256))) fail('CONTEXT_EVIDENCE_REQUIRED', 500);
    if (source.status === 'deprecated' && (!source.statusEvidence || !evidenceHashes.has(source.statusEvidence.sha256))) fail('DEPRECATION_EVIDENCE_REQUIRED', 500);
    if (source.availability === 'available') {
      if (!HASH.test(source.sha256) || !Number.isInteger(source.size) || source.size < 0 || source.size > 8 * 1024 * 1024) fail('INVALID_SOURCE_PIN', 500);
      const bytes = pinnedFile(sourceRoot, source.relativePath, source.sha256, source.size);
      pins.push({ root:sourceRoot, relativePath: source.relativePath, sha256: source.sha256, size: source.size });
      let document;
      try { document = JSON.parse(bytes); } catch { fail('INVALID_SOURCE_JSON', 503); }
      if (source.kind === 'tokens') tokenData.set(source.id, normalizeTokens(source, document));
    }
    sources.set(source.id, source);
  }
  const snapshotId = digest(manifest);
  function assertFresh() {
    for (const pin of pins) pinnedFile(pin.root, pin.relativePath, pin.sha256, pin.size);
  }
  function inventory() {
    assertFresh();
    const output = { protocolVersion: VERSION, snapshotId, knowledge: manifest.knowledge,
      authority: { classification: 'read-evidence-only', bindingPermission: false, semanticEligibility: 'unknown' },
      sources: [...sources.values()].map(source => ({ id: source.id, kind: source.kind,
        availability: source.availability, status: source.status, provenance: source.provenance,
        sha256: source.sha256 || null, size: source.size || null, library: source.library || null,
        context: source.context, contextEvidence: source.contextEvidence,
        statusEvidence: source.statusEvidence || null,
        checkoutObservation: source.checkoutObservation || null,
        collections: tokenData.get(source.id)?.collections || [],
        entryCount: tokenData.get(source.id)?.records.length ?? source.observedEntryCount ?? null,
        publication: 'unverified' })),
      coverage: { tokenSources: [...sources.values()].filter(s => s.kind === 'tokens' && s.availability === 'available').length,
        styleSources: [...sources.values()].filter(s => s.kind === 'styles' && s.availability === 'available').length,
        stylesNotPackaged: [...sources.values()].filter(s => s.kind === 'styles' && s.availability === 'not-packaged').length,
        semanticPolicies: 0, nativeImportsPerformed: 0 } };
    return JSON.parse(canonical(output));
  }
  return { snapshotId, contentVersion: manifest.knowledge.contentVersion, knowledge: manifest.knowledge,
    sources, tokenData, assertFresh, inventory, manifestSha256: expectedManifestSha256 };
}
module.exports = { loadSnapshot, pinnedFile, normalizeTokens };

function loadPackageSnapshot(packageRoot, expectedRelease = {}) {
  const {validateManifest} = require('../knowledge-package');
  packageRoot = fs.realpathSync(packageRoot);
  const manifestFile = path.join(packageRoot,'manifest.json');
  const stat = fs.lstatSync(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('PACKAGE_MANIFEST_PIN_REQUIRED',503);
  const bytes = fs.readFileSync(manifestFile), manifestSha256 = sha256(bytes);
  const pkg = validateManifest(JSON.parse(bytes));
  if (expectedRelease.contentVersion && expectedRelease.contentVersion !== 'embedded-seed' && expectedRelease.contentVersion !== pkg.contentVersion) fail('PACKAGE_VERSION_MISMATCH',409);
  for (const [source,commit] of Object.entries(expectedRelease.sourceCommits || {})) {
    if (commit && commit !== pkg.sourceCommits[source]) fail('PACKAGE_VERSION_MISMATCH',409);
  }
  const codeRoot = __dirname;
  const codePins = ['inventory.js','protocol.js','query.js','router.js','service.js','display.js','display-protocol.js'].map(relativePath=>{
    const raw=fs.readFileSync(path.join(codeRoot,relativePath));return {relativePath,size:raw.length,sha256:sha256(raw)};
  });
  const provenanceArtifact=pkg.artifacts.find(a=>a.path==='data/design-system_ab/apollo/style-token-catalog-provenance.json');
  const provenance=provenanceArtifact?JSON.parse(pinnedFile(packageRoot,provenanceArtifact.path,provenanceArtifact.sha256,provenanceArtifact.size)):null;
  if(provenance && (provenance.schemaVersion!=='apollo.catalog-provenance.v1' || provenance.sourceCommit!==pkg.sourceCommits['design-system_ab']
    || !Array.isArray(provenance.sourceOrder) || !Array.isArray(provenance.sourcePins)))fail('INVALID_CATALOG_PROVENANCE',503);
  const artifacts=pkg.artifacts.filter(a=>/^data\/design-system_ab\/JSONS\/(tokens|styles)\/[^/]+\.json$/.test(a.path));
  if(provenance && (new Set(provenance.sourceOrder).size!==artifacts.length || provenance.sourceOrder.length!==artifacts.length
    || provenance.sourcePins.length!==artifacts.length || new Set(provenance.sourcePins.map(p=>p.sourceId)).size!==artifacts.length
    || artifacts.some(a=>!provenance.sourceOrder.includes(a.path.slice(5)))))fail('CATALOG_PROVENANCE_MISMATCH',503);
  if(provenance)artifacts.sort((a,b)=>provenance.sourceOrder.indexOf(a.path.slice(5))-provenance.sourceOrder.indexOf(b.path.slice(5)));
  const sources = artifacts.map(a=>{
    const raw=pinnedFile(packageRoot,a.path,a.sha256,a.size),document=JSON.parse(raw);
    const kind=a.path.includes('/tokens/')?'tokens':'styles';
    if (!document.meta || typeof document.meta.library !== 'string' || typeof document.meta.fileName !== 'string'
      || !Array.isArray(kind==='tokens'?document.collections:document.styles)) fail('INVALID_CATALOG_SOURCE',503);
    const pin=provenance?.sourcePins.find(p=>p.sourceId===a.path.slice(5));
    if(provenance && (!pin || pin.kind!==kind || pin.packagedPath!==a.path || pin.sourceCommit!==pkg.sourceCommits['design-system_ab']
      || pin.sha256!==a.sha256 || pin.size!==a.size || typeof pin.deliveryFileName!=='string'))fail('CATALOG_PROVENANCE_MISMATCH',503);
    return {id:a.path.slice(5),kind,relativePath:a.path,sha256:a.sha256,size:a.size,availability:'available',
      status:'not-declared',context:null,contextEvidence:null,library:document.meta.library,
      observedEntryCount:kind==='tokens'?document.collections.reduce((n,c)=>n+c.variables.length,0):document.styles.length,
      deliveryFileName:pin?.deliveryFileName??document.meta.fileName,
      provenance:{kind:'packaged-source',contentVersion:pkg.contentVersion,packageManifestSha256:manifestSha256,sourceCommit:pkg.sourceCommits['design-system_ab']}};
  });
  // These exact absences remain visible when an older immutable seed is selected.
  const styleFiles=['009 _ Shadows BlueTint Light.json','010 _ Colors Indigo Light.json','011 _ Colors Indigo Dark.json',
    '012 _ Colors Indigo Static.json','020 _ Colors BlueTint Light.json','022 _ Colors BlueTint Static.json',
    'Web _ Core Helpers.json','Web _ Core.json','Web _ Typography.json'];
  for(const name of styleFiles){
    const id='design-system_ab/JSONS/styles/'+name;
    if(!sources.some(s=>s.id===id))sources.push({id,kind:'styles',availability:'not-packaged',relativePath:null,sha256:null,size:null,
      status:'not-declared',context:null,contextEvidence:null,library:null,observedEntryCount:null,
      provenance:{kind:'package-absence',contentVersion:pkg.contentVersion,packageManifestSha256:manifestSha256}});
  }
  const knowledge={contentVersion:pkg.contentVersion,sourceCommits:pkg.sourceCommits,manifestSha256,
    checksum:pkg.checksum,artifactCount:pkg.artifactCount,totalBytes:pkg.totalBytes};
  const virtual={protocolVersion:VERSION,knowledge,evidenceFiles:provenanceArtifact?[{relativePath:provenanceArtifact.path,sha256:provenanceArtifact.sha256,size:provenanceArtifact.size}]:[],sources,readerCodeSha256:digest(codePins)};
  const snapshot=loadSnapshot(packageRoot,digest(virtual),{packageRoot,manifest:virtual});
  const check=snapshot.assertFresh;
  snapshot.assertFresh=()=>{check();for(const pin of codePins)pinnedFile(codeRoot,pin.relativePath,pin.sha256,pin.size);};
  snapshot.readerCodeSha256=virtual.readerCodeSha256;snapshot.codePins=codePins;
  snapshot.rawCatalogs=new Map(sources.filter(s=>s.availability==='available').map(s=>[s.id,JSON.parse(pinnedFile(packageRoot,s.relativePath,s.sha256,s.size))]));
  const originalInventory=snapshot.inventory;
  snapshot.inventory=()=>{snapshot.assertFresh();return JSON.parse(canonical(Object.assign(originalInventory(),{readerCodeSha256:snapshot.readerCodeSha256,codePins})));};
  return snapshot;
}
module.exports.loadPackageSnapshot=loadPackageSnapshot;

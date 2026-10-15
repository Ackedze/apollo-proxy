#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  CHANNEL_SCHEMA_VERSION,
  ENGINE_VERSION,
  KNOWLEDGE_SCHEMA_VERSION,
  sha256File,
  validatePackageDirectory,
} = require('../src/knowledge-package');

const TEXT_DATA_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml', '.txt']);
const DESIGN_RUNTIME_ARTIFACT_ROLES = new Set(['rules', 'composition', 'generatedContract']);
const DESIGN_GIT_INPUT_PATHS = [
  'JSONS/apollo',
  'JSONS/tokens',
  'JSONS/styles',
  'JSONS/referenceSourcesMVP.json',
  ':(glob)JSONS/web/components/**/rules.json',
  ':(glob)JSONS/web/components/**/composition-contract.json',
  ':(glob)JSONS/web/components/**/contract.generated.json',
  ':(glob)JSONS/web/components/**/semantic-targets.json',
  'apollo',
  'patterns',
  'redpolrules',
  'README.md',
  'AGENTIC_FILES.md',
  'COMPONENT_AUTHORING.md',
  ':(exclude)apollo/knowledge/channels/**',
];
const HUB_DATA_ROOTS = [
  'products/ab',
  'products/abm/patterns',
  'core/web/components',
];
const HUB_GIT_INPUT_PATHS = [
  ...HUB_DATA_ROOTS,
  'README.md',
  'CONTRACT.md',
];

function parseArgs(argv) {
  const options = { channel: 'stable', minEngine: ENGINE_VERSION, maxEngine: ENGINE_VERSION };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--directory-only') options.directoryOnly = true;
    else if (key.startsWith('--') && index + 1 < argv.length) options[key.slice(2)] = argv[++index];
    else throw new Error(`Invalid argument: ${key}`);
  }
  return options;
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot read git metadata for ${root}: ${result.stderr}`);
  return result.stdout.trim();
}

function projectionCommit(root, paths) {
  const commit = runGit(root, ['rev-list', '-1', 'HEAD', '--', ...paths]);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Cannot resolve knowledge source commit for ${root}`);
  return commit;
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Path escapes source root: ${target}`);
  return resolved;
}

async function walkFiles(root, filter = () => true, directory = root) {
  const files = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Knowledge inputs may not contain symlinks: ${absolute}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, filter, absolute));
    else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (filter(relative, absolute)) files.push(relative);
    }
  }
  return files.sort();
}

async function collectDesignSystemFiles(root) {
  const result = new Set();
  const addTree = async (relativeRoot, extensions = null, include = () => true) => {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!(await fsp.stat(absoluteRoot).catch(() => null))?.isDirectory()) return;
    for (const relative of await walkFiles(absoluteRoot, (item) => (
      (!extensions || extensions.has(path.extname(item).toLowerCase())) && include(item)
    ))) {
      result.add(path.posix.join(relativeRoot, relative));
    }
  };
  await addTree('JSONS/apollo', TEXT_DATA_EXTENSIONS);
  await addTree('JSONS/tokens', TEXT_DATA_EXTENSIONS);
  await addTree('JSONS/styles', new Set(['.json']));
  await addTree('apollo', TEXT_DATA_EXTENSIONS, (item) => !item.startsWith('knowledge/channels/'));
  await addTree('patterns', TEXT_DATA_EXTENSIONS);
  await addTree('redpolrules', TEXT_DATA_EXTENSIONS);
  for (const fileName of ['README.md', 'AGENTIC_FILES.md', 'COMPONENT_AUTHORING.md']) {
    if ((await fsp.stat(path.join(root, fileName)).catch(() => null))?.isFile()) result.add(fileName);
  }
  const indexPath = path.join(root, 'JSONS/apollo/indexes/componentContractIndex.json');
  const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
  if (index.schemaVersion !== 2 || !Array.isArray(index.packages)) throw new Error('Unsupported componentContractIndex.');
  for (const packageEntry of index.packages) {
    if (typeof packageEntry.packagePath !== 'string' || packageEntry.packagePath.includes('..')) throw new Error('Unsafe packagePath in componentContractIndex.');
    for (const [role, artifact] of Object.entries(packageEntry.artifacts || {})) {
      if (!DESIGN_RUNTIME_ARTIFACT_ROLES.has(role)) continue;
      if (typeof artifact !== 'string' || artifact.includes('..') || path.isAbsolute(artifact)) throw new Error('Unsafe artifact in componentContractIndex.');
      const relative = path.posix.join('JSONS', packageEntry.packagePath, artifact);
      const source = assertInside(root, path.join(root, relative));
      if (!(await fsp.stat(source).catch(() => null))?.isFile()) throw new Error(`Missing indexed artifact: ${relative}`);
      result.add(relative);
    }
    const semanticTargetsRelative = path.posix.join(
      'JSONS',
      packageEntry.packagePath,
      'semantic-targets.json'
    );
    const semanticTargetsSource = assertInside(
      root,
      path.join(root, semanticTargetsRelative)
    );
    if ((await fsp.stat(semanticTargetsSource).catch(() => null))?.isFile()) {
      result.add(semanticTargetsRelative);
    }
  }
  return [...result].sort();
}

function compactGeneratedContract(document) {
  return {
    schemaVersion: document.schemaVersion,
    source: document.source ? { library: document.source.library || null } : null,
    contracts: (document.contracts || []).map((contract) => ({
      id: contract.id || null,
      name: contract.name || null,
      normalizedName: contract.normalizedName || null,
      componentKey: contract.componentKey || null,
      status: contract.status || null,
      platform: contract.platform || null,
      role: contract.role || null,
      source: contract.source ? { library: contract.source.library || null } : null,
      figma: contract.figma ? {
        defaultVariantKey: contract.figma.defaultVariantKey || null,
        variants: {
          properties: contract.figma.variants?.properties || {},
          variantKeys: (contract.figma.variants?.variantKeys || []).map((variant) => ({
            key: variant.key || null,
            properties: variant.properties || {},
          })),
        },
        anatomy: (contract.figma.anatomy || []).map((entry) => ({
          path: entry.path || null,
          type: entry.type || null,
        })),
      } : null,
    })),
  };
}

async function rewriteDesignRuntimeProjection(sourceRoot, packageRoot) {
  const sourceIndexPath = path.join(sourceRoot, 'JSONS/apollo/indexes/componentContractIndex.json');
  const targetIndexPath = path.join(packageRoot, 'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json');
  const index = JSON.parse(await fsp.readFile(sourceIndexPath, 'utf8'));
  for (const packageEntry of index.packages || []) {
    packageEntry.artifacts = Object.fromEntries(
      Object.entries(packageEntry.artifacts || {}).filter(([role]) => DESIGN_RUNTIME_ARTIFACT_ROLES.has(role))
    );
    const generatedName = packageEntry.artifacts.generatedContract;
    if (!generatedName) continue;
    const relative = path.posix.join('JSONS', packageEntry.packagePath, generatedName);
    const sourcePath = path.join(sourceRoot, relative);
    const targetPath = path.join(packageRoot, 'data/design-system_ab', relative);
    const compact = compactGeneratedContract(JSON.parse(await fsp.readFile(sourcePath, 'utf8')));
    await fsp.writeFile(targetPath, `${JSON.stringify(compact)}\n`);
  }
  await fsp.writeFile(targetIndexPath, `${JSON.stringify(index)}\n`);
}

async function collectDsAiHubFiles(root) {
  const result = new Set();
  for (const relativeRoot of HUB_DATA_ROOTS) {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!(await fsp.stat(absoluteRoot).catch(() => null))?.isDirectory()) continue;
    for (const relative of await walkFiles(absoluteRoot, (item) => TEXT_DATA_EXTENSIONS.has(path.extname(item).toLowerCase()))) {
      result.add(path.posix.join(relativeRoot, relative));
    }
  }
  for (const fileName of ['README.md', 'CONTRACT.md']) {
    if ((await fsp.stat(path.join(root, fileName)).catch(() => null))?.isFile()) result.add(fileName);
  }
  return [...result].sort();
}

async function copyProjection(sourceRoot, files, targetRoot, prefix) {
  for (const relative of files) {
    const source = assertInside(sourceRoot, path.join(sourceRoot, relative));
    const target = path.join(targetRoot, 'data', prefix, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
  }
}

async function artifactManifest(packageRoot) {
  const dataRoot = path.join(packageRoot, 'data');
  const files = await walkFiles(dataRoot);
  const artifacts = [];
  for (const relative of files) {
    const filePath = path.join(dataRoot, relative);
    const stat = await fsp.stat(filePath);
    artifacts.push({
      path: path.posix.join('data', relative),
      size: stat.size,
      sha256: await sha256File(filePath),
    });
  }
  return artifacts;
}

function manifestChecksum(artifacts) {
  const canonical = artifacts.map((artifact) => `${artifact.path}\0${artifact.size}\0${artifact.sha256}\n`).join('');
  const value = crypto.createHash('sha256').update(canonical).digest('hex');
  return { algorithm: 'sha256', value, integrity: `sha256-${Buffer.from(value, 'hex').toString('base64')}` };
}

function sourceDate(options, designRoot, hubRoot, designCommit, hubCommit) {
  if (options['generated-at']) return new Date(options['generated-at']).toISOString();
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  const dates = [
    Date.parse(runGit(designRoot, ['show', '-s', '--format=%cI', designCommit])),
    Date.parse(runGit(hubRoot, ['show', '-s', '--format=%cI', hubCommit])),
  ];
  return new Date(Math.max(...dates)).toISOString();
}

async function buildKnowledgePackage(options) {
  if (options['base-package']) return extendPackageWithCatalogs(options);
  const designRoot = path.resolve(options['design-system-root']);
  const hubRoot = path.resolve(options['ds-ai-hub-root']);
  const outputRoot = path.resolve(options.output);
  const designCommit = options['design-system-commit'] || projectionCommit(designRoot, DESIGN_GIT_INPUT_PATHS);
  const hubCommit = options['ds-ai-hub-commit'] || projectionCommit(hubRoot, HUB_GIT_INPUT_PATHS);
  const generatedAt = sourceDate(options, designRoot, hubRoot, designCommit, hubCommit);
  if (options['require-clean']) {
    for (const sourceRoot of [designRoot, hubRoot]) {
      if (runGit(sourceRoot, ['status', '--porcelain'])) {
        throw new Error(`Knowledge source must be clean for publishing: ${sourceRoot}`);
      }
    }
  }
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-build-'));
  const packageRoot = path.join(temporaryRoot, 'package');
  try {
    await copyProjection(designRoot, await collectDesignSystemFiles(designRoot), packageRoot, 'design-system_ab');
    await rewriteDesignRuntimeProjection(designRoot, packageRoot);
    await copyProjection(hubRoot, await collectDsAiHubFiles(hubRoot), packageRoot, 'ds-ai-hub');
    await writeCatalogProvenance(designRoot, packageRoot, designCommit);
    const artifacts = await artifactManifest(packageRoot);
    const checksum = manifestChecksum(artifacts);
    const contentVersion = options['content-version'] || `ds-${designCommit.slice(0, 12)}.hub-${hubCommit.slice(0, 12)}.${checksum.value.slice(0, 12)}`;
    const manifest = {
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      contentVersion,
      channel: options.channel,
      engineCompatibility: { min: options.minEngine, max: options.maxEngine },
      sourceCommits: { 'design-system_ab': designCommit, 'ds-ai-hub': hubCommit },
      generatedAt,
      projection: {
        predicate: 'design-system_ab/JSONS indexed artifacts + generation semantic targets + tokens + styles + apollo + patterns + redpolrules',
        agent: `ds-ai-hub ${HUB_DATA_ROOTS.join(' + ')} text data`,
      },
      artifactCount: artifacts.length,
      totalBytes: artifacts.reduce((total, artifact) => total + artifact.size, 0),
      artifacts,
      checksum,
    };
    await fsp.writeFile(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await fsp.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: '@apollo/knowledge',
      version: `0.0.0-${checksum.value.slice(0, 12)}`,
      description: 'Data-only Apollo knowledge projection',
      license: 'UNLICENSED',
      files: ['data', 'manifest.json'],
    }, null, 2)}\n`);
    await validatePackageDirectory(packageRoot, options.minEngine);
    await fsp.mkdir(outputRoot, { recursive: true });
    const directoryTarget = path.join(outputRoot, 'package');
    await fsp.rm(directoryTarget, { recursive: true, force: true });
    await fsp.cp(packageRoot, directoryTarget, { recursive: true, preserveTimestamps: false });
    let tarball = null;
    let descriptor = null;
    if (!options.directoryOnly) {
      const packed = spawnSync('npm', ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', outputRoot], {
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: path.join(temporaryRoot, 'npm-cache') },
      });
      if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
      const packedInfo = JSON.parse(packed.stdout);
      const sourceTarball = path.join(outputRoot, packedInfo[0].filename);
      tarball = path.join(outputRoot, `apollo-knowledge-${contentVersion}.tgz`);
      await fsp.rename(sourceTarball, tarball);
      const tarballDigest = await sha256File(tarball);
      const tarballIntegrity = `sha256-${Buffer.from(tarballDigest, 'hex').toString('base64')}`;
      if (options['base-url']) {
        const baseUrl = options['base-url'].replace(/\/$/, '');
        descriptor = {
          schemaVersion: CHANNEL_SCHEMA_VERSION,
          channel: options.channel,
          contentVersion,
          generatedAt,
          engineCompatibility: manifest.engineCompatibility,
          sourceCommits: manifest.sourceCommits,
          tarballUrl: `${baseUrl}/${path.basename(tarball)}`,
          tarballIntegrity,
          artifactCount: manifest.artifactCount,
        };
        await fsp.writeFile(path.join(outputRoot, 'latest-stable.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
      }
    }
    return { manifest, tarball, descriptor, packageRoot: directoryTarget };
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
}

// A local catalog extension reuses immutable base bytes; it never packages a dirty authoring tree.
async function extendPackageWithCatalogs(options) {
  if (!options.directoryOnly) throw new Error('--base-package requires --directory-only; local extension cannot publish.');
  const baseRoot = path.resolve(options['base-package']);
  const designRoot = path.resolve(options['design-system-root']);
  const target = path.resolve(options.output, 'package');
  if (target === baseRoot || target.startsWith(baseRoot + path.sep)) throw new Error('Local output must not modify the base package.');
  const base = await validatePackageDirectory(baseRoot, options.minEngine || ENGINE_VERSION);
  const styles = (await walkFiles(path.join(designRoot, 'JSONS/styles'), p => p.endsWith('.json')))
    .map(p => 'JSONS/styles/' + p);
  if (styles.length !== 9) throw new Error('Local V3 extension requires exactly the nine canonical style catalogs.');
  const sourceCommit = base.sourceCommits['design-system_ab'];
  const referencePath = 'JSONS/referenceSourcesMVP.json';
  const referenceBytes = await fsp.readFile(path.join(designRoot,referencePath));
  const referenceTracked = spawnSync('git',['-C',designRoot,'show',sourceCommit+':'+referencePath]);
  if(referenceTracked.status!==0 || !referenceTracked.stdout.equals(referenceBytes)) throw new Error('Reference manifest does not match the pinned base source commit.');
  const catalogPaths = [...base.artifacts.filter(a => a.path.startsWith('data/design-system_ab/JSONS/tokens/'))
    .map(a => a.path.slice('data/design-system_ab/'.length)), ...styles].sort();
  if (catalogPaths.filter(p => p.startsWith('JSONS/tokens/')).length !== 23) throw new Error('Local V3 extension requires 23 token catalogs.');
  const sourcePins = [];
  for (const relative of catalogPaths) {
    const source = assertInside(designRoot, path.join(designRoot, relative));
    const bytes = await fsp.readFile(source);
    const tracked = spawnSync('git', ['-C', designRoot, 'show', sourceCommit + ':' + relative]);
    if (tracked.status !== 0 || !tracked.stdout.equals(bytes)) throw new Error('Catalog does not match the pinned base source commit: ' + relative);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const artifact = base.artifacts.find(a => a.path === 'data/design-system_ab/' + relative);
    if (artifact && (artifact.sha256 !== digest || artifact.size !== bytes.length)) throw new Error('Catalog differs from base package: ' + relative);
    const document = JSON.parse(bytes);
    const kind = relative.startsWith('JSONS/tokens/') ? 'tokens' : 'styles';
    if (!Array.isArray(kind === 'tokens' ? document.collections : document.styles)) throw new Error('Invalid catalog: ' + relative);
    sourcePins.push({sourceId: 'design-system_ab/' + relative, kind, sourceCommit,
      sourcePath: relative, sha256: digest, size: bytes.length});
  }
  await fsp.mkdir(path.dirname(target), {recursive:true});
  await fsp.mkdir(target);
  try {
    for (const artifact of base.artifacts) {
      // Generated provenance is recreated; never share its inode with immutable input.
      if (artifact.path === 'data/design-system_ab/apollo/style-token-catalog-provenance.json') continue;
      const destination = path.join(target, artifact.path);
      await fsp.mkdir(path.dirname(destination), {recursive:true});
      await fsp.link(path.join(baseRoot, artifact.path), destination);
    }
    for (const relative of styles) {
      const destination = path.join(target, 'data/design-system_ab', relative);
      await fsp.mkdir(path.dirname(destination), {recursive:true});
      if (base.artifacts.some(a => a.path === 'data/design-system_ab/' + relative)) continue;
      await fsp.copyFile(path.join(designRoot, relative), destination);
    }
    await writeCatalogProvenance(designRoot, target, sourceCommit);
    for(const pin of sourcePins){
      const packaged=path.join(target,'data/design-system_ab',pin.sourcePath);
      if((await fsp.stat(packaged)).size!==pin.size || await sha256File(packaged)!==pin.sha256)throw new Error('Source changed during local catalog packaging: '+pin.sourcePath);
    }
    const provenance=JSON.parse(await fsp.readFile(path.join(target,'data/design-system_ab/apollo/style-token-catalog-provenance.json'),'utf8'));
    if(provenance.referenceManifest.sha256!==crypto.createHash('sha256').update(referenceBytes).digest('hex'))throw new Error('Reference manifest changed during local catalog packaging.');
    const artifacts = await artifactManifest(target), checksum = manifestChecksum(artifacts);
    const manifest = checksum.value===base.checksum.value ? base : Object.assign({}, base, {
      contentVersion: `ds-${sourceCommit.slice(0,12)}.hub-${base.sourceCommits['ds-ai-hub'].slice(0,12)}.${checksum.value.slice(0,12)}`,
      projection: Object.assign({}, base.projection, {catalogs: {
        classification: 'PINNED_LOCAL_V3_CATALOG_EXTENSION', baseManifestSha256: await sha256File(path.join(baseRoot,'manifest.json')),
        tokenCatalogs:23, styleCatalogs:9, sourcePins,
      }}),
      artifacts, artifactCount:artifacts.length, totalBytes:artifacts.reduce((n,a)=>n+a.size,0), checksum,
    });
    await fsp.writeFile(path.join(target,'manifest.json'), manifest===base
      ? await fsp.readFile(path.join(baseRoot,'manifest.json')) : JSON.stringify(manifest,null,2)+'\n');
    const metadata = JSON.parse(await fsp.readFile(path.join(baseRoot,'package.json'),'utf8'));
    metadata.version = '0.0.0-' + checksum.value.slice(0,12);
    await fsp.writeFile(path.join(target,'package.json'), JSON.stringify(metadata,null,2)+'\n');
    await validatePackageDirectory(target, options.minEngine || ENGINE_VERSION);
    return {manifest, packageRoot:target, tarball:null, descriptor:null};
  } catch (error) {
    await fsp.rm(target,{recursive:true,force:true});
    throw error;
  }
}

async function writeCatalogProvenance(designRoot,packageRoot,sourceCommit){
  const referencePath=path.join(designRoot,'JSONS/referenceSourcesMVP.json');
  if(!(await fsp.stat(referencePath).catch(()=>null))?.isFile())return;
  const referenceBytes=await fsp.readFile(referencePath);
  const reference=JSON.parse(referenceBytes);
  const entries=[...(reference.catalogs||[]),...(reference.libraries||[]).flatMap(l=>l.catalogs||[])];
  const selected=entries.filter(e=>typeof e.path==='string' && /^(tokens|styles)\/[^/]+\.json$/.test(e.path));
  const seen=new Set(),sourcePins=[];
  for(const entry of selected){
    const sourceId='design-system_ab/JSONS/'+entry.path;
    if(seen.has(sourceId))throw new Error('Duplicate catalog in reference manifest: '+sourceId);seen.add(sourceId);
    const packagedPath='data/'+sourceId;
    const bytes=await fsp.readFile(path.join(packageRoot,packagedPath));
    sourcePins.push({sourceId,kind:entry.path.startsWith('tokens/')?'tokens':'styles',deliveryFileName:entry.fileName,
      sourceCommit,packagedPath,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
  }
  if(sourcePins.filter(s=>s.kind==='tokens').length!==23 || sourcePins.filter(s=>s.kind==='styles').length!==9)throw new Error('Reference manifest must provide23 token and9 style catalogs.');
  const file=path.join(packageRoot,'data/design-system_ab/apollo/style-token-catalog-provenance.json');
  await fsp.mkdir(path.dirname(file),{recursive:true});
  await fsp.rm(file,{force:true});
  await fsp.writeFile(file,JSON.stringify({schemaVersion:'apollo.catalog-provenance.v1',sourceCommit,
    referenceManifest:{path:'JSONS/referenceSourcesMVP.json',size:referenceBytes.length,sha256:crypto.createHash('sha256').update(referenceBytes).digest('hex')},
    sourceOrder:sourcePins.map(s=>s.sourceId),sourcePins},null,2)+'\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ['design-system-root', 'ds-ai-hub-root', 'output']) {
    if (!options[required]) throw new Error(`--${required} is required.`);
  }
  const result = await buildKnowledgePackage(options);
  console.log(JSON.stringify({
    contentVersion: result.manifest.contentVersion,
    artifactCount: result.manifest.artifactCount,
    totalBytes: result.manifest.totalBytes,
    tarball: result.tarball,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  artifactManifest,
  buildKnowledgePackage,
  extendPackageWithCatalogs,
  collectDesignSystemFiles,
  collectDsAiHubFiles,
  compactGeneratedContract,
  manifestChecksum,
  parseArgs,
  projectionCommit,
  rewriteDesignRuntimeProjection,
  walkFiles,
};

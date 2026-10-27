#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const releases = require('../src/data-release');
const knowledge = require('../src/knowledge-package');
const PORTABLE_PROFILE = 'checking-ask-figma-mcp';
const FRONTEND_GAP = 'AGENT_FRONTEND_CAPABILITY_UNAVAILABLE';

async function projectPortableData({ dataRoot, runtimeRoot, output, omitContractArchives = false }) {
  dataRoot = path.resolve(dataRoot); runtimeRoot = path.resolve(runtimeRoot); output = path.resolve(output);
  const packages = require('../src/data-packages');
  const original = await fs.readFile(path.join(dataRoot, 'manifest.json'));
  const parent = packages.readDataIndex(dataRoot).index;
  const index = structuredClone(parent);
  if (omitContractArchives) for (const entry of index.contracts) delete entry.archive;
  delete index.generation.frontend;
  delete index.generation.bindings;
  index.parentDataId = parent.deliveryProfile === PORTABLE_PROFILE ? parent.parentDataId : parent.id;
  index.deliveryProfile = PORTABLE_PROFILE;
  index.capabilities = { checking: true, ask: true, figmaMcp: true, frontend: false };
  index.connectionRequirements = { figmaMcp: 'OWN_FIGMA_MCP_CONNECTION_AND_FILE_REQUIRED', frontend: 'DEFERRED_OWN_LOCAL_SDK_CONNECTION' };
  index.capabilityGaps = [{ target: 'frontend', code: FRONTEND_GAP, message: 'Frontend с собственным SDK будет подключён отдельно; исходники SDK не входят в первую поставку.' }];
  index.catalog = (index.catalog || []).map(row => ({ ...row, frontend: { status: 'unavailable', reason: index.capabilityGaps[0].message } }));
  index.id = releases.idOf(index);
  const data = packages.readGenerationData({ root: dataRoot, apolloRoot: runtimeRoot, index });
  // Include declared contract archives as well as files opened by the actual readers.
  for (const contract of index.contracts) if (contract.archive) data.reader.read(contract.archive);
  for (const [file, digest] of data.reader.pins) {
    const relative = path.relative(data.reader.root, file), bytes = await fs.readFile(file);
    if (!['.json', '.zip'].includes(path.extname(relative)) || releases.sha(bytes) !== digest) throw Error('PORTABLE_DATA_CLOSURE_INVALID');
    const target = path.join(output, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  data.assertCurrent();
  if (!(await fs.readFile(path.join(dataRoot, 'manifest.json'))).equals(original)) throw Error('PORTABLE_DATA_INPUT_CHANGED');
  const installed = packages.readGenerationData({ root: output, apolloRoot: runtimeRoot });
  installed.assertCurrent();
  return { index, files: data.reader.pins.size };
}

async function buildDataRelease({ dataRoot, knowledgeRoot, runtimeRoot, output, tarballUrl, profile, skillsRoot, skillsSourceSha256 }) {
  dataRoot = path.resolve(dataRoot); knowledgeRoot = path.resolve(knowledgeRoot); runtimeRoot = path.resolve(runtimeRoot); output = path.resolve(output);
  if (profile !== undefined && profile !== PORTABLE_PROFILE) throw Error('Unknown portable profile.');
  if (new URL(tarballUrl).protocol !== 'https:') throw Error('An immutable HTTPS release asset URL is required.');
  await fs.mkdir(output, { recursive: false });
  const root = path.join(output, 'package');
  await fs.mkdir(root);
  const runtime = releases.readRuntime(runtimeRoot);
  const legacy = await knowledge.validatePackageDirectory(knowledgeRoot);
  for (const [source, name] of [[dataRoot, 'contracts'], [knowledgeRoot, 'knowledge']]) {
    if (name === 'contracts' && profile === PORTABLE_PROFILE) {
      await projectPortableData({ dataRoot, runtimeRoot, output: path.join(root, name) });
      continue;
    }
    // Reject symlinks/special entries before copying an accepted data snapshot.
    const files = await knowledge.listPackageFiles(source);
    for (const relative of files) {
      const destination = path.join(root, name, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(source, relative), destination);
    }
  }
  const sourceSkills = path.resolve(skillsRoot || path.join(runtimeRoot, 'skills'));
  const namingFolder = path.join(sourceSkills, 'figma-layer-name-hygiene');
  const central = require('node:fs').existsSync(path.join(sourceSkills,'manifest.json')) || require('node:fs').existsSync(path.join(namingFolder,'run')) || require('node:fs').existsSync(path.join(namingFolder,'manifest.json'));
  const catalog = central ? require('../src/skills/catalog').readCatalog(sourceSkills) : null;
  if(skillsSourceSha256!==undefined && (!/^[a-f0-9]{64}$/.test(skillsSourceSha256) || catalog && skillsSourceSha256!==catalog.sha256))throw Error('SKILL_CATALOG_INVALID');
  skillsSourceSha256=catalog?.sha256 || skillsSourceSha256;
  const runFolder = catalog ? path.join(namingFolder,'run') : path.join(sourceSkills,'figma-layer-name-hygiene-run');
  if(skillsRoot!==undefined && !require('node:fs').existsSync(namingFolder) && !require('node:fs').existsSync(runFolder))throw Object.assign(Error('Explicit skill source contains no supported naming profile.'),{code:'LAYER_NAMES_SKILL_UNAVAILABLE'});
  // New instructions can be published against an unchanged, accepted runtime.
  if (require('node:fs').existsSync(namingFolder)) {
    const skill = require('../src/skills/layer-names').loadSkill(runtimeRoot, { skillsRoot: sourceSkills });
    for (const file of ['SKILL.md', 'profile.json']) {
      const target = path.join(root, 'skills/figma-layer-name-hygiene', file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(namingFolder, file), target);
    }
    skill.assertCurrent();
  }
  if(require('node:fs').existsSync(runFolder)) {
    const skill=require('../src/skills/run-skill').readRunProfile(runFolder);
    for(const file of ['SKILL.md','profile.json']){
      const target=path.join(root,'skills/figma-layer-name-hygiene-run',file);
      await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(runFolder,file),target);
    }
    skill.assertCurrent();
  }
  catalog?.assertCurrent();
  const data = JSON.parse(await fs.readFile(path.join(root, 'contracts/manifest.json'), 'utf8'));
  const files = [];
  for (const file of await knowledge.listPackageFiles(root)) {
    const bytes = await fs.readFile(path.join(root, file));
    files.push({ file, bytes: bytes.length, sha256: releases.sha(bytes) });
  }
  const manifest = { schemaVersion: releases.RELEASE_SCHEMA, generatedAt: new Date().toISOString(),
    dataId: data.id, knowledgeVersion: legacy.contentVersion, sourceCommits: legacy.sourceCommits,
    ...(skillsSourceSha256 ? {skillsSourceSha256} : {}),
    ...(data.deliveryProfile ? { deliveryProfile: data.deliveryProfile, parentDataId: data.parentDataId, capabilities: data.capabilities } : {}),
    runtimeId: runtime.id, profileVersion: runtime.profileVersion, nativeSourceHash: runtime.nativeSourceHash, files };
  manifest.id = releases.idOf(manifest);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await releases.validateRelease(root, { runtimeRoot });
  const tarballPath = path.join(output, 'apollo-data-' + manifest.id + '.tgz');
  const packed = spawnSync('/usr/bin/tar', ['-czf', tarballPath, '-C', output, 'package'], { encoding: 'utf8' });
  if (packed.status !== 0) throw Error('Data release archive failed: ' + packed.stderr);
  const descriptor = { schemaVersion: releases.CHANNEL_SCHEMA, channel: 'stable', contentVersion: manifest.id,
    runtimeId: runtime.id, tarballUrl: tarballUrl.replaceAll('{version}', manifest.id), tarballIntegrity: 'sha256-' + Buffer.from(await knowledge.sha256File(tarballPath), 'hex').toString('base64') };
  releases.validateDescriptor(descriptor, runtime);
  await fs.writeFile(path.join(output, 'stable.json'), JSON.stringify(descriptor, null, 2) + '\n');
  return { manifest, descriptor, tarballPath, packageRoot: root };
}
if (require.main === module) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--data': 'dataRoot', '--knowledge': 'knowledgeRoot', '--runtime': 'runtimeRoot', '--output': 'output', '--tarball-url': 'tarballUrl', '--profile': 'profile', '--skills-root': 'skillsRoot' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) throw Error('Expected --data ROOT --knowledge ROOT --runtime ROOT --output NEW_ROOT --tarball-url HTTPS_URL [--skills-root ROOT]');
    options[key] = process.argv[i + 1];
  }
  buildDataRelease(options).then(result => console.log(JSON.stringify({ contentVersion: result.manifest.id, tarball: result.tarballPath }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { PORTABLE_PROFILE, FRONTEND_GAP, projectPortableData, buildDataRelease };

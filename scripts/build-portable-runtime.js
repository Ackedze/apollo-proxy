#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire } = require('node:module');
const { RUNTIME_SCHEMA, sha, idOf } = require('../src/data-release');

const ENTRIES = [
  'dist/runtime.cjs', 'dist/agent-protocol.cjs', 'dist/agent-figma-protocol.cjs',
  'dist/agent-figma-provider-descriptor.json',
  'packages/generation-core/dist/planning.cjs', 'packages/component-contract-core/dist/core.cjs',
  'src/generation/agent/figma/source.json', 'src/generation/agent/figma/target.js',
  'src/generation/agent/figma/mapping.js', 'src/generation/agent/figma/projection.js', 'src/generation/agent/figma/api.js',
  'src/generation/context/resources.js', 'src/generation/context/ledger.js',
  'scripts/agent-run-inputs.cjs', 'scripts/agent-generation-skills.cjs',
  'scripts/agent-frontend-workspace.cjs', 'scripts/agent-page-background.cjs',
  'src/skills/layer-names/protocol.js',
  'skills/figma-layer-name-hygiene/profile.json', 'skills/figma-layer-name-hygiene/SKILL.md',
];
function buildPortableRuntime({ apolloRoot, output, skillsRoot, entries = ENTRIES }) {
  apolloRoot = fs.realpathSync(apolloRoot); output = path.resolve(output);
  skillsRoot = path.resolve(skillsRoot || path.join(apolloRoot, 'skills'));
  if (fs.existsSync(output)) throw Error('Portable runtime output already exists. Choose a fresh output.');
  const files = new Map();
  let sourceProjection;
  function include(file, relative = path.relative(apolloRoot, file)) {
    file = path.resolve(file);
    if (!file.startsWith(apolloRoot + path.sep) || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw Error('Runtime file outside accepted code root: ' + relative);
    if (files.has(relative)) return;
    const sourceBytes = fs.readFileSync(file);
    let bytes = sourceBytes;
    if (relative === 'src/generation/agent/figma/source.json') {
      const source = JSON.parse(bytes);
      // Installed mappings supply policy; historical author evidence is not a runtime input.
      const choices = source.choices.map(({ references, defaultPayloadEvidence, ...choice }) => choice);
      bytes = Buffer.from(JSON.stringify({ choices, capabilityPlatform: source.capabilityPlatform }, null, 2) + '\n');
      sourceProjection = { file: relative, originalSha256: sha(sourceBytes), originalBytes: sourceBytes.length,
        constructionSha256: sha(bytes), removedChoiceFields: ['references', 'defaultPayloadEvidence'] };
    }
    files.set(relative, { bytes, sourceBytes, source: file });
    if (!/\.(?:c?js)$/.test(file)) return;
    const resolve = createRequire(file).resolve;
    for (const match of bytes.toString('utf8').matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      const spec = match[2];
      if (spec.startsWith('node:') || builtinModules.includes(spec)) continue;
      if (!spec.startsWith('.')) throw Error('External runtime dependency needs an explicit installed toolchain: ' + spec);
      include(resolve(spec));
    }
  }
  function tree(relative) {
    const root = path.join(apolloRoot, relative);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name), rel = path.join(relative, entry.name);
      if (entry.isDirectory()) tree(rel);
      else include(file);
    }
  }
  for (const entry of entries) include(path.join(apolloRoot, entry));
  const namingSkill = entries.includes('src/skills/layer-names/protocol.js')
    ? require('../src/skills/layer-names').loadSkill(apolloRoot) : null;
  namingSkill?.assertCurrent();
  tree('instructions/agent-generation');
  const profile = JSON.parse(fs.readFileSync(path.join(apolloRoot, 'instructions/agent-generation/skill-profile.json')));
  for (const target of Object.values(profile.targets)) {
    for (const pin of target.files) {
      if (!/^[a-zA-Z0-9_-]+$/.test(target.name) || pin.path.split('/').some(p => p === '..' || !p)) throw Error('Unsafe skill profile');
      const file = path.resolve(skillsRoot, target.name, pin.path), bytes = fs.readFileSync(file);
      if (fs.realpathSync(file) !== file || bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) throw Error('Installed generation skill does not match accepted profile: ' + target.name);
      files.set('skills/' + target.name + '/' + pin.path, { bytes, sourceBytes: bytes, source: file });
    }
  }
  const build = JSON.parse(fs.readFileSync(path.join(apolloRoot, 'dist/build-inputs.json')));
  const descriptor = JSON.parse(files.get('dist/agent-figma-provider-descriptor.json').bytes);
  const manifest = { schemaVersion: RUNTIME_SCHEMA, profileVersion: build.profileVersion, nativeSourceHash: descriptor.sourceHash,
    ...(sourceProjection ? { sourceProjection } : {}),
    capabilities: { checking: true, ask: true, figmaMcp: 'requires-own-connection-and-file', frontend: 'requires-installed-sdk-toolchain-and-browser', builtInFigma: 'not-admitted-by-data-runtime' },
    files: Array.from(files, ([file, value]) => ({ file: file.split(path.sep).join('/'), sha256: sha(value.bytes), bytes: value.bytes.length })).sort((a, b) => a.file.localeCompare(b.file)) };
  manifest.id = idOf(manifest);
  for (const [relative, value] of files) {
    const destination = path.join(output, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value.bytes, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(output, 'portable-runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Detect a source change across copying without producing another source/build seal.
  for (const value of files.values()) if (!fs.readFileSync(value.source).equals(value.sourceBytes)) throw Error('Portable runtime input changed during packaging.');
  namingSkill?.assertCurrent();
  return manifest;
}
if (require.main === module) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--apollo-root': 'apolloRoot', '--output': 'output', '--skills-root': 'skillsRoot' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) throw Error('Expected --apollo-root ROOT --output NEW_ROOT [--skills-root ROOT]');
    options[key] = process.argv[i + 1];
  }
  const result = buildPortableRuntime(options); console.log(JSON.stringify({ runtimeId: result.id, files: result.files.length }));
}
module.exports = { ENTRIES, buildPortableRuntime };

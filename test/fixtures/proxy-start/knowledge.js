const fs = require('node:fs'), path = require('node:path');
const release = require('../../../src/data-release');
const { manifestChecksum } = require('../../../scripts/build-knowledge-package');
const { ENGINE_VERSION } = require('../../../src/knowledge-package');

function put(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
function pins(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const file = path.join(e.parentPath, e.name), bytes = fs.readFileSync(file);
    return { file: path.relative(root, file), bytes: bytes.length, sha256: release.sha(bytes) };
  }).sort((a, b) => a.file.localeCompare(b.file));
}
function create(root) {
  put(root, 'runtime/dist/runtime.cjs', '// Synthetic runtime, never executed\n');
  const runtime = { schemaVersion: release.RUNTIME_SCHEMA, profileVersion: '0.4.1', nativeSourceHash: 'a'.repeat(64), files: pins(path.join(root, 'runtime')) };
  runtime.id = release.idOf(runtime); put(root, 'runtime/portable-runtime.json', runtime);
  const seed = path.join(root, 'seed'), knowledgeRoot = path.join(seed, 'knowledge');
  put(knowledgeRoot, 'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json', { schemaVersion: 2, packages: [{ componentKey: 'fixture' }] });
  put(knowledgeRoot, 'data/design-system_ab/JSONS/apollo/designPatternRules.json', { rules: [] });
  put(knowledgeRoot, 'data/design-system_ab/redpolrules/dictionary.json', { rules: [] });
  put(knowledgeRoot, 'data/ds-ai-hub/products/ab/components/fixture/meta.json', {});
  put(knowledgeRoot, 'data/ds-ai-hub/core/web/components/fixture/meta.json', {});
  const artifacts = pins(knowledgeRoot).map(p => ({ path: p.file, size: p.bytes, sha256: p.sha256 }));
  const knowledge = { schemaVersion: 'apollo.knowledge-package.v1', channel: 'stable', contentVersion: 'fixture', generatedAt: '2026-10-22T00:00:00Z',
    sourceCommits: { 'design-system_ab': '1'.repeat(40), 'ds-ai-hub': '2'.repeat(40) }, engineCompatibility: { min: ENGINE_VERSION, max: ENGINE_VERSION },
    artifacts, artifactCount: artifacts.length, totalBytes: artifacts.reduce((n, a) => n + a.size, 0), checksum: manifestChecksum(artifacts) };
  put(knowledgeRoot, 'manifest.json', knowledge); put(knowledgeRoot, 'package.json', { name: '@apollo/knowledge', version: '0.0.0' });
  const index = { schemaVersion: 'apollo.data-index.v1', profileVersion: runtime.profileVersion };
  index.id = release.idOf(index); put(seed, 'contracts/manifest.json', index);
  const manifest = { schemaVersion: release.RELEASE_SCHEMA, generatedAt: knowledge.generatedAt, knowledgeVersion: knowledge.contentVersion,
    dataId: index.id, runtimeId: runtime.id, profileVersion: runtime.profileVersion, nativeSourceHash: runtime.nativeSourceHash,
    sourceCommits: knowledge.sourceCommits, files: pins(seed) };
  manifest.id = release.idOf(manifest); put(seed, 'manifest.json', manifest);
}
async function run() {
  const [command, ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) options[args[i]] = args[i + 1];
  const root = path.dirname(options['--store']);
  fs.appendFileSync(path.join(root, 'timeline.jsonl'), JSON.stringify({ event: 'start', command, pid: process.pid }) + '\n');
  const ensured = await release.ensureStore({ storeRoot: options['--store'], seedRoot: options['--seed'], runtimeRoot: path.join(root, 'runtime'),
    validateData: async folder => {
      if (command === 'check') {
        const lock = JSON.parse(fs.readFileSync(path.join(options['--store'], '.update.lock')));
        put(root, 'held.json', { command, pid: process.pid, lock });
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(path.join(root, 'release'))) {
          if (Date.now() > deadline) throw Error('Fixture barrier timeout');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      return { index: JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'))), assertCurrent() {} };
    } });
  fs.appendFileSync(path.join(root, 'timeline.jsonl'), JSON.stringify({ event: 'unlocked', command, pid: process.pid }) + '\n');
  if (command === 'check' && fs.existsSync(path.join(root, 'offline'))) throw Error('OFFLINE_CHECK_FIXTURE');
  return release.publicStatus(ensured.state, { updateAvailable: false });
}
if (require.main === module) run().then(value => console.log(JSON.stringify(value))).catch(error => {
  console.log(JSON.stringify({ error: error.message })); process.exitCode = 1;
});
module.exports = { create };

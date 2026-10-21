// Explicit opt-in smoke test. Uses the authenticated local Codex CLI and a
// synthetic one-node contract; no real design snapshot is sent to the agent.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sourceRoot = path.resolve(__dirname, '..');
const proxyRoot = path.resolve(process.argv[2] || sourceRoot);
const pilotRoot = path.join(proxyRoot, 'runtime/component-contract-v4');
const workspacePilot = path.resolve(sourceRoot, '../../projects/Apollo/dist/pilot-release');
const sourcePilot = fs.existsSync(path.join(pilotRoot, 'manifest.json')) ? pilotRoot : workspacePilot;
const { readRelease } = require('../src/contracts/service');
const release = readRelease(sourcePilot);
const fixture = require('../../../projects/Apollo/tests/fixtures');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-v4-live-agent-'));
  const originalCwd = process.cwd();
  let server;
  const start = Date.now();
  try {
    const sources = require('../../../projects/Apollo/tests/authoring-fixtures');
    const source = sources.source(), snapshot = sources.snapshot();
    const authored = release.runtime.loadAuthoringSource(source), contract = authored.contract;
    snapshot.nodes[0].appearance.opacity = .5;
    const bytes = Buffer.from(JSON.stringify(source)), cache = Buffer.from(JSON.stringify(contract));
    const runtimeBytes = fs.readFileSync(path.join(sourcePilot, release.manifest.runtime.file));
    const entry = { id: contract.package.id, family: 'Synthetic test', file: 'contract.json', sha256: sha(bytes),
      componentId: contract.package.componentId, revision: contract.rules[0].revision, dependencies: [],
      contractHash: release.runtime.contractHash(contract), manualSourceHash: contract.package.manualSourceHash,
      sourceHash: authored.sourceHash, generatedFactsHash: contract.package.generatedFactsHash, compiledCache: { file: 'contract-cache.json', sha256: sha(cache) },
      keys: Array.from(release.runtime.collectContractKeys(contract)).sort(), scope: 'standalone-component', published: false };
    const manifest = { schemaVersion: release.manifest.schemaVersion, channel: 'local-pilot', published: false,
      sourceSchema: release.runtime.SOURCE_SCHEMA, runtime: { file: 'runtime.cjs', sha256: sha(runtimeBytes), version: release.manifest.runtime.version }, contracts: [entry] };
    manifest.id = sha(JSON.stringify(manifest));
    fs.writeFileSync(path.join(directory, 'contract.json'), bytes);
    fs.writeFileSync(path.join(directory, 'contract-cache.json'), cache);
    fs.writeFileSync(path.join(directory, 'runtime.cjs'), runtimeBytes);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    process.env.APOLLO_RELEASE_ROOT = directory;
    process.env.CODEX_IDLE_TIMEOUT_MS = '45000';
    process.env.CODEX_MAX_RUNTIME_MS = '90000';
    process.env.CODEX_WORKSPACE = path.join(directory, 'unavailable-legacy-workspace');
    process.env.CODEX_DS_AI_HUB = path.join(directory, 'unavailable-legacy-hub');
    process.env.CODEX_DESIGN_SYSTEM = path.join(directory, 'unavailable-legacy-design-system');
    // Prevent the smoke test from reading the checkout's private .env.
    process.chdir(directory);
    const app = require(path.join(proxyRoot, 'server.js')).app;
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const loaded = await fetch(base + '/v2/contracts/' + entry.id).then(res => res.json());
    assert.equal(loaded.success, true);
    const response = await fetch(base + '/v2/contracts/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditId: sha('apollo-v4-synthetic-smoke'), release: loaded.release, snapshot }) });
    const body = await response.json();
    assert.equal(response.status, 200, body.error || 'Agent request failed');
    assert.equal(body.agent, 'codex');
    assert.ok(body.explanation.trim());
    const expected = release.runtime.auditContractSnapshot(snapshot, contract).engine.evaluations[0];
    assert.equal(expected.classification, 'violation');
    assert.ok(body.references.some(item => item.evaluationId === expected.evaluationId && item.ruleId === expected.ruleId), 'Agent must cite the synthetic violation');
    const result = { documentType: 'apollo-v4-agent-smoke', proxySource: path.relative(sourceRoot, proxyRoot) || '.',
      fixture: 'synthetic-one-node-opacity', agent: body.agent, referencesVerified: true, classification: expected.classification,
      elapsedMs: Date.now() - start, testedAt: new Date().toISOString() };
    const output = path.join(sourceRoot, '.local/v4-qa/agent-smoke.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    process.chdir(originalCwd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });

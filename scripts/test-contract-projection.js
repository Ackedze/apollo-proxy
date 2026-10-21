// Offline opt-in check against private local archives. Never calls Codex or Figma.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const service = require('../src/contracts/service');
const sourceRoot = path.resolve(__dirname, '..');
const releaseRoot = process.argv[2] || (process.env.APOLLO_RELEASE_ROOT || process.env.APOLLO_V4_RELEASE_ROOT)
  || path.resolve(sourceRoot, '../../projects/Apollo/dist/pilot-release');
const dsRoot = process.env.DESIGN_SYSTEM_AB_ROOT || path.resolve(sourceRoot, '../../shared/design-system_ab');
const packageRoot = path.join(dsRoot, 'experiments/web-core/core/Button');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b, message) => assert.ok(JSON.stringify(a) === JSON.stringify(b), message);
const actualNodes = nodes => nodes.map(node => { const actual = Object.assign({}, node); delete actual.baseline; return actual; });

try {
  const loaded = service.readRelease(releaseRoot), item = loaded.contracts.find(item => item.contract.package.componentId === 'core.web.button');
  assert.ok(item, 'Button must be in the pilot release');
  const acceptance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'qa/final-readiness-r31.2026-09-29.json')));
  assert.equal(item.contract.package.manualSourceHash, acceptance.candidateManualHash);
  const sizes = [];
  function checkContract(projected, source, hash) {
    equal(projected.rules, source.rules, 'Source RuleIR changed in the projection');
    equal(projected.customizationPolicy, source.customizationPolicy, 'Source policies changed in the projection');
    assert.equal(projected.compiledHash, hash);
    (source.componentDependencies || []).forEach((pin, i) => checkContract(projected.componentDependencies[i].contract, pin.contract, pin.compiledHash));
  }
  for (const input of acceptance.snapshotComparisons) {
    const file = path.resolve(packageRoot, input.file); assert.ok(file.startsWith(packageRoot + path.sep));
    const bytes = zlib.gunzipSync(fs.readFileSync(file)); assert.equal(sha(bytes), input.sha256, 'Archive checksum mismatch');
    const snapshot = JSON.parse(bytes).snapshot;
    const packet = { auditId: 'a'.repeat(64), release: item.release, contract: item.contract, snapshot,
      deterministicResult: loaded.runtime.auditContractSnapshot(snapshot, item.contract) };
    const prompt = service.buildExplanationPrompt(packet), projected = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    assert.ok(prompt.length <= 900000, 'Archived Button prompt exceeds transport limit');
    checkContract(projected.contract, item.contract, item.entry.contractHash);
    equal(projected.snapshot.nodes, actualNodes(snapshot.nodes), 'Actual node facts changed in the projection');
    if (snapshot.transitionBefore?.nodes) equal(projected.snapshot.transitionBefore.nodes, actualNodes(snapshot.transitionBefore.nodes), 'Before node facts changed');
    const engine = projected.deterministicResult.engine, entries = new Map(engine.evaluations.map(e => [e.evaluationId, e]));
    for (const row of engine.resolvedEvaluations.rows) {
      const entry = Object.fromEntries(engine.resolvedEvaluations.columns.map((name, i) => [name, row[i]]));
      entry.dependency = entry.dependencyEvidenceIndex === null ? undefined : engine.dependencyEvidence[entry.dependencyEvidenceIndex];
      entries.set(entry.evaluationId, entry);
    }
    assert.equal(entries.size, packet.deterministicResult.engine.evaluations.length);
    for (const entry of packet.deterministicResult.engine.evaluations) {
      const p = entries.get(entry.evaluationId); assert.ok(p, 'Evaluation identity missing');
      equal([p.ruleId, p.ruleRevision, p.classification, p.subjectNodeId, p.focusNodeId, p.dependency],
        [entry.ruleId, entry.ruleRevision, entry.classification, entry.subjectNodeId, entry.focusNodeId, entry.dependency], 'Evaluation identity/provenance changed');
      if (!['compliant', 'allowed', 'not-applicable'].includes(entry.classification)) equal(p, entry, 'Finding trace changed');
    }
    sizes.push(prompt.length);
  }
  const summary = { documentType: 'apollo-v4-button-prompt-size-check', reports: sizes.length,
    minCharacters: Math.min(...sizes), maxCharacters: Math.max(...sizes), transportLimit: 900000,
    sourceRulesPreserved: true, actualNodeFactsPreserved: true, allEvaluationIdentitiesPreserved: true, findingTracesPreserved: true, agentCalled: false };
  const output = path.join(sourceRoot, '.local/v4-qa/button-prompt-size.json');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} catch (error) { console.error(error.message); process.exitCode = 1; }

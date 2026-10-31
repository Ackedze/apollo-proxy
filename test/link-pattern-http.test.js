'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm');
const base = require('../src/reports/progressbar-pilot'), pilot = require('../src/reports/component-pattern-pilot');
const {fixture, payload} = require('./helpers/component-patterns');

test('actual HTTP prepare/run handler transports the declared Link scope and rejects a changed scope before starting a run', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), source = await fs.readFile(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf("app.post('/v1/analyze/codex/runs',"), end = source.indexOf('\nfunction respondWithCodexRun', start);
  assert.ok(start > 0 && end > start);
  let handler, calls = 0;
  vm.runInNewContext(source.slice(start, end), {
    app: {post(url, callback) { handler = callback; }},
    validateCodexReportRequest: base.validatePilotRequest, progressBarPilot: base, activeCodexRuns: 0,
    assertCodexRuntimeReady: () => ({knowledge:f.options.knowledgeRelease}),
    CODEX_DESIGN_SYSTEM:f.options.designSystemRoot, CODEX_DS_AI_HUB:f.options.hubRoot,
    createCodexRun() { calls++; return {id:'run_12345678-abcd',status:'queued'}; },
  });
  const request = body => new Promise(resolve => {
    let status = 200;
    const res = {status(value) { status = value; return res; },json(value) { resolve({status,value}); }};
    handler({body}, res);
  });
  const input = payload(f.capture([{contract:'link.universal'}]), pilot.LINK_PILOT), prepared = await request(input);
  assert.equal(prepared.status, 200); assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.value.preparation.declaredContext)), input.report.context);
  assert.equal(prepared.value.preparation.subjects[0].ruleIds.length, 8);
  input.report.phase = 'run'; input.report.sourcePin = prepared.value.preparation.sourcePin;
  input.report.context.platform = 'mobile-web';
  assert.equal((await request(input)).value.code, 'PATTERN_SOURCE_STALE'); assert.equal(calls, 0);
  input.report.context.platform = 'desktop';
  assert.equal((await request(input)).status, 202); assert.equal(calls, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('contract explanation launches isolated Codex, reports busy/auth errors and cleans its workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-v4-launcher-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'codex-stub'), record = path.join(root, 'record.json');
  fs.writeFileSync(executable, '#!/usr/bin/env node\n' + `
const fs = require('node:fs'), args = process.argv.slice(2);
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), input }));
  if (input === 'auth-error') { process.stderr.write('not logged in'); process.exit(1); }
  setTimeout(() => {
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'stub', findings: [] }));
  }, 100);
});
`, { mode: 0o700 });
  process.env.CODEX_BIN = executable;
  process.env.CODEX_WORKSPACE = path.join(root, 'missing-legacy-workspace');
  process.env.CODEX_DS_AI_HUB = path.join(root, 'missing-legacy-hub');
  process.env.CODEX_DESIGN_SYSTEM = path.join(root, 'missing-legacy-ds');
  const { callCodexContractExplanation } = require('../server');
  const running = callCodexContractExplanation('frozen-contract-packet', { type: 'object' });
  await assert.rejects(callCodexContractExplanation('second-request', {}), error => error.status === 429);
  assert.equal((await running).summary, 'stub');
  const observed = JSON.parse(fs.readFileSync(record));
  assert.equal(observed.input, 'frozen-contract-packet');
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', '--output-schema']) assert.ok(observed.args.includes(flag));
  assert.equal(observed.args[observed.args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(!observed.args.includes('--add-dir'));
  assert.equal(fs.existsSync(observed.cwd), false);
  await assert.rejects(callCodexContractExplanation('auth-error', {}), error => error.status === 401);
  assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(record)).cwd), false);
  assert.equal((await callCodexContractExplanation('after-error', {})).summary, 'stub');
});

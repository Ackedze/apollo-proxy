#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const releases = require('../src/data-release');
const { downloadFile, fetchJson } = require('../src/knowledge-package');

function parse(argv) {
  const [command, ...args] = argv, options = {};
  if (!['ensure', 'status', 'check', 'update', 'rollback', 'run'].includes(command)) throw Error('Unknown data release command.');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--store', '--seed', '--runtime', '--descriptor', '--engine'].includes(args[i]) || !args[i + 1]) throw Error('Invalid data release argument.');
    options[args[i].slice(2)] = args[i + 1];
  }
  for (const key of ['store', 'seed', 'runtime']) if (!options[key]) throw Error('--' + key + ' is required.');
  return { command, options };
}

async function runCommand(command, options) {
  const settings = { storeRoot: path.resolve(options.store), seedRoot: path.resolve(options.seed), runtimeRoot: path.resolve(options.runtime) };
  const ensured = await releases.ensureStore(settings);
  const releaseReader = await require('../src/data-release').retainRelease(ensured.state?.current?.path);
  try {
    if (['ensure', 'status', 'run'].includes(command)) return releases.publicStatus(ensured.state, { recovered: ensured.recovered });
    if (command === 'rollback') return releases.publicStatus(await releases.rollbackStore(settings), { rolledBack: true });
    const url = options.descriptor || process.env.APOLLO_DATA_DESCRIPTOR_URL || require('../src/portable-runtime').readSettings().dataDescriptorUrl;
    if (!url) throw Error('Configure APOLLO_DATA_DESCRIPTOR_URL for remote data updates.');
    const token = process.env.APOLLO_DATA_TOKEN;
    const descriptor = releases.validateDescriptor(await fetchJson(url, token), releases.readRuntime(settings.runtimeRoot));
    const updateAvailable = descriptor.contentVersion !== ensured.state.current.contentVersion;
    if (command === 'check' || !updateAvailable) return releases.publicStatus(ensured.state, { updateAvailable, descriptor });
    const temporary = path.join(settings.storeRoot, '.download-' + crypto.randomUUID() + '.tgz');
    try {
      console.error(JSON.stringify({ phase: 'downloading' }));
      await downloadFile(descriptor.tarballUrl, temporary, token);
      console.error(JSON.stringify({ phase: 'validating' }));
      const state = await releases.installTarball({ ...settings, tarballPath: temporary, expectedIntegrity: descriptor.tarballIntegrity, expectedContentVersion: descriptor.contentVersion });
      return releases.publicStatus(state, { updateAvailable: false, updated: true, descriptor });
    } finally { await fs.rm(temporary, { force: true }); }
  } finally { releaseReader(); }
}

async function main(argv) {
  const { command, options } = parse(argv);
  const status = await runCommand(command, options);
  if (command !== 'run') { console.log(JSON.stringify(status)); return; }
  const root = path.resolve(__dirname, '..');
  const env = { ...process.env, APOLLO_PROJECT_ROOT: path.resolve(options.runtime), APOLLO_DATA_ROOT: status.dataRoot,
    APOLLO_RELEASE_ROOT: status.releaseRoot, CODEX_DESIGN_SYSTEM: status.designSystemRoot, CODEX_DS_AI_HUB: status.dsAiHubRoot,
    APOLLO_KNOWLEDGE_CONTENT_VERSION: status.current.knowledgeVersion,
    APOLLO_KNOWLEDGE_DESIGN_SYSTEM_COMMIT: status.current.sourceCommits['design-system_ab'],
    APOLLO_KNOWLEDGE_DS_AI_HUB_COMMIT: status.current.sourceCommits['ds-ai-hub'] };
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.log(JSON.stringify({ success: false, code: error.code || 'DATA_RELEASE_UPDATE_FAILED', error: error.message }));
  process.exitCode = 1;
});
module.exports = { parse, runCommand };

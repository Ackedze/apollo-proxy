#!/usr/bin/env node
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  ENGINE_VERSION,
  downloadFile,
  ensureStore,
  fetchJson,
  installTarball,
  publicStatus,
  rollbackStore,
  validateChannelDescriptor,
} = require('../src/knowledge-package');

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key]) throw new Error(`--${key} is required.`);
  return path.resolve(options[key]);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const storeRoot = required(options, 'store');
  const seedRoot = required(options, 'seed');
  const engineVersion = options.engine || ENGINE_VERSION;
  const ensured = await ensureStore({ storeRoot, seedRoot, engineVersion });
  if (command === 'ensure' || command === 'status') {
    console.log(JSON.stringify(publicStatus(ensured.state, { recovered: ensured.recovered })));
    return;
  }
  if (command === 'rollback') {
    const state = await rollbackStore({ storeRoot, engineVersion });
    console.log(JSON.stringify(publicStatus(state, { rolledBack: true })));
    return;
  }
  if (!['check', 'update'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const descriptorUrl = options.descriptor || process.env.APOLLO_KNOWLEDGE_DESCRIPTOR_URL;
  if (!descriptorUrl) throw new Error('Knowledge descriptor URL is not configured.');
  const descriptor = validateChannelDescriptor(
    await fetchJson(descriptorUrl, process.env.APOLLO_KNOWLEDGE_TOKEN),
    engineVersion
  );
  const updateAvailable = descriptor.contentVersion !== ensured.state.current.contentVersion;
  if (command === 'check' || !updateAvailable) {
    console.log(JSON.stringify(publicStatus(ensured.state, { updateAvailable, descriptor })));
    return;
  }
  const temporary = path.join(storeRoot, `.download-${crypto.randomUUID()}.tgz`);
  try {
    console.error(JSON.stringify({ phase: 'downloading' }));
    await downloadFile(descriptor.tarballUrl, temporary, process.env.APOLLO_KNOWLEDGE_TOKEN);
    console.error(JSON.stringify({ phase: 'validating' }));
    const state = await installTarball({
      storeRoot,
      tarballPath: temporary,
      expectedIntegrity: descriptor.tarballIntegrity,
      expectedContentVersion: descriptor.contentVersion,
      expectedSourceCommits: descriptor.sourceCommits,
      engineVersion,
    });
    console.log(JSON.stringify(publicStatus(state, { updateAvailable: false, updated: true, descriptor })));
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ success: false, code: error.code || 'KNOWLEDGE_UPDATE_FAILED', error: error.message || String(error) }));
  process.exitCode = 1;
});

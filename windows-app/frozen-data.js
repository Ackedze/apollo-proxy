'use strict';
const fs = require('node:fs');
const path = require('node:path');
function createFrozenDataCommand({ proxyRoot, indexFile, archive, releases, protectedData, validateReference, cli }) {
  releases ||= require(path.join(proxyRoot, 'src/data-release'));
  protectedData ||= require(path.join(proxyRoot, 'src/data-packages/protected'));
  validateReference ||= require(path.join(proxyRoot, 'src/data-packages/npm')).validateReference;
  cli ||= require(path.join(proxyRoot, 'scripts/git-data-cli'));
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  if (index.schemaVersion !== 'apollo.git-data-index.v3') throw Error('WINDOWS_SEED_INVALID');
  validateReference(index.npm); protectedData.validateActivation(index.activation);
  const request = async url => {
    if (url !== index.npm.tarballUrl) throw Error('WINDOWS_SEED_REQUEST_FORBIDDEN');
    // The stock consumer still verifies the exact byte count, SHA-512, AES-GCM and inner manifest.
    return new Response(fs.readFileSync(archive), { headers: { 'Content-Length': String(index.npm.bytes) } });
  };
  return async (command, options) => {
    const settings = { storeRoot: path.resolve(options.store), seedRoot: path.resolve(options.seed), runtimeRoot: path.resolve(options.runtime) };
    if (releases.readRuntime(settings.runtimeRoot).id !== index.runtimeId) throw Error('DATA_RELEASE_RUNTIME_INCOMPATIBLE');
    if (['status', 'ensure', 'rollback'].includes(command)) return cli.runCommand(command, options);
    if (!['activate', 'check', 'update'].includes(command)) throw Error('WINDOWS_COMMAND_INVALID');
    let ensured;
    try { ensured = await releases.ensureStore(settings); }
    catch (e) {
      if (e.code !== 'ENOENT' || fs.existsSync(path.join(settings.storeRoot, 'state.json')) || !fs.existsSync(path.join(settings.seedRoot, '.activation-required'))) throw e;
      ensured = { state: { current: null, previous: null } };
    }
    return protectedData.installProtected({ settings, ensured, selected: { index, commit: null }, command,
      access: options.access || {}, request, releases });
  };
}
module.exports = { createFrozenDataCommand };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const releases = require('./data-release');

function stateRoot(environment = process.env) {
  return path.resolve(environment.APOLLO_STATE_ROOT || path.join(environment.HOME || os.homedir(), 'Library/Application Support/ApolloProxyControl'));
}
function readSettings(environment = process.env) {
  const file = path.join(stateRoot(environment), 'portable-settings.json');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  validateSettings(value);
  return value;
}
function validateSettings(value) {
  const keys = ['dataDescriptorUrl', 'figmaFileKey', 'frontendToolchainHome', 'chromeExecutable'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Error('PORTABLE_SETTINGS_INVALID');
  if (value.dataDescriptorUrl && new URL(value.dataDescriptorUrl).protocol !== 'https:') throw Error('PORTABLE_SETTINGS_HTTPS_REQUIRED');
  if (value.figmaFileKey && !/^[a-zA-Z0-9_-]{6,128}$/.test(value.figmaFileKey)) throw Error('PORTABLE_FIGMA_FILE_INVALID');
  for (const key of ['frontendToolchainHome', 'chromeExecutable']) if (value[key] && !path.isAbsolute(value[key])) throw Error('PORTABLE_SETTINGS_PATH_INVALID');
  return value;
}
function installedSkillsDirectory(root) {
  return fs.existsSync(path.join(root, 'portable-runtime.json')) ? path.join(root, 'skills') : undefined;
}
function configureInstalledEnvironment({ proxyRoot, environment = process.env }) {
  const code = path.resolve(environment.APOLLO_PROJECT_ROOT || path.join(proxyRoot, 'runtime/apollo'));
  if (!fs.existsSync(path.join(code, 'portable-runtime.json'))) return { portable: false };
  releases.readRuntime(code);
  const settings = readSettings(environment), state = stateRoot(environment);
  const snapshot = environment.APOLLO_RELEASE_ROOT || path.join(proxyRoot, 'runtime/seed');
  const release = releases.readReleaseFiles(snapshot, code);
  const set = (key, value) => { if (!environment[key]) environment[key] = value; };
  set('APOLLO_PROJECT_ROOT', code);
  set('APOLLO_RELEASE_ROOT', snapshot);
  set('APOLLO_DATA_ROOT', path.join(snapshot, 'contracts'));
  set('CODEX_DESIGN_SYSTEM', path.join(snapshot, 'knowledge/data/design-system_ab'));
  set('CODEX_DS_AI_HUB', path.join(snapshot, 'knowledge/data/ds-ai-hub'));
  set('APOLLO_KNOWLEDGE_CONTENT_VERSION', release.knowledgeVersion);
  set('APOLLO_CODEX_DEBUG_ROOT', path.join(state, 'history/validation'));
  set('APOLLO_DATA_DESCRIPTOR_URL', settings.dataDescriptorUrl || '');
  // Legacy settings/history stay on disk, but never configure a retired executor.
  for(const name of ['APOLLO_AGENT_MVP_CONFIG','APOLLO_AGENT_FIGMA_CONFIG','APOLLO_AGENT_MCP_CONFIG'])delete environment[name];
  const landingConfigured=release.files.some(pin=>pin.file==='skills/ab-generate-custom-landing/manifest.json');
  return {portable:true,releaseId:release.id,dataId:release.dataId,figmaMcpConfigured:Boolean(settings.figmaFileKey),frontendConfigured:false,landingConfigured,
    gaps:landingConfigured?[]:['LANDING_SKILL_DATA_REQUIRED']};
}
module.exports = { stateRoot, readSettings, validateSettings, installedSkillsDirectory, configureInstalledEnvironment };

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
  const generated = path.join(state, 'generation'), configRoot = path.join(state, 'config');
  fs.mkdirSync(configRoot, { recursive: true });
  const write = (name, value) => {
    const file = path.join(configRoot, name + '.json'), bytes = JSON.stringify(value, null, 2) + '\n';
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== bytes) {
      fs.writeFileSync(file + '.tmp', bytes, { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    }
    return file;
  };
  const figmaFileKey = environment.APOLLO_FIGMA_FILE_KEY || settings.figmaFileKey;
  if (figmaFileKey) {
    validateSettings({ figmaFileKey });
    set('APOLLO_AGENT_FIGMA_CONFIG', write('figma', { schemaVersion: 'apollo.data-mcp-host-config.v1', apolloRoot: code,
      frontendRoot: path.join(generated, 'figma-output'), hostRoot: path.join(generated, 'figma-host') }));
    set('APOLLO_AGENT_MCP_CONFIG', write('mcp', { schemaVersion: 'apollo.mcp-worker-config.v1', name: 'apollo_figma_mcp',
      url: 'https://mcp.figma.com/mcp', fileKey: figmaFileKey, tools: ['use_figma', 'get_screenshot'] }));
  }
  const toolchain = environment.APOLLO_FRONTEND_TOOLCHAIN_ROOT || settings.frontendToolchainHome;
  const chrome = environment.APOLLO_CHROME_BIN || settings.chromeExecutable;
  const frontendAvailable = release.capabilities?.frontend !== false;
  if (!frontendAvailable) delete environment.APOLLO_AGENT_MVP_CONFIG;
  if (frontendAvailable && toolchain && chrome) {
    validateSettings({ frontendToolchainHome: toolchain, chromeExecutable: chrome });
    set('APOLLO_AGENT_MVP_CONFIG', write('frontend', { schemaVersion: 'apollo.agent-runtime-config.v1', apolloRoot: code,
      mappingDirectory: path.join(snapshot, 'contracts/generation'), frontendRoot: path.join(generated, 'frontend-output'),
      hostRoot: path.join(generated, 'frontend-host'), toolchainHome: toolchain, nodeExecutable: process.execPath,
      chromeExecutable: chrome, laboratoryFile: null }));
  }
  return { portable: true, releaseId: release.id, dataId: release.dataId,
    figmaMcpConfigured: Boolean(figmaFileKey), frontendConfigured: Boolean(frontendAvailable && toolchain && chrome),
    gaps: [!figmaFileKey && 'OWN_FIGMA_MCP_CONNECTION_AND_FILE_REQUIRED', !frontendAvailable ? 'AGENT_FRONTEND_CAPABILITY_UNAVAILABLE' : !(toolchain && chrome) && 'FRONTEND_SDK_TOOLCHAIN_AND_BROWSER_REQUIRED'].filter(Boolean) };
}
module.exports = { stateRoot, readSettings, validateSettings, installedSkillsDirectory, configureInstalledEnvironment };

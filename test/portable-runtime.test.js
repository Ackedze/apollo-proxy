const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha, idOf, RUNTIME_SCHEMA, RELEASE_SCHEMA } = require('../src/data-release');
const { configureInstalledEnvironment, validateSettings } = require('../src/portable-runtime');

test('installed runtime creates own settings/outputs without a checkout, author consumer or credentials', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-portable-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proxyRoot = path.join(root, 'proxy'), code = path.join(proxyRoot, 'runtime/apollo'), seed = path.join(proxyRoot, 'runtime/seed'), state = path.join(root, 'own-user-state');
  function put(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); }
  function pin(file, bytes) { return { file, sha256: sha(Buffer.from(bytes)), bytes: Buffer.byteLength(bytes) }; }
  put(path.join(code, 'dist/runtime.cjs'), '// fixture');
  const runtime = { schemaVersion: RUNTIME_SCHEMA, profileVersion: '0.4.1', nativeSourceHash: 'a'.repeat(64), files: [pin('dist/runtime.cjs', '// fixture')] };
  runtime.id = idOf(runtime); put(path.join(code, 'portable-runtime.json'), runtime);
  put(path.join(seed, 'contracts/manifest.json'), '{}');
  const manifest = { schemaVersion: RELEASE_SCHEMA, generatedAt: '2026-10-20T00:00:00Z', dataId: 'd'.repeat(64), knowledgeVersion: 'seed', runtimeId: runtime.id, profileVersion: runtime.profileVersion, nativeSourceHash: runtime.nativeSourceHash, files: [pin('contracts/manifest.json', '{}')] };
  manifest.id = idOf(manifest); put(path.join(seed, 'manifest.json'), manifest);
  put(path.join(state, 'portable-settings.json'), { figmaFileKey: 'OwnFile123', dataDescriptorUrl: 'https://example.test/apollo/stable.json' });
  put(path.join(state, 'history/keep.json'), '{"owned":true}');
  const environment = { APOLLO_STATE_ROOT: state, HOME: path.join(root, 'own-home'), CODEX_HOME: path.join(root, 'own-auth') };
  const result = configureInstalledEnvironment({ proxyRoot, environment });
  assert.equal(result.portable, true); assert.equal(result.frontendConfigured, false); assert.equal(result.figmaMcpConfigured, true);
  assert.equal(environment.CODEX_HOME, path.join(root, 'own-auth'));
  assert.equal(environment.APOLLO_DATA_ROOT, path.join(seed, 'contracts'));
  assert.equal(environment.APOLLO_PROJECT_ROOT, code);
  assert.equal(environment.APOLLO_AGENT_FIGMA_CONFIG, undefined);
  assert.equal(environment.APOLLO_AGENT_MCP_CONFIG, undefined);
  assert.equal(result.landingConfigured, false);
  assert(result.gaps.includes('LANDING_SKILL_DATA_REQUIRED'));
  assert.equal(fs.readFileSync(path.join(state, 'history/keep.json'), 'utf8'), '{"owned":true}');
  assert.equal(environment.APOLLO_AGENT_MVP_CONFIG, undefined);
  assert.equal(fs.existsSync(path.join(root, 'own-auth')), false);
  assert.doesNotMatch(JSON.stringify(environment), /alexkukhta|Desktop\/workplace|arui-private/);
  manifest.capabilities = { checking: true, ask: true, figmaMcp: true, frontend: false };
  manifest.id = idOf(manifest); put(path.join(seed, 'manifest.json'), manifest);
  const disabled = { ...environment, APOLLO_AGENT_MVP_CONFIG: '/own/old-frontend.json', APOLLO_FRONTEND_TOOLCHAIN_ROOT: '/own/sdk', APOLLO_CHROME_BIN: '/own/chrome' };
  const firstProfile = configureInstalledEnvironment({ proxyRoot, environment: disabled });
  assert.equal(firstProfile.frontendConfigured, false);
  assert.equal(disabled.APOLLO_AGENT_MVP_CONFIG, undefined);
  assert(firstProfile.gaps.includes('LANDING_SKILL_DATA_REQUIRED'));
  assert.equal(disabled.CODEX_HOME, environment.CODEX_HOME);
});

test('portable setup leaves developer configurations untouched and rejects credentials/unsafe connection settings', () => {
  const environment = { APOLLO_AGENT_FIGMA_CONFIG: '/own/host.json' };
  assert.deepEqual(configureInstalledEnvironment({ proxyRoot: '/not-an-installed-bundle', environment }), { portable: false });
  assert.deepEqual(environment, { APOLLO_AGENT_FIGMA_CONFIG: '/own/host.json' });
  assert.throws(() => validateSettings({ token: 'never-copy' }));
  assert.throws(() => validateSettings({ dataDescriptorUrl: 'http://example.test/data' }));
  assert.throws(() => validateSettings({ frontendToolchainHome: 'relative/author-root' }));
  assert.throws(() => validateSettings({ figmaFileKey: '../author' }));
});

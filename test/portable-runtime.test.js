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

test('portable runtime carries the pure V3 preparation code with exact pins while older code has no audit capability', t => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-v3-portable-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const apolloRoot=path.join(root,'apollo');
  function put(file,value){const target=path.join(apolloRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));}
  put('dist/runtime.cjs','module.exports={};');
  put('dist/build-inputs.json',{profileVersion:'0.4.8'});
  put('dist/agent-figma-provider-descriptor.json',{sourceHash:'a'.repeat(64)});
  const {buildPortableRuntime}=require('../scripts/build-portable-runtime'),entries=['dist/runtime.cjs','dist/agent-figma-provider-descriptor.json'];
  const old=buildPortableRuntime({apolloRoot,output:path.join(root,'old'),entries});assert.equal(old.capabilities.auditDataPreparation,undefined);
  const file='dist/v3-audit-preparation.cjs',body='exports.VERSION="apollo.v3-audit-preparation.v1";';put(file,body);
  const output=path.join(root,'new'),current=buildPortableRuntime({apolloRoot,output,entries});
  assert.equal(current.capabilities.auditDataPreparation,require('../src/audit-data/protocol').SCHEMA);
  assert.deepEqual(current.files.find(row=>row.file===file),{file,sha256:sha(Buffer.from(body)),bytes:Buffer.byteLength(body)});
  assert.equal(fs.readFileSync(path.join(output,file),'utf8'),body);
  assert.equal(require('../src/audit-data/builder').preparationFromRuntime(output).VERSION,'apollo.v3-audit-preparation.v1');
});

test('actual portable producer declares direct workflow; unchanged reader accepts direct package and refuses staged data',t=>{
 const catalog=require('../src/skills/catalog'),releases=require('../src/data-release'),{buildPortableRuntime}=require('../scripts/build-portable-runtime');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'direct-portable-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const apolloRoot=path.join(root,'apollo'),runtimeRoot=path.join(root,'built');
 const put=(base,name,body)=>{const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return {file:name,bytes:bytes.length,sha256:sha(bytes)};};
 put(apolloRoot,'dist/runtime.cjs','module.exports={};');put(apolloRoot,'dist/build-inputs.json',{profileVersion:'0.4.16'});put(apolloRoot,'dist/agent-figma-provider-descriptor.json',{sourceHash:'a'.repeat(64)});put(apolloRoot,'instructions/landing/figma-workflow.md','# Loaded workflow file: figma-use/SKILL.md\nFixture\n# Loaded workflow file: figma-generate-design/SKILL.md\nFixture');
 const runtime=buildPortableRuntime({apolloRoot,output:runtimeRoot,entries:['dist/runtime.cjs','dist/agent-figma-provider-descriptor.json','instructions/landing/figma-workflow.md']});assert.equal(runtime.capabilities.generationWorkflow,catalog.DIRECT_WORKFLOW);assert.equal(runtime.capabilities.recipeOperations,undefined);
 const skillRoot=path.resolve(__dirname,'../../../shared/design-system_ab/apollo/skills/ab-generate-custom-landing'),descriptor=JSON.parse(fs.readFileSync(path.join(skillRoot,'manifest.json')));
 function data(name,workflow){
  const target=path.join(root,name),profile=JSON.parse(JSON.stringify(descriptor));profile.generation.workflow=workflow;const files=[];
  for(const pin of profile.files)files.push(put(target,'skills/'+profile.id+'/'+pin.path,fs.readFileSync(path.join(skillRoot,pin.path),'utf8')));
  files.push(put(target,'skills/'+profile.id+'/manifest.json',profile));files.push(put(target,'knowledge/data/ds-ai-hub/AGENTS.md','Fixture rules'));
  for(const id of profile.generation.requiredResources)files.push(put(target,id,id.endsWith('.json')?'{}':'Fixture rules'));
  const manifest={schemaVersion:RELEASE_SCHEMA,generatedAt:'2026-11-06T00:00:00Z',dataId:'b'.repeat(64),knowledgeVersion:'fixture',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};manifest.id=idOf(manifest);put(target,'manifest.json',manifest);return target;
 }
 const direct=data('direct',catalog.DIRECT_WORKFLOW);assert.equal(releases.readReleaseFiles(direct,runtimeRoot).runtimeId,runtime.id);assert.equal(require('../src/landing/knowledge').openKnowledge({releaseRoot:direct,runtimeRoot}).skill.version,descriptor.version);
 const staged=data('staged',catalog.STAGED_WORKFLOW);assert.throws(()=>releases.readReleaseFiles(staged,runtimeRoot),{code:'DATA_RELEASE_RUNTIME_INCOMPATIBLE'});
});

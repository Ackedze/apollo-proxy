'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const releases = require('../src/data-release'), npmData = require('../src/data-packages/npm');
const { buildNpmDataPackage } = require('../scripts/build-npm-data-package');
const { buildDataRelease } = require('../scripts/build-data-release');
const { updateFromGit, readGitIndex } = require('../scripts/git-data-cli');
const packages = require('../src/data-packages');
const sourceUrl = 'https://raw.githubusercontent.com/example/contracts/main/apollo/data-packages/current.json';
const commit = 'c'.repeat(40), sha = releases.sha;
async function put(root, file, body) {
  const target = path.join(root, file); await fs.mkdir(path.dirname(target), {recursive:true});
  await fs.writeFile(target, typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function pins(root) {
  const result=[];
  for (const file of await require('../src/knowledge-package').listPackageFiles(root)) {
    const bytes=await fs.readFile(path.join(root,file));result.push({file,sha256:sha(bytes),bytes:bytes.length});
  }
  return result;
}
async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'npm-data-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const runtimeRoot=path.join(root,'runtime');
  // Small synthetic runtime exercises transport/assembly/reader contracts; the accepted real runtime is tested separately.
  await put(runtimeRoot,'dist/runtime.cjs',`const crypto=require('node:crypto');exports.RUNTIME_VERSION='0.4.1';exports.contractHash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');exports.loadAuthoringSource=s=>({contract:s.compiled});exports.collectContractKeys=c=>[c.package.componentId];exports.collectContractDependencies=c=>c.dependencies||[];`);
  await put(runtimeRoot,'packages/component-contract-core/dist/core.cjs','module.exports={};');
  const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),files:await pins(runtimeRoot)};
  runtime.id=releases.idOf(runtime);await put(runtimeRoot,'portable-runtime.json',runtime);
  const knowledgeRoot=path.join(root,'knowledge'), knowledgeApi=require('../src/knowledge-package');
  for (const file of ['data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json','data/design-system_ab/JSONS/apollo/designPatternRules.json','data/design-system_ab/redpolrules/dictionary.json','data/ds-ai-hub/products/ab/components/fixture/meta.json','data/ds-ai-hub/core/web/components/fixture/meta.json']) await put(knowledgeRoot,file,{});
  await put(knowledgeRoot,'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json',{schemaVersion:2,packages:[{componentKey:'fixture'}]});
  await put(knowledgeRoot,'data/design-system_ab/JSONS/apollo/designPatternRules.json',{rules:[]});
  await put(knowledgeRoot,'data/design-system_ab/redpolrules/dictionary.json',{rules:[]});
  const artifacts=(await pins(knowledgeRoot)).map(p=>({path:p.file,size:p.bytes,sha256:p.sha256}));
  const k={schemaVersion:'apollo.knowledge-package.v1',channel:'stable',contentVersion:'fixture-knowledge',generatedAt:'2026-10-27T00:00:00Z',sourceCommits:{'design-system_ab':'1'.repeat(40),'ds-ai-hub':'2'.repeat(40)},engineCompatibility:{min:knowledgeApi.ENGINE_VERSION,max:knowledgeApi.ENGINE_VERSION},artifacts,artifactCount:artifacts.length,totalBytes:artifacts.reduce((n,p)=>n+p.size,0),checksum:require('../scripts/build-knowledge-package').manifestChecksum(artifacts)};
  await put(knowledgeRoot,'manifest.json',k);await put(knowledgeRoot,'package.json',{name:'@apollo/knowledge',version:'0.0.0-fixture'});
  async function data(label,count=1,revision=1) {
    const dataRoot=path.join(root,label), contracts=[];
    for(let i=0;i<count;i++) {
      const manual={component:{componentId:'fixture'+i,contractId:'contract'+i,family:'Fixture '+i,platform:'desktop'},metadata:{revision}},manualSourceHash=sha(JSON.stringify(manual));
      const compiled={package:{componentId:manual.component.componentId,id:manual.component.contractId,manualSourceHash},dependencies:[],status:'draft'};
      const source={manual,dependencies:[],compiled};
      const sourceBody=Buffer.from(JSON.stringify(source)),cacheBody=Buffer.from(JSON.stringify(compiled));
      const file='components/'+i+'/source.json',cache='components/'+i+'/compiled.json';
      await put(dataRoot,file,sourceBody);await put(dataRoot,cache,cacheBody);
      contracts.push({id:compiled.package.id,componentId:manual.component.componentId,revision,file,sha256:sha(sourceBody),sourceHash:sha(sourceBody),compiledCache:{file:cache,sha256:sha(cacheBody),bytes:cacheBody.length},contractHash:sha(cacheBody),manualSourceHash,keys:[manual.component.componentId],dependencies:[]});
    }
    const index={schemaVersion:'apollo.data-index.v1',profileVersion:runtime.profileVersion,Ready:false,contracts,generation:{},catalog:[]};index.id=releases.idOf(index);await put(dataRoot,'manifest.json',index);
    return dataRoot;
  }
  return {root,runtimeRoot,runtime,knowledgeRoot,data};
}

test('data prepare selects exact contract IDs, keeps platform exclusions visible and rejects ambiguous identity', () => {
  const { selectContracts } = require('../scripts/prepare-data-package');
  const base = { contracts: [{ id: 'buttons.desktop', componentId: 'buttons', revision: 60 }] };
  const desktop = { contractId: 'buttons.desktop', componentId: 'buttons', platform: 'desktop', revision: 60 };
  const mobile = { contractId: 'buttons.mobile', componentId: 'buttons', platform: 'mobile-web', revision: 3 };
  const selected = selectContracts(base, [mobile, desktop]);
  assert.equal(selected.selected[0].entry, desktop);
  assert.deepEqual(selected.excluded, [mobile]);
  for (const entries of [[mobile], [desktop, desktop], [{ ...desktop, revision: 59 }], [{ ...desktop, componentId: 'other' }]]) {
    assert.throws(() => selectContracts(base, entries), /DATA_PREPARE_CONTRACT_(SELECTION|IDENTITY)_INVALID/);
  }
  assert.throws(() => selectContracts({ contracts: [...base.contracts, { id: mobile.contractId, componentId: 'buttons', revision: 3 }] }, [desktop, mobile]), /DATA_COMPONENT_CONFLICT/);
});

test('data prepare makes one protected package, verifies the actual consumer, then reuses bytes without requesting a password', async t => {
  const { prepareDataPackage } = require('../scripts/prepare-data-package');
  const f = await fixture(t), dataRoot = await f.data('prepare-data', 2);
  const seed = await buildDataRelease({ dataRoot, knowledgeRoot: f.knowledgeRoot, runtimeRoot: f.runtimeRoot,
    output: path.join(f.root, 'prepare-base'), profile: 'checking-ask-figma-mcp', tarballUrl: 'https://example.test/{version}.tgz' });
  const password = 'only-a-test-password', activationFile = path.join(f.root, 'activation.json');
  await put(f.root, 'activation.json', require('../src/data-packages/protected').createActivation(password));
  const activationBefore = await fs.readFile(activationFile);
  const config = { baseRelease: seed.packageRoot, runtimeRoot: f.runtimeRoot, activationFile,
    outputRoot: path.join(f.root, 'prepared'), version: '1.0.0', tarballUrl: 'https://example.test/data-{version}.tgz' };
  const result = await prepareDataPackage(config, { passwordInput: JSON.stringify({ password }) });
  assert.equal(result.status, 'PREPARED_LOCAL'); assert.equal(result.contracts, 2);
  assert.equal(result.actualProtectedConsumer, 'PASS'); assert.equal(result.runtimeChanged, false);
  assert.deepEqual(await fs.readdir(config.outputRoot), ['1.0.0', 'last-build.json']);
  const tarball = path.join(config.outputRoot, result.artifact.file), before = await fs.readFile(tarball);
  assert.deepEqual(execFileSync('/usr/bin/tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n').sort(), ['package/encryption.json', 'package/package.json', 'package/payload.enc']);
  const repeated = await prepareDataPackage({ ...config, version: '1.0.1', passwordCommand: ['this-command-must-not-run'] });
  assert.equal(repeated.status, 'UNCHANGED'); assert.equal(repeated.version, '1.0.0');
  assert.deepEqual(await fs.readFile(tarball), before);
  assert.deepEqual(await fs.readFile(activationFile), activationBefore);
  assert.deepEqual(await fs.readdir(config.outputRoot), ['1.0.0', 'last-build.json']);
  await assert.rejects(prepareDataPackage({ ...config, tarballUrl: 'https://changed.test/{version}.tgz' }), /DATA_PREPARE_VERSION_EXISTS/);
  await fs.appendFile(tarball, 'corrupt');
  await assert.rejects(prepareDataPackage(config), /DATA_PREPARE_INPUT_CHANGED/);
});

test('data prepare refuses missing activation, unsafe output and wrong password without creating a new key or keeping staging', async t => {
  const { prepareDataPackage } = require('../scripts/prepare-data-package');
  const f = await fixture(t), dataRoot = await f.data('refusal-data');
  const seed = await buildDataRelease({ dataRoot, knowledgeRoot: f.knowledgeRoot, runtimeRoot: f.runtimeRoot,
    output: path.join(f.root, 'refusal-base'), profile: 'checking-ask-figma-mcp', tarballUrl: 'https://example.test/{version}.tgz' });
  const config = { baseRelease: seed.packageRoot, runtimeRoot: f.runtimeRoot, activationFile: path.join(f.root, 'activation.json'),
    outputRoot: path.join(f.root, 'refused'), version: '1.0.0', tarballUrl: 'https://example.test/{version}.tgz' };
  await assert.rejects(prepareDataPackage(config), { code: 'ENOENT' });
  assert.equal(sync.existsSync(config.activationFile), false);
  await put(f.root, 'activation.json', require('../src/data-packages/protected').createActivation('correct-password'));
  await assert.rejects(prepareDataPackage(config, { passwordInput: JSON.stringify({ password: 'wrong-password' }) }), /DATA_ACTIVATION_PASSWORD_INVALID/);
  assert.deepEqual(await fs.readdir(config.outputRoot), []);
  await assert.rejects(prepareDataPackage({ ...config, outputRoot: path.join(seed.packageRoot, 'output') }), /DATA_PREPARE_OUTPUT_UNSAFE/);
  await fs.symlink(seed.packageRoot, path.join(f.root, 'alias'));
  await assert.rejects(prepareDataPackage({ ...config, outputRoot: path.join(f.root, 'alias', 'output') }), /DATA_PREPARE_OUTPUT_UNSAFE/);
  assert.equal(sync.existsSync(path.join(seed.packageRoot, 'output')), false);
});

test('data prepare detects source drift and removes command secrets from errors', async t => {
  const { assertInputs, passwordFrom } = require('../scripts/prepare-data-package');
  const f = await fixture(t), file = path.join(f.root, 'pinned.json');
  await put(f.root, 'pinned.json', 'before');
  const snapshot = { pins: new Map([[file, { sha256: sha(Buffer.from('before')), bytes: 6 }]]) };
  await assertInputs(snapshot); await fs.writeFile(file, 'after!');
  await assert.rejects(assertInputs(snapshot), /DATA_PREPARE_INPUT_CHANGED/);
  await assert.rejects(passwordFrom(undefined, [process.execPath, '-e', 'console.error("secret-value");process.exit(1)']), error => {
    assert.equal(error.code, 'DATA_PREPARE_PASSWORD_COMMAND_FAILED'); assert.equal(error.message.includes('secret-value'), false); return true;
  });
});

test('one source command builds Apollo and knowledge, verifies npm/runtime, reuses npm, and rejects source drift', async t => {
  const { prepareFromSources } = require('../scripts/prepare-data-package');
  const f = await fixture(t), apolloRoot = path.join(f.root, 'apollo'), designSystemRoot = path.join(f.root, 'design'), dsAiHubRoot = path.join(f.root, 'hub');
  await put(f.runtimeRoot, 'packages/component-contract-core/dist/core.cjs', `const crypto=require('node:crypto');exports.stableHash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');exports.compileManualSource=()=>({contract:{package:{}}});`);
  f.runtime.files = (await pins(f.runtimeRoot)).filter(p => p.file !== 'portable-runtime.json');
  f.runtime.id = releases.idOf(f.runtime); await put(f.runtimeRoot, 'portable-runtime.json', f.runtime);
  const dataRoot = await f.data('source-data');
  const seed = await buildDataRelease({ dataRoot, knowledgeRoot: f.knowledgeRoot, runtimeRoot: f.runtimeRoot,
    output: path.join(f.root, 'source-seed'), profile: 'checking-ask-figma-mcp', tarballUrl: 'https://example.test/{version}.tgz' });
  await fs.cp(path.join(f.knowledgeRoot, 'data/design-system_ab'), designSystemRoot, { recursive: true });
  await fs.cp(path.join(f.knowledgeRoot, 'data/ds-ai-hub'), dsAiHubRoot, { recursive: true });
  await put(designSystemRoot, 'JSONS/apollo/indexes/componentContractIndex.json', { schemaVersion: 2, packages: [{ componentKey: 'fixture', packagePath: 'fixture', artifacts: {} }] });
  const old = JSON.parse(await fs.readFile(path.join(dataRoot, 'manifest.json'))).contracts[0];
  const source = JSON.parse(await fs.readFile(path.join(dataRoot, old.file)));
  await put(designSystemRoot, 'JSONS/web/components/fixture/contract.manual.json', source.manual);
  await put(designSystemRoot, 'JSONS/web/components/fixture/variant-evidence.json', {});
  await put(designSystemRoot, 'JSONS/web/components/fixture/packages/fixture.zip', 'unused unchanged archive');
  const sourcePins = await pins(designSystemRoot), get = name => { const p = sourcePins.find(p => p.file === name); return { path: name, sha256: p.sha256, bytes: p.bytes }; };
  const archive = get('JSONS/web/components/fixture/packages/fixture.zip');
  const index = { schemaVersion: 'apollo.component-contract-sources.v1', pathBase: 'design-system_ab', entries: [{ contractId: old.id, componentId: old.componentId,
    platform: 'desktop', revision: 1, manualSourceHash: old.manualSourceHash, archiveSha256: archive.sha256,
    manual: get('JSONS/web/components/fixture/contract.manual.json'), facts: get('JSONS/web/components/fixture/variant-evidence.json') }] };
  await put(designSystemRoot, 'JSONS/indexes/component-contracts.index.json', index);
  const indexBytes = await fs.readFile(path.join(designSystemRoot, 'JSONS/indexes/component-contracts.index.json'));
  await put(designSystemRoot, 'experiments/current-contract-packages/manifest.json', { schemaVersion: 'component-contract-package-collection.v1', archivePathBase: 'design-system_ab',
    authoringIndex: { file: '../../JSONS/indexes/component-contracts.index.json', sha256: sha(indexBytes), bytes: indexBytes.length },
    packages: [{ contractId: old.id, componentId: old.componentId, revision: 1, manualSourceHash: old.manualSourceHash, file: archive.path, zipSha256: archive.sha256, bytes: archive.bytes }] });
  await put(apolloRoot, 'package.json', { scripts: { build: 'node build.js' } });
  await put(apolloRoot, 'build.js', `const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/built','ok');`);
  for (const root of [apolloRoot, designSystemRoot, dsAiHubRoot]) {
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    for (const [name, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.test']]) execFileSync('git', ['-C', root, 'config', name, value]);
    execFileSync('git', ['-C', root, 'add', '.']); execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
  }
  let drift = false; const workRoots = [];
  // Only the portable copier is synthetic; subprocess build, knowledge/npm and consumer are real.
  t.mock.method(require('../scripts/build-portable-runtime'), 'buildPortableRuntime', ({ output }) => {
    workRoots.push(path.dirname(output)); sync.cpSync(f.runtimeRoot, output, { recursive: true });
    if (drift) sync.appendFileSync(path.join(dsAiHubRoot, 'core/web/components/fixture/meta.json'), ' ');
    return releases.readRuntime(output);
  });
  const password = 'source-fixture-password';
  await put(f.root, 'activation.json', require('../src/data-packages/protected').createActivation(password));
  const config = { apolloRoot, designSystemRoot, dsAiHubRoot, baseRelease: seed.packageRoot, baseRuntimeRoot: f.runtimeRoot,
    activationFile: path.join(f.root, 'activation.json'), outputRoot: path.join(f.root, 'source-output'), version: '1.0.0', tarballUrl: 'https://example.test/{version}.tgz' };
  const first = await prepareFromSources(config, { passwordInput: JSON.stringify({ password }) });
  assert.equal(first.status, 'PREPARED_LOCAL'); assert.equal(first.actualProtectedConsumer, 'PASS');
  assert.equal(releases.readRuntime(path.join(config.outputRoot, first.runtime.root)).id, f.runtime.id);
  assert.equal(first.sourceBuild.commits.apollo.length, 40); assert.equal(await fs.readFile(path.join(apolloRoot, 'dist/built'), 'utf8'), 'ok');
  assert.equal((await prepareFromSources({ ...config, version: '1.0.1', passwordCommand: ['must-not-run'] })).status, 'UNCHANGED');
  const before = await fs.readFile(path.join(config.outputRoot, first.artifact.file));
  drift = true;
  await assert.rejects(prepareFromSources({ ...config, version: '1.0.1', passwordCommand: ['must-not-run'] }), { code: 'DATA_PREPARE_SOURCE_CHANGED' });
  assert.deepEqual(await fs.readFile(path.join(config.outputRoot, first.artifact.file)), before);
  assert.deepEqual((await fs.readdir(config.outputRoot)).sort(), ['1.0.0', 'last-build.json']);
  for (const root of workRoots) await assert.rejects(fs.access(root), { code: 'ENOENT' });
});
function transport(descriptor, bytes, knowledgeBytes) {
  const calls=[],packet=s=>(Buffer.byteLength(s)+4).toString(16).padStart(4,'0')+s;
  return {calls,request:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/info/refs?'))return new Response(packet(commit+' refs/heads/main\n')+'0000');
    if(url===descriptor.npm.tarballUrl)return new Response(bytes);
    if(url===descriptor.knowledge?.tarballUrl)return new Response(knowledgeBytes);
    assert.ok(url.includes('/'+commit+'/'));return Response.json(descriptor);
  }};
}

test('real npm pack installs, checks without download and rolls back through the existing assembler/store',async t=>{
  const f=await fixture(t),old=await f.data('old'),next=await f.data('new',2,2);
  const seed=await buildDataRelease({dataRoot:old,knowledgeRoot:f.knowledgeRoot,runtimeRoot:f.runtimeRoot,output:path.join(f.root,'seed'),profile:'checking-ask-figma-mcp',tarballUrl:'https://example.test/{version}.tgz'});
  const built=await buildNpmDataPackage({dataRoot:next,runtimeRoot:f.runtimeRoot,output:path.join(f.root,'npm-v2'),name:'@apollo/contracts',version:'1.0.2',tarballUrl:'https://registry.example.test/apollo-contracts-1.0.2.tgz'});
  assert.match(execFileSync('/usr/bin/tar',['-tzf',built.tarballPath],{encoding:'utf8'}),/package\/package.json/);
  const settings={storeRoot:path.join(f.root,'installed'),seedRoot:seed.packageRoot,runtimeRoot:f.runtimeRoot};
  const ensured=await releases.ensureStore(settings),before=ensured.state.current;
  const network=transport(built.descriptor,await fs.readFile(built.tarballPath));
  const args={settings,ensured,url:sourceUrl,token:'never-forward-me',producerRoot:path.resolve(__dirname,'..'),request:network.request};
  const checked=await updateFromGit({...args,command:'check'});assert.equal(checked.updateAvailable,true);assert.equal(network.calls.length,2);
  const result=await updateFromGit({...args,command:'update'});
  assert.equal(result.current.dataId,built.descriptor.npm.dataId);assert.equal(result.current.knowledgeVersion,before.knowledgeVersion);assert.deepEqual(result.current.sourceCommits,before.sourceCommits);
  assert.equal(packages.readGenerationData({root:result.dataRoot,apolloRoot:f.runtimeRoot}).contracts.length,2);
  assert.ok(!network.calls.find(c=>c.url===built.descriptor.npm.tarballUrl).options.headers.Authorization);
  const noOp=transport(built.descriptor,null);
  assert.equal((await updateFromGit({...args,ensured:{state:await releases.readState(settings.storeRoot)},command:'update',request:noOp.request})).updateAvailable,false);assert.equal(noOp.calls.length,2);
  assert.equal((await releases.rollbackStore(settings)).current.contentVersion,before.contentVersion);
  const state=await fs.readFile(path.join(settings.storeRoot,'state.json'));
  await assert.rejects(updateFromGit({...args,ensured:{state:await releases.readState(settings.storeRoot)},command:'update',request:transport(built.descriptor,Buffer.from('corrupt')).request}),/NPM_DATA_(INTEGRITY|SIZE)_INVALID/);
  assert.deepEqual(await fs.readFile(path.join(settings.storeRoot,'state.json')),state);
});

test('npm redirects preserve HTTPS and never forward repository credentials', async t => {
  const f = await fixture(t), dataRoot = await f.data('data');
  const built = await buildNpmDataPackage({ dataRoot, runtimeRoot: f.runtimeRoot, output: path.join(f.root,'npm'),
    name:'@apollo/contracts',version:'1.0.0',tarballUrl:'https://github.com/example/data/releases/download/v1/contracts.tgz' });
  const body = await fs.readFile(built.tarballPath), calls = [];
  await npmData.download(built.descriptor.npm, path.join(f.root, 'downloaded.tgz'), async (url, options) => {
    calls.push(options);
    return calls.length === 1 ? new Response(null, { status:302,headers:{location:'https://release-assets.githubusercontent.com/contracts.tgz'} }) : new Response(body);
  });
  assert.deepEqual(await fs.readFile(path.join(f.root,'downloaded.tgz')), body);
  assert.ok(calls.every(c => !c.headers.Authorization));
  await assert.rejects(npmData.download(built.descriptor.npm, path.join(f.root,'bad.tgz'), async () => new Response(null,{status:302,headers:{location:'http://example.test/data.tgz'}})), /REDIRECT_INVALID/);
});

test('npm references are exact, identity and executable extras fail closed; v2 retains skill catalog pins',async t=>{
  const f=await fixture(t),dataRoot=await f.data('data');
  const built=await buildNpmDataPackage({dataRoot,runtimeRoot:f.runtimeRoot,output:path.join(f.root,'npm'),name:'@apollo/contracts',version:'1.0.0',tarballUrl:'https://registry.example.test/contracts-1.0.0.tgz'});
  const pin=built.descriptor.npm;
  for(const bad of [{version:'latest'},{name:'../escape'},{tarballUrl:'http://example.test/data.tgz'},{integrity:'sha256-bad'},{bytes:npmData.MAX_ARCHIVE_BYTES+1}]) assert.throws(()=>npmData.validateReference({...pin,...bad}),/REFERENCE_INVALID/);
  const skills={path:'apollo/skills/manifest.json',sha256:'f'.repeat(64),bytes:400};
  const selected=await readGitIndex(sourceUrl,f.runtime.id,undefined,transport({...built.descriptor,skills},null).request);assert.deepEqual(selected.index.skills,skills);
  await assert.rejects(npmData.readPackage(built.packageRoot,{...pin,version:'1.0.1'},f.runtimeRoot),/PACKAGE_INVALID/);
  const pkg=JSON.parse(await fs.readFile(path.join(built.packageRoot,'package.json')));pkg.scripts={postinstall:'touch forbidden'};await put(built.packageRoot,'package.json',pkg);
  await assert.rejects(npmData.readPackage(built.packageRoot,pin,f.runtimeRoot),/PACKAGE_INVALID/);delete pkg.scripts;await put(built.packageRoot,'package.json',pkg);
  await put(built.packageRoot,'data/execute.js','throw Error("never run")');await assert.rejects(npmData.readPackage(built.packageRoot,pin,f.runtimeRoot),/EXTRA_FILE/);
});

test('1001 small contracts pass actual index/contract readers and archive-free reimport without an arbitrary count cap',async t=>{
  const f=await fixture(t),root=await f.data('scale',1001);
  assert.equal(packages.readGenerationData({root,apolloRoot:f.runtimeRoot}).contracts.length,1001);
  const result=await require('../src/data-packages/import').importDataPackage({root,apolloRoot:f.runtimeRoot});
  assert.equal(result.contracts.length,1001);
  assert.equal(packages.readGenerationData({root,apolloRoot:f.runtimeRoot}).prompt('desktop').contracts.length,1001);
  assert.equal(sync.statSync(path.join(root,'manifest.json')).size<16*1024*1024,true);
});

test('empty app activates an encrypted npm release once; wrong password/tampering preserve data, saved key updates and rolls back',async t=>{
  const f=await fixture(t), protectedData=require('../src/data-packages/protected');
  const {buildProtectedDataPackage}=require('../scripts/build-protected-data-package');
  const password='test-only-'+require('node:crypto').randomBytes(24).toString('hex');
  const activation=protectedData.createActivation(password);
  assert.throws(()=>protectedData.accessKey(activation,{password:'incorrect'}),/PASSWORD_INVALID/);
  assert.throws(()=>protectedData.validateActivation({...activation,kdf:{...activation.kdf,N:2**28}}),/DESCRIPTOR_INVALID/);
  const settings={storeRoot:path.join(f.root,'store'),seedRoot:path.join(f.root,'empty-seed'),runtimeRoot:f.runtimeRoot};
  await fs.mkdir(settings.storeRoot);
  const args={settings,url:sourceUrl,producerRoot:path.resolve(__dirname,'..')};
  let ensured={state:{current:null,previous:null}},access;
  for(const count of [1,2]) {
    const data=await f.data('protected-'+count,count,count);
    const release=await buildDataRelease({dataRoot:data,knowledgeRoot:f.knowledgeRoot,runtimeRoot:f.runtimeRoot,
      output:path.join(f.root,'release-'+count),profile:'checking-ask-figma-mcp',tarballUrl:'https://example.test/{version}.tgz'});
    const built=await buildProtectedDataPackage({releaseRoot:release.packageRoot,runtimeRoot:f.runtimeRoot,
      output:path.join(f.root,'protected-npm-'+count),version:'1.0.'+count,tarballUrl:'https://example.test/data-'+count+'.tgz',activation,password});
    const members=execFileSync('/usr/bin/tar',['-tzf',built.tarballPath],{encoding:'utf8'}).trim().split('\n').sort();
    assert.deepEqual(members,['package/encryption.json','package/package.json','package/payload.enc']);
    const archive=await fs.readFile(built.tarballPath);
    const checked=await updateFromGit({...args,ensured,command:'check',access,request:transport(built.descriptor,archive).request});
    assert.equal(checked.activationRequired,count===1);
    const before=(await fs.readFile(path.join(settings.storeRoot,'state.json')).catch(()=>null));
    const bad=transport(built.descriptor,archive);
    await assert.rejects(updateFromGit({...args,ensured,command:'activate',access:{password:'incorrect'},request:bad.request}),/PASSWORD_INVALID/);
    assert.equal(bad.calls.length,2,'incorrect password must not download data');
    assert.deepEqual(await fs.readFile(path.join(settings.storeRoot,'state.json')).catch(()=>null),before);
    const result=await updateFromGit({...args,ensured,command:count===1?'activate':'update',access:access||{password},request:transport(built.descriptor,archive).request});
    assert.equal(result.activationRequired,false);
    assert.equal(packages.readGenerationData({root:result.dataRoot,apolloRoot:f.runtimeRoot}).contracts.length,count);
    if(count===1)access={key:result.activationKey,keyId:result.activationKeyID};
    else assert.equal(result.activationKey,undefined,'updates must not return secrets');
    ensured={state:await releases.readState(settings.storeRoot)};
    const noOp=transport(built.descriptor,archive);
    assert.equal((await updateFromGit({...args,ensured,command:'update',access,request:noOp.request})).updateAvailable,false);
    assert.equal(noOp.calls.length,2);
    // A publisher-side alteration with a recomputed outer checksum must still fail GCM authentication.
    const encrypted=path.join(built.packageRoot,'payload.enc'),bytes=await fs.readFile(encrypted);bytes[0]^=1;await fs.writeFile(encrypted,bytes);
    const corrupt=path.join(f.root,'corrupt-'+count+'.tgz');execFileSync('/usr/bin/tar',['-czf',corrupt,'-C',path.dirname(built.packageRoot),'package'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
    const body=await fs.readFile(corrupt),index=structuredClone(built.descriptor);
    index.npm.bytes=body.length;index.npm.integrity='sha512-'+require('node:crypto').createHash('sha512').update(body).digest('base64');
    const oldState={state:{current:null,previous:null}},saved=await fs.readFile(path.join(settings.storeRoot,'state.json'));
    await fs.mkdir(path.join(f.root,'corrupt-store-'+count));
    await assert.rejects(updateFromGit({...args,ensured:oldState,settings:{...settings,storeRoot:path.join(f.root,'corrupt-store-'+count)},command:'update',access,request:transport(index,body).request}),/DECRYPTION_FAILED/);
    assert.deepEqual(await fs.readFile(path.join(settings.storeRoot,'state.json')),saved);
    assert.ok(!(await fs.readdir(settings.storeRoot)).some(n=>n.startsWith('.protected-update-')));
  }
  const restored=await releases.rollbackStore(settings);
  assert.equal(packages.readGenerationData({root:path.join(restored.current.path,'contracts'),apolloRoot:f.runtimeRoot}).contracts.length,1);
});

test('an empty upgraded app migrates an intact old-runtime store with saved access and retains rollback', async t => {
  const f = await fixture(t), protectedData = require('../src/data-packages/protected');
  const { runCommand } = require('../scripts/git-data-cli');
  const dataRoot = await f.data('migration-old');
  const old = await buildDataRelease({ dataRoot, knowledgeRoot: f.knowledgeRoot, runtimeRoot: f.runtimeRoot,
    output: path.join(f.root, 'migration-seed'), profile: 'checking-ask-figma-mcp', tarballUrl: 'https://example.test/{version}.tgz' });
  const storeRoot = path.join(f.root, 'migration-store');
  const initial = await releases.ensureStore({ storeRoot, seedRoot: old.packageRoot, runtimeRoot: f.runtimeRoot });
  const stateFile = path.join(storeRoot, 'state.json'), stateBefore = await fs.readFile(stateFile);
  const runtimeRoot = path.join(f.root, 'migration-runtime'); await fs.cp(f.runtimeRoot, runtimeRoot, { recursive: true });
  const runtime = { ...f.runtime, nativeSourceHash: 'b'.repeat(64) }; runtime.id = releases.idOf(runtime);
  await put(runtimeRoot, 'portable-runtime.json', runtime);
  const seedRoot = path.join(f.root, 'empty-upgraded-seed'); await fs.mkdir(seedRoot);
  const password = 'migration-fixture-only', activation = protectedData.createActivation(password);
  const access = { key: protectedData.accessKey(activation, { password }).toString('hex'), keyId: activation.keyId };
  const options = { store: storeRoot, seed: seedRoot, runtime: runtimeRoot, descriptor: sourceUrl, access };
  await assert.rejects(runCommand('ensure', options), { code: 'ENOENT' });
  await put(seedRoot, '.activation-required', '');
  for (const command of ['ensure', 'status', 'run']) {
    const pending = await runCommand(command, options);
    assert.equal(pending.current, null); assert.equal(pending.activationRequired, false); assert.equal(pending.runtimeMigrationRequired, true);
    assert.equal(pending.dataRoot, undefined);
  }
  assert.deepEqual(await fs.readFile(stateFile), stateBefore);
  const data = await f.data('migration-new', 2);
  const next = await buildDataRelease({ dataRoot: data, knowledgeRoot: f.knowledgeRoot, runtimeRoot,
    output: path.join(f.root, 'migration-release'), profile: 'checking-ask-figma-mcp', tarballUrl: 'https://example.test/{version}.tgz' });
  const built = await require('../scripts/build-protected-data-package').buildProtectedDataPackage({ releaseRoot: next.packageRoot, runtimeRoot,
    output: path.join(f.root, 'migration-npm'), version: '1.4.4', tarballUrl: 'https://example.test/migration.tgz', activation, password });
  const archive = await fs.readFile(built.tarballPath);
  const check = await runCommand('check', options, transport(built.descriptor, archive).request);
  assert.equal(check.current, null); assert.equal(check.updateAvailable, true); assert.equal(check.activationRequired, false);
  assert.equal(check.runtimeMigrationRequired, true); assert.equal(check.releaseRoot, undefined);
  await assert.rejects(runCommand('update', options, transport(built.descriptor, Buffer.from('damaged')).request), /NPM_DATA_(SIZE|INTEGRITY)_INVALID/);
  assert.deepEqual(await fs.readFile(stateFile), stateBefore);
  const badStore = path.join(f.root, 'bad-migration-store'); await fs.cp(storeRoot, badStore, { recursive: true });
  const badState = JSON.parse(stateBefore); badState.current.path = path.join(badStore, 'versions', badState.current.contentVersion);
  await put(badStore, 'state.json', badState);
  const oldIndex = JSON.parse(await fs.readFile(path.join(badState.current.path, 'contracts/manifest.json')));
  await fs.appendFile(path.join(badState.current.path, 'contracts', oldIndex.contracts[0].file), ' ');
  await assert.rejects(runCommand('ensure', { ...options, store: badStore }), { code: 'ENOENT' });
  const installed = await runCommand('update', options, transport(built.descriptor, archive).request);
  assert.equal(installed.current.contentVersion, next.manifest.id); assert.equal(installed.previous.contentVersion, initial.state.current.contentVersion);
  assert.equal(installed.activationKey, undefined); assert.equal(installed.activationRequired, false);
  assert.equal((await runCommand('ensure', options)).current.contentVersion, next.manifest.id);
  await releases.validateRelease(initial.state.current.path, { runtimeRoot: f.runtimeRoot });
  const rolled = await releases.rollbackStore({ storeRoot, seedRoot, runtimeRoot: f.runtimeRoot });
  assert.equal(rolled.current.contentVersion, old.manifest.id);
});

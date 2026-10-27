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
function transport(descriptor, bytes) {
  const calls=[],packet=s=>(Buffer.byteLength(s)+4).toString(16).padStart(4,'0')+s;
  return {calls,request:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/info/refs?'))return new Response(packet(commit+' refs/heads/main\n')+'0000');
    if(url===descriptor.npm.tarballUrl)return new Response(bytes);
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

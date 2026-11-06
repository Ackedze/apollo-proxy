'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const releases=require('../src/data-release'), protectedData=require('../src/data-packages/protected'), incremental=require('../src/data-packages/incremental');
const {buildDataRelease}=require('../scripts/build-data-release'), {buildProtectedDataPackage}=require('../scripts/build-protected-data-package');
const {updateFromGit,readGitIndex}=require('../scripts/git-data-cli');
const sourceUrl='https://raw.githubusercontent.com/example/data/main/current.json', commit='c'.repeat(40), objectsUrl='https://example.test/objects/';
async function put(root,file,body){const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));}
async function pins(root){const result=[];for(const file of await require('../src/knowledge-package').listPackageFiles(root)){const b=await fs.readFile(path.join(root,file));result.push({file,sha256:releases.sha(b),bytes:b.length});}return result;}
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'apollo-incremental-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const runtimeRoot=path.join(root,'runtime');
 await put(runtimeRoot,'dist/runtime.cjs',`const crypto=require('node:crypto');exports.RUNTIME_VERSION='0.4.1';exports.contractHash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');exports.loadAuthoringSource=s=>({contract:s.compiled});exports.collectContractKeys=c=>[c.package.componentId];exports.collectContractDependencies=c=>c.dependencies||[];`);
 await put(runtimeRoot,'packages/component-contract-core/dist/core.cjs','module.exports={};');
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),files:await pins(runtimeRoot)};runtime.id=releases.idOf(runtime);await put(runtimeRoot,'portable-runtime.json',runtime);
 const dataRoot=path.join(root,'contracts'),manual={component:{componentId:'fixture',contractId:'fixture',family:'Fixture',platform:'desktop'},metadata:{revision:1}},manualSourceHash=releases.sha(JSON.stringify(manual));
 const compiled={package:{componentId:'fixture',id:'fixture',manualSourceHash},dependencies:[],status:'draft'},source={manual,dependencies:[],compiled};
 await put(dataRoot,'source.json',source);await put(dataRoot,'compiled.json',compiled);
 const sourceBody=Buffer.from(JSON.stringify(source)),compiledBody=Buffer.from(JSON.stringify(compiled));
 const contracts={schemaVersion:'apollo.data-index.v1',profileVersion:'0.4.1',Ready:false,generation:{},catalog:[],contracts:[{id:'fixture',componentId:'fixture',revision:1,file:'source.json',sha256:releases.sha(sourceBody),sourceHash:releases.sha(sourceBody),compiledCache:{file:'compiled.json',sha256:releases.sha(compiledBody),bytes:compiledBody.length},contractHash:releases.sha(compiledBody),manualSourceHash,keys:['fixture'],dependencies:[]}]};contracts.id=releases.idOf(contracts);await put(dataRoot,'manifest.json',contracts);
 const password='synthetic-only',activation=protectedData.createActivation(password),key=protectedData.accessKey(activation,{password}),access={keyId:activation.keyId,key:key.toString('hex')};
 const assets=new Map();let previousRoot;
 async function make(version,docs,packed=false){
  const knowledgeRoot=path.join(root,'knowledge-'+version),api=require('../src/knowledge-package');
  const files={'data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json':{schemaVersion:2,packages:[{componentKey:'fixture'}]},'data/design-system_ab/JSONS/apollo/designPatternRules.json':{rules:[]},'data/design-system_ab/redpolrules/dictionary.json':{rules:[]},'data/ds-ai-hub/products/ab/components/fixture/meta.json':{},'data/ds-ai-hub/core/web/components/fixture/meta.json':{}};
  for(const [file,value]of Object.entries(files))await put(knowledgeRoot,file,value);
  for(const [name,value]of Object.entries(docs))await put(knowledgeRoot,'data/ds-ai-hub/products/ab/docs/'+name+'.md',value);
  const artifacts=(await pins(knowledgeRoot)).map(p=>({path:p.file,size:p.bytes,sha256:p.sha256}));
  await put(knowledgeRoot,'manifest.json',{schemaVersion:'apollo.knowledge-package.v1',channel:'stable',contentVersion:version,generatedAt:'2026-11-05T00:00:00Z',sourceCommits:{'design-system_ab':'1'.repeat(40),'ds-ai-hub':'2'.repeat(40)},engineCompatibility:{min:api.ENGINE_VERSION,max:api.ENGINE_VERSION},artifacts,artifactCount:artifacts.length,totalBytes:artifacts.reduce((n,p)=>n+p.size,0),checksum:require('../scripts/build-knowledge-package').manifestChecksum(artifacts)});
  await put(knowledgeRoot,'package.json',{name:'@apollo/knowledge',version:'0.0.0-fixture'});
  const release=await buildDataRelease({dataRoot,knowledgeRoot,runtimeRoot,output:path.join(root,'release-'+version),profile:'checking-ask-figma-mcp',tarballUrl:'https://example.test/{version}.tgz'});
  const output=path.join(root,'output-'+version),packUrl='https://example.test/'+version+'/objects.bin',built=await buildProtectedDataPackage({releaseRoot:release.packageRoot,runtimeRoot,output,version,tarballUrl:'https://example.test/'+version+'/data.tgz',activation,password,incremental:{...(packed?{packUrl}:{objectsUrl}),previousRoot}});
  previousRoot=output;assets.set(built.descriptor.npm.tarballUrl,await fs.readFile(built.tarballPath));assets.set(built.descriptor.incremental.manifest.url,await fs.readFile(path.join(output,'incremental.json.enc')));
  for(const file of await fs.readdir(path.join(output,'objects')))assets.set(objectsUrl+file,await fs.readFile(path.join(output,'objects',file)));
  if(packed)assets.set(packUrl,await fs.readFile(path.join(output,'objects.bin')));
  return {...built,release,output};
 }
 async function store(){const storeRoot=path.join(root,crypto.randomUUID());await fs.mkdir(storeRoot);return{storeRoot,seedRoot:path.join(root,'empty'),runtimeRoot};}
 function transport(descriptor,override){const calls=[];return{calls,request:async(url,options)=>{
  calls.push({url,options});const replacement=override&&await override(url,options);if(replacement)return replacement;
  if(url.includes('/info/refs?')){const line=commit+' refs/heads/main\n';return new Response((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line+'0000');}
  if(url.includes('/'+commit+'/'))return Response.json(descriptor);
  assert(assets.has(url),'Unexpected URL '+url);const bytes=assets.get(url);
  if(options?.headers?.Range){const range=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);assert(range);const start=Number(range[1]),end=Number(range[2]);assert(end>=start&&end<bytes.length);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}});}
  return new Response(bytes);
 }};}
 async function update(settings,built,transportValue=transport(built.descriptor),command='update'){
  const state=await releases.readState(settings.storeRoot)||{current:null,previous:null};
  return updateFromGit({settings,ensured:{state},url:sourceUrl,producerRoot:path.resolve(__dirname,'..'),command,access,request:transportValue.request});
 }
 return{root,runtimeRoot,runtime,activation,access,key,assets,make,store,transport,update};
}

test('incremental data travels through the actual Git/protected/release pipeline',async t=>{
 const f=await fixture(t),seed=await f.make('1.0.0',{same:'unchanged',remove:'delete me',rename:'identical rename'}),skipped=await f.make('1.0.1',{same:'unchanged',remove:'intermediate',rename:'identical rename'}),next=await f.make('1.0.2',{same:'unchanged',renamed:'identical rename',added:'new rule',changed:'changed rule'});
 assert(next.incrementalStats.reusedObjects>0);assert(skipped.descriptor.schemaVersion==='apollo.git-data-index.v4');
 const settings=await f.store();const bootstrap=f.transport(seed.descriptor);await f.update(settings,seed,bootstrap);
 assert(bootstrap.calls.some(c=>c.url===seed.descriptor.npm.tarballUrl));assert(!bootstrap.calls.some(c=>c.url===seed.descriptor.incremental.manifest.url));
 const before=await releases.readState(settings.storeRoot),held=await releases.retainRelease(before.current.path);
 const targetIndex=incremental.readIndex(f.assets.get(next.descriptor.incremental.manifest.url),f.key,next.descriptor.incremental,f.activation.keyId,next.descriptor.npm.dataId);
 const oldManifest=JSON.parse(await fs.readFile(path.join(before.current.path,'manifest.json'))),oldHashes=new Set(oldManifest.files.map(p=>p.sha256));
 const needed=new Set(targetIndex.manifest.files.filter(p=>!oldHashes.has(p.sha256)).map(p=>objectsUrl+targetIndex.objects[p.sha256].sha256+'.enc'));
 const transport=f.transport(next.descriptor),result=await f.update(settings,next,transport);
 assert.equal(result.current.contentVersion,next.descriptor.npm.dataId);assert.equal(result.current.packageVersion,'1.0.2');assert(result.transfer.reusedFiles>0);
 assert.deepEqual(new Set(transport.calls.filter(c=>c.url.startsWith(objectsUrl)).map(c=>c.url)),needed,'skip directly to target and download only missing objects');
 assert(!transport.calls.some(c=>c.url.endsWith('.tgz')));assert(transport.calls.every(c=>!c.options.headers.Authorization));
 await assert.rejects(fs.access(path.join(result.current.path,'knowledge/data/ds-ai-hub/products/ab/docs/remove.md')),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(result.current.path,'knowledge/data/ds-ai-hub/products/ab/docs/renamed.md'),'utf8'),'identical rename');
 await releases.validateRelease(result.current.path,{runtimeRoot:f.runtimeRoot});assert.equal(await fs.readFile(path.join(before.current.path,'knowledge/data/ds-ai-hub/products/ab/docs/remove.md'),'utf8'),'delete me');
 const rollback=await releases.rollbackStore(settings);assert.equal(rollback.current.contentVersion,before.current.contentVersion);held();
 await t.test('already current checks do not download payload',async()=>{const transport=f.transport(seed.descriptor);const checked=await f.update(settings,seed,transport,'check');assert.equal(checked.updateAvailable,false);assert.equal(transport.calls.length,2);});
 await t.test('interrupted download preserves current and resumes verified objects',async()=>{
  let count=0;const interrupted=f.transport(next.descriptor,async url=>{if(url.startsWith(objectsUrl)&&++count===2)throw Error('simulated offline');});
  await assert.rejects(f.update(settings,next,interrupted),/simulated offline/);assert.equal((await releases.readState(settings.storeRoot)).current.contentVersion,before.current.contentVersion);
  const first=interrupted.calls.find(c=>c.url.startsWith(objectsUrl)).url,resumed=f.transport(next.descriptor);const result=await f.update(settings,next,resumed);assert(result.transfer.cachedObjects>0);assert(!resumed.calls.some(c=>c.url===first));
  assert.deepEqual((await fs.readdir(path.join(settings.storeRoot,'.incremental'))).filter(n=>n!=='.update.lock'),[]);
 });
 await t.test('corrupt local reusable data is downloaded, not trusted by its inventory',async()=>{
  await releases.rollbackStore(settings);const state=await releases.readState(settings.storeRoot),same='knowledge/data/ds-ai-hub/products/ab/docs/same.md';await fs.writeFile(path.join(state.current.path,same),'corrupt');
  const tr=f.transport(next.descriptor),result=await f.update(settings,next,tr);const pin=targetIndex.manifest.files.find(p=>p.file===same);assert(tr.calls.some(c=>c.url===objectsUrl+targetIndex.objects[pin.sha256].sha256+'.enc'));assert.equal(await fs.readFile(path.join(result.current.path,same),'utf8'),'unchanged');
 });
 await t.test('wrong access, corrupt transport and incompatible runtime never activate',async()=>{
  for(const mode of ['wrong-key','manifest','object','runtime']){
   const local=await f.store();await f.update(local,seed);const prior=await fs.readFile(path.join(local.storeRoot,'state.json')),descriptor=structuredClone(next.descriptor);
   if(mode==='runtime')descriptor.runtimeId='e'.repeat(64);
   const tr=f.transport(descriptor,async url=>{if(mode==='manifest'&&url===descriptor.incremental.manifest.url)return new Response(Buffer.alloc(descriptor.incremental.manifest.bytes));if(mode==='object'&&url.startsWith(objectsUrl))return new Response(Buffer.from('corrupt'));});
   const state=await releases.readState(local.storeRoot);
   await assert.rejects(updateFromGit({settings:local,ensured:{state},url:sourceUrl,producerRoot:path.resolve(__dirname,'..'),command:'update',access:mode==='wrong-key'?{keyId:f.activation.keyId,key:'0'.repeat(64)}:f.access,request:tr.request}));
   assert.deepEqual(await fs.readFile(path.join(local.storeRoot,'state.json')),prior);
  }
 });
 await t.test('authenticated malicious paths, extra objects and bad tags still refuse',()=>{
  const descriptor=next.descriptor,raw=f.assets.get(descriptor.incremental.manifest.url),value=JSON.parse(incremental.open(raw,f.key,descriptor.incremental.manifest,incremental.indexAad(f.activation.keyId,descriptor.npm.dataId),releases.MAX_ARCHIVE_BYTES));
  function reseal(v,id=descriptor.npm.dataId){const seal=protectedData.encrypt(require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v))),f.key,incremental.indexAad(f.activation.keyId,id));return{body:seal.body,descriptor:{...descriptor.incremental,manifest:{url:descriptor.incremental.manifest.url,sha256:releases.sha(seal.body),bytes:seal.body.length,iv:seal.iv,tag:seal.tag}}};}
  const extra=structuredClone(value);extra.objects['0'.repeat(64)]=Object.values(extra.objects)[0];let sealed=reseal(extra);assert.throws(()=>incremental.readIndex(sealed.body,f.key,sealed.descriptor,f.activation.keyId,descriptor.npm.dataId),/INDEX_INVALID/);
  const unsafe=structuredClone(value),manifest=JSON.parse(unsafe.releaseManifest);manifest.files[0].file='../escape.json';manifest.id=releases.idOf(manifest);unsafe.releaseManifest=JSON.stringify(manifest);sealed=reseal(unsafe,manifest.id);assert.throws(()=>incremental.readIndex(sealed.body,f.key,sealed.descriptor,f.activation.keyId,manifest.id),/INVENTORY_INVALID/);
  const tag=structuredClone(descriptor.incremental);tag.manifest.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>incremental.readIndex(raw,f.key,tag,f.activation.keyId,descriptor.npm.dataId),/DECRYPTION_FAILED/);
 });
 await t.test('concurrent state change refuses commit without overwriting the winner',async()=>{
  const local=await f.store();await f.update(local,seed);const current=await releases.readState(local.storeRoot);let changed=false;
  const tr=f.transport(next.descriptor,async url=>{if(url===next.descriptor.incremental.manifest.url&&!changed){changed=true;await fs.writeFile(path.join(local.storeRoot,'state.json'),JSON.stringify({...current,previous:current.current,current:{...current.current,contentVersion:'d'.repeat(64)}}));}});
  await assert.rejects(f.update(local,next,tr),/DATA_RELEASE_STATE_CHANGED/);assert.equal((await releases.readState(local.storeRoot)).current.contentVersion,'d'.repeat(64));
 });
 await t.test('v4 shape/HTTPS rejection happens before any object fetch',async()=>{
  for(const change of [d=>{d.incremental.objectsUrl='http://example.test/';},d=>{d.incremental.manifest.iv='bad';},d=>{d.schemaVersion='apollo.git-data-index.v3';}]){const d=structuredClone(next.descriptor);change(d);const tr=f.transport(d);await assert.rejects(readGitIndex(sourceUrl,f.runtime.id,null,tr.request));assert.equal(tr.calls.length,2);}
 });
 await t.test('the existing one-command producer verifies incremental install and pins every reusable output',async()=>{
  const {prepareDataPackage}=require('../scripts/prepare-data-package');await put(f.root,'activation.json',f.activation);
  const config={baseRelease:seed.release.packageRoot,runtimeRoot:f.runtimeRoot,knowledgeRoot:path.join(next.release.packageRoot,'knowledge'),activationFile:path.join(f.root,'activation.json'),outputRoot:path.join(f.root,'prepared'),version:'2.0.0',tarballUrl:'https://example.test/{version}/data.tgz',incremental:{objectsUrl,previousRoot:next.output}};
  const report=await prepareDataPackage(config,{passwordInput:JSON.stringify({password:'synthetic-only'})});assert.equal(report.actualProtectedConsumer,'PASS');assert(report.incrementalTransfer.reusedFiles>0);assert(report.incrementalArtifacts.length>1);
  const again=await prepareDataPackage(config);assert.equal(again.status,'UNCHANGED');
  await fs.appendFile(path.join(config.outputRoot,report.incrementalArtifacts[0].file),'corrupt');await assert.rejects(prepareDataPackage(config),/DATA_PREPARE_INPUT_CHANGED/);
 });
});

test('packed incremental delivery downloads only authenticated missing-file ranges',async t=>{
 const f=await fixture(t),seed=await f.make('3.0.0',{same:'unchanged',rename:'retained bytes'},true),skipped=await f.make('3.0.1',{same:'unchanged',rename:'intermediate'},true),next=await f.make('3.0.2',{same:'unchanged',renamed:'retained bytes',added:'new target content'},true);
 assert(next.incrementalStats.reusedObjects>0);assert.equal(next.descriptor.incremental.objectsUrl,undefined);assert.equal(next.incrementalStats.packBytes,f.assets.get(next.descriptor.incremental.objectsPack.url).length);
 const target=incremental.readIndex(f.assets.get(next.descriptor.incremental.manifest.url),f.key,next.descriptor.incremental,f.activation.keyId,next.descriptor.npm.dataId),settings=await f.store();await f.update(settings,seed);
 const before=await releases.readState(settings.storeRoot),old=JSON.parse(await fs.readFile(path.join(before.current.path,'manifest.json'))),hashes=new Set(old.files.map(p=>p.sha256));
 const needed=new Set(target.manifest.files.filter(p=>!hashes.has(p.sha256)).map(p=>{const x=target.objects[p.sha256];return'bytes='+x.offset+'-'+(x.offset+x.bytes-1);}));
 const tr=f.transport(next.descriptor),result=await f.update(settings,next,tr),ranges=tr.calls.filter(c=>c.options?.headers?.Range);
 assert.deepEqual(new Set(ranges.map(c=>c.options.headers.Range)),needed);assert(ranges.every(c=>c.url===next.descriptor.incremental.objectsPack.url));assert(!tr.calls.some(c=>c.url.endsWith('.tgz')));assert(result.transfer.reusedFiles>0);assert(result.transfer.downloadedBytes<next.descriptor.npm.bytes);assert.equal(await fs.readFile(path.join(result.current.path,'knowledge/data/ds-ai-hub/products/ab/docs/renamed.md'),'utf8'),'retained bytes');await releases.validateRelease(result.current.path,{runtimeRoot:f.runtimeRoot});
 await releases.rollbackStore(settings);
 await t.test('partial network failure resumes verified range objects without replacing current',async()=>{
  let count=0;const interrupted=f.transport(next.descriptor,async(_url,o)=>{if(o?.headers?.Range&&++count===2)throw Error('range offline');});await assert.rejects(f.update(settings,next,interrupted),/range offline/);assert.equal((await releases.readState(settings.storeRoot)).current.contentVersion,before.current.contentVersion);const first=interrupted.calls.find(c=>c.options?.headers?.Range).options.headers.Range,resumed=f.transport(next.descriptor),done=await f.update(settings,next,resumed);assert(done.transfer.cachedObjects>0);assert(!resumed.calls.some(c=>c.options?.headers?.Range===first));
 });
 for(const mode of ['whole-body-200','wrong-range','wrong-total','short','corrupt'])await t.test('invalid packed response preserves current: '+mode,async()=>{
  const local=await f.store();await f.update(local,seed);const state=await fs.readFile(path.join(local.storeRoot,'state.json'));
  const tr=f.transport(next.descriptor,async(url,o)=>{if(!o?.headers?.Range)return;const all=f.assets.get(url);if(mode==='whole-body-200')return new Response(all);const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(o.headers.Range),start=Number(a),end=Number(b);let body=all.subarray(start,end+1);if(mode==='short')body=body.subarray(1);if(mode==='corrupt')body=Buffer.alloc(body.length);return new Response(body,{status:206,headers:{'Content-Range':'bytes '+(mode==='wrong-range'?start+1:start)+'-'+end+'/'+(mode==='wrong-total'?all.length+1:all.length)}});});await assert.rejects(f.update(local,next,tr));assert.deepEqual(await fs.readFile(path.join(local.storeRoot,'state.json')),state);
 });
 await t.test('authenticated out-of-pack offsets refuse before reading data',()=>{
  const d=next.descriptor,v=JSON.parse(incremental.open(f.assets.get(d.incremental.manifest.url),f.key,d.incremental.manifest,incremental.indexAad(f.activation.keyId,d.npm.dataId),releases.MAX_ARCHIVE_BYTES));Object.values(v.objects)[0].offset=d.incremental.objectsPack.bytes;
  const seal=protectedData.encrypt(require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v))),f.key,incremental.indexAad(f.activation.keyId,d.npm.dataId)),descriptor={...d.incremental,manifest:{url:d.incremental.manifest.url,sha256:releases.sha(seal.body),bytes:seal.body.length,iv:seal.iv,tag:seal.tag}};assert.throws(()=>incremental.readIndex(seal.body,f.key,descriptor,f.activation.keyId,d.npm.dataId),/INDEX_INVALID/);
 });
 await t.test('one-command producer exercises the actual ranged consumer and pins objects.bin',async()=>{
  await put(f.root,'activation.json',f.activation);const config={baseRelease:seed.release.packageRoot,runtimeRoot:f.runtimeRoot,knowledgeRoot:path.join(next.release.packageRoot,'knowledge'),activationFile:path.join(f.root,'activation.json'),outputRoot:path.join(f.root,'packed-prepared'),version:'4.0.0',tarballUrl:'https://example.test/{version}/data.tgz',incremental:{packUrl:'https://example.test/{version}/objects.bin',previousRoot:skipped.output}};
  const prepare=require('../scripts/prepare-data-package').prepareDataPackage,report=await prepare(config,{passwordInput:JSON.stringify({password:'synthetic-only'})});assert.equal(report.actualProtectedConsumer,'PASS');assert(report.incrementalArtifacts.some(p=>p.file.endsWith('/objects.bin')));assert.equal((await prepare(config)).status,'UNCHANGED');await fs.appendFile(path.join(config.outputRoot,'4.0.0/objects.bin'),'corrupt');await assert.rejects(prepare(config),/DATA_PREPARE_INPUT_CHANGED/);
 });
});

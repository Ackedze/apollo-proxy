'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,loadApollo}=require('./audit-data.test');
const p=require('../src/audit-data/protocol');
const {mountAuditDataRoutes}=require('../src/audit-data/service');
const {data}=require('../../../projects/Apollo/tests/fixtures/v3-audit-compact-index.cjs');

test('Proxy delivers the exact Athena index from the package used by the repository route',async t=>{
 const f=await fixture(t);
 const repositoryBytes=Buffer.from(JSON.stringify(data)+'\n');
 await f.write(f.designRoot,p.COMPACT_INDEX,repositoryBytes.toString());
 const built=await f.build(),routes=new Map();
 assert.deepEqual(built.manifest.projection.athenaIndex,{path:p.PACKAGED_COMPACT_INDEX,dataId:data.dataId});
 assert.equal(built.manifest.artifacts.find(row=>row.path===p.PACKAGED_COMPACT_INDEX).sha256,p.sha(repositoryBytes));
 const reader=mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:built.packageRoot});
 const relay=routes.get('/v1/audit-data/compact-index');
 async function call(query={}){
  const reply={status:200,headers:{},body:null};
  await relay({query},{set:(key,value)=>reply.headers[key]=value,status:status=>{reply.status=status;return{json:value=>reply.body=value};},send:value=>reply.body=value,json:value=>reply.body=value});
  return reply;
 }
 const reply=await call();
 assert.equal(reply.status,200);
 assert.equal(reply.headers['Content-Type'],'application/json; charset=utf-8');
 assert.deepEqual(reply.body,repositoryBytes);
 const {readOfflineAuditIndex}=loadApollo('embedded-data.ts');
 for(const [source,bytes] of [['proxy',reply.body],['repository',repositoryBytes]]){
  const result=await readOfflineAuditIndex({source,text:bytes.toString()},()=>{});
  assert.equal(result.summary.source,source);
  assert.equal(result.index.dataId,data.dataId);
 }
 assert.equal((await call({path:'../catalog'})).status,400);
 assert.equal((await reader.manifest()).dataId,built.auditData.manifest.dataId);
 const packaged=path.join(built.packageRoot,p.PACKAGED_COMPACT_INDEX);
 await fs.appendFile(packaged,' ');
 const corrupt=await call();
 assert.equal(corrupt.status,409);
 assert.deepEqual(corrupt.body,{error:'AUDIT_DATA_ASSET_MISMATCH'});
});

test('a missing index leaves the existing package reader intact and corrupt data cannot enter a new package',async t=>{
 const f=await fixture(t),built=await f.build();
 const reader=require('../src/audit-data/reader').createAuditDataReader({knowledgeRoot:built.packageRoot});
 await assert.rejects(reader.compactIndex(),/AUDIT_ATHENA_INDEX_MISSING/);
 assert.equal((await reader.manifest()).dataId,built.auditData.manifest.dataId);
 await f.write(f.designRoot,p.COMPACT_INDEX,Object.assign({},data,{dataId:'0'.repeat(64)}));
 await assert.rejects(f.build(path.join(f.root,'corrupt-output')),/AUDIT_ATHENA_INDEX_INVALID/);
});

test('legacy preparation is a separate opt-in route and leaves the compact index unchanged',async t=>{
 const f=await fixture(t),document=JSON.parse(JSON.stringify(data));
 const family=document.payload.components.rows['a'.repeat(40)].componentKey,local='9'.repeat(40);
 document.payload.components.rows[family].platforms=['iOS'];
 document.payload.sources.sources[0].fileKey='SyntheticLibrary';
 document.dataId=p.sha(JSON.stringify(document.payload));
 const original=JSON.stringify(document)+'\n';await f.write(f.designRoot,p.COMPACT_INDEX,original);
 const config=await f.write(f.root,'legacy.json',{schemaVersion:1,platform:'iOS',families:[
  {key:family,name:'Legacy',fileKey:'SyntheticLibrary',allowLocalSupplement:false},
  {key:local,name:'Supplement',fileKey:'OtherLibrary',allowLocalSupplement:true},
 ]});
 const built=await f.build(),routes=new Map();
 mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:built.packageRoot,legacyComponentsFile:config});
 async function call(route,query={}){
  const reply={status:200,body:null};
  await routes.get(route)({query},{set(){},status(status){reply.status=status;return this;},json(value){reply.body=value;},send(value){reply.body=value;}});
  return reply;
 }
 const result=await call('/v1/audit-data/legacy-components');
 assert.equal(result.status,200);assert.equal(result.body.sourceIndexDataId,document.dataId);
 assert.deepEqual(result.body.families.map(row=>row.source),['catalog','local-supplement']);
 assert.deepEqual((await call('/v1/audit-data/compact-index')).body,Buffer.from(original));
 assert.equal((await call('/v1/audit-data/legacy-components',{path:config})).status,400);
 await fs.writeFile(config,'invalid');
 assert.deepEqual(await call('/v1/audit-data/legacy-components'),{status:503,body:{error:'AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID'}});
 const unconfigured=new Map();
 mountAuditDataRoutes({get:(route,handler)=>unconfigured.set(route,handler)},{knowledgeRoot:built.packageRoot});
 routes.set('/v1/audit-data/legacy-components',unconfigured.get('/v1/audit-data/legacy-components'));
 assert.deepEqual(await call('/v1/audit-data/legacy-components'),{status:503,body:{error:'AUDIT_LEGACY_COMPONENTS_NOT_CONFIGURED'}});
});

test('legacy policy travels with the standard knowledge package and enforces its manifest pin',async t=>{
 const f=await fixture(t),document=JSON.parse(JSON.stringify(data));
 const family=document.payload.components.rows['a'.repeat(40)].componentKey;
 document.payload.components.rows[family].platforms=['iOS'];
 document.payload.sources.sources[0].fileKey='SyntheticLibrary';
 document.dataId=p.sha(JSON.stringify(document.payload));
 const original=JSON.stringify(document)+'\n';await f.write(f.designRoot,p.COMPACT_INDEX,original);
 const policy={schemaVersion:1,platform:'iOS',families:[{key:family,name:'Legacy',fileKey:'SyntheticLibrary',allowLocalSupplement:false}]};
 await f.write(f.designRoot,'JSONS/apollo/policies/liquid-glass.json',policy);
 const built=await f.build(),routes=new Map();
 assert(built.manifest.artifacts.some(row=>row.path===p.LEGACY_COMPONENT_POLICY));
 const reader=mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:built.packageRoot});
 let status,body;
 const call=async()=>{
  status=200;body=null;
  await routes.get('/v1/audit-data/legacy-components')({query:{}},{set(){},status(value){status=value;return this;},json(value){body=value;}});
 };
 await call();assert.equal(status,200);assert.equal(body.policySource,'package');
 assert.equal(body.policySha256,p.sha(Buffer.from(JSON.stringify(policy))));
 assert.equal(body.families[0].key,family);assert.deepEqual(await reader.compactIndex(),Buffer.from(original));
 await fs.appendFile(path.join(built.packageRoot,p.LEGACY_COMPONENT_POLICY),' ');
 await call();assert.equal(status,409);assert.deepEqual(body,{error:'AUDIT_DATA_ASSET_MISMATCH'});
});

test('legacy route rejects a package change between the policy and index reads',async t=>{
 const f=await fixture(t),document=structuredClone(data);
 const family=document.payload.components.rows['a'.repeat(40)].componentKey;
 const row=document.payload.components.rows[family];
 row.platforms=['iOS'];
 document.payload.sources.sources[0].fileKey='SyntheticLibrary';
 const policy={schemaVersion:1,platform:'iOS',families:[{key:family,name:'Original',fileKey:'SyntheticLibrary',allowLocalSupplement:false}]};
 const configPath='JSONS/apollo/policies/liquid-glass.json';
 document.dataId=p.sha(JSON.stringify(document.payload));
 await f.write(f.designRoot,p.COMPACT_INDEX,document);
 await f.write(f.designRoot,configPath,policy);
 const first=await f.build();

 row.name='Updated catalog name';
 policy.families[0].name='Updated policy name';
 document.dataId=p.sha(JSON.stringify(document.payload));
 await f.write(f.designRoot,p.COMPACT_INDEX,document);
 await f.write(f.designRoot,configPath,policy);
 const second=await f.build(path.join(f.root,'replacement'));

 const outerManifest=path.join(first.packageRoot,'manifest.json'),lstat=fs.lstat;
 let manifestStats=0;
 t.mock.method(fs,'lstat',async(file,...args)=>{
  const stat=await lstat(file,...args);
  // Switch after the policy reader captures its final manifest stat.
  if(file===outerManifest&&++manifestStats===3){
   await fs.rename(first.packageRoot,path.join(f.root,'previous'));
   await fs.rename(second.packageRoot,first.packageRoot);
  }
  return stat;
 });
 const routes=new Map();
 mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:first.packageRoot});
 const relay=routes.get('/v1/audit-data/legacy-components');
 const call=async()=>{
  const reply={status:200,body:null};
  await relay({query:{}},{set(){},status(code){reply.status=code;return this;},json(body){reply.body=body;}});
  return reply;
 };
 assert.deepEqual(await call(),{status:409,body:{error:'AUDIT_DATA_SOURCE_CHANGED'}});
 const retry=await call();
 assert.equal(retry.status,200);
 assert.equal(retry.body.sourceIndexDataId,document.dataId);
 assert.equal(retry.body.policySha256,p.sha(JSON.stringify(policy)));
});

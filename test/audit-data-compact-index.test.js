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

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,loadApollo,native,reseal}=require('./audit-data.test');
const p=require('../src/audit-data/protocol');

test('current package/service/client/native V3 path finds the forbidden API value without network or V4 fallback',async t=>{
 const f=await fixture(t),built=await f.build(),routes=new Map(),reads=[];
 require('../src/audit-data/service').mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:built.packageRoot});
 async function call(route,params={}){
  let status=200,body;const response={set(){return response;},status(n){status=n;return response;},json(value){body=value;}};
  await routes.get(route)({query:{},params},response);if(status!==200)throw Error(body.error);return body;
 }
 const data=loadApollo('data-client.ts').createAuditDataClient({hashText:p.sha,
  loadManifest:()=>call('/v1/audit-data/manifest'),
  readAsset:(dataId,fileId)=>{reads.push([dataId,fileId]);return call('/v1/audit-data/:dataId/assets/:fileId',{dataId,fileId});}});
 const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=previousFetch;delete globalThis.figma;});
 const node=native(),progress=[];
 const result=await loadApollo('entry.ts').runV3Audit({runId:'package-joint',channel:'Desktop',pageType:null,shellAuditEnabled:false,pluginVersion:'synthetic',selection:[node],data,assertCurrent(){},onProgress:value=>progress.push(value)});
 assert.equal(result.dataId,data.identity());
 const diffs=Object.values(result.checkState.relevanceBuckets).flat().flatMap(item=>item.diffs);
 assert(diffs.some(diff=>diff.assessment?.reasonCode==='component-api-invalid-variant-value'));
 assert(result.report.summary.problemOccurrenceCount>0);assert(progress.length>0);assert.equal(network,0);
 const manifest=await data.open();assert(reads.every(([id,file])=>id===manifest.dataId&&manifest.files.some(row=>row.id===file)));
 assert(reads.some(([,id])=>id===manifest.policyFileId));
 // A package replacement cannot mix prior assets and new policies in one run.
 await reseal(built.packageRoot,manifest=>{manifest.sourceCommits['design-system_ab']='e'.repeat(40);});
 await assert.rejects(data.assertCurrent(),/CHANGED_RELOAD_REQUIRED/);
 await assert.rejects(data.readPolicies(),/CHANGED_RELOAD_REQUIRED/);
});

test('a changed packaged asset cannot yield a native success or a public-source retry',async t=>{
 const f=await fixture(t),built=await f.build(),reader=require('../src/audit-data/reader').createAuditDataReader({knowledgeRoot:built.packageRoot});
 const manifest=await reader.manifest(),policy=manifest.files.find(row=>row.id===manifest.policyFileId);
 await fs.appendFile(path.join(built.packageRoot,policy.storage.path),' ');
 const data=loadApollo('data-client.ts').createAuditDataClient({hashText:p.sha,loadManifest:()=>reader.manifest(),readAsset:(id,file)=>reader.asset(id,file)});
 const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=previousFetch;delete globalThis.figma;});
 const node=native();
 await assert.rejects(loadApollo('entry.ts').runV3Audit({runId:'changed-package',channel:'Desktop',pageType:null,shellAuditEnabled:false,pluginVersion:'synthetic',selection:[node],data,assertCurrent(){},onProgress(){}}),/AUDIT_DATA_(ASSET_MISMATCH|SOURCE_CHANGED)/);
 assert.equal(network,0);
});

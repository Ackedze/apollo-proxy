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


function loadLifecycleAudit(){
 const source=path.resolve(__dirname,'../../../projects/Apollo'),esbuild=require(path.join(source,'node_modules/esbuild'));
 const built=esbuild.buildSync({stdin:{contents:"export * from './entry';export { buildApolloAgentReport } from './stats/agentReport';export { auditResultForUi } from './bridge';",resolveDir:path.join(source,'src/v3-audit')},bundle:true,write:false,metafile:true,platform:'node',format:'cjs',logLevel:'silent'});
 assert(!Object.keys(built.metafile.inputs).some(file=>/component-contract-core|experimentalContractV2|predicate\/index/.test(file)));
 const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);return module.exports;
}
test('primary V3 categories use packaged Athena registries and independently verified library versions',async t=>{
 const cases=[
  {name:'scheduled variant beats catalog deprecated',status:'scheduled',catalogStatus:'deprecated',variant:true,expected:'update',reasons:['catalog-lifecycle']},
  {name:'source definition scheduled plus new version appears once',dependency:true,status:'scheduled',newer:true,expected:'update',reasons:['library-update-available','catalog-lifecycle']},
  {name:'different local owners retain two source updates',dependency:true,distinct:true,status:'scheduled',newer:true,expected:'update',reasons:['library-update-available','catalog-lifecycle']},
  {name:'source update retains unknown lifecycle evidence',dependency:true,conflict:true,newer:true,expected:'update',reasons:['library-update-available']},
  {name:'source definition deprecated beats newer version once',dependency:true,status:'deprecated',newer:true,expected:'deprecated',reasons:['library-update-available']},
  {name:'deprecated beats newer version',status:'deprecated',newer:true,expected:'deprecated',reasons:['library-update-available']},
  {name:'unlisted ignores old catalog status and deprecated library name',catalogStatus:'deprecated',oldLibrary:true,expected:'current',reasons:[]},
  {name:'version import failure stays unknown without inventing update',freshFail:true,expected:'current',reasons:[]},
  {name:'scheduled remains confirmed while version is unknown',status:'scheduled',freshFail:true,expected:'update',reasons:['catalog-lifecycle']},
  {name:'current remote has a newer version',newer:true,expected:'update',reasons:['library-update-available']},
  {name:'catalog absent still checks newer published version',missingReference:true,newer:true,expected:'update',reasons:['library-update-available']},
  {name:'conflict is unknown',conflict:true,expected:'unknown',reasons:[]},
  {name:'conflict preserves independent update and incomplete evidence',conflict:true,newer:true,expected:'update',reasons:['library-update-available']},
 ];
 const previous=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('NETWORK_FORBIDDEN');};t.after(()=>{globalThis.fetch=previous;delete globalThis.figma;});
 for(const c of cases){
  const f=await fixture(t),catalog=structuredClone(f.catalog);catalog.components[0].status=c.catalogStatus||'active';if(c.oldLibrary)catalog.meta.library='Web :: Old Core Default Components';if(c.missingReference)catalog.components=[];
  await f.write(f.designRoot,'JSONS/web/components/example/Example.json',catalog);
  for(const category of ['deprecated','scheduled']){
   const include=c.status===category||c.conflict,record={key:c.variant?'c'.repeat(40):f.key,status:category,role:'main',variantKeys:c.variant?[f.key]:[],sources:[{status:category,role:'main'}]};
   await f.write(f.designRoot,'JSONS/indexes/lifecycle/'+category+'.index.json',{kind:'component-lifecycle-index',version:1,category,count:include?1:0,components:include?[record]:[],warnings:[]});
  }
  const built=await f.build(),reader=require('../src/audit-data/reader').createAuditDataReader({knowledgeRoot:built.packageRoot}),manifest=await reader.manifest(),data=loadApollo('data-client.ts').createAuditDataClient({hashText:p.sha,loadManifest:()=>reader.manifest(),readAsset:(id,file)=>reader.asset(id,file)}),node=native(),main=await node.getMainComponentAsync();
  figma.importComponentByKeyAsync=async()=>{if(c.freshFail)throw Error('SYNTHETIC_IMPORT_UNAVAILABLE');return Object.assign({},main,{id:c.newer?'published-new':main.id});};
  const selection=[node];
  if(c.dependency){
   const original=Object.assign({},node),nodes={};
   const wrap=(occurrence,prefix)=>{
    const local={id:prefix+'local-definition',key:prefix+'local-key',name:'Local wrapper',type:'COMPONENT',remote:false,parent:figma.currentPage,children:[]},source=Object.assign({},original,{id:prefix+'source-dependency',parent:local,getMainComponentAsync:async()=>main});local.children=[source];
    occurrence.name='Local wrapper';occurrence.getMainComponentAsync=async()=>local;occurrence.children=[Object.assign({},source,{id:'I'+occurrence.id+';'+source.id,parent:occurrence})];occurrence.variantProperties={};occurrence.componentProperties={};
    for(const n of [occurrence,local,source,occurrence.children[0]])nodes[n.id]=n;
   };
   wrap(node,'');if(c.distinct){const second=Object.assign({},original,{id:'other-occurrence'});wrap(second,'other-');selection.push(second);figma.currentPage.children.push(second);}
   figma.getNodeByIdAsync=async id=>nodes[id]||null;
  }
  const targetId=c.dependency?'source-dependency':node.id;

  const runtime=loadLifecycleAudit(),result=await runtime.runV3Audit({runId:'registry-'+cases.indexOf(c),channel:'Desktop',pageType:null,shellAuditEnabled:false,pluginVersion:'synthetic',selection,data,assertCurrent(){},onProgress(){}}),item=Object.values(result.checkState.relevanceBuckets).flat().find(i=>i.id===targetId);
  assert.ok(item,c.name);assert.equal(item.relevance,c.expected,c.name);assert.deepEqual(item.updateReasons,c.reasons,c.name);assert.equal(item.catalogLifecycle.status,c.conflict?'unknown':c.status||'not-listed',c.name);assert(item.catalogLifecycle.checks.every(check=>check.targetId===targetId&&check.sha256));
  const agent=runtime.buildApolloAgentReport(result.report);
  const category=c.expected==='deprecated'?'deprecatedComponents':c.expected==='update'?'updates':c.expected==='current'?'currentComponents':null;
  if(category){const exported=result.report.categories[category].items.find(i=>i.node.id===targetId);assert(exported,c.name);assert.deepEqual(exported.catalogLifecycle,item.catalogLifecycle);if(category!=='currentComponents')assert.deepEqual(agent.findings.find(f=>f.node.id===targetId&&f.category===category).catalogLifecycle,item.catalogLifecycle);}
  const {auditResultForUi}=runtime,{buildV3Groups}=require('../../../projects/Apollo/src/v3-audit/ui-model'),ui=auditResultForUi(result),summary=buildV3Groups(ui),components=summary.groups.find(g=>g.id==='components');
  if(['deprecated','update'].includes(c.expected))assert(components.categories.find(category=>category.id===c.expected).entries.some(entry=>entry.item.id===targetId),c.name);
  if(c.dependency){const entries=components.categories.find(category=>category.id===c.expected).entries;assert.equal(entries.length,c.distinct?2:1,c.name);assert(entries.some(entry=>entry.item.sourceOwnerOccurrenceIds.includes('instance')),c.name);if(c.distinct)assert(entries.some(entry=>entry.item.sourceOwnerOccurrenceIds.includes('other-occurrence')),c.name);}
  if(c.missingReference){assert.equal(components.categories.find(category=>category.id==='local').count,1,c.name);assert.equal(summary.incomplete,true,c.name);assert.equal(components.categories.find(category=>category.id==='local').entries[0].incomplete,true,c.name);}
  if(c.conflict||c.freshFail)assert.equal(summary.incomplete,true,c.name);
  const lifecycle=manifest.files.filter(row=>row.roles.includes('component-lifecycle-index'));assert.equal(lifecycle.length,3);for(const row of lifecycle){const asset=await reader.asset(manifest.dataId,row.id);assert.equal(asset.text,await fs.readFile(path.join(f.designRoot,row.source.path),'utf8'));}
 }
 assert.equal(network,0);
});

test('missing lifecycle package member refuses before any native component read',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.designRoot,'JSONS/indexes/lifecycle/scheduled.index.json'));await assert.rejects(f.build(),/ENOENT/);
 const g=await fixture(t),built=await g.build();await reseal(built.packageRoot,manifest=>{manifest.files=manifest.files.filter(row=>!row.urls.some(url=>url.endsWith('/scheduled.index.json')));});
 const reader=require('../src/audit-data/reader').createAuditDataReader({knowledgeRoot:built.packageRoot}),data=loadApollo('data-client.ts').createAuditDataClient({hashText:p.sha,loadManifest:()=>reader.manifest(),readAsset:(id,file)=>reader.asset(id,file)}),node=native();let reads=0;node.getMainComponentAsync=async()=>{reads++;throw Error('SHOULD_NOT_READ');};t.after(()=>delete globalThis.figma);
 await assert.rejects(loadApollo('entry.ts').runV3Audit({runId:'missing-registry',channel:'Desktop',pageType:null,shellAuditEnabled:false,pluginVersion:'test',selection:[node],data,assertCurrent(){},onProgress(){}}),/URL_UNDECLARED/);assert.equal(reads,0);
});

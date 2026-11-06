'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {componentRequests,promptContext,isIndexPrefix}=require('../src/landing/context'),{createLandingService}=require('../src/landing/service');
const base='knowledge/data/ds-ai-hub/products/ab/components/fixture/';
test('only one exact observed component package is batched; unrelated/code sources are not substituted',()=>{
 const list={query:'products/ab/components/fixture/',offset:0,next:null,resources:['instructions.md','adapter.figma.md','figma-keys.json','cookbook/01-overview.md','adapter.code.md','bridge.md'].map(file=>({id:base+file}))};
 assert.deepEqual(componentRequests(list).map(row=>row.id),list.resources.slice(0,4).map(row=>row.id));for(const query of ['fixture','products/ab/components/fixture/ other','products/ab/components/'])assert.deepEqual(componentRequests({...list,query}),[]);assert.deepEqual(componentRequests({...list,next:64}),[]);
});
test('exact folder autoload is identical with or without slash and never reads a neighbouring component',()=>{
 const resources=['instructions.md','adapter.figma.md','figma-keys.json','cookbook/01-overview.md'].map(file=>({id:base+file})).concat({id:base.replace('/fixture/','/fixture-other/')+'instructions.md'});
 for(const prefix of ['products/ab/components/fixture','knowledge/data/ds-ai-hub/products/ab/components/fixture']){
  const a=componentRequests({query:prefix,offset:0,next:null,resources}),b=componentRequests({query:prefix+'/',offset:0,next:null,resources});
  assert.deepEqual(a,b);assert.equal(a.length,4);assert(a.every(r=>r.id.startsWith(base)));
 }
});
test('Core Figma subfolder recipes are batched and conditional routed dependencies remain discovery only',()=>{
 const prefix='knowledge/data/ds-ai-hub/core/web/components/button/',required=prefix+'guidelines.md',list={query:'core/web/components/button/',offset:0,next:null,resources:['guidelines.md','figma/adapter.md','figma/cookbook.md','figma/snippets.md','figma/keys.json','figma/model.json','code/adapter.md'].map(file=>({id:prefix+file})),routing:{requiredSources:[{id:required,reasons:['component:Button']}],technicalSources:[{id:prefix+'figma/keys.json'}],candidateSources:[{id:base+'instructions.md',reason:'conditional dependency'}]}};
 const requests=componentRequests(list);assert.equal(requests.length,6);assert.equal(new Set(requests.map(r=>r.id)).size,6);assert(requests.every(r=>r.id.startsWith(prefix)&&!r.id.includes('/code/')));assert(!requests.some(r=>r.id===base+'instructions.md'));
});
test('phase projection preserves complete pinned ledger, exposes cached addresses and leaves legacy behavior intact',()=>{
 const context=[{id:base+'instructions.md',text:'norm',address:'norm'},{id:'other',text:'other',address:'other'},{id:'workflow/api',text:'signature',address:'api'}],indexes=[{query:'fixture',offset:0,total:1,next:null,resources:[{id:'fixture',large:'x'.repeat(1000)}]}];
 const job={source:{skill:{generation:{}}},context,indexes,phase:'plan'},record={spec:{sections:[{id:'hero',sourceIds:[context[0].id]}]},execution:{activeSectionId:'hero'}};
 const before=JSON.stringify(context);let view=promptContext(record,job);assert.deepEqual(view.resources.map(r=>r.id),[context[0].id,'other']);assert.equal(view.availableReads[0].id,'workflow/api');assert.equal(Object.hasOwn(view.indexes[0],'resources'),false);
 job.phase='write';view=promptContext(record,job);assert.deepEqual(view.resources.map(r=>r.id),[context[0].id,'workflow/api']);assert.equal(view.availableReads[0].id,'other');assert.equal(JSON.stringify(context),before);
 delete job.source.skill.generation;assert.deepEqual(promptContext(record,job),{resources:context,indexes});
});
test('one list turn reads all Figma package text pages and defers technical workflow without claiming it read',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-context-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0,physical=[];
 const source={id:'fixture',knowledgeVersion:'fixture',skill:{version:'0.3.2',sha256:'fixture',generation:{}},assertCurrent(){},initial:{norms:[],instructions:{},resources:[]},list(query,offset=0){return {query,offset,total:1,next:null,resources:[{id:base+'instructions.md'}]};},read(req){physical.push(req);return {...req,sha256:'a'.repeat(64),text:req.offset?'tail':'body',next:req.offset?null:4,total:8};}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  calls++;const state=JSON.parse(options.prompt.split('\n').at(-1));if(calls===3){assert.equal(state.resources.length,2);assert.equal(state.resourceFeedback.deferredToExecution,1);assert.equal(state.resources.map(r=>r.text).join(''),'bodytail');}
  const kind=calls===1?'list_resources':calls===2?'request_context':'question';return {result:{kind,message:'Fixture',specJson:JSON.stringify({sections:[{id:'hero'}]}),query:'products/ab/components/fixture/',offset:0,resources:calls===2?[{id:'workflow/api',path:[],mode:'read',offset:0,limit:16000}]:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};
 }})});const chat=service.create({fileKey:'FixtureFile',pageId:'0:1'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Fixture'});await service.whenSettled(chat.id);assert.equal(service.poll(chat.id).status,'needs-input');assert.equal(calls,3);assert.deepEqual(physical.map(r=>r.offset),[0,4]);assert(physical.every(r=>!r.id.startsWith('workflow/')));
});


test('repeated deferred workflow requests retain the no-progress guard and never claim a source read',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-deferred-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0,reads=0;
 const source={id:'fixture',knowledgeVersion:'fixture',skill:{generation:{},version:'0.3.2',sha256:'fixture'},assertCurrent(){},read(){reads++;throw Error('Unexpected read');},initial:{norms:[],workflow:[],instructions:{},resources:[]}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async()=>{calls++;return {result:{kind:'request_context',message:'Fixture',specJson:JSON.stringify({sections:[{id:'hero'}]}),query:'',offset:0,resources:[{id:'workflow/api',mode:'read',path:[],offset:0,limit:16000}],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};}})});
 const chat=service.create({pageId:'page',fileKey:'FixtureFile'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Fixture'});await service.whenSettled(chat.id);assert.equal(service.poll(chat.id).error.code,'LANDING_NO_PROGRESS');assert.equal(calls,3);assert.equal(reads,0);
});

test('only an exact Hub component search prefix can be returned as unread index feedback',()=>{
 const list={query:'products/ab/components/',offset:0,total:400,next:64,resources:[{id:base+'instructions.md'}]},request={id:'knowledge/data/ds-ai-hub/products/ab/components/',mode:'summary',path:[],offset:0,limit:100};
 assert.equal(isIndexPrefix(list,request),true);
 for(const change of [{id:'../../private'},{id:base},{id:base+'instructions.md'},{id:'/Users/example/components/'},{path:['components']},{offset:1},{limit:0},{mode:'unknown'}])assert.equal(isIndexPrefix(list,{...request,...change}),false);
 assert.equal(isIndexPrefix({...list,query:'components'},request),false);assert.equal(isIndexPrefix({...list,query:'products/ab/components/../../'},request),false);
 assert.equal(isIndexPrefix({...list,resources:[{id:'other'}]},request),false);
 assert.equal(isIndexPrefix({...list,query:request.id},request),true);
});

function prefixFixture(t,{repeat=false,extra=[],generation=true}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-prefix-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const prefix='knowledge/data/ds-ai-hub/products/ab/components/',resource=base+'instructions.md',reads=[],prompts=[];let calls=0;
 const source={id:'fixture',knowledgeVersion:'fixture',skill:{version:'0.3.2',sha256:'fixture',...(generation?{generation:{}}:{})},assertCurrent(){},initial:{norms:[],instructions:{},resources:[]},list(query,offset){return {query,offset,total:400,next:64,resources:[{id:resource}]};},read(request){reads.push(request.id);if(request.id!==resource)throw Object.assign(Error('LANDING_RESOURCE_INVALID'),{code:'LANDING_RESOURCE_INVALID'});return {...request,sha256:'a'.repeat(64),text:'Actual document',next:null,total:15};}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  calls++;const state=JSON.parse(options.prompt.split('\n').at(-1));prompts.push(state);
  const kind=calls===1||repeat?'list_resources':calls===2&&!extra.length?'request_context':'question';
  return {result:{kind,message:'Fixture',specJson:JSON.stringify({sections:['hero','benefits','steps','faq','cta'].map(id=>({id}))}),query:'products/ab/components/',offset:0,resources:kind==='list_resources'?[{id:prefix,mode:'summary',path:[],offset:0,limit:100},...extra]:kind==='request_context'?[{id:resource,mode:'read',path:[],offset:0,limit:100}]:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};
 }})});
 return {root,service,source,reads,prompts,get calls(){return calls;},async run(){const chat=service.create({fileKey:'FixtureFile',pageId:'0:1'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Fixture'});await service.whenSettled(chat.id);return service.poll(chat.id);}};
}
test('owner directory-summary shape recovers to an exact listed file without reading or citing the prefix',async t=>{
 const h=prefixFixture(t),result=await h.run();assert.equal(result.status,'needs-input',JSON.stringify(result.error));assert.equal(h.calls,3);assert.deepEqual(h.reads,[base+'instructions.md']);
 const state=h.prompts[1];assert.equal(state.resourceFeedback.code,'INDEX_PREFIX_NOT_RESOURCE');assert.deepEqual(state.resourceFeedback.unreadIds,['knowledge/data/ds-ai-hub/products/ab/components/']);assert.equal(state.index.next,64);assert.equal(state.resources.length,0);
 assert.deepEqual(result.sources.map(s=>s.id),h.reads);const stored=JSON.parse(fs.readFileSync(path.join(h.root,result.id+'.json')));assert.equal(stored.readerState.reads.length,1);assert.equal(result.target,null);
});
test('a valid file in the same list batch is retained alongside unread prefix feedback',async t=>{
 const h=prefixFixture(t,{extra:[{id:base+'instructions.md',mode:'read',path:[],offset:0,limit:100}]}),result=await h.run();assert.equal(result.status,'needs-input');assert.deepEqual(h.reads,[base+'instructions.md']);assert.equal(h.prompts[1].resourceFeedback.indexPrefixes.code,'INDEX_PREFIX_NOT_RESOURCE');assert.equal(h.prompts[1].resources[0].text,'Actual document');assert.deepEqual(result.sources.map(s=>s.id),h.reads);
});
test('repeating a prefix is still bounded by no-progress and arbitrary IDs remain fatal',async t=>{
 const repeated=prefixFixture(t,{repeat:true}),result=await repeated.run();assert.equal(result.error.code,'LANDING_NO_PROGRESS');assert.equal(repeated.calls,3);assert.equal(repeated.reads.length,0);assert.equal(result.sources.length,0);
 const invalid=prefixFixture(t,{extra:[{id:'../../private',mode:'read',path:[],offset:0,limit:100}]}),failed=await invalid.run();assert.equal(failed.error.code,'LANDING_RESOURCE_INVALID');assert.deepEqual(invalid.reads,['../../private']);
 const legacy=prefixFixture(t,{generation:false}),unchanged=await legacy.run();assert.equal(unchanged.error.code,'LANDING_RESOURCE_INVALID');assert.equal(legacy.calls,1);
});

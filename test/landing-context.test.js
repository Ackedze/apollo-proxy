'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {componentRequests,promptContext}=require('../src/landing/context'),{createLandingService}=require('../src/landing/service');
const base='knowledge/data/ds-ai-hub/products/ab/components/fixture/';
test('only one exact observed component package is batched; unrelated/code sources are not substituted',()=>{
 const list={query:'products/ab/components/fixture/',offset:0,next:null,resources:['instructions.md','adapter.figma.md','figma-keys.json','cookbook/01-overview.md','adapter.code.md','bridge.md'].map(file=>({id:base+file}))};
 assert.deepEqual(componentRequests(list).map(row=>row.id),list.resources.slice(0,4).map(row=>row.id));for(const query of ['fixture','products/ab/components/fixture/ other','products/ab/components/'])assert.deepEqual(componentRequests({...list,query}),[]);assert.deepEqual(componentRequests({...list,next:64}),[]);
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

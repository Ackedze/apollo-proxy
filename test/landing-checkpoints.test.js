'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service');
const copy=v=>JSON.parse(JSON.stringify(v));
const target={fileKey:'FileKey123',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
const row=id=>({id:id==='hero'?'2:1':'2:2',sectionId:id,fingerprint:'d'.repeat(64)});
const readback=(rows=[])=>({rootNodeId:'1:1',pageId:'0:1',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:rows.length+1,instanceCount:rows.length,sections:rows,text:'Fixture',coverage:'tagged-sections-and-text'});
const make=(kind,spec,point)=>({kind,message:kind,specJson:JSON.stringify(spec),query:'',offset:0,resources:[],resultJson:JSON.stringify(point?{checkpoint:point}:{summary:'Fixture',checks:[{verdict:'UNKNOWN'}]})});
function fixture(t,intercept=()=>null){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-checkpoint-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let stale=false;
 const source={id:'data1',knowledgeVersion:'k1',skill:{version:'0.3.0',sha256:'s1'},initial:{instructions:{},norms:[],resources:[]},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});}};
 const calls=[];const makeService=()=>createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  const state=JSON.parse(options.prompt.split('\n').at(-1));calls.push(options);const n=calls.length;const custom=await intercept(state,options,n);if(custom)return custom;
  const spec=copy(state.spec.sections.length?state.spec:{sections:[{id:'hero',nodeId:null},{id:'details',nodeId:null}]});let result;
  if(!state.execution)result=make('build',spec);
  else if(state.execution.stage==='verify')result=make('finish',spec);
  else {const id=state.execution.activeSectionId;if(id)spec.sections.find(s=>s.id===id).nodeId=row(id).id;result=make('continue',spec,{sectionId:id,status:'complete',nextAction:'Next work unit'});}
  return {result,receipt:{usage:{measurementId:'measurement-'+n},mcp:{toolCalls:0}}};
 }})});
 const service=makeService();
 const chat=service.create({fileKey:'FileKey123',pageId:'0:1'}),request={requestId:crypto.randomUUID(),revision:chat.revision,text:'Fixture'};
 const settle=async()=>{await service.whenSettled(chat.id);return service.poll(chat.id);};
 const observe=async rows=>{const r=service.poll(chat.id);service.observation(chat.id,{revision:r.revision,readback:readback(rows)});return settle();};
 return {root,service,chat,request,calls,settle,observe,makeService,stale:()=>stale=true};
}
async function begin(h){h.service.submit(h.chat.id,h.request);let r=await h.settle();assert.equal(r.status,'awaiting-canvas');h.service.canvas(r.id,{revision:r.revision,target,readback:readback()});return h.settle();}
test('host cursor advances bootstrap/hero/details/verify only after independent observations',async t=>{
 const h=fixture(t);let r=await begin(h);assert.equal(r.execution.stage,'bootstrap');assert.equal(h.calls.length,2);
 r=await h.observe([]);assert.equal(r.execution.activeSectionId,'hero');assert.equal(r.execution.completed.length,0);
 r=await h.observe([row('hero')]);assert.equal(r.execution.activeSectionId,'details');assert.equal(r.execution.completed.length,1);
 r=await h.observe([row('hero'),row('details')]);assert.equal(r.execution.stage,'verify');assert.equal(r.result,null);
 r=await h.observe([row('hero'),row('details')]);assert.equal(r.status,'completed');assert.equal(r.execution.status,'completed');assert.equal(r.usage.length,5);assert.equal(r.result.Ready,false);
 assert(h.calls.filter(c=>c.profile==='landing-figma').every(c=>c.checkpointBudget.maxCompletedCalls===3&&c.checkpointBudget.softRuntimeMs===90000&&c.mcpBudget.maxToolCalls===4));
});
test('a later section cannot be created early, even inside the owned root',async t=>{
 const h=fixture(t);await begin(h);await h.observe([]);assert.throws(()=>h.service.observation(h.chat.id,{revision:1,readback:readback([row('hero'),row('details')])}),{code:'LANDING_SECTION_SCOPE_CHANGED'});assert.equal(h.service.poll(h.chat.id).result,null);
});
test('confirmed sections cannot change while another section is active',async t=>{
 const h=fixture(t);await begin(h);await h.observe([]);await h.observe([row('hero')]);assert.throws(()=>h.service.observation(h.chat.id,{revision:1,readback:readback([{...row('hero'),fingerprint:'e'.repeat(64)},row('details')])}),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});
for(const code of ['AGENT_CHECKPOINT_REQUIRED','AGENT_TIMEOUT'])test(code+' preserves partial nodes and usage, waits for host readback, then resumes the same section',async t=>{
 let thrown=false;const h=fixture(t,(state,options)=>{if(state.execution?.activeSectionId==='hero'&&!thrown){thrown=true;options.onEvent({type:'item.started',item:{type:'mcp_tool_call',tool:'use_figma',id:'call-one'}});throw Object.assign(Error(code),{code,usage:{measurementId:'partial-write',toolCalls:2},diagnostic:'retained failure',nativeFailure:{callId:'call-one',message:'Unsupported variant values'}});}});
 await begin(h);let r=await h.observe([]);assert.equal(r.status,'awaiting-readback');assert.equal(r.execution.activeSectionId,'hero');assert.equal(r.execution.operation,'mcp.use_figma');assert.equal(r.execution.lastIssue.code,code);assert.equal(h.calls.length,3);
 r=await h.observe([row('hero')]);assert.equal(h.calls.length,4);const state=JSON.parse(h.calls[3].prompt.split('\n').at(-1));assert.equal(state.execution.activeSectionId,'hero');assert.equal(state.execution.lastIssue.nativeFailure.message,'Unsupported variant values');assert.equal(state.spec.sections[0].nodeId,'2:1');assert.equal(state.readback.sections[0].id,'2:1');assert.equal(state.limits.toolsRemaining,94);assert.equal(r.usage.filter(x=>x.measurementId==='partial-write').length,1);
 r=await h.observe([row('hero')]);assert.equal(r.execution.activeSectionId,'details');
});
test('unknown recovery without canvas progress stops after three checkpoints',async t=>{
 const h=fixture(t,state=>{if(state.execution?.activeSectionId==='hero')throw Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{toolCalls:1}});});await begin(h);await h.observe([]);await h.observe([]);await h.observe([]);assert.throws(()=>h.service.observation(h.chat.id,{revision:1,readback:readback()}),{code:'LANDING_NO_PROGRESS'});assert.equal(h.service.poll(h.chat.id).target.rootNodeId,'1:1');
});
test('Stop and source drift never relaunch a suspended write',async t=>{
 for(const guard of ['stop','stale']){
  const h=fixture(t,state=>{if(state.execution?.activeSectionId==='hero')throw Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{toolCalls:1}});});await begin(h);await h.observe([]);const count=h.calls.length;if(guard==='stop')h.service.cancel(h.chat.id);else h.stale();assert.throws(()=>h.service.observation(h.chat.id,{revision:1,readback:readback([row('hero')])}));assert.equal(h.calls.length,count);
 }
});
test('persisted completed checkpoints require exact source/spec/actual fingerprint before reuse',()=>{
 const c=require('../src/landing/checkpoints'),r={spec:{sections:[{id:'hero',nodeId:'2:1'}]},target,readback:readback()};r.execution=c.start(r,'pin');c.observed(r.execution,r.readback,readback(),{sectionId:null,status:'complete',nextAction:'Hero'},r.spec,1);c.observed(r.execution,readback(),readback([row('hero')]),{sectionId:'hero',status:'complete',nextAction:'Verify'},r.spec,2);r.readback=readback([row('hero')]);assert.equal(c.start(r,'pin').stage,'verify');assert.equal(c.start(r,'new-pin').stage,'bootstrap');r.readback.sections[0].fingerprint='f'.repeat(64);assert.equal(c.start(r,'pin').activeSectionId,'hero');
});
test('checkpoint recovery cannot reset the global 24-step budget',async t=>{
 const h=fixture(t,state=>{if(state.execution)throw Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{toolCalls:1}});});await begin(h);
 for(let i=0;i<24&&h.service.poll(h.chat.id).status==='awaiting-readback';i++){
  const r=h.service.poll(h.chat.id);h.service.observation(r.id,{revision:r.revision,readback:{...readback(),text:'Observed host progress '+i}});await h.settle();
 }
 const r=h.service.poll(h.chat.id);assert.equal(r.error.code,'LANDING_STEP_BUDGET');assert.equal(h.calls.length,24);assert.equal(r.usage.length,24);assert.equal(r.result,null);
});
test('late controlled yield after Stop retains usage without restoring the cancelled job',async t=>{
 let release;const h=fixture(t,state=>state.execution?new Promise((_,reject)=>{release=()=>reject(Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{measurementId:'late-yield',toolCalls:1}}));}):null);
 h.service.submit(h.chat.id,h.request);let r=await h.settle();h.service.canvas(r.id,{revision:r.revision,target,readback:readback()});const settled=h.service.whenSettled(r.id);h.service.cancel(r.id);release();await settled;r=h.service.poll(r.id);assert.equal(r.status,'cancelled');assert.equal(r.execution.status,'cancelled');assert.equal(r.usage.filter(x=>x.measurementId==='late-yield').length,1);assert.equal(r.result,null);
});
test('finish before verify and spec edits to another section are refused',async t=>{
 for(const attack of ['finish','other-spec']){
  const h=fixture(t,state=>{
   if(state.execution?.activeSectionId==='hero'){
    const spec=copy(state.spec);if(attack==='other-spec')spec.sections[1].text='Unrequested';
    return {result:make(attack==='finish'?'finish':'continue',spec,{sectionId:'hero',status:'complete',nextAction:'Next'}),receipt:{usage:{measurementId:'attempted-write'},mcp:{toolCalls:1}}};
   }
  });await begin(h);const r=await h.observe([]);assert.equal(r.status,'interrupted');assert.equal(r.error.code,attack==='finish'?'LANDING_CHECKPOINT_REQUIRED':'LANDING_SECTION_SCOPE_CHANGED');assert.equal(r.result,null);assert.equal(r.usage.filter(x=>x.measurementId==='attempted-write').length,1);
 }
});
test('restart resumes only exact confirmed section checkpoints after reopening the same root',async t=>{
 let held=true;const h=fixture(t,state=>{if(held&&state.execution?.activeSectionId==='details')throw Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{toolCalls:1}});});await begin(h);await h.observe([]);let r=await h.observe([row('hero')]);assert.equal(r.execution.activeSectionId,'details');assert.equal(r.execution.completed.length,1);
 held=false;const restarted=h.makeService();r=restarted.poll(r.id);assert.equal(r.status,'interrupted');assert.equal(r.execution.status,'interrupted');
 const spec=copy(r.spec);spec.editSectionIds=['hero','details'];
 // The tool-free planner declares the exact requested scope before reusing a root.
 const persisted=JSON.parse(fs.readFileSync(path.join(h.root,r.id+'.json')));persisted.spec=spec;fs.writeFileSync(path.join(h.root,r.id+'.json'),JSON.stringify(persisted));
 const next=h.makeService();r=next.poll(r.id);next.submit(r.id,{requestId:crypto.randomUUID(),revision:r.revision,text:'Resume remaining work'});await next.whenSettled(r.id);r=next.poll(r.id);assert.equal(r.status,'awaiting-canvas');
 next.canvas(r.id,{revision:r.revision,target:{...target,leaseNonce:'e'.repeat(64)},readback:{...readback([row('hero')]),leaseNonce:'e'.repeat(64)}});await next.whenSettled(r.id);r=next.poll(r.id);assert.equal(r.execution.activeSectionId,'details');assert.equal(r.execution.completed[0].sectionId,'hero');assert.equal(r.target.rootNodeId,'1:1');assert.equal(r.status,'awaiting-readback');
});

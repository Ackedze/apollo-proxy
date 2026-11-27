'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {FLOW,createDirectLandingService,mountDirectLandingRoutes}=require('../src/landing/direct-service');
function fixture(t,verification=null,repairStructure=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'direct-landing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let result='needs-structure-approval',message='Actual fixture checkpoint',checkpoint='Existing frame and next action',held=null,hold=false,stale=false,inspection=null,onlyInspection=false,runError=null,reportedChecks=[],reportedIssues=[],reportedQuestion;const calls=[],knowledgeEvents=[],figmaEvents=[];
 const source={id:'data',resumePin:'source-pin',knowledgeVersion:'hub-v1',skill:{id:'ab-generate-custom-landing',name:'Landing',version:'0.6.0',sha256:'a'.repeat(64),generation:{workflow:FLOW},bodies:{'references/rules/page-layout.md':'Layout recipe.','references/rules/component-selection.md':'Selection recipe.'}},initial:{selectedSkill:{id:'ab-generate-custom-landing'},instructions:{'SKILL.md':'Use Hub.'}},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});}};
 source.fileAccess={hub:'/package/hub',skill:'/package/skill',workflow:'/runtime/workflow.md'};
 if(verification){source.skill.generation.verification={schemaVersion:'apollo.recipe-verification.v1',file:'references/verification.json'};source.skill.bodies['references/verification.json']=JSON.stringify(verification);}
 if(repairStructure)source.skill.bodies['references/recovery.json']=JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1',repairStructure:true});
 const rootCalls=[],rootValues=[];
 const rootLifecycle={async inspect(input,options){if(!options.fit)rootCalls.push({...input,create:options.create});if(rootValues.length){const v=rootValues.shift();if(v instanceof Error)throw v;if(typeof v==='function')return v(input,options);return v;}return {state:'found',matches:['30:40'],root:{id:'30:40',type:input.type,pageId:input.pageId,parentId:input.parentId,owner:input.ownerNonce,chat:input.chatId,width:1140,height:400,childrenComplete:true,children:[{id:'30:41',x:0,y:0,width:1140,height:400}]}};}};
 const options={root,rootLifecycle,knowledge:()=>source,isProcessAlive:()=>false,createCli:(_fileKey,_source,knowledgePilot)=>({async run(input){
  input.knowledgePilot=knowledgePilot;
  calls.push(input);const context=JSON.parse(input.prompt.split('\n').at(-1));
  if(runError)throw runError;
  input.onEvent({type:'thread.started',thread_id:'12345678-1234-1234-1234-123456789abc'});input.onEvent({type:'process.started',pid:999999});
  if(hold)await new Promise(resolve=>{held=resolve;input.signal.addEventListener('abort',resolve,{once:true});});
  if(input.signal.aborted)throw Object.assign(Error('Stopped'),{code:'AGENT_CANCELLED'});
  input.onEvent({type:'item.completed',item:{id:'source:1',type:'mcp_tool_call',server:'apollo_knowledge',tool:'read_source',status:'completed',result:{content:[{type:'text',text:JSON.stringify({id:'knowledge/data/ds-ai-hub/products/ab/patterns/landing-pages.md',sha256:'b'.repeat(64),path:[],offset:0,mode:'read',text:'Rule.',sourcePin:'source-pin'})}]}}});
  for(const [index,{tool,value}] of knowledgeEvents.entries())input.onEvent({type:'item.completed',item:{id:'knowledge:'+index,type:'mcp_tool_call',server:'apollo_knowledge',tool,status:'completed',result:{content:[{type:'text',text:JSON.stringify(value)}]}}});
  if(inspection)input.onEvent({type:'item.completed',item:{id:'inspect:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify(inspection(context))}]}}});
  for(const [index,readback] of figmaEvents.entries()){
   if(Number.isInteger(readback.startAt)){
    input.onEvent({type:'item.started',item:{id:'readback:'+readback.startAt,type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'in_progress'}});
    continue;
   }
   input.onEvent({type:'item.completed',item:{id:'readback:'+index,type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify({...readback,target:{...context.target,rootNodeId:'30:40',parentNodeId:context.target.pageId}})}]}}});
  }
  const hasRoot=result!=='needs-input'&&!onlyInspection;if(hasRoot)input.onEvent({type:'item.completed',item:{id:'figma:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify({target:{rootNodeId:'30:40',pageId:context.target.pageId,parentNodeId:context.target.placement.sectionId||context.target.pageId,ownerNonce:context.target.ownerNonce}})}]}}});
  return {result:{status:result,message,rootNodeId:hasRoot?'30:40':null,checkpoint,checks:reportedChecks,issues:reportedIssues,...(reportedQuestion!==undefined?{question:reportedQuestion}:{})},receipt:{usage:{actualInputTokens:10,actualOutputTokens:5}}};
 }})};
 const service=createDirectLandingService(options),chat=service.create({id:crypto.randomUUID(),fileKey:'FigmaTestFile',pageId:'1:2',placement:{mode:'new-section',sectionId:null}});
 const send=(text='Build a landing')=>service.submit(chat.id,{requestId:crypto.randomUUID(),revision:service.poll(chat.id).revision,text});
 return {root,service,chat,calls,rootCalls,rootValues,options,source,send,knowledgeEvents,figmaEvents,setResult:value=>result=value,setMessage:value=>message=value,setQuestion:value=>reportedQuestion=value,setCheckpoint:value=>checkpoint=value,setChecks:value=>reportedChecks=value,setIssues:value=>reportedIssues=value,setHold:value=>hold=value,release:()=>held?.(),setStale:()=>stale=true,setInspection:(value,only=false)=>{inspection=value;onlyInspection=only;},setError:value=>runError=value};
}
const absent=context=>({target:{rootNodeId:null,pageId:context.target.pageId,parentNodeId:context.target.placement.sectionId||context.target.pageId,ownerNonce:context.target.ownerNonce},ownedCount:0,matches:[]});
test('new chats default to B and explicit modes remain pinned after the first message',async t=>{
 const brief='Собери обзор из трёх PromoCard';
 for(const [selector,mode] of [['','B'],['/ab-a\n','A'],['/ab-b\n','B']]){
  const f=fixture(t);
  assert.equal(f.chat.execution.knowledgePilot,'B');
  f.send(selector+brief);
  await f.service.settled(f.chat.id);
  const chat=f.service.poll(f.chat.id),prompt=JSON.parse(f.calls[0].prompt.split('\n').at(-1));
  assert.equal(chat.execution.knowledgePilot,mode);
  assert.equal(f.calls[0].knowledgePilot,mode);
  assert.deepEqual(prompt.source,chat.source);
  assert.equal(prompt.userMessage,brief);
  assert.match(f.calls[0].prompt,/Before acting on a recipe, read the complete applicable section/);
  assert.match(f.calls[0].prompt,/Reuse its full text if it is already in context/);
  assert.match(f.calls[0].prompt,/If the response was truncated, read the missing range in a separate call before acting/);
  assert.equal(chat.messages[0].text,brief);
  assert.deepEqual(prompt.knowledgeFiles,mode==='B'?f.source.fileAccess:undefined);
  assert.deepEqual(prompt.structureSources.map(doc=>doc.id.split('/').at(-1)),mode==='B'?['component-selection.md']:['page-layout.md','component-selection.md']);
  if(mode==='B'){
   assert.match(f.calls[0].prompt,/one short document or one complete applicable section/);
   assert.match(f.calls[0].prompt,/tokens truncated/);
   assert.match(f.calls[0].prompt,/references\/rules\/modal-layout\.md/);
   assert.match(f.calls[0].prompt,/references\/rules\/page-layout\.md/);
   assert.match(f.calls[0].prompt,/sections of the single knowledgeFiles.workflow file, not filesystem paths/);
   assert.match(f.calls[0].prompt,/rg -n "\^# Loaded workflow file: "/);
   assert.match(f.calls[0].prompt,/Do not enumerate the parent directory/);
  }else{
   assert.doesNotMatch(f.calls[0].prompt,/sections of the single knowledgeFiles.workflow file/);
  }
  assert.match(f.calls[0].prompt,/supplemental API\/tool reference only/);
  assert.match(f.calls[0].prompt,/If a permitted technical resource is unavailable/);
  assert.throws(()=>f.send('/ab-b '+brief),{code:'LANDING_KNOWLEDGE_PILOT_NEW_CHAT_REQUIRED'});
  f.send('Продолжи правку');
  await f.service.settled(f.chat.id);
  assert.equal(f.calls[1].knowledgePilot,mode);
  const resumed=JSON.parse(f.calls[1].prompt.split('\n').at(-1));
  assert.deepEqual(resumed.structureSources,prompt.structureSources);
  assert.deepEqual(resumed.knowledgeFiles,prompt.knowledgeFiles);
  if(mode==='B')assert.match(f.calls[1].prompt,/sections of the single knowledgeFiles.workflow file, not filesystem paths/);
  for(const call of [f.calls[0],f.calls[1]]){assert.equal((call.prompt.match(/Keep message concise and in Russian\./g)||[]).length,1);assert.match(call.prompt,/bold the question/);assert.match(call.prompt,/\[к макету\]\(actual Figma URL\)/);assert.match(call.prompt,/Keep ownership IDs and component property names in structured evidence, not user-facing prose/);}
 }
});
test('legacy records keep their mode and source pins still prevent stale file reads',async t=>{
 const legacy=fixture(t),file=path.join(legacy.root,legacy.chat.id+'.json');
 const stored=JSON.parse(fs.readFileSync(file,'utf8'));
 delete stored.execution.knowledgePilot;
 fs.writeFileSync(file,JSON.stringify(stored));
 const service=createDirectLandingService(legacy.options);
 service.submit(stored.id,{requestId:crypto.randomUUID(),revision:0,text:'Use retained mode'});
 await service.settled(stored.id);
 assert.equal(legacy.calls[0].knowledgePilot,undefined);
 assert.match(legacy.calls[0].prompt,/Use apollo_knowledge/);
 assert.equal(service.poll(stored.id).execution.knowledgePilot,undefined);

 const b=fixture(t);
 b.send();await b.service.settled(b.chat.id);
 const pinned=b.service.poll(b.chat.id);
 b.source.resumePin='another-source-pin';
 assert.throws(()=>b.send('Continue'),{code:'LANDING_DATA_STALE'});
 assert.equal(b.calls.length,1);
 assert.deepEqual(b.service.poll(b.chat.id),pinned);
});
test('B with unavailable file roots stops before starting the CLI',async t=>{
 const f=fixture(t);
 delete f.source.fileAccess;
 f.send();await f.service.settled(f.chat.id);
 assert.equal(f.calls.length,0);
 assert.equal(f.service.poll(f.chat.id).error.code,'AGENT_KNOWLEDGE_UNAVAILABLE');
});
test('complete structural recipes survive first and resumed prompts; content keeps its existing delivery',async t=>{
 const f=fixture(t),plans=[];
 const bodies=Object.fromEntries(['page-layout.md','component-selection.md'].map(name=>['references/rules/'+name,'Начало '+name+'\n'+'Переменные сетки и отступы. '.repeat(800)+'\nПоследняя строка '+name+' 🧩']));
 f.source.skill.bodies=bodies;
 f.source.plan=input=>{plans.push(input);return {phase:input.phase};};
 const expected=Object.entries(bodies).map(([file,text])=>({id:'skills/'+f.source.skill.id+'/'+file,text}));
 f.send('/ab-a Build a landing');await f.service.settled(f.chat.id);
 f.send('Revise the structure');await f.service.settled(f.chat.id);
 for(const call of f.calls){assert.deepEqual(JSON.parse(call.prompt.split('\n').at(-1)).structureSources,expected);assert.match(call.prompt,/complete layout and component-selection recipes/);}
 for(const doc of expected)assert(plans[0].providedIds.includes(doc.id));
 f.setResult('completed');f.send('да');await f.service.settled(f.chat.id);
 const content=JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1));assert.equal(content.structureApproved,true);assert.equal(content.structureSources,undefined);assert.equal(f.service.poll(f.chat.id).status,'completed');
});
test('missing or invalid structural recipes stop before CLI and other skills keep their existing inputs',async t=>{
 for(const value of [undefined,null,'','   ',{text:'partial'}]){
  const f=fixture(t);f.source.skill.bodies['references/rules/component-selection.md']=value;f.send();await f.service.settled(f.chat.id);
  assert.equal(f.calls.length,0);assert.equal(f.service.poll(f.chat.id).error.code,'LANDING_REQUIRED_KNOWLEDGE_MISSING');
 }
 const f=fixture(t);f.source.skill.id='other-skill';f.source.skill.bodies={};f.send();await f.service.settled(f.chat.id);
 assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].prompt.split('\n').at(-1)).structureSources,undefined);
});
test('initial CLI prompt omits the source plan and resume retains phase planning and usage correlation',async t=>{
 const f=fixture(t),plans=[];f.source.plan=input=>{plans.push(input);return {sourcePin:'source-pin',phase:input.phase,required:[{id:'rule'}],candidates:[],gaps:[]};};
 f.send('Build a landing');await f.service.settled(f.chat.id);
 const initial=JSON.parse(f.calls[0].prompt.split('\n').at(-1));
 assert.equal(Object.hasOwn(initial,'sourcePlan'),false);assert.equal(plans.length,0);
 assert.equal(initial.userMessage,'Build a landing');assert.deepEqual(initial.skill,f.source.initial.instructions);
 assert.deepEqual(initial.knowledgeFiles,f.source.fileAccess);
 assert.match(f.calls[0].prompt,/Use local read-only commands/);
 assert.equal(f.service.poll(f.chat.id).status,'needs-structure-approval');
 f.setResult('completed');f.send('Да');await f.service.settled(f.chat.id);
 assert.deepEqual(plans.map(p=>p.phase),['content']);assert.equal(plans[0].resuming,true);
 assert(plans[0].query.includes('Build a landing'));assert(Object.hasOwn(plans[0].ledger[0],'returned'));
 assert(plans[0].providedIds.includes('skills/ab-generate-custom-landing/SKILL.md'));
 const contexts=f.calls.map(c=>c.diagnosticContext);assert(contexts.every(c=>c.requestId.startsWith('landing-chat:'+f.chat.id+':')));assert.notEqual(contexts[0].requestId,contexts[1].requestId);assert.notEqual(contexts[0].runId,contexts[1].runId);assert.deepEqual(contexts.map(c=>c.stage),['structure','content']);
 assert.equal(JSON.parse(f.calls[1].prompt.split('\n').at(-1)).sourcePlan.phase,'content');assert.equal(f.service.poll(f.chat.id).status,'completed');
});
test('batch records actual successful read ranges once and search snippets never count as reads',async t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/fixture.json';
 const row={id,sha256:'c'.repeat(64),path:['sections'],mode:'read',offset:1,returned:1,total:4,next:2,text:'["section"]'};
 f.knowledgeEvents.push({tool:'search_sources',value:{sourcePin:'source-pin',matches:[row]}},{tool:'read_sources',value:{sourcePin:'source-pin',results:[row,row,{...row,id:'missing',error:{code:'LANDING_RESOURCE_INVALID'}},{...row,mode:'keys'},{...row,tooLarge:true}]}});
 f.send('/ab-a Build a landing');await f.service.settled(f.chat.id);
 const c=f.service.poll(f.chat.id);
 assert.equal(c.status,'needs-structure-approval');assert.equal(c.sources.length,2);
 assert.deepEqual(c.sources[1],{id,sha256:row.sha256,path:row.path,offset:1,returned:1,total:4,next:2});
 const stale=fixture(t);
 stale.knowledgeEvents.push({tool:'read_sources',value:{sourcePin:'foreign',results:[row]}});
 stale.send('/ab-a Build a landing');await stale.service.settled(stale.chat.id);
 const rejected=stale.service.poll(stale.chat.id);assert.equal(rejected.error.code,'LANDING_DATA_STALE');assert.equal(rejected.sources.length,1);
});
test('host bootstraps before CLI and independently rechecks the same canonical root after each run',async t=>{
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);let c=f.service.poll(f.chat.id);
 assert.equal(c.status,'needs-structure-approval');assert.deepEqual(f.rootCalls.map(v=>v.create),[true,false]);
 assert.equal(JSON.parse(f.calls[0].prompt.split('\n').at(-1)).target.rootNodeId,'30:40');
 f.send('Revise');await f.service.settled(c.id);c=f.service.poll(c.id);
 assert.deepEqual(f.rootCalls.map(v=>v.create),[true,false,false,false]);assert.equal(c.target.rootNodeId,'30:40');assert.equal(c.execution.rootReadRequired,false);
});
test('empty canonical root survives needs-input and is reused in the same chat',async t=>{
 const f=fixture(t);f.setResult('needs-input');f.send();await f.service.settled(f.chat.id);let c=f.service.poll(f.chat.id);
 assert.equal(c.target.rootNodeId,'30:40');assert.equal(c.status,'needs-input');f.setResult('needs-structure-approval');f.send('Answer');await f.service.settled(c.id);
 assert.deepEqual(f.rootCalls.map(v=>v.create),[true,false,false,false]);assert.equal(f.calls[1].sessionId,'12345678-1234-1234-1234-123456789abc');
});
test('unknown bootstrap persists read-required before dispatch and cannot blindly create on restart',async t=>{
 const f=fixture(t);f.rootValues.push((input,options)=>{options.onToolCall({tool:'use_figma',phase:'bootstrap'});const stored=JSON.parse(fs.readFileSync(path.join(f.root,f.chat.id+'.json')));assert.equal(stored.execution.rootReadRequired,true);throw Object.assign(Error('timeout'),{code:'LANDING_ROOT_MCP_TIMEOUT'});});
 f.send();await f.service.settled(f.chat.id);assert.equal(f.calls.length,0);
 f.rootValues.push({state:'absent',matches:[]});const service=createDirectLandingService(f.options);service.submit(f.chat.id,{revision:1,requestId:crypto.randomUUID(),text:'Retry'});await service.settled(f.chat.id);
 assert.deepEqual(f.rootCalls.map(v=>v.create),[true,false]);assert.equal(f.calls.length,0);assert.equal(service.poll(f.chat.id).execution.rootReadRequired,true);
});
test('pre-dispatch auth failure may retry bootstrap; cancellation after dispatch recovers only by reading',async t=>{
 const f=fixture(t);f.rootValues.push(Object.assign(Error('auth'),{code:'AGENT_MCP_AUTH_REQUIRED'}));f.send();await f.service.settled(f.chat.id);assert.equal(f.service.poll(f.chat.id).execution.rootReadRequired,false);assert.equal(f.calls.length,0);f.send('Retry after login');await f.service.settled(f.chat.id);assert.deepEqual(f.rootCalls.map(v=>v.create),[true,true,false]);
 const c=fixture(t);c.rootValues.push(async(i,o)=>{o.onToolCall({tool:'use_figma',phase:'bootstrap'});c.service.cancel(c.chat.id);throw Object.assign(Error('cancel'),{code:'AGENT_CANCELLED'});});c.send();await c.service.settled(c.chat.id);assert.equal(c.calls.length,0);assert.equal(c.service.poll(c.chat.id).execution.rootReadRequired,true);
 const resumed=createDirectLandingService(c.options);resumed.submit(c.chat.id,{requestId:crypto.randomUUID(),revision:1,text:'Resume'});await resumed.settled(c.chat.id);assert.deepEqual(c.rootCalls.map(v=>v.create),[true,false,false]);assert.equal(c.calls.length,1);assert.equal(resumed.poll(c.chat.id).target.rootNodeId,'30:40');
});
test('failed partial creation retains candidate ID without rebinding or recreation',async t=>{
 const f=fixture(t);f.rootValues.push((i,o)=>{o.onToolCall({tool:'use_figma',phase:'bootstrap'});return {state:'write-failed',candidateId:'30:40',matches:[]};});f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);assert.equal(c.target,null);assert.equal(c.execution.rootCandidateId,'30:40');assert.equal(c.execution.rootReadRequired,true);assert.equal(f.calls.length,0);
 f.send('Read after failure');await f.service.settled(f.chat.id);assert.equal(f.rootCalls[1].rootId,'30:40');assert.equal(f.rootCalls[1].create,false);assert.equal(f.service.poll(f.chat.id).target.rootNodeId,'30:40');
});
test('host-created empty root plus a model target echo cannot authorize a finished skeleton',async t=>{
 const f=fixture(t);f.rootValues.push(i=>({state:'found',matches:['30:40'],root:{id:'30:40',type:i.type,pageId:i.pageId,parentId:i.parentId,owner:i.ownerNonce,chat:i.chatId,childrenComplete:true,children:[]}}));
 f.rootValues.push(i=>({state:'found',matches:['30:40'],root:{id:'30:40',type:i.type,pageId:i.pageId,parentId:i.parentId,owner:i.ownerNonce,chat:i.chatId,childrenComplete:true,children:[]}}));
 f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);assert.equal(c.status,'interrupted');assert.equal(c.execution.structureApproval,undefined);assert(c.result.checks.some(c=>c.name==='Содержимое корня'&&c.status==='unknown'));
});
test('confirmed root loss, wrong canonical metadata, scope and duplicate roots refuse before the model',async t=>{
 for(const change of [r=>{r.owner='wrong';},r=>{r.chat='wrong';},r=>{r.owner='';r.aliasOwnerNonce='ignored';},r=>{r.pageId='9:9';},r=>{r.parentId='9:9';},r=>{r.type='FRAME';}]){
  const f=fixture(t);f.rootValues.push(input=>{const r={id:'30:40',type:input.type,pageId:input.pageId,parentId:input.parentId,owner:input.ownerNonce,chat:input.chatId};change(r);return {state:'found',matches:['30:40'],root:r};});f.send();await f.service.settled(f.chat.id);assert.equal(f.calls.length,0);assert.equal(f.service.poll(f.chat.id).error.code,'LANDING_TARGET_CHANGED');
 }
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);const before=f.service.poll(f.chat.id);f.rootValues.push({state:'absent',matches:[]});f.send('Continue');await f.service.settled(f.chat.id);assert.deepEqual(f.service.poll(f.chat.id).target,before.target);assert.equal(f.calls.length,1);
 const a=fixture(t);a.rootValues.push({state:'ambiguous',matches:['30:40','30:50']});a.send();await a.service.settled(a.chat.id);assert.equal(a.calls.length,0);assert.equal(a.service.poll(a.chat.id).error.code,'LANDING_ROOT_AMBIGUOUS');
});
test('model target echo and alias metadata cannot replace final independent native ownership',async t=>{
 const f=fixture(t);f.rootValues.push(input=>({state:'found',matches:['30:40'],root:{id:'30:40',type:input.type,pageId:input.pageId,parentId:input.parentId,owner:input.ownerNonce,chat:input.chatId}}),input=>({state:'found',matches:['30:40'],root:{id:'30:40',type:input.type,pageId:input.pageId,parentId:input.parentId,owner:'',chat:'',ownerNonce:input.ownerNonce,chatId:input.chatId}}));
 f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);assert.equal(c.error.code,'LANDING_TARGET_CHANGED');assert.equal(c.status,'interrupted');assert.equal(c.target.rootNodeId,'30:40');assert.equal(c.execution.rootReadRequired,true);
});
test('captured owner receipt alias confirms only the already verified exact target',async t=>{
 for(const canonical of [false,true]){
  const f=fixture(t);f.setResult('partial');
  f.setInspection(context=>({target:{rootNodeId:'30:40',pageId:context.target.pageId,parentNodeId:context.target.pageId,rootType:'SECTION',rootName:'Section',owner:context.target.ownerNonce,chat:context.target.chatId,...(canonical?{ownerNonce:context.target.ownerNonce}:{})},childCount:0,sets:[]}),true);
  f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);
  assert.equal(chat.error,null);assert.equal(chat.target.rootNodeId,'30:40');assert.equal(chat.target.ownerNonce,chat.execution.ownerNonce);
  assert.equal(chat.status,'interrupted');assert.equal(chat.execution.structureApproval,undefined);
 }
});
test('receipt owner aliases reject missing, conflicting or foreign identity without rebinding',async t=>{
 for(const change of [
  target=>{delete target.owner;},target=>{target.owner=null;},target=>{target.owner='foreign';},
  target=>{target.ownerNonce='foreign';},target=>{target.ownerNonce=null;},
  target=>{target.ownerNonce=target.owner;target.owner='foreign';},
  target=>{delete target.rootNodeId;},target=>{target.rootNodeId=null;},target=>{target.rootNodeId='30:50';},
  target=>{target.pageId='9:9';},target=>{delete target.parentNodeId;},target=>{target.parentNodeId='9:9';}
 ]){
  const f=fixture(t);f.setResult('partial');f.setInspection(context=>{const target={rootNodeId:'30:40',pageId:context.target.pageId,parentNodeId:context.target.pageId,owner:context.target.ownerNonce};change(target);return {target,childCount:0};},true);
  f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);
  assert.equal(chat.error.code,'LANDING_TARGET_CHANGED');assert.equal(chat.target.rootNodeId,'30:40');assert.equal(chat.execution.rootReadRequired,true);
 }
});
test('host failure is shown truthfully and supplied to resumed CLI; success clears it',async t=>{
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);
 f.setError(Object.assign(Error('process failed'),{code:'AGENT_MCP_STARTUP_TIMEOUT',diagnostic:JSON.stringify({mcpStartup:{server:'apollo_figma_mcp',timeoutMs:30000}})}));f.send('Continue');await f.service.settled(f.chat.id);let c=f.service.poll(f.chat.id);
 assert.equal(c.error.code,'AGENT_MCP_STARTUP_TIMEOUT');assert.equal(c.execution.lastFailure.origin,'mcp-startup');assert.equal(c.execution.lastFailure.operation,null);assert.match(c.messages.at(-1).text,/apollo_figma_mcp за 30 с/);assert(c.messages.at(-1).hostDiagnostic);
 f.setError(null);f.send('продолжай');await f.service.settled(c.id);c=f.service.poll(c.id);const context=JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1));
 assert.equal(context.hostFailure.code,'AGENT_MCP_STARTUP_TIMEOUT');assert.equal(context.hostFailure.mcpStartup.timeoutMs,30000);assert.match(f.calls.at(-1).prompt,/do not infer cancellation by incoming user messages/);assert.equal(c.execution.lastFailure,null);
});
test('direct CLI builds skeleton, pauses without canvas callbacks, then resumes the same session after explicit approval',async t=>{
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);let c=f.service.poll(f.chat.id);
 assert.equal(c.status,'needs-structure-approval');assert.equal(c.sources.length,1);assert.equal(c.execution.sessionId,'12345678-1234-1234-1234-123456789abc');assert.equal(c.target.rootNodeId,'30:40');assert.equal(f.calls[0].profile,'landing-direct');assert.equal(f.calls[0].sessionId,null);
 const a=c.execution.structureApproval;f.setResult('completed');const body={requestId:crypto.randomUUID(),revision:c.revision,approvalId:a.id,structureHash:a.structureHash,decision:'approve',text:''};
 f.service.structureDecision(c.id,body);await f.service.settled(c.id);c=f.service.poll(c.id);assert.equal(c.status,'completed');assert.equal(c.result.ready,false);assert.equal(f.calls[1].sessionId,'12345678-1234-1234-1234-123456789abc');assert.match(f.calls[1].prompt,/explicitly approved/);const resumed=JSON.parse(f.calls[1].prompt.split('\n').at(-1));assert.equal(resumed.skill,undefined);assert.equal(resumed.dialogue,undefined);
 assert.equal(f.service.structureDecision(c.id,body).status,'completed');assert.equal(f.calls.length,2);
});
test('continue is not structure approval; rejection waits for requested changes and requires a new approval',async t=>{
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);let c=f.service.poll(f.chat.id),a=c.execution.structureApproval;
 f.send('продолжай');assert.equal(f.calls.length,1);assert.equal(f.service.poll(c.id).status,'needs-structure-approval');
 f.service.structureDecision(c.id,{requestId:crypto.randomUUID(),revision:c.revision,approvalId:a.id,structureHash:a.structureHash,decision:'revise',text:''});assert.equal(f.service.poll(c.id).status,'needs-structure-changes');assert.equal(f.calls.length,1);
 f.send('Move FAQ after benefits');await f.service.settled(c.id);c=f.service.poll(c.id);assert.equal(c.status,'needs-structure-approval');assert.notEqual(c.execution.structureApproval.id,a.id);assert.equal(c.execution.structureApproved,false);
});

test('content sends full applicable rules and completes only against the final Figma readback',async t=>{
 const cases={
  complete:(inventory,proof)=>[inventory,{mutatedNodeIds:['50:1']},proof],
  splitReadback:(inventory,{contentReadback:{imageSlots,groups}})=>[
   inventory,{affectedIds:['50:1']},{contentReadback:{groups,imageSlots:[]}},{contentReadback:{imageSlots,groups:[]}},
  ],
  replacedSlot:(inventory,{contentReadback:{imageSlots,groups}})=>[
   inventory,{contentReadback:{groups,imageSlots:[{...imageSlots[0],variantKey:null}]}},{contentReadback:{imageSlots}},
  ],
  writeBetweenBatches:(inventory,{contentReadback:{imageSlots,groups}})=>[
   inventory,{contentReadback:{groups}},{affectedIds:['50:1']},{contentReadback:{imageSlots}},
  ],
  lateReadFromBeforeWrite:(inventory,proof)=>[inventory,{startAt:3},{affectedIds:['50:1']},proof],
  fakeEmptyInventory:({instances},proof)=>[
   {instances,illustrationSlots:[{id:'30:41'}]},{affectedIds:['50:1']},{instances,illustrationSlotIds:[],...proof},
  ],
  duplicateInOneBatch:(inventory,{contentReadback:{imageSlots,groups}})=>[
   inventory,{contentReadback:{groups,imageSlots:[imageSlots[0],imageSlots[0]]}},{contentReadback:{imageSlots}},
  ],
  draftOnly:inventory=>[inventory,{mutatedNodeIds:['50:1']}],
  stale:(inventory,proof)=>[inventory,proof,{mutatedNodeIds:['50:1']}],
  lateInventory:(inventory,proof)=>[{mutatedNodeIds:['50:1']},inventory,proof],
  violations:(inventory,proof)=>{
   const {imageSlots,groups}=proof.contentReadback;
   imageSlots[1].familyKey=imageSlots[0].familyKey;
   groups[0].cards[0].icon=null;
   groups[0].cards[1].height=160;
   groups[1].cards[1].height=95;
   return [inventory,proof];
  },
  hiddenIllustration:(inventory,proof)=>{
   proof.contentReadback.imageSlots.pop();
   return [inventory,proof];
  },
  partiallyRead:(inventory,proof)=>[inventory,proof],
  fullyRead:(inventory,proof)=>[inventory,proof],
  changedStructure:(inventory,proof)=>[{...inventory,instances:[]},{contentReadback:{imageSlots:proof.contentReadback.imageSlots,groups:[]}}],
 };
 for(const [name,events] of Object.entries(cases))await t.test(name,async t=>{
  const f=fixture(t),calls=[];
  const content='Content start. '+'Content instruction. '.repeat(650)+'Content end.';
  f.source.skill.bodies={...f.source.skill.bodies,'references/rules/content-and-assets.md':content};
  f.source.read=input=>{
   calls.push(input);
   return {text:'Full recipe: '+input.id,offset:0,next:null,sha256:'d'.repeat(64)};
  };
  const instances=[{id:'50:1',setName:'🔒 [D] Benefits'},{id:'51:1',setName:'🔒 [D] BentoGrid '}];
  const legacy=['partiallyRead','fullyRead'].includes(name);
  if(!legacy)f.figmaEvents.push({instances});
  f.send();await f.service.settled(f.chat.id);
  const before=f.service.poll(f.chat.id);
  assert.equal(before.status,'needs-structure-approval');
  assert.equal(Object.hasOwn(JSON.parse(f.calls[0].prompt.split('\n').at(-1)),'contentInputs'),false);
  assert.match(f.calls[0].prompt,/documented structural slots/);

  const icon={variantKey:'e'.repeat(40),expectedVariantKey:'e'.repeat(40),set:'glyph-26',size:24,expectedSize:24,gridVisible:false};
  const card={width:300,height:180,verticalSizing:'FILL',stopperSizing:'FILL',graphicBottom:240,graphicKind:'icon',icon};
  const inventory={instances,illustrationSlotIds:['30:41','30:42']};
  const proof={contentReadback:{
   imageSlots:[{id:'30:41',variantKey:'a'.repeat(40),familyKey:'b'.repeat(40),gridVisible:false},{id:'30:42',variantKey:'c'.repeat(40),familyKey:'d'.repeat(40),gridVisible:false}],
   groups:[
    {id:'50:1',family:'Benefits',capacity:3,cards:[{...card,id:'50:2',graphicId:'50:3'},{...card,id:'50:4',graphicId:'50:5',stopperSizing:'FIXED'},{...card,id:'50:6',graphicId:'50:7'}]},
    {id:'51:1',family:'BentoGrid',capacity:4,cards:[
     {id:'51:2',width:280,height:400,areaWidth:280,areaHeight:400,verticalSizing:'FILL'},
     {id:'51:3',width:280,height:180,areaWidth:280,areaHeight:180,verticalSizing:'FILL'},
     {id:'51:4',width:280,height:210,areaWidth:280,areaHeight:210,verticalSizing:'FILL'},
     {id:'51:5',width:280,height:400,areaWidth:280,areaHeight:400,verticalSizing:'FILL'},
    ]},
   ],
  }};
  if(legacy){
   const {contentInputs}=require('../src/landing/content-verification');
   const paths=Object.values(contentInputs(f.source).recipesByFamily).flat();
   for(const id of paths){
    const partial=id.endsWith('bento-grid/cookbook/04-compose-cards.md')&&name==='partiallyRead';
    f.knowledgeEvents.push({tool:'read_source',value:{sourcePin:'source-pin',mode:'read',path:[],id,sha256:'d'.repeat(64),offset:0,returned:partial?4:30,total:30,next:partial?4:null,text:partial?'Part':'Read complete'}});
   }
  }
  f.figmaEvents.splice(0,f.figmaEvents.length,...events(inventory,proof));
  f.setResult('completed');f.send('Да');await f.service.settled(f.chat.id);
  const after=f.service.poll(f.chat.id);
  const {contentInputs}=JSON.parse(f.calls[1].prompt.split('\n').at(-1));
  assert.equal(contentInputs.sources[0].text,content);
  if(!legacy){
   assert(contentInputs.sources.some(row=>row.id.includes('/benefits/cookbook/04-compose-cards.md')));
   assert(contentInputs.sources.some(row=>row.id.includes('/promo-card/cookbook/04-image-and-surface.md')));
  }
  assert(calls.filter(call=>call.limit===16000).every(call=>call.offset===undefined));
  assert.equal(after.target.rootNodeId,'30:40');
  const complete=['complete','fullyRead','splitReadback','replacedSlot'].includes(name);
  assert.equal(after.status,complete?'completed':'interrupted');
  if(complete)assert.deepEqual(after.result.checks.filter(row=>row.name!=='Границы SECTION').map(row=>row.status),['passed','passed','passed']);
  if(name==='violations')assert.deepEqual(after.result.checks.filter(row=>row.name!=='Границы SECTION').map(row=>row.status),['failed','failed','failed']);
  if(name==='hiddenIllustration')assert.match(after.result.checks[0].evidence,/30:42/);
  if(name==='partiallyRead')assert(after.result.checks.some(row=>row.status==='unknown'&&row.evidence.includes('04-compose-cards.md')));
  if(name==='changedStructure')assert.equal(after.result.checks[0].status,'unknown');
 });
});
test('content inventory survives a partial turn and process restart; missing old slots and changed structure stay visible',async t=>{
 for(const mode of ['complete','missing-slot','changed-structure','wrong-root'])await t.test(mode,async t=>{
  const f=fixture(t),instances=[{id:'51:1',setName:'[D] BentoGrid'}];
  f.source.skill.bodies['references/rules/content-and-assets.md']='Read actual content.';
  f.source.read=()=>({text:'Full applicable recipe',offset:0,next:null,sha256:'d'.repeat(64)});
  f.figmaEvents.push({instances});f.send();await f.service.settled(f.chat.id);
  f.figmaEvents.splice(0,f.figmaEvents.length,{instances,illustrationSlotIds:['30:41']},{mutatedNodeIds:['51:2']});
  f.setResult('partial');f.send('Да');await f.service.settled(f.chat.id);
  const before=f.service.poll(f.chat.id);assert.deepEqual(before.execution.contentInventory.slots,['30:41']);
  if(mode==='wrong-root'){
   const file=path.join(f.root,f.chat.id+'.json'),record=JSON.parse(fs.readFileSync(file));record.execution.contentInventory.rootNodeId='wrong:root';fs.writeFileSync(file,JSON.stringify(record));
  }
  const contentReadback={imageSlots:mode==='missing-slot'?[]:[{id:'30:41',variantKey:'a'.repeat(40),familyKey:'b'.repeat(40),gridVisible:false}],groups:[{id:'51:1',family:'BentoGrid',capacity:1,cards:[{id:'51:2',width:300,height:200,areaWidth:300,areaHeight:200,verticalSizing:'FILL'}]}]};
  f.figmaEvents.splice(0,f.figmaEvents.length,...(mode==='changed-structure'?[{instances:[]}]:[]),{contentReadback});
  f.setResult('completed');const resumed=createDirectLandingService(f.options);
  resumed.submit(f.chat.id,{requestId:crypto.randomUUID(),revision:before.revision,text:'Продолжи'});await resumed.settled(f.chat.id);
  const after=resumed.poll(f.chat.id),input=JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1));
  assert.equal(after.status,mode==='complete'?'completed':'interrupted');
  assert.deepEqual(input.contentInventory?.slots,mode==='wrong-root'?undefined:['30:41']);
  if(mode==='missing-slot')assert(after.result.checks.some(c=>c.evidence.includes('30:41')));
  if(mode==='changed-structure')assert(after.result.checks.some(c=>c.evidence.includes('повторно согласуй')));
  if(mode==='wrong-root')assert(after.result.checks.some(c=>c.details?.[0].code==='CONTENT_INVENTORY_REQUIRED'));
 });
});
test('Stop retains session/root; restart resumes with fresh-read instruction and duplicate message delivery is idempotent',async t=>{
 const f=fixture(t);f.setHold(true);const body={requestId:crypto.randomUUID(),revision:0,text:'Build'};f.service.submit(f.chat.id,body);while(!f.calls.length)await new Promise(r=>setImmediate(r));f.service.cancel(f.chat.id);await f.service.settled(f.chat.id);
 assert.equal(f.service.poll(f.chat.id).status,'interrupted');assert.equal(f.service.poll(f.chat.id).execution.sessionId,'12345678-1234-1234-1234-123456789abc');
 f.setHold(false);const resumed=createDirectLandingService(f.options);const c=resumed.poll(f.chat.id);const next={requestId:crypto.randomUUID(),revision:c.revision,text:'продолжай'};resumed.submit(c.id,next);await resumed.settled(c.id);assert.equal(f.calls[1].sessionId,c.execution.sessionId);assert.match(f.calls[1].prompt,/Read after uncertain outcomes/);assert.equal(resumed.submit(c.id,next).status,'needs-structure-approval');assert.equal(f.calls.length,2);
 assert.throws(()=>resumed.submit(c.id,{...next,text:'different request'}),{code:'LANDING_REQUEST_CONFLICT'});
});
test('host field diagnostics reach the resumed model; completion still requires a fresh actual readback',async t=>{
 const f=fixture(t),instances=[{id:'51:1',setName:'[D] BentoGrid'}];
 f.source.skill.bodies['references/rules/content-and-assets.md']='Read actual content.';
 f.source.read=()=>({text:'Full applicable recipe',offset:0,next:null,sha256:'d'.repeat(64)});
 f.figmaEvents.push({instances});f.send();await f.service.settled(f.chat.id);
 const proof={imageSlots:[],groups:[{id:'51:1',family:'BentoGrid',capacity:'1',cards:[{id:'51:2',width:300,height:200,areaWidth:300,areaHeight:200,verticalSizing:'FILL'}]}]};
 f.figmaEvents.splice(0,f.figmaEvents.length,{instances,illustrationSlotIds:[]},{contentReadback:proof});f.setResult('completed');f.send('Да');await f.service.settled(f.chat.id);
 assert.equal(f.service.poll(f.chat.id).status,'interrupted');
 f.figmaEvents.splice(0);f.send('Заверши проверку');await f.service.settled(f.chat.id);
 const feedback=JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1)).contentValidation;
 assert.equal(feedback[0].details[0].path,'contentReadback.groups[0].capacity');assert.match(feedback[0].details[0].expected,/JSON-число/);
 assert.equal(f.service.poll(f.chat.id).status,'interrupted');
 proof.groups[0].capacity=1;f.figmaEvents.push({contentReadback:proof});f.send('Исправил формат и перечитал');await f.service.settled(f.chat.id);
 assert.equal(f.service.poll(f.chat.id).status,'completed');
 assert(f.service.poll(f.chat.id).execution.contentValidationChecks.every(c=>c.status==='passed'));
});
test('old chats stay byte-identical and read-only; legacy callback routes return410',t=>{
 const f=fixture(t),id=crypto.randomUUID(),filename=path.join(f.root,id+'.json');const raw=JSON.stringify({schemaVersion:'apollo.landing-chat.v1',id,revision:2,sequence:4,status:'awaiting-native',context:{},messages:[{role:'user',text:'Old'}],updatedAt:'2026-11-06T00:00:00Z'});fs.writeFileSync(filename,raw);
 assert.equal(f.service.poll(id).historical,true);assert.throws(()=>f.service.submit(id,{requestId:crypto.randomUUID(),revision:2,text:'continue'}),{code:'LANDING_LEGACY_FLOW_RETIRED'});assert.equal(fs.readFileSync(filename,'utf8'),raw);
 const routes=new Map(),app={get:(url,fn)=>routes.set('GET '+url,fn),post:(url,fn)=>routes.set('POST '+url,fn)};mountDirectLandingRoutes(app,{loadService:()=>f.service,status:()=>({available:true})});
 for(const name of ['canvas','native','observation','failure']){let response,code;routes.get('POST /landing/chats/:id/'+name)({}, {status:v=>{code=v;return {json:v=>response=v};}});assert.equal(code,410);assert.equal(response.code,'LANDING_LEGACY_FLOW_RETIRED');}
});
test('history returns a bounded latest message preview without exposing progress or changing stored chats',t=>{
 const f=fixture(t),pastId=crypto.randomUUID(),file=path.join(f.root,pastId+'.json');
 const old={schemaVersion:'apollo.landing-chat.v1',id:pastId,revision:3,sequence:5,status:'awaiting-native',updatedAt:'2026-11-06T00:00:00Z',messages:[
  {role:'user',text:'Initial brief'},
  {role:'assistant',text:'Final\n answer '+ '🙂'.repeat(180)},
  {role:'assistant',text:'Transient progress',progress:true},
  {id:'progress:prior',role:'assistant',text:'Historical transient progress'},
  {role:'assistant',text:'Internal diagnostic',hostDiagnostic:true},
  {role:'user',text:'  '},
 ]};
 const bytes=JSON.stringify(old);fs.writeFileSync(file,bytes);
 const emptyId=f.chat.id,currentFile=path.join(f.root,emptyId+'.json');
 const currentBytes=fs.readFileSync(currentFile);
 const current={...JSON.parse(currentBytes),messages:[{role:'user',text:'Latest user message'}]};
 fs.writeFileSync(currentFile,JSON.stringify(current));
 const rows=createDirectLandingService(f.options).list();
 assert.equal(rows[0].id,emptyId);
 assert.equal(rows[0].lastMessagePreview,'Latest user message');
 const entry=rows.find(item=>item.id===pastId);
 assert.equal(entry.title,'Initial brief');
 assert.equal(entry.updatedAt,old.updatedAt);
 assert.equal(entry.lastMessagePreview,'Final answer '+'🙂'.repeat(147));
 assert.deepEqual(Object.keys(entry).sort(),['id','lastMessagePreview','status','title','updatedAt']);
 assert.equal(fs.readFileSync(file,'utf8'),bytes);
 fs.writeFileSync(currentFile,currentBytes);
 const empty=createDirectLandingService(f.options).list().find(item=>item.id===emptyId);
 assert.equal(Object.hasOwn(empty,'lastMessagePreview'),false);
 assert.equal(f.calls.length,0);
});
test('data drift and potentially alive prior CLI refuse before a new model run',async t=>{
 const f=fixture(t);f.setStale();assert.throws(()=>f.send(),{code:'LANDING_DATA_STALE'});assert.equal(f.calls.length,0);
 const g=fixture(t),c=g.service.poll(g.chat.id);c.execution.processPid=123;fs.writeFileSync(path.join(g.root,c.id+'.json'),JSON.stringify(c));
 const recovered=createDirectLandingService({...g.options,isProcessAlive:()=>true});assert.throws(()=>recovered.submit(c.id,{requestId:crypto.randomUUID(),revision:c.revision,text:'continue'}),{code:'LANDING_PREVIOUS_RUN_ACTIVE'});assert.equal(g.calls.length,0);
});
test('a premature completed reply never bypasses the structure approval gate',async t=>{
 const f=fixture(t);f.setResult('completed');f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);assert.equal(c.status,'interrupted');assert.equal(c.error.code,'LANDING_STRUCTURE_APPROVAL_REQUIRED');assert.equal(c.result.ready,false);
});

test('deleting history preserves the old record in its archive and never invokes generation',t=>{
 const f=fixture(t),id=crypto.randomUUID(),file=path.join(f.root,id+'.json'),old={schemaVersion:'apollo.landing-chat.v1',id,revision:3,sequence:1,status:'awaiting-native',messages:[],updatedAt:'2026-11-06T00:00:00Z'};const bytes=JSON.stringify(old);fs.writeFileSync(file,bytes);assert.deepEqual(f.service.remove(id,{revision:3}),{id,deleted:true});assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(file.replace('.json','.deleted.json'),'utf8'),bytes);assert.equal(f.calls.length,0);assert.throws(()=>f.service.poll(id),{code:'LANDING_CHAT_NOT_FOUND'});
});

test('Figma auth and unverified connection preserve chat, target and session with a concrete recovery action',async t=>{
 for(const code of ['AGENT_MCP_AUTH_REQUIRED','AGENT_MCP_CONNECTION_UNVERIFIED']){
  const f=fixture(t);f.send();await f.service.settled(f.chat.id);const before=f.service.poll(f.chat.id);f.setError(Object.assign(Error('original failure'),{code,diagnostic:'saved original diagnostic'}));f.send('Continue');await f.service.settled(f.chat.id);const after=f.service.poll(f.chat.id);
  assert.equal(after.status,'interrupted');assert.equal(after.error.code,code);assert.equal(after.error.diagnostic,'saved original diagnostic');assert.equal(after.failures.at(-1).diagnostic,'saved original diagnostic');assert.deepEqual(after.target,before.target);assert.equal(after.execution.sessionId,before.execution.sessionId);assert(after.messages.length>before.messages.length);assert.match(after.message,/О прокси/);
  assert.match(after.message,code==='AGENT_MCP_AUTH_REQUIRED'?/Подключить Figma/:/Проверить подключение/);
  f.setError(null);f.send('Continue after connecting');await f.service.settled(f.chat.id);assert.equal(JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1)).hostFailure.code,code);
 }
});

const factProfile={schemaVersion:'apollo.recipe-verification.v1',rules:[{id:'measured-tree',label:'Фактическое дерево',source:'knowledge/data/ds-ai-hub/recipe.md',stages:['structure','content'],scope:[{relation:'self',match:{}}],minScopes:1,assertions:[{id:'width',label:'Ширина',op:'value',field:'width',equals:1140,targets:[{relation:'self',match:{}}]},{id:'color',label:'Привязки',op:'same',field:'binding:fills',targets:[{relation:'children',match:{}}]}]}]};
function factFixture(t, repairStructure=false){
 const f=fixture(t,factProfile,repairStructure),operations=[];let width=1140,color='color-a',missing=false;
 const original=f.options.rootLifecycle.inspect;
 f.options.rootLifecycle.inspect=async(input,options)=>{
  operations.push({fit:!!options.fit,observe:!!options.observe});const value=await original(input,options);
  if(options.observe&&!missing)value.root.observation={schemaVersion:'apollo.recipe-observation.v1',rootId:'30:40',complete:true,nodes:[{id:'30:40',parentId:input.parentId,type:input.type,name:'Root',visible:true,facts:{width}},...['a','b'].map(id=>({id,parentId:'30:40',type:'FRAME',name:id,visible:true,facts:{},bindings:{fills:color}}))]};
  return value;
 };
 return {...f,operations,setWidth:v=>width=v,setColor:v=>color=v,setMissing:v=>missing=v};
}
test('a concrete structural failure repairs the same revision once and checks the result independently',async t=>{
 for(const repaired of [true,false]) await t.test(repaired?'successful':'still fails',async t=>{
  const f=factFixture(t,true);
  f.setWidth(800);
  f.setInspection(()=>{
   if(repaired&&f.calls.length===2)f.setWidth(1140);
   return {};
  });
  f.send('Собери каркас');
  await f.service.settled(f.chat.id);
  const chat=f.service.poll(f.chat.id), first=f.calls[0], repair=f.calls[1];
  assert.equal(f.calls.length,2);
  assert.equal(f.operations.filter(operation=>operation.observe).length,2);
  assert.equal(chat.revision,1);
  assert.equal(chat.messages.filter(message=>message.role==='user').length,1);
  assert.deepEqual(chat.execution.automaticRepair,{revision:1,failedChecks:1});
  assert.equal(repair.sessionId,chat.execution.sessionId);
  assert.equal(repair.diagnosticContext.requestId,first.diagnosticContext.requestId);
  assert.notEqual(repair.diagnosticContext.runId,first.diagnosticContext.runId);
  const repairContext=JSON.parse(repair.prompt.split('\n').at(-1));
  assert.equal(repairContext.recipeValidation.revision,1);
  assert.equal(repairContext.recipeValidation.checks[0].status,'failed');
  assert.equal(repairContext.target.rootNodeId,chat.target.rootNodeId);
  assert.equal(chat.execution.recipeValidation.passed,repaired);
  assert.equal(chat.execution.structureApproved,false);
  assert.equal(chat.status,repaired?'needs-structure-approval':'interrupted');
 });
});
test('a question or an unknown host check prevents automatic edits',async t=>{
 for(const status of ['needs-input','needs-structure-approval']){
  const f=factFixture(t,true);
  f.setResult(status);
  f.setWidth(800);
  if(status==='needs-structure-approval')f.setMissing(true);
  f.send();
  await f.service.settled(f.chat.id);
  assert.equal(f.calls.length,1);
  assert.equal(f.service.poll(f.chat.id).status,status==='needs-input'?status:'interrupted');
 }
});
test('an agent draft with a concrete independent failure also gets a single repair',async t=>{
 const f=factFixture(t,true);
 f.setResult('partial');
 f.setWidth(800);
 f.setInspection(()=>{
  if (f.calls.length===2) f.setWidth(1140);
  return {};
 });
 f.send();
 await f.service.settled(f.chat.id);
 const chat=f.service.poll(f.chat.id);
 assert.equal(f.calls.length,2);
 assert.equal(chat.execution.recipeValidation.passed,true);
 assert.equal(chat.status,'interrupted');
 assert.equal(chat.execution.structureApproval,undefined);
});
test('partial recolor refreshes r2 facts without fitting or offering approval, including affectedIds receipts',async t=>{
 const f=factFixture(t);f.setResult('partial');f.setWidth(800);f.send();await f.service.settled(f.chat.id);
 const old=f.service.poll(f.chat.id);assert.equal(old.execution.recipeValidation.revision,1);assert.equal(old.result.verification,'host-blocked');
 f.setWidth(1140);f.setColor('promo-pearl-variable');f.setMessage('Перекрасил КИБ в ММБ. Согласование ещё не завершено.');f.figmaEvents.push({affectedIds:['a','b']});
 f.send('А теперь смени сегмент на ММБ');await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id),checked=chat.execution.recipeValidation;
 assert.equal(checked.revision,2);assert.equal(checked.rootId,'30:40');assert.equal(checked.sourcePin,'source-pin');assert.equal(checked.stage,'structure');assert.equal(checked.profileHash,chat.execution.verification.profileHash);
 assert.notEqual(checked.snapshotHash,old.execution.recipeValidation.snapshotHash);assert.equal(checked.passed,true);
 assert.equal(chat.status,'interrupted');assert.equal(chat.execution.structureApproved,false);assert.equal(chat.execution.structureApproval,undefined);assert.equal(chat.result.ready,false);assert.equal(chat.result.verification,'host-verified-recipe');
 assert.equal(chat.message,'Перекрасил КИБ в ММБ. Согласование ещё не завершено.');assert.equal(chat.messages.at(-1).text,chat.message);assert.equal(chat.execution.checkpoint,'Existing frame and next action');
 assert.equal(f.operations.filter(x=>x.observe).length,2);assert(!f.operations.some(x=>x.fit));
});
test('partial after an unaccepted approval records current failed/unknown facts and preserves the model explanation',async t=>{
 for(const mode of ['failed','unknown','read-error'])await t.test(mode,async t=>{
  const f=factFixture(t);f.send();await f.service.settled(f.chat.id);const before=f.service.poll(f.chat.id);
  f.setResult('partial');f.setMessage('Цвет изменён; остаются точные замечания.');
  if(mode==='failed')f.setWidth(800);
  if(mode==='unknown')f.setMissing(true);
  if(mode==='read-error'){const inspect=f.options.rootLifecycle.inspect;f.options.rootLifecycle.inspect=async(i,o)=>{if(o.observe)throw Object.assign(Error('timeout'),{code:'LANDING_ROOT_MCP_TIMEOUT'});return inspect(i,o);};}
  f.send('Измени сегмент на ММБ');await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);
  assert.equal(chat.status,'interrupted');assert.equal(chat.execution.structureApproved,false);assert.equal(chat.execution.structureApproval.status,'rejected');assert.equal(chat.result.revision,2);assert.equal(chat.result.ready,false);
  assert(chat.messages.some(m=>m.text==='Цвет изменён; остаются точные замечания.'));assert.equal(chat.execution.checkpoint,'Existing frame and next action');
  if(mode==='read-error'){assert.equal(chat.result.verification,'host-unavailable');assert.equal(chat.execution.recipeValidation.revision,before.execution.recipeValidation.revision);assert.equal(chat.error.code,'LANDING_ROOT_MCP_TIMEOUT');}
  else{assert.equal(chat.execution.recipeValidation.revision,2);assert.equal(chat.result.verification,'host-blocked');assert(chat.result.checks.some(c=>c.status===mode));assert.equal(chat.message,'Цвет изменён; остаются точные замечания.');}
 });
});
test('a partial awaiting independently confirmed recipe facts only can offer user approval',async t=>{
 for(const mode of ['verified','wrong-scope','independent-unknown','open-issue','needs-input'])await t.test(mode,async t=>{
  const f=factFixture(t);
  f.setResult(mode==='needs-input'?'needs-input':'partial');
  f.setCheckpoint('await-host-recipe-verification');
  f.setChecks([{name:'Await a host reading',status:'unknown',evidence:JSON.stringify({
   ruleId:'measured-tree',assertionId:'width',scope:mode==='wrong-scope'?'40:90':'30:40',
  })}]);
  if(mode==='independent-unknown')f.setMissing(true);
  if(mode==='open-issue')f.setIssues(['User decision still required']);
  f.send();
  await f.service.settled(f.chat.id);
  const chat=f.service.poll(f.chat.id);
  assert.equal(chat.execution.structureApproved,false);
  assert.equal(f.calls.length,1);
  if(mode==='verified'){
   assert.equal(chat.status,'needs-structure-approval');
   assert.equal(chat.execution.structureApproval.status,'pending');
   assert.match(chat.message,/node-id=30%3A40/);
   assert.deepEqual(f.operations.slice(-2),[{fit:true,observe:false},{fit:false,observe:true}]);
  }else{
   assert.equal(chat.status,mode==='needs-input'?'needs-input':'interrupted');
   assert.equal(chat.execution.structureApproval,undefined);
  }
 });
});
test('ordinary partial, needs-input and incomplete or empty roots keep their pause',async t=>{
 for(const mode of ['needs-input','empty','incomplete']){
  const f=factFixture(t);f.setResult(mode==='needs-input'?mode:'partial');
  if(mode!=='needs-input'){
   const inspect=f.options.rootLifecycle.inspect;f.options.rootLifecycle.inspect=async(i,o)=>{const v=await inspect(i,o);if(mode==='empty')v.root.children=[];else v.root.childrenComplete=false;return v;};
  }
  f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);
  assert.equal(chat.status,mode==='needs-input'?'needs-input':'interrupted');assert.equal(chat.execution.recipeValidation,undefined);assert.equal(chat.execution.structureApproval,undefined);assert(!f.operations.some(o=>o.observe||o.fit));
 }
});
test('cancelling a partial observation cannot save a late successful verification',async t=>{
 const f=factFixture(t),inspect=f.options.rootLifecycle.inspect;f.setResult('partial');
 f.options.rootLifecycle.inspect=async(i,o)=>{const v=await inspect(i,o);if(o.observe)f.service.cancel(f.chat.id);return v;};
 f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);
 assert.equal(chat.status,'interrupted');assert.equal(chat.error.code,'AGENT_CANCELLED');assert.equal(chat.execution.recipeValidation,undefined);assert.equal(chat.execution.structureApproval,undefined);assert.equal(chat.result.ready,false);
});
test('new declared gates reject empty or forged model checks and require a host read after fit',async t=>{
 for(const checks of [[],[{name:'Everything passed',status:'passed',evidence:'Trust the model'}]]){
  const f=factFixture(t);f.setWidth(800);f.setChecks(checks);f.send();await f.service.settled(f.chat.id);let chat=f.service.poll(f.chat.id);
  assert.equal(chat.status,'interrupted');assert.equal(chat.execution.structureApproval,undefined);assert.equal(chat.result.verification,'host-blocked');assert(chat.result.checks.some(c=>c.status==='failed'));
  assert.deepEqual(f.operations.slice(-2),[{fit:true,observe:false},{fit:false,observe:true}]);
  f.setWidth(1140);f.send('Исправь ширину');await f.service.settled(f.chat.id);chat=f.service.poll(f.chat.id);
  assert.equal(chat.status,'needs-structure-approval');assert.equal(chat.result.verification,'host-verified-recipe');assert.equal(chat.execution.recipeValidation.sourcePin,'source-pin');assert.equal(chat.execution.recipeValidation.revision,2);
  assert(JSON.parse(f.calls.at(-1).prompt.split('\n').at(-1)).recipeValidation.checks.some(c=>c.status==='failed'));
 }
});
test('unknown host facts cannot offer approval, and a saved new chat retains its gate',async t=>{
 const f=factFixture(t);f.setMissing(true);f.send();await f.service.settled(f.chat.id);
 const stored=f.service.poll(f.chat.id);assert.equal(stored.status,'interrupted');assert.equal(stored.result.checks[0].status,'unknown');
 const resumed=createDirectLandingService(f.options);resumed.submit(f.chat.id,{requestId:crypto.randomUUID(),revision:stored.revision,text:'Повторно проверь'});await resumed.settled(f.chat.id);
 assert.equal(resumed.poll(f.chat.id).execution.verification.profileHash,stored.execution.verification.profileHash);assert.equal(resumed.poll(f.chat.id).status,'interrupted');
});
test('same-root recolor after offered approval forces reapproval before the next model or write',async t=>{
 const f=factFixture(t);f.send();await f.service.settled(f.chat.id);const before=f.service.poll(f.chat.id);assert.equal(before.status,'needs-structure-approval');
 f.setColor('color-b');f.setResult('completed');f.service.structureDecision(f.chat.id,{requestId:crypto.randomUUID(),revision:before.revision,approvalId:before.execution.structureApproval.id,structureHash:before.execution.structureApproval.structureHash,decision:'approve'});await f.service.settled(f.chat.id);
 const after=f.service.poll(f.chat.id);assert.equal(f.calls.length,1);assert.equal(after.status,'interrupted');assert.equal(after.execution.structureApproved,false);assert.equal(after.target.rootNodeId,before.target.rootNodeId);assert.match(after.message,/согласуй каркас заново/);
});
test('unchanged host-verified structure proceeds to content and independently verifies completion',async t=>{
 const f=factFixture(t);f.send();await f.service.settled(f.chat.id);f.setResult('completed');f.send('Да');await f.service.settled(f.chat.id);
 const chat=f.service.poll(f.chat.id);assert.equal(chat.status,'completed');assert.equal(chat.execution.recipeValidation.stage,'content');assert.equal(chat.result.verification,'host-verified-recipe');assert.equal(f.calls.length,2);
});
test('authorized partial content changes resume without comparing them to the old skeleton snapshot',async t=>{
 const f=factFixture(t);f.send();await f.service.settled(f.chat.id);
 f.setResult('partial');f.send('Да');await f.service.settled(f.chat.id);
 assert.equal(f.service.poll(f.chat.id).execution.structureApproved,true);assert.equal(f.service.poll(f.chat.id).execution.approvalReadRequired,false);
 // This is the permitted content write from the partial turn, not an edit
 // between offering and accepting the structure approval.
 f.setColor('new-authorized-content-color');f.setResult('completed');f.send('Продолжи наполнение');await f.service.settled(f.chat.id);
 const chat=f.service.poll(f.chat.id);assert.equal(f.calls.length,3);assert.equal(chat.status,'completed');assert.equal(chat.execution.structureApproved,true);
});
test('content starts only from approval and the current independent slot inventory',async t=>{
 const verification=structuredClone(factProfile);
 verification.rules.push({id:'content-inventory',label:'Inventory',source:'recipe.md',stages:['structure','content'],scope:[{relation:'self',match:{}}],minScopes:1,assertions:[
  {id:'sections.blocks',label:'Blocks',op:'count',min:1,targets:[{relation:'children',match:{type:'FRAME'}}]},
  {id:'slots.images',label:'Slots',op:'count',min:0,targets:[{relation:'descendants',match:{name:'Slot',visible:true}}]},
 ]});
 for(const scenario of ['changed before approval','changed after partial','same slots with new content','changed during final write','incomplete slot observation'])await t.test(scenario,async t=>{
  const f=fixture(t,verification),inspect=f.options.rootLifecycle.inspect;
  let slot='slot:1',text='placeholder',complete=true;
  f.options.rootLifecycle.inspect=async(input,options)=>{
   const result=await inspect(input,options);
   if(options.observe)result.root.observation={schemaVersion:'apollo.recipe-observation.v1',rootId:'30:40',complete,nodes:[
    {id:'30:40',parentId:input.parentId,type:input.type,facts:{width:1140}},
    {id:'30:41',parentId:'30:40',type:'FRAME',bindings:{fills:'gray'}},
    {id:slot,parentId:'30:41',type:'INSTANCE',name:'Slot',visible:true},
    {id:'30:42',parentId:'30:41',type:'TEXT',text},
   ]};
   return result;
  };
  f.send();await f.service.settled(f.chat.id);
  const before=f.service.poll(f.chat.id);
  assert.equal(before.status,'needs-structure-approval');
  f.send('Заполни контентом');await f.service.settled(f.chat.id);
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.service.poll(f.chat.id).execution.structureApproval,before.execution.structureApproval);
  if(scenario==='changed before approval')slot='slot:2';
  if(scenario==='incomplete slot observation')complete=false;
  f.setResult('partial');f.send('Да');await f.service.settled(f.chat.id);
  if(scenario==='changed before approval'||scenario==='incomplete slot observation'){
   assert.equal(f.calls.length,1);
   assert.equal(f.service.poll(f.chat.id).execution.structureApproval.status,'stale');
   return;
  }
  const content=JSON.parse(f.calls[1].prompt.split('\n').at(-1));
  assert.deepEqual(content.contentInventory.slots,['slot:1']);
  assert.deepEqual(content.contentInventory.sections,{blocks:['30:41']});
  assert.equal(content.contentInventory.approvalHash,before.execution.structureApproval.structureHash);
  text='final text';
  if(scenario==='changed after partial')slot='slot:2';
  if(scenario==='changed during final write'){
   const createCli=f.options.createCli;
   // Change after preflight, while the content agent is running.
   const service=createDirectLandingService({...f.options,createCli(...args){slot='slot:2';return createCli(...args);}});
   f.setResult('completed');service.submit(f.chat.id,{requestId:crypto.randomUUID(),revision:service.poll(f.chat.id).revision,text:'Продолжи наполнение'});await service.settled(f.chat.id);
   assert.equal(f.calls.length,3);
   assert.equal(service.poll(f.chat.id).execution.structureApproval.status,'stale');
   assert.equal(service.poll(f.chat.id).status,'interrupted');
   return;
  }
  f.setResult('completed');f.send('Продолжи наполнение');await f.service.settled(f.chat.id);
  const after=f.service.poll(f.chat.id);
  if(scenario==='changed after partial'){
   assert.equal(f.calls.length,2);
   assert.equal(after.execution.structureApproval.status,'stale');
  }else{
   assert.equal(f.calls.length,3);
   assert.equal(after.status,'completed');
  }
 });
});
test('gated agent readiness waits for host observation; transport failure has no false recipe result',async t=>{
 for(const fails of [true,false])await t.test(fails?'transport failure':'verified result',async t=>{
  const f=factFixture(t),factory=f.options.createCli,inspect=f.options.rootLifecycle.inspect;let release,entered;
  const observing=new Promise(resolve=>entered=resolve);
  f.options.createCli=(...args)=>{const cli=factory(...args);return {async run(input){input.onEvent({type:'item.completed',item:{type:'agent_message',text:'Каркас уже готов SECRET_READY'}});return cli.run(input);}};};
  f.options.rootLifecycle.inspect=async(input,options)=>{
   if(options.observe){assert.deepEqual(options.capture,{nativeFields:[],propertyNames:[],bindingFields:['fills'],variableFields:[],resolvedFields:[],nativeTargets:[]});entered();await new Promise(resolve=>release=resolve);if(fails)throw Object.assign(Error('LANDING_ROOT_MCP_TIMEOUT'),{code:'LANDING_ROOT_MCP_TIMEOUT',diagnostic:JSON.stringify({layer:'json-rpc',kind:'timeout',rpcCode:-32603})});}
   return inspect(input,options);
  };
  const service=createDirectLandingService(f.options);service.submit(f.chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Build'});await observing;
  const pending=service.poll(f.chat.id);assert.equal(pending.status,'running');assert.match(pending.message,/Проверяем фактический макет/);assert(!JSON.stringify(pending.messages).includes('SECRET_READY'));assert.equal(pending.execution.structureApproval,undefined);
  release();await service.settled(f.chat.id);const result=service.poll(f.chat.id);assert(!JSON.stringify(result.messages).includes('SECRET_READY'));
  if(fails){assert.equal(result.status,'interrupted');assert.equal(result.execution.lastFailure.operation.phase,'observe');assert.equal(result.result.verification,'host-unavailable');assert.deepEqual(result.result.checks,[]);assert.equal(JSON.parse(result.error.diagnostic).kind,'timeout');assert.equal(result.execution.structureApproval,undefined);}
  else{assert.equal(result.status,'needs-structure-approval');assert.equal(result.result.verification,'host-verified-recipe');}
 });
});
test('old interrupted progress is hidden without rewriting saved history',t=>{
 const f=factFixture(t),file=path.join(f.root,f.chat.id+'.json'),record=JSON.parse(fs.readFileSync(file));record.status='interrupted';record.messages.push({id:'progress:old',role:'assistant',text:'Каркас готов',progress:true});
 fs.writeFileSync(file,JSON.stringify(record));const before=fs.readFileSync(file),service=createDirectLandingService(f.options);assert(!service.poll(record.id).messages.some(m=>m.progress));assert.deepEqual(fs.readFileSync(file),before);
});


const clarification={text:'Показывать текст согласия под формой?',options:[{label:'Показывать',description:'Оставить текст согласия под формой.'},{label:'Скрыть',description:'Убрать текст согласия.'}]};
test('structured clarification persists, has readable legacy fallback and resumes as an ordinary answer',async t=>{
 const f=fixture(t);f.setResult('needs-input');f.setMessage('Макет собран.');f.setQuestion(clarification);f.send();await f.service.settled(f.chat.id);
 const chat=f.service.poll(f.chat.id),answer=chat.messages.at(-1);assert.equal(chat.status,'needs-input');assert.deepEqual(answer.question,{...clarification,context:'Макет собран.'});assert.match(answer.text,/Макет собран\./);assert(answer.text.includes(clarification.text));for(const option of clarification.options)assert(answer.text.includes(option.label+' — '+option.description));assert.equal(chat.message,answer.text);assert.equal(chat.execution.structureApproved,false);
 assert.equal(f.calls[0].schema.required.includes('question'),true);assert.deepEqual(f.calls[0].schema.properties.question.type,['object','null']);assert.match(f.calls[0].prompt,/For a clarification with 2–4 meaningful choices/);
 const reloaded=createDirectLandingService(f.options);assert.deepEqual(reloaded.poll(chat.id).messages.at(-1).question,answer.question);
 f.setQuestion(null);const text=clarification.text+'\nОтвет: Скрыть — Убрать текст согласия.';const body={requestId:crypto.randomUUID(),revision:chat.revision,text};reloaded.submit(chat.id,body);await reloaded.settled(chat.id);const next=reloaded.poll(chat.id);assert.equal(next.messages.findLast(m=>m.role==='user').text,text);assert.equal(next.messages.at(-1).question,undefined);assert.equal(next.execution.structureApproved,false);assert.equal(JSON.parse(f.calls[1].prompt.split('\n').at(-1)).userMessage,text);assert.match(f.calls[1].prompt,/For a clarification with 2–4 meaningful choices/);
 const calls=f.calls.length;reloaded.submit(chat.id,body);assert.equal(f.calls.length,calls,'same request is not replayed');assert.throws(()=>reloaded.submit(chat.id,{...body,requestId:crypto.randomUUID()}),{code:'LANDING_REVISION_STALE'});
});
test('legacy missing question and explicit null stay compatible without changing ordinary output',async t=>{
 for(const question of [undefined,null]){const f=fixture(t);f.setQuestion(question);f.setResult('needs-input');f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);assert.equal(chat.status,'needs-input');assert.equal(chat.messages.at(-1).question,undefined);assert.equal(chat.messages.at(-1).text,'Actual fixture checkpoint');}
});
test('malformed or misplaced choice payload cannot become an actionable question',async t=>{
 const variants=[{},[],{...clarification,context:'untrusted'},{...clarification,text:''},{...clarification,text:'x'.repeat(1001)},{...clarification,options:clarification.options.slice(0,1)},{...clarification,options:Array(5).fill(clarification.options[0])},{...clarification,options:[clarification.options[0],clarification.options[0]]},{...clarification,options:[{label:' ',description:''},clarification.options[1]]},{...clarification,options:[{label:'a',description:42},clarification.options[1]]},{...clarification,options:[{label:'a',description:'',extra:true},clarification.options[1]]},false,'question'];
 for(const question of variants){const f=fixture(t);f.setResult('needs-input');f.setQuestion(question);f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);assert.equal(chat.error.code,'LANDING_RESPONSE_INVALID');assert.equal(chat.messages.some(m=>m.question),false);assert.equal(chat.execution.structureApproved,false);}
 for(const status of ['needs-structure-approval','completed','partial']){const f=fixture(t);f.setResult(status);f.setQuestion(clarification);f.send();await f.service.settled(f.chat.id);const chat=f.service.poll(f.chat.id);assert.equal(chat.error.code,'LANDING_RESPONSE_INVALID');assert.equal(chat.messages.some(m=>m.question),false);}
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {FLOW,createDirectLandingService,mountDirectLandingRoutes}=require('../src/landing/direct-service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'direct-landing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let result='needs-structure-approval',held=null,hold=false,stale=false,inspection=null,onlyInspection=false,runError=null;const calls=[];
 const source={id:'data',resumePin:'source-pin',knowledgeVersion:'hub-v1',skill:{id:'ab-generate-custom-landing',name:'Landing',version:'0.6.0',sha256:'a'.repeat(64),generation:{workflow:FLOW}},initial:{selectedSkill:{id:'ab-generate-custom-landing'},instructions:{'SKILL.md':'Use Hub.'}},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});}};
 const options={root,knowledge:()=>source,isProcessAlive:()=>false,createCli:()=>({async run(input){
  calls.push(input);const context=JSON.parse(input.prompt.split('\n').at(-1));
  if(runError)throw runError;
  input.onEvent({type:'thread.started',thread_id:'12345678-1234-1234-1234-123456789abc'});input.onEvent({type:'process.started',pid:999999});
  if(hold)await new Promise(resolve=>{held=resolve;input.signal.addEventListener('abort',resolve,{once:true});});
  if(input.signal.aborted)throw Object.assign(Error('Stopped'),{code:'AGENT_CANCELLED'});
  input.onEvent({type:'item.completed',item:{id:'source:1',type:'mcp_tool_call',server:'apollo_knowledge',tool:'read_source',status:'completed',result:{content:[{type:'text',text:JSON.stringify({id:'knowledge/data/ds-ai-hub/products/ab/patterns/landing-pages.md',sha256:'b'.repeat(64),path:[],offset:0,mode:'read',text:'Rule.',sourcePin:'source-pin'})}]}}});
  if(inspection)input.onEvent({type:'item.completed',item:{id:'inspect:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify(inspection(context))}]}}});
  const hasRoot=result!=='needs-input'&&!onlyInspection;if(hasRoot)input.onEvent({type:'item.completed',item:{id:'figma:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify({target:{rootNodeId:'30:40',pageId:context.target.pageId,parentNodeId:context.target.placement.sectionId||context.target.pageId,ownerNonce:context.target.ownerNonce}})}]}}});
  return {result:{status:result,message:'Actual fixture checkpoint',rootNodeId:hasRoot?'30:40':null,checkpoint:'Existing frame and next action',checks:[],issues:[]},receipt:{usage:{actualInputTokens:10,actualOutputTokens:5}}};
 }})};
 const service=createDirectLandingService(options),chat=service.create({id:crypto.randomUUID(),fileKey:'FigmaTestFile',pageId:'1:2',placement:{mode:'new-section',sectionId:null}});
 const send=(text='Build a landing')=>service.submit(chat.id,{requestId:crypto.randomUUID(),revision:service.poll(chat.id).revision,text});
 return {root,service,chat,calls,options,source,send,setResult:value=>result=value,setHold:value=>hold=value,release:()=>held?.(),setStale:()=>stale=true,setInspection:(value,only=false)=>{inspection=value;onlyInspection=only;},setError:value=>runError=value};
}
const absent=context=>({target:{rootNodeId:null,pageId:context.target.pageId,parentNodeId:context.target.placement.sectionId||context.target.pageId,ownerNonce:context.target.ownerNonce},ownedCount:0,matches:[]});
test('initial CLI prompt omits the source plan and resume retains phase planning and usage correlation',async t=>{
 const f=fixture(t),plans=[];f.source.plan=input=>{plans.push(input);return {sourcePin:'source-pin',phase:input.phase,required:[{id:'rule'}],candidates:[],gaps:[]};};
 f.send('Build a landing');await f.service.settled(f.chat.id);
 const initial=JSON.parse(f.calls[0].prompt.split('\n').at(-1));
 assert.equal(Object.hasOwn(initial,'sourcePlan'),false);assert.equal(plans.length,0);
 assert.equal(initial.userMessage,'Build a landing');assert.deepEqual(initial.skill,f.source.initial.instructions);
 assert.equal(f.service.poll(f.chat.id).status,'needs-structure-approval');
 f.setResult('completed');f.send('Да');await f.service.settled(f.chat.id);
 assert.deepEqual(plans.map(p=>p.phase),['content']);assert.equal(plans[0].resuming,true);
 assert(plans[0].query.includes('Build a landing'));assert(Object.hasOwn(plans[0].ledger[0],'returned'));
 assert(plans[0].providedIds.includes('skills/ab-generate-custom-landing/SKILL.md'));
 const contexts=f.calls.map(c=>c.diagnosticContext);assert(contexts.every(c=>c.requestId.startsWith('landing-chat:'+f.chat.id+':')));assert.notEqual(contexts[0].requestId,contexts[1].requestId);assert.notEqual(contexts[0].runId,contexts[1].runId);assert.deepEqual(contexts.map(c=>c.stage),['structure','content']);
 assert.equal(JSON.parse(f.calls[1].prompt.split('\n').at(-1)).sourcePlan.phase,'content');assert.equal(f.service.poll(f.chat.id).status,'completed');
});
test('successful initial no-root inspection continues to actual root creation and approval',async t=>{
 const f=fixture(t);f.setInspection(absent);f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);
 assert.equal(c.error,null);assert.equal(c.status,'needs-structure-approval');assert.equal(c.target.rootNodeId,'30:40');assert.equal(c.execution.lastFailure,null);
});
test('initial absence alone binds no root and cannot authorize approval or completion',async t=>{
 for(const result of ['partial','needs-structure-approval','completed']){const f=fixture(t);f.setInspection(absent,true);f.setResult(result);f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);
  assert.equal(c.target,null);assert.equal(c.error?.code||null,result==='partial'?null:'LANDING_TARGET_UNCONFIRMED');assert.notEqual(c.status,'completed');assert.notEqual(c.status,'needs-structure-approval');}
});
test('absence of an already confirmed root stops writes and preserves root/session',async t=>{
 const f=fixture(t);f.send();await f.service.settled(f.chat.id);const before=f.service.poll(f.chat.id);
 f.setInspection(absent,true);f.setResult('partial');f.send('Inspect again');await f.service.settled(before.id);const c=f.service.poll(before.id);
 assert.equal(c.error.code,'LANDING_TARGET_UNCONFIRMED');assert.deepEqual(c.target,before.target);assert.equal(c.execution.sessionId,before.execution.sessionId);
 assert.equal(c.execution.lastFailure.origin,'proxy-validation');assert.equal(c.execution.lastFailure.operation.status,'completed');assert(c.messages.at(-1).hostDiagnostic);
});
test('absent-root exception never admits wrong scope, missing count or ambiguous observations',async t=>{
 const changes=[v=>{v.target.pageId='foreign';},v=>{v.target.parentNodeId='foreign';},v=>{v.target.ownerNonce='foreign';},v=>{delete v.ownedCount;},v=>{v.ownedCount=2;},v=>{v.matches=[{id:'unexpected'}];}];
 for(const mutate of changes){const f=fixture(t);f.setInspection(ctx=>{const v=absent(ctx);mutate(v);return v;},true);f.setResult('partial');f.send();await f.service.settled(f.chat.id);const c=f.service.poll(f.chat.id);assert(c.error);assert.equal(c.target,null);assert.equal(c.status,'interrupted');}
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
test('Stop retains session/root; restart resumes with fresh-read instruction and duplicate message delivery is idempotent',async t=>{
 const f=fixture(t);f.setHold(true);const body={requestId:crypto.randomUUID(),revision:0,text:'Build'};f.service.submit(f.chat.id,body);f.service.cancel(f.chat.id);await f.service.settled(f.chat.id);
 assert.equal(f.service.poll(f.chat.id).status,'interrupted');assert.equal(f.service.poll(f.chat.id).execution.sessionId,'12345678-1234-1234-1234-123456789abc');
 f.setHold(false);const resumed=createDirectLandingService(f.options);const c=resumed.poll(f.chat.id);const next={requestId:crypto.randomUUID(),revision:c.revision,text:'продолжай'};resumed.submit(c.id,next);await resumed.settled(c.id);assert.equal(f.calls[1].sessionId,c.execution.sessionId);assert.match(f.calls[1].prompt,/Read after uncertain outcomes/);assert.equal(resumed.submit(c.id,next).status,'needs-structure-approval');assert.equal(f.calls.length,2);
 assert.throws(()=>resumed.submit(c.id,{...next,text:'different request'}),{code:'LANDING_REQUEST_CONFLICT'});
});
test('old chats stay byte-identical and read-only; legacy callback routes return410',t=>{
 const f=fixture(t),id=crypto.randomUUID(),filename=path.join(f.root,id+'.json');const raw=JSON.stringify({schemaVersion:'apollo.landing-chat.v1',id,revision:2,sequence:4,status:'awaiting-native',context:{},messages:[{role:'user',text:'Old'}],updatedAt:'2026-11-06T00:00:00Z'});fs.writeFileSync(filename,raw);
 assert.equal(f.service.poll(id).historical,true);assert.throws(()=>f.service.submit(id,{requestId:crypto.randomUUID(),revision:2,text:'continue'}),{code:'LANDING_LEGACY_FLOW_RETIRED'});assert.equal(fs.readFileSync(filename,'utf8'),raw);
 const routes=new Map(),app={get:(url,fn)=>routes.set('GET '+url,fn),post:(url,fn)=>routes.set('POST '+url,fn)};mountDirectLandingRoutes(app,{loadService:()=>f.service,status:()=>({available:true})});
 for(const name of ['canvas','native','observation','failure']){let response,code;routes.get('POST /landing/chats/:id/'+name)({}, {status:v=>{code=v;return {json:v=>response=v};}});assert.equal(code,410);assert.equal(response.code,'LANDING_LEGACY_FLOW_RETIRED');}
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

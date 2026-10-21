const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSkillRunner}=require('../src/skills/runner');
const {mountLayerNameRoutes}=require('../src/skills/layer-names');
const {loadRunSkill}=require('../src/skills/run-skill');
const apolloRoot=process.env.APOLLO_PROJECT_ROOT || path.resolve(__dirname,'../../../projects/Apollo');
const p=require('../src/skills/layer-names/run-protocol')(require(path.join(apolloRoot,'src/skills/layer-names/protocol')));
function fixture(){
 const snapshot={schemaVersion:p.SCHEMA,snapshotId:'owned-hash',pageId:'page',rootIds:['root'],scopeName:'Owned fixture',observedCount:3,skippedCount:1,nodes:[
  {nodeId:'root',type:'FRAME',parentId:'page',oldName:'Order',path:'Order',texts:['Адрес доставки']},
  {nodeId:'form',type:'FRAME',parentId:'root',oldName:'Frame 1',path:'Order / Frame 1',texts:['Адрес доставки']}]};
 const change={nodeId:'form',oldName:'Frame 1',newName:'Адрес доставки',reason:'Название подтверждено заголовком.',category:'recommended'};
 const context={snapshotId:snapshot.snapshotId,nodes:[Object.assign({},snapshot.nodes[1],{layoutMode:'VERTICAL',geometry:[0,0,200,80],childTypes:[{type:'TEXT',count:1}]})]};
 return {snapshot,change,context,skill:loadRunSkill(apolloRoot),protocol:p,requestId:'owned-request'};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(service,run){for(let i=0;i<100;i++){const value=service.read(run.runId,run.requestId);if(value.status!=='running')return value;await tick();}assert.fail('Owned stub did not settle');}
function finish(changes=[]){return{action:'finish',nodeIds:[],changes};}
test('runner supplies deduplicated overview, executes requested context and returns a correlated immutable plan',async()=>{
 const f=fixture(),before=JSON.stringify(f.snapshot),calls=[];let time=0;
 const service=createSkillRunner({now:()=>time,invoke:async(prompt,schema,meta)=>{
  calls.push({prompt,meta});assert.equal(meta.dataOnly,true);assert.ok(meta.signal instanceof AbortSignal);assert.deepEqual(schema,p.stepSchema);
  if(calls.length===1){const overview=JSON.parse(prompt.split('OVERVIEW=')[1].split('\nNODE_CONTEXT=')[0]);assert.equal(overview.texts.length,1);assert.equal(overview.nodes.length,2);assert.ok(!Object.hasOwn(overview.nodes[0],'path'));return{action:'read_nodes',nodeIds:['form'],changes:[]};}
  assert.match(prompt,/VERTICAL/);assert.equal(meta.runtimeBudgetMs,899000);return finish([f.change]);
 }});
 const first=service.begin(f),waiting=await settled(service,first);assert.equal(waiting.status,'awaiting-context');assert.equal(p.runValid(waiting,f.snapshot,f.requestId),true);
 time=1000;service.observe({runId:first.runId,requestId:f.requestId,callId:waiting.pending.callId,context:f.context});const done=await settled(service,first);
 assert.equal(done.status,'completed');assert.deepEqual(done.plan,{changes:[f.change]});assert.equal(done.readCount,1);assert.equal(calls.length,2);assert.equal(service.busy(),false);assert.equal(JSON.stringify(f.snapshot),before);
});
test('enough overview evidence finishes in one model call without mandatory reads',async()=>{
 const f=fixture();let calls=0;const service=createSkillRunner({invoke:async()=>{calls++;return finish([f.change]);}}),run=service.begin(f);
 assert.equal((await settled(service,run)).status,'completed');assert.equal(calls,1);
});
test('foreign IDs, writes and invalid finish plans are refused before any native request',async()=>{
 for(const step of [{action:'read_nodes',nodeIds:['outside'],changes:[]},{action:'write',nodeIds:['form'],changes:[]},finish([Object.assign({},fixture().change,{nodeId:'outside'})])]){
  const f=fixture(),service=createSkillRunner({invoke:async()=>step}),run=service.begin(f),out=await settled(service,run);
  assert.equal(out.status,'failed');assert.equal(out.error.code,'LAYER_NAMES_STEP_INVALID');assert.equal(out.pending,null);
 }
});
test('context capability, payload and replay checks preserve the pending read',async()=>{
 const f=fixture();let calls=0;const service=createSkillRunner({invoke:async()=>++calls===1?{action:'read_nodes',nodeIds:['form'],changes:[]}:finish()}),run=service.begin(f),waiting=await settled(service,run);
 assert.throws(()=>service.read(run.runId,'foreign'),e=>e.status===404);
 assert.throws(()=>service.observe({runId:run.runId,requestId:f.requestId,callId:'foreign',context:f.context}),e=>e.code==='LAYER_NAMES_CONTEXT_REPLAY');
 const payload=Object.assign({},f.context,{nodes:[Object.assign({},f.context.nodes[0],{oldName:'changed'})]});
 assert.throws(()=>service.observe({runId:run.runId,requestId:f.requestId,callId:waiting.pending.callId,context:payload}),e=>e.code==='LAYER_NAMES_CONTEXT_INVALID');
 assert.equal(calls,1);service.observe({runId:run.runId,requestId:f.requestId,callId:waiting.pending.callId,context:f.context});
 assert.throws(()=>service.observe({runId:run.runId,requestId:f.requestId,callId:waiting.pending.callId,context:f.context}),e=>e.code==='LAYER_NAMES_CONTEXT_REPLAY');assert.equal((await settled(service,run)).status,'completed');
});
test('cancel aborts the current invocation and late completion cannot replace its state',async()=>{
 const f=fixture();let release,signal;const service=createSkillRunner({invoke:async(a,b,meta)=>{signal=meta.signal;await new Promise(resolve=>{release=resolve;});return finish([f.change]);}}),run=service.begin(f);
 service.cancel(run.runId,f.requestId);assert.equal(signal.aborted,true);release();await tick();const out=service.read(run.runId,f.requestId);
 assert.equal(out.status,'cancelled');assert.equal(out.plan,null);assert.equal(service.busy(),false);
});
test('total deadline includes callback waiting and stops before another CLI invocation',async()=>{
 const f=fixture();let now=0,calls=0;const service=createSkillRunner({now:()=>now,maxRuntimeMs:1000,invoke:async()=>{calls++;return{action:'read_nodes',nodeIds:['form'],changes:[]};}}),run=service.begin(f),waiting=await settled(service,run);
 now=1001;assert.throws(()=>service.observe({runId:run.runId,requestId:f.requestId,callId:waiting.pending.callId,context:f.context}),e=>e.code==='LAYER_NAMES_DEADLINE');assert.equal(calls,1);assert.equal(service.read(run.runId,f.requestId).status,'failed');
 let clock=0;const exhausted=createSkillRunner({now:()=>clock+=100,maxRuntimeMs:50,invoke:async()=>{calls++;return finish();}}),before=exhausted.begin(Object.assign({},f,{requestId:'exhausted'}));
 assert.equal(exhausted.read(before.runId,'exhausted').error.code,'LAYER_NAMES_DEADLINE');assert.equal(calls,1);
});
test('repeated reads and exhausted step budgets terminate explicitly',async()=>{
 for(const maxSteps of [1,8]){
  const f=fixture(),service=createSkillRunner({maxSteps,invoke:async()=>({action:'read_nodes',nodeIds:['form'],changes:[]})}),run=service.begin(f),waiting=await settled(service,run);
  service.observe({runId:run.runId,requestId:f.requestId,callId:waiting.pending.callId,context:f.context});const out=await settled(service,run);
  assert.equal(out.status,'failed');assert.equal(out.error.code,maxSteps===1?'LAYER_NAMES_STEP_LIMIT':'LAYER_NAMES_REPEATED_READ');
 }
});
test('request admission is idempotent; competing or changed replay requests do not create model calls',async()=>{
 const f=fixture();let release,calls=0;const service=createSkillRunner({invoke:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return finish();}}),run=service.begin(f);
 assert.equal(service.begin(f).runId,run.runId);assert.equal(calls,1);
 assert.throws(()=>service.begin(Object.assign({},f,{requestId:'other'})),e=>e.code==='LAYER_NAMES_BUSY');
 assert.throws(()=>service.begin(Object.assign({},f,{snapshot:Object.assign({},f.snapshot,{scopeName:'changed'})})),e=>e.code==='LAYER_NAMES_REQUEST_REPLAY');
 release();await settled(service,run);
});
test('skill drift and observed upstream routing failures are reported separately from time budgets',async()=>{
 const f=fixture();let current=true,release;
 const service=createSkillRunner({invoke:async()=>{await new Promise(resolve=>{release=resolve;});return finish();}});
 const run=service.begin(Object.assign({},f,{skill:Object.assign({},f.skill,{assertCurrent(){if(!current)throw Object.assign(Error('LAYER_NAMES_SKILL_STALE'),{code:'LAYER_NAMES_SKILL_STALE'});}})}));
 current=false;release();assert.equal((await settled(service,run)).error.code,'LAYER_NAMES_SKILL_STALE');
 const failed=createSkillRunner({invoke:async()=>{throw Object.assign(Error('exit1'),{code:'CODEX_PROCESS_FAILED',details:{stderr:'workspace routing discovery timed out'}});}}),other=failed.begin(Object.assign({},f,{requestId:'connection'}));
 assert.equal((await settled(failed,other)).error.code,'LAYER_NAMES_CONNECTION_FAILED');
});
test('HTTP lifecycle exposes only a bound readonly callback, blocks competing legacy requests and cancels safely',async t=>{
 const express=require('express'),app=express();app.use(express.json());const f=fixture();let calls=0;
 mountLayerNameRoutes(app,{apolloRoot,plan:async()=>++calls===1?{action:'read_nodes',nodeIds:['form'],changes:[]}:finish([f.change])});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>{server.closeIdleConnections?.();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port,post=(url,body)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const incompatible=await post('/skills/layer-names/runs',{schemaVersion:p.RUN_SCHEMA,wire:{version:p.WIRE_VERSION,sha256:'0'.repeat(64)},requestId:'bad-wire',snapshot:f.snapshot});
 assert.equal(incompatible.status,409);assert.equal((await incompatible.json()).code,'LAYER_NAMES_WIRE_INCOMPATIBLE');assert.equal(calls,0);
 const response=await post('/skills/layer-names/runs',{schemaVersion:p.RUN_SCHEMA,wire:{version:p.WIRE_VERSION,sha256:p.WIRE_SHA256},requestId:f.requestId,snapshot:f.snapshot}),first=(await response.json()).run;assert.equal(response.status,202);
 const get=()=>fetch(origin+'/skills/layer-names/runs/'+first.runId+'?requestId='+f.requestId).then(r=>r.json());let waiting=(await get()).run;
 while(waiting.status==='running'){await tick();waiting=(await get()).run;}assert.equal(waiting.status,'awaiting-context');
 assert.equal((await post('/skills/layer-names/plan',{requestId:'legacy',snapshot:f.snapshot})).status,409);
 assert.equal((await post('/skills/layer-names/runs/'+first.runId+'/context',{requestId:f.requestId,callId:'foreign',context:f.context})).status,409);assert.equal(calls,1);
 assert.equal((await post('/skills/layer-names/runs/'+first.runId+'/context',{requestId:f.requestId,callId:waiting.pending.callId,context:f.context})).status,200);
 assert.deepEqual((await get()).run.plan,{changes:[f.change]});assert.equal(calls,2);
});
test('plugin and proxy share the exact code-owned wire; malformed and incompatible responses fail closed',()=>{
 const fs=require('node:fs'),file='src/skills/layer-names/run-protocol.js';
 assert.deepEqual(fs.readFileSync(path.join(apolloRoot,file)),fs.readFileSync(path.join(__dirname,'..',file)));
 const f=fixture(),service=createSkillRunner({invoke:async()=>finish()}),run=service.begin(f);
 assert.equal(p.runValid(run,f.snapshot,f.requestId),true);
 for(const wire of [null,{},Object.assign({},run.wire,{version:'999.0.0'}),Object.assign({},run.wire,{sha256:'0'.repeat(64)})])assert.equal(p.runValid(Object.assign({},run,{wire}),f.snapshot,f.requestId),false);
 service.cancel(run.runId,f.requestId);
 assert.throws(()=>require('../src/skills/layer-names/run-protocol')({SCHEMA:'wrong'}),/WIRE_INCOMPATIBLE/);
});
test('run policy rejects missing instructions, source drift and incompatible adapter pins',t=>{
 const fs=require('node:fs'),os=require('node:os'),{BUNDLED,readRunProfile}=require('../src/skills/run-skill');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'naming-policy-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(BUNDLED,root,{recursive:true});const skill=readRunProfile(root);skill.assertCurrent();
 fs.appendFileSync(path.join(root,'SKILL.md'),'\nChanged');assert.throws(()=>skill.assertCurrent(),e=>e.code==='LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE');
 fs.cpSync(BUNDLED,root,{recursive:true});const profile=JSON.parse(fs.readFileSync(path.join(root,'profile.json')));profile.adapter.sha256='0'.repeat(64);fs.writeFileSync(path.join(root,'profile.json'),JSON.stringify(profile));
 assert.throws(()=>readRunProfile(root),e=>e.code==='LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE');
 fs.cpSync(BUNDLED,root,{recursive:true});fs.unlinkSync(path.join(root,'SKILL.md'));assert.throws(()=>readRunProfile(root),e=>e.code==='LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE');
});

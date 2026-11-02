const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service');
const question={kind:'question',message:'Choose CTA',specJson:'{"sections":[{"id":"hero"}]}',query:'',offset:0,resources:[],resultJson:'{}'};
function fixture(t,steps,waitForRetry=async()=>{}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-capacity-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[];let stale=false,creations=0;
 const source={id:'data1',knowledgeVersion:'k1',skill:{version:'0.3.0',sha256:'s1'},initial:{instructions:{'SKILL.md':'Synthetic'},norms:[],resources:{resources:[]}},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});},list:(query,offset)=>({query,offset,total:1,resources:[{id:'known-doc'}]})};
 const make=()=>createLandingService({root,knowledge:()=>source,waitForRetry,createCli:()=>{creations++;return {run:async options=>{calls.push(options);const next=steps.shift();assert(next,'Unexpected replay');const result=typeof next==='function'?await next(options):next;return {result,receipt:{usage:{measurementId:'ok-'+calls.length},mcp:{toolCalls:0}}};}};}});
 const service=make(),chat=service.create({pageId:'0:1',fileKey:'FileKey123'}),request={requestId:crypto.randomUUID(),revision:chat.revision,text:'Brief'};
 return {root,service,chat,request,calls,make,creations:()=>creations,stale:()=>{stale=true;}};
}
function capacity(id){return ()=>{throw Object.assign(Error('AGENT_MODEL_CAPACITY'),{code:'AGENT_MODEL_CAPACITY',diagnostic:JSON.stringify({errorId:id,code:'AGENT_MODEL_CAPACITY'}),usage:{measurementId:id,actualInputTokens:null}});};}
test('only the failed planner step is retried with retained context, distinct usage and correlated bounded attempts',async t=>{
 const waits=[],h=fixture(t,[{...question,kind:'list_resources',query:'CorporateContent'},capacity('capacity1'),capacity('capacity2'),question],async(ms,signal)=>{waits.push(ms);assert.equal(signal.aborted,false);const r=h.service.poll(h.chat.id);assert.equal(r.status,'running');assert.equal(r.error,null);assert.match(r.message,/Модель временно перегружена/);assert.equal(r.messages.length,1);});
 h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);const r=h.service.poll(h.chat.id);
 assert.deepEqual(waits,[5000,15000]);assert.equal(r.status,'needs-input');assert.equal(h.calls.length,4);assert.equal(h.creations(),2,'same CLI/model instance for the failed step');
 assert.deepEqual(h.calls.map(c=>c.diagnosticContext.modelStep),[1,2,3,4]);assert(h.calls.every(c=>c.diagnosticContext.requestId===h.request.requestId&&c.profile==='landing-plan'));
 for(const c of h.calls.slice(1))assert.equal(JSON.parse(c.prompt.split('\n').at(-1)).index.query,'CorporateContent');
 assert.deepEqual(r.usage.map(v=>v.measurementId),['ok-1','capacity1','capacity2','ok-4']);assert.equal(r.failures.length,2);assert.equal(r.error,null);assert.equal(r.messages.filter(m=>m.role==='user').length,1);
 const reloaded=h.make().poll(r.id);assert.deepEqual(reloaded.usage,r.usage);assert.deepEqual(reloaded.failures,r.failures);
});
test('capacity exhaustion stops after three calls and preserves the specific final error and every attempt',async t=>{
 const waits=[],h=fixture(t,[capacity('one'),capacity('two'),capacity('three')],async ms=>waits.push(ms));h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);const r=h.service.poll(h.chat.id);
 assert.deepEqual(waits,[5000,15000]);assert.equal(h.calls.length,3);assert.equal(r.status,'interrupted');assert.equal(r.error.code,'AGENT_MODEL_CAPACITY');assert.match(r.message,/Модель временно перегружена/);assert.equal(r.usage.length,3);assert.equal(r.failures.length,3);assert.equal(r.target,null);assert.equal(h.service.isBusy(),false);
});
test('Stop cancels an actual retry timer immediately without another model call or late resurrection',async t=>{
 let entered;const waiting=new Promise(resolve=>entered=resolve);
 const h=fixture(t,[capacity('first')],(ms,signal)=>{entered();return require('node:timers/promises').setTimeout(ms,undefined,{signal});});
 h.service.submit(h.chat.id,h.request);const work=h.service.whenSettled(h.chat.id);await waiting;h.service.cancel(h.chat.id);await work;
 const r=h.service.poll(h.chat.id);assert.equal(r.status,'cancelled');assert.equal(h.calls.length,1);assert.equal(r.usage.length,1);assert.equal(r.result,null);assert.equal(h.service.isBusy(),false);
});
test('source drift during capacity wait prevents another call and retains the original capacity evidence',async t=>{
 const h=fixture(t,[capacity('first')],async()=>h.stale());h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);const r=h.service.poll(h.chat.id);
 assert.equal(h.calls.length,1);assert.equal(r.error.code,'LANDING_DATA_STALE');assert.equal(r.failures[0].error.code,'AGENT_MODEL_CAPACITY');assert.equal(r.usage.length,1);
});
test('a late capacity refusal after Stop keeps measured usage without scheduling a retry or changing cancellation',async t=>{
 let reject;const h=fixture(t,[()=>new Promise((resolve,no)=>reject=no)],async()=>assert.fail('Cancelled job retried'));
 h.service.submit(h.chat.id,h.request);const work=h.service.whenSettled(h.chat.id);h.service.cancel(h.chat.id);
 reject(Object.assign(Error('AGENT_MODEL_CAPACITY'),{code:'AGENT_MODEL_CAPACITY',usage:{measurementId:'late'}}));await work;
 const r=h.service.poll(h.chat.id);assert.equal(r.status,'cancelled');assert.equal(r.error,null);assert.equal(r.usage[0].measurementId,'late');assert.equal(h.calls.length,1);
 assert.equal(h.make().poll(r.id).usage[0].measurementId,'late');
});
test('unrelated failures have no automatic retry',async t=>{
 for(const code of ['AGENT_PROCESS_FAILED','AGENT_CONTEXT_LIMIT','AGENT_MODEL_UNAVAILABLE','AGENT_CANCELLED']){
  const h=fixture(t,[()=>{throw Object.assign(Error(code),{code});}],async()=>assert.fail('Unrelated failure retried'));
  h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);assert.equal(h.calls.length,1);assert.equal(h.service.poll(h.chat.id).error.code,code);
 }
});
test('retry attempts cannot exceed the existing 24 model-call budget',async t=>{
 const h=fixture(t,[...Array.from({length:23},(_,i)=>({...question,kind:'list_resources',query:'distinct-'+i})),capacity('last')],async()=>assert.fail('Budget exceeded'));
 h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);const r=h.service.poll(h.chat.id);assert.equal(h.calls.length,24);assert.equal(r.error.code,'AGENT_MODEL_CAPACITY');assert.equal(r.usage.length,24);
});
test('Figma executor capacity never blindly replays a possibly mutating turn',async t=>{
 const h=fixture(t,[{...question,kind:'build'},capacity('write')],async()=>assert.fail('Figma replayed'));
 h.service.submit(h.chat.id,h.request);await h.service.whenSettled(h.chat.id);let r=h.service.poll(h.chat.id);assert.equal(r.status,'awaiting-canvas');
 const target={fileKey:'FileKey123',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)},readback={rootNodeId:'1:1',pageId:'0:1',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:1,instanceCount:0,sections:[],text:'',coverage:'tagged-sections-and-text'};
 h.service.canvas(r.id,{revision:r.revision,target,readback});await h.service.whenSettled(r.id);r=h.service.poll(r.id);
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].profile,'landing-figma');assert.equal(r.status,'interrupted');assert.equal(r.error.code,'AGENT_MODEL_CAPACITY');assert.deepEqual(r.target,target);assert.deepEqual(r.readback,readback);
});

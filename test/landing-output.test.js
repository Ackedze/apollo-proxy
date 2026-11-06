'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const wire=require('../src/landing/write-step'),{createFullFlowHarness}=require('./landing-full-flow.test'),{createLandingService}=require('../src/landing/service');
const copy=v=>JSON.parse(JSON.stringify(v));
const map=value=>({entries:Object.entries(value).map(([key,value])=>({key,value:Array.isArray(value)?value:value!==null&&typeof value==='object'?map(value):value}))});
function foundation(){return {kind:'continue',message:'Fixture preparation',query:'',offset:0,resources:[],sectionPatch:null,payload:{checkpoint:{sectionId:null,status:'complete',nextAction:'Create admitted foundation'},preparationPatch:{stage:'prepare-foundation',sectionId:null,baseRevision:0,sources:[{id:'knowledge/data/ds-ai-hub/fixture.md',sha256:'b'.repeat(64),path:[],offset:0,observation:'Read the exact source.'}],decision:{container:{role:'container',type:'INSTANCE',componentKey:'a'.repeat(40)},mount:{role:'mount',type:'SLOT',componentKey:null},layout:map({spacing:0,visible:false,nested:{label:'',options:[null,1,true]}}),slotContentReplacement:'Fixture.Body.default'}},technicalPatch:null,apiObservations:[],report:null}};}
test('closed structured schema preserves arbitrary source-derived JSON map values',()=>{
 const reply=foundation(),before=copy(reply),result=wire.read(reply,'prepare-foundation');
 assert.deepEqual(result.preparationPatch.decision.layout,{spacing:0,visible:false,nested:{label:'',options:[null,1,true]}});assert.equal(result.preparationPatch.decision.slotContentReplacement,'Fixture.Body.default');assert.deepEqual(reply,before);
 const visit=value=>{if(value&&typeof value==='object'){if(value.type==='object'){assert.equal(value.additionalProperties,false);assert.deepEqual(value.required,Object.keys(value.properties));}Object.values(value).forEach(visit);}};visit(wire.schema('prepare-foundation'));
});
test('the actual CLI adapter writes the closed stage schema and round-trips its structured result offline',async t=>{
 const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),{createAgentCli}=require('../src/generation-agent/agent-cli');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-wire-cli-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'workspace'));fs.mkdirSync(path.join(root,'traces'));let captured;
 const cli=createAgentCli({generatedRoot:root,model:'synthetic-model',environment:{PATH:process.env.PATH,HOME:os.homedir()},maxRuntimeMs:2000,spawnProcess(_binary,args){
  captured=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin=new Writable({write(_chunk,_encoding,done){done();},final(done){done();queueMicrotask(()=>{fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(foundation()));child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})+'\n');child.emit('close',0);});}});return child;
 }});
 const schema=wire.schema('prepare-foundation'),out=await cli.run({workspace:path.join(root,'workspace'),traceDirectory:path.join(root,'traces'),profile:'landing-plan',prompt:wire.instructions,schema});assert.deepEqual(captured,schema);assert.deepEqual(out.result,foundation());assert.equal(wire.read(out.result,'prepare-foundation').preparationPatch.decision.layout.visible,false);
});
for(const [label,change]of [
 ['legacy embedded JSON',r=>{r.resultJson='{"checkpoint":{}}}';delete r.payload;}],
 ['misplaced recipe field',r=>{r.payload.preparationPatch.slotContentReplacement=r.payload.preparationPatch.decision.slotContentReplacement;delete r.payload.preparationPatch.decision.slotContentReplacement;}],
 ['duplicate map key',r=>r.payload.preparationPatch.decision.layout.entries.push({key:'spacing',value:1})],
 ['reserved map key',r=>r.payload.preparationPatch.decision.layout.entries.push({key:'__proto__',value:null})],
 ['unwrapped nested object',r=>r.payload.preparationPatch.decision.layout.entries[2].value={label:'raw'}],
 ['stringified map',r=>r.payload.preparationPatch.decision.layout='{}'],
 ['nonfinite number',r=>r.payload.preparationPatch.decision.layout.entries[0].value=Infinity],
 ['missing preparation',r=>r.payload.preparationPatch=null],
 ['wrong base revision type',r=>r.payload.preparationPatch.baseRevision='0'],
 ['unknown field',r=>r.payload.allowDeletion=true],
 ['oversized body',r=>r.payload.preparationPatch.decision.layout.entries.push({key:'large',value:'x'.repeat(262144)})]
])test('structured admission refuses '+label,()=>{const r=foundation();change(r);assert.throws(()=>wire.read(r,'prepare-foundation'),e=>e.code==='LANDING_STEP_PAYLOAD_INVALID'&&typeof e.diagnostic.field==='string');});
test('schema-defined null optional recipe never creates replacement permission',()=>{
 const r=foundation();r.payload.preparationPatch.decision.slotContentReplacement=null;assert.equal(Object.hasOwn(wire.read(r,'prepare-foundation').preparationPatch.decision,'slotContentReplacement'),false);
});
test('technical decision has an explicit string type and cannot hide a preparation or report',()=>{
 const r=foundation();r.payload.preparationPatch=null;r.payload.checkpoint={sectionId:'hero',status:'partial',nextAction:'Inspect current API'};r.payload.technicalPatch={sectionId:'hero',baseRevision:0,sources:foundation().payload.preparationPatch.sources,decision:'Use the observed public API'};
 assert.equal(wire.read(r,'structure').technicalPatch.decision,'Use the observed public API');
 r.payload.technicalPatch.decision={construction:'Untrusted object'};assert.throws(()=>wire.read(r,'structure'),e=>e.diagnostic.field==='step.payload.technicalPatch.decision');
 r.payload.technicalPatch.decision='x'.repeat(2001);assert.throws(()=>wire.read(r,'structure'),{code:'LANDING_STEP_PAYLOAD_INVALID'});
});
test('reader/question payload cannot silently discard a submitted patch',()=>{
 const r=foundation();r.kind='question';assert.throws(()=>wire.read(r,'prepare-foundation'),{code:'LANDING_STEP_PAYLOAD_INVALID'});r.payload=null;assert.deepEqual(wire.read(r,'prepare-foundation'),{});
});
test('dynamic maps and norm reports keep byte/count bounds without a new fixed item cap',()=>{
 const r=foundation();r.payload.preparationPatch.decision.layout={entries:Array.from({length:180},(_,i)=>({key:'source-setting-'+i,value:false}))};assert.equal(Object.keys(wire.read(r,'prepare-foundation').preparationPatch.decision.layout).length,180);
 const report={summary:'Fixture',checks:Array.from({length:180},(_,i)=>({name:'Rule '+i,verdict:'UNKNOWN',evidence:'Fixture only',critical:true})),visualReviews:[],issues:[],limits:[]};r.payload={checkpoint:null,preparationPatch:null,technicalPatch:null,apiObservations:[],report};r.kind='finish';assert.equal(wire.read(r,'verify').checks.length,180);
});
async function untilRepair(h){let c=await h.begin();for(let i=0;i<60&&['awaiting-canvas','awaiting-readback'].includes(c.status);i++){if(c.execution?.protocolIssue)return c;c=await h.tick();}throw Error('Fixture did not reach addressed repair: '+JSON.stringify(c.error));}
async function finish(h,c){for(let i=0;i<70&&['awaiting-canvas','awaiting-readback'].includes(c.status);i++)c=await h.tick();return c;}
test('a rejected preparation is corrected after unchanged readback and the five-section flow completes',async()=>{
 let rejected=false;const h=createFullFlowHarness({responseTransform(r,unit){if(!rejected&&unit.stage==='prepare-foundation'){rejected=true;r.payload.preparationPatch.slotContentReplacement=r.payload.preparationPatch.decision.slotContentReplacement;delete r.payload.preparationPatch.decision.slotContentReplacement;}return r;}});
 try{const c=await untilRepair(h);assert.deepEqual(h.mutations,[]);assert.equal(c.spec.foundation?.plan,undefined);assert.equal(c.execution.stage,'prepare-foundation');assert.equal(c.execution.protocolRepairs.length,1);assert.equal(c.failures[0].error.code,'LANDING_STEP_PAYLOAD_INVALID');const done=await finish(h,c);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.execution.completed.length,5);assert.equal(h.outlineCalls,1);assert.equal(done.execution.protocolRepairs.length,1);assert.equal(done.failures[0].error.code,'LANDING_STEP_PAYLOAD_INVALID');h.assertNeighbor();}finally{h.close();}
});
test('invalid reply after a real partial scene write is reread and never duplicates that block',async()=>{
 let rejected=false;const h=createFullFlowHarness({responseTransform(r,unit){if(!rejected&&unit.stage==='structure'&&unit.sectionId==='benefits'){rejected=true;r.payload.checkpoint.status='bad';}return r;}});
 try{const c=await untilRepair(h),calls=h.calls.length;assert.equal(c.execution.stage,'structure');assert.equal(c.execution.activeSectionId,'benefits');assert.equal(c.spec.sections.find(s=>s.id==='benefits').nodeId,undefined);assert.equal(h.mutations.filter(s=>s==='structure:benefits').length,1);const after=await h.tick();assert.equal(h.calls.length,calls+1);assert(h.calls.at(-1).readback.native.nodes.some(n=>n.sectionId==='benefits'));const done=await finish(h,after);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(h.mutations.filter(s=>s==='structure:benefits').length,1);assert(done.execution.mcpCallsUsed>0);h.assertNeighbor();}finally{h.close();}
});
test('a repeated malformed reply stops after one repair and resume does not reset its allowance',async()=>{
 const h=createFullFlowHarness({responseTransform(r,u){if(u.stage==='prepare-foundation')r.payload.preparationPatch.baseRevision='0';return r;}});
 try{let c=await untilRepair(h);c=await h.tick();assert.equal(c.status,'interrupted');assert.equal(c.execution.protocolRepairs.length,1);assert.equal(c.failures.length,2);const used=c.execution.modelStepsUsed;h.reloadService();h.service.submit(c.id,{requestId:crypto.randomUUID(),revision:c.revision,text:'продолжай'});c=await h.tick();assert.equal(c.status,'interrupted');assert.equal(c.execution.protocolRepairs.length,1);assert.equal(c.execution.modelStepsUsed,used+1);assert.deepEqual(h.mutations,[]);}finally{h.close();}
});
for(const reason of ['Stop','source change'])test('addressed repair still requires '+reason+' guards',async()=>{
 let bad=true;const h=createFullFlowHarness({responseTransform(r,u){if(bad&&u.stage==='prepare-foundation'){bad=false;r.payload.checkpoint.status='bad';}return r;}});
 try{const c=await untilRepair(h),calls=h.calls.length;if(reason==='Stop'){h.service.cancel(c.id);assert.equal(h.service.poll(c.id).status,'cancelled');}else{h.markStale();await assert.rejects(h.tick(),{code:'LANDING_DATA_STALE'});}assert.equal(h.calls.length,calls);assert.deepEqual(h.mutations,[]);assert.equal(h.service.poll(c.id).execution.protocolRepairs.length,1);}finally{h.close();}
});
test('legacy malformed nested JSON receives a specific code and preserves the accepted empty plan',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-output-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source={id:'data',knowledgeVersion:'knowledge',skill:{id:'ab-generate-custom-landing',version:'fixture',sha256:'fixture'},assertCurrent(){},initial:{instructions:{},norms:[],workflow:[],resources:[]}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async()=>({result:{kind:'build',message:'Fixture',specJson:'{"sections":[]} }',query:'',offset:0,resources:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}})})});const r=service.create({pageId:'page',fileKey:'FixtureFile'});service.submit(r.id,{requestId:crypto.randomUUID(),revision:0,text:'Synthetic brief'});await service.whenSettled(r.id);const out=service.poll(r.id);assert.equal(out.error.code,'LANDING_OUTPUT_JSON_INVALID');assert.equal(out.error.diagnostic.field,'specJson');assert.deepEqual(out.spec.sections,[]);assert.equal(out.target,null);
});
test('bounded native outside differences survive the failure transport without changing the accepted plan',async()=>{
 const h=createFullFlowHarness();try{let c=await h.begin();c=await h.tick();const before=copy(c.spec),diff={beforeHash:'a'.repeat(64),afterHash:'b'.repeat(64),changes:[{nodeId:'foreign-neighbor',property:'x',before:0,after:1}],truncated:false};
 const out=h.service.failure(c.id,{revision:c.revision,error:{code:'LANDING_OUTSIDE_CHANGED',diagnostic:{code:'LANDING_OUTSIDE_CHANGED',outsideDiff:diff}}});assert.equal(out.status,'interrupted');assert.deepEqual(out.error.diagnostic.outsideDiff,diff);assert.deepEqual(out.spec,before);assert.equal(h.mutations.length,0);
 }finally{h.close();}
});

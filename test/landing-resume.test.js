'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service');const cp=require('../src/landing/checkpoints');
const copy=x=>JSON.parse(JSON.stringify(x)),sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-resume-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const id=crypto.randomUUID(),key='a'.repeat(40),target={fileKey:'FixtureFile',pageId:'page',rootNodeId:'root',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)},structurePlan={revision:1,sourcePin:'pin',decision:{root:{type:'INSTANCE',componentKey:key},props:{},slots:[],layout:{}}},spec={version:1,facts:[{id:'offer',value:'Confirmed'}],sections:[{id:'hero',role:'Offer',contentShape:{titleCount:1},structurePlan}]};
 const readback={rootNodeId:'root',pageId:'page',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:1,instanceCount:0,sections:[],text:'',coverage:'tagged-sections-and-text',native:{schemaVersion:'apollo.landing-native.v1',nodes:[{id:'root',parentId:'page',type:'FRAME',name:'Root',role:'',sectionId:null}]}};
 const record={schemaVersion:'apollo.landing-chat.v1',id,skillId:'ab-generate-custom-landing',revision:1,sequence:1,status:'interrupted',messages:[],spec,result:null,target,context:{fileKey:target.fileKey,pageId:'page'},source:{workflow:cp.WORKFLOW},usage:[],sources:[],requests:[],readback,execution:{schemaVersion:'apollo.landing-checkpoints.v2',workflow:cp.WORKFLOW,sourcePin:'pin',rootNodeId:'root',ownerNonce:target.ownerNonce,queue:['hero'],structures:[],completed:[],stage:'structure',activeSectionId:'hero',activePlanHash:sha(structurePlan),status:'interrupted',modelStepsUsed:7,mcpCallsUsed:2},createdAt:new Date(0).toISOString()};fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify(record));
 let stale=false;const calls=[],source={id:'data',knowledgeVersion:'knowledge',resumePin:'pin',skill:{id:'ab-generate-custom-landing',version:'0.4.1',sha256:'skill',generation:{workflow:cp.WORKFLOW}},initial:{instructions:{},norms:[],workflow:[],resources:[]},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{calls.push(JSON.parse(options.prompt.split('\n').at(-1)));return {result:{kind:'question',message:'Fixture inspection only',query:'',offset:0,resources:[],...(calls.at(-1).execution?{sectionPatch:null,payload:null}:{specJson:JSON.stringify(spec),resultJson:'{}'})},receipt:{mcp:{toolCalls:0}}};}})});
 return {root,id,record,readback,target,service,calls,source,stale:()=>stale=true,submit:(text='продолжи')=>service.submit(id,{requestId:crypto.randomUUID(),revision:1,text})};
}
test('exact continue waits for fresh owned canvas without calling the outline planner',async t=>{
 const h=fixture(t);h.submit();await h.service.whenSettled(h.id);let r=h.service.poll(h.id);assert.equal(h.calls.length,0);assert.equal(r.status,'awaiting-canvas');assert.deepEqual(r.spec.sections,h.record.spec.sections);
 const after=copy(h.readback);if(r.source.nativeEvidenceVersion===2)after.native={...after.native,schemaVersion:'apollo.landing-native.v2',modeDefaults:{}};
 h.service.canvas(h.id,{revision:r.revision,target:h.target,readback:after});await h.service.whenSettled(h.id);r=h.service.poll(h.id);assert.equal(h.calls.length,1);assert.equal(h.calls[0].execution.stage,'structure');assert.equal(h.calls[0].execution.activeSectionId,'hero');assert.equal(h.calls[0].execution.writeContext.stage,'structure');assert.equal(h.calls[0].execution.writeContext.sectionId,'hero');assert.equal(h.calls[0].execution.writeContext.target.rootNodeId,h.target.rootNodeId);assert.equal(h.calls[0].execution.writeContext.target.leaseNonce,h.target.leaseNonce);assert.equal(h.calls[0].limits.modelStepsRemaining,48-8);assert.deepEqual(r.spec.sections,h.record.spec.sections);
});
test('an incompatible source cannot resume or overwrite the old accepted plan',t=>{
 const h=fixture(t);h.source.resumePin='changed';assert.throws(h.submit,{code:'LANDING_RESUME_SOURCE_CHANGED'});assert.deepEqual(h.service.poll(h.id).spec,h.record.spec);assert.equal(h.calls.length,0);
});
test('source freshness remains mandatory before a resume is saved or launched',t=>{
 const h=fixture(t);h.stale();assert.throws(h.submit,{code:'LANDING_DATA_STALE'});assert.equal(h.calls.length,0);assert.deepEqual(h.service.poll(h.id).spec,h.record.spec);
});

for(const command of ['продолжай','продолжая, макет не трогаю','продолжаем без изменений','Continue!'])test('unchanged-canvas resume intent: '+command,async t=>{
 const h=fixture(t);h.submit(command);await h.service.whenSettled(h.id);const r=h.service.poll(h.id);assert.equal(h.calls.length,0);assert.equal(r.status,'awaiting-canvas');assert.deepEqual(r.spec.sections,h.record.spec.sections);assert.equal(r.execution.modelStepsUsed,7);assert.equal(r.execution.mcpCallsUsed,2);
});
for(const command of ['продолжай и измени кнопку','продолжи, поменяй порядок','продолжая, макет не трогаю, но измени заголовок'])test('edit-bearing request is not swallowed by resume: '+command,async t=>{
 const h=fixture(t);h.submit(command);await h.service.whenSettled(h.id);assert.equal(h.calls.length,1);assert.equal(h.calls[0].execution,null);assert.deepEqual(h.service.poll(h.id).spec.sections,h.record.spec.sections);
});
test('a completed execution is not silently resumed',async t=>{
 const h=fixture(t);h.record.execution.status='completed';fs.writeFileSync(path.join(h.root,h.id+'.json'),JSON.stringify(h.record));h.submit();await h.service.whenSettled(h.id);assert.equal(h.calls.length,1);assert.equal(h.calls[0].execution,null);
});
test('resume cannot reset the cumulative model budget',t=>{
 const h=fixture(t);h.record.execution.modelStepsUsed=48;fs.writeFileSync(path.join(h.root,h.id+'.json'),JSON.stringify(h.record));assert.throws(h.submit,{code:'LANDING_STEP_BUDGET'});assert.equal(h.calls.length,0);
});

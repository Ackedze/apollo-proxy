'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAuditService,usage}=require('../src/figma-audit/service');
const p=require(require('node:path').join(process.env.APOLLO_PROJECT_ROOT||require('node:path').resolve(__dirname,'../../../projects/Apollo'),'src/figma-audit/protocol'));
const sourceId='knowledge/data/ds-ai-hub/products/ab/patterns/buttons.md';
const snapshot={version:p.VERSION,snapshotId:'snapshot',pageId:'page',rootIds:['root'],nodes:[{id:'root',name:'Screen',type:'FRAME',parentId:'page'}],limitations:[]};
const plan=[{id:'buttons:root',sourceId,rule:'desktop-safe',targets:['root'],requiredFields:['componentProperties']}];
const checks=[{id:'buttons:root',status:'FAIL',actual:'Accent',expected:'Primary',sourceQuote:'Use primary on desktop.',evidenceIds:['native-1'],reason:'Read contextual rule',fix:'Set Primary',severity:'source-unspecified'}];
const step=(action,more={})=>Object.assign({action,documents:[],query:'',resourceId:'',offset:0,nodeIds:[],plan:[],checks:[],summary:'Audit',gaps:[],excluded:[]},more);
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function setup(actions){let stale=false;const measured=[];const knowledge=()=>({id:'release',knowledgeVersion:'hub',skill:{id:'ab-audit-figma',version:'0.2.0'},instructions:'audit',initial:[],sources:()=>[{id:sourceId,offset:0,end:100}],assertCurrent(){if(stale)throw Object.assign(Error('stale'),{code:'AUDIT_DATA_STALE'});},list:()=>({items:[]}),read:()=>({text:'Use primary on desktop.'}),hasRead:(id,quote)=>id===sourceId&&quote==='Use primary on desktop.'});
 const service=createAuditService({protocol:p,knowledge,invoke:async({phase})=>{measured.push(phase);return {result:actions.shift(),usage:{measurementId:'u'+measured.length,actualInputTokens:10,actualOutputTokens:2,cachedInputSubsetTokens:1,reasoningOutputSubsetTokens:0}};}});return {service,measured,stale:()=>{stale=true;}};
}
test('host validates plan/evidence, performs final native recheck, and measures real usage by phase',async()=>{
 const f=setup([step('plan',{plan}),step('read_nodes',{nodeIds:['root']}),step('finish',{checks}),step('finish',{checks})]),s=f.service;
 let run=s.start({version:p.VERSION,requestId:'request',snapshot,platform:'desktop'});await wait();run=s.get(run.runId,'request');assert.equal(run.status,'awaiting-native');
 const original=run.pending.callId;s.context(run.runId,{requestId:'request',callId:original,result:{nodes:[{id:'root',unavailable:[],componentProperties:{View:'Accent'}}]}});await wait();run=s.get(run.runId,'request');assert.equal(run.pending.operation,'verify');
 assert.throws(()=>s.context(run.runId,{requestId:'request',callId:original,result:{nodes:[]}}),{code:'AUDIT_CONTEXT_REPLAY'});
 run=s.context(run.runId,{requestId:'request',callId:run.pending.callId,result:{current:true,snapshotId:'snapshot'}});assert.equal(run.status,'completed');assert.equal(run.report.coverage.percent,100);assert.equal(run.report.freshness,'NATIVE_RECHECKED');assert.equal(run.report.usage.total.inputTokens,40);assert.equal(run.report.usage.phases.documentation.inputTokens,10);assert.equal(run.report.usage.phases.report.inputTokens,10);
});
test('unread quotation cannot become a FAIL and out-of-scope reads cannot dispatch',async()=>{
 for(const actions of [[step('read_nodes',{nodeIds:['outside']})],[step('plan',{plan}),step('finish',{checks}),step('finish',{checks})]]){
  const f=setup(actions),r=f.service.start({version:p.VERSION,requestId:'request',snapshot,platform:'desktop'});await wait();const run=f.service.get(r.runId,'request');assert.equal(run.status,'failed');assert.ok(['AUDIT_SCOPE_ESCAPE','AUDIT_EVIDENCE_MISSING','AUDIT_REPORT_INVALID'].includes(run.error));
 }
});
test('cancellation, stale knowledge and replay cannot complete a report',async()=>{
 for(const type of ['cancel','stale']){const f=setup([step('read_nodes',{nodeIds:['root']})]),s=f.service,r=s.start({version:p.VERSION,requestId:'request',snapshot,platform:'desktop'});await wait();assert.throws(()=>s.start({version:p.VERSION,requestId:'request',snapshot,platform:'mobile'}),{code:'AUDIT_REQUEST_REPLAY'});if(type==='cancel')s.cancel(r.runId,'request');else f.stale();const run=s.get(r.runId,'request');assert.equal(run.status,type==='cancel'?'cancelled':'failed');assert.equal(run.report,null);}
});
test('missing actual usage stays unavailable; cached/reasoning are never added',()=>{
 const result=usage([{auditPhase:'figma',actualInputTokens:12,actualOutputTokens:3,cachedInputSubsetTokens:10,reasoningOutputSubsetTokens:2},{auditPhase:'report',actualInputTokens:null,actualOutputTokens:5}]);assert.equal(result.total.inputTokens,null);assert.equal(result.total.outputTokens,8);assert.equal(result.phases.figma.inputTokens,12);assert.equal(result.phases.documentation.inputTokens,null);
});

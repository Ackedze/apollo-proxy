'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createAuditService}=require('../src/figma-audit/service'),facts=require('../src/figma-audit/facts'),p=require(path.join(process.env.APOLLO_PROJECT_ROOT||path.resolve(__dirname,'../../../projects/Apollo'),'src/figma-audit/protocol'));
const sourceId='knowledge/data/ds-ai-hub/products/ab/patterns/fixture.md',quote='Use the documented fixture property.',tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot={version:p.VERSION,snapshotId:'snapshot',pageId:'page',rootIds:['a','b'],contextParents:[],nodes:['a','b'].map(id=>({id,name:id,type:'INSTANCE',parentId:'page',children:[]}))};
const row=(id,field='fills')=>({id,sourceId,rule:'fixture',targets:[id==='a'?'a':'b'],requiredFields:[{id:'value',field,nodeId:id==='a'?'a':'b',role:'target'}]});
const verdict=(id,patch={})=>Object.assign({id,status:'PASS',actual:'Observed fixture value',expected:'Documented fixture value',reason:'Synthetic fixture comparison',fix:'',sourceQuote:quote,evidenceIds:['native-1'],factBindings:[{factId:'value',evidenceId:'native-1'}],severity:'fixture'},patch);
const action=(name,patch={})=>Object.assign({action:name,documents:[],query:'',resourceId:'',offset:0,nodeIds:[],plan:[],checks:[],summary:'Untrusted draft count',gaps:[],excluded:[]},patch);
const plan=action('plan',{plan:[row('a'),row('b')]}),read=action('read_nodes',{nodeIds:['a','b']}),begin=action('begin_report'),finish=patch=>action('finish',patch),bad=patch=>verdict('b',Object.assign({status:'FAIL',fix:'Use documented value',sourceQuote:'Reworded source paragraph.'},patch));
function fixture(actions,options={}){
 const receipts=new Map(),stored=new Map(),prompts=[];let stale=false,waiting=false,calls=0;
 const knowledge=()=>({id:'release',skill:{id:'fixture'},initial:[],sources:()=>[{id:sourceId,offset:0,end:100}],assertCurrent(){if(stale)throw Object.assign(Error('stale'),{code:'AUDIT_DATA_STALE'});},hasRead:(id,q)=>id===sourceId&&q===quote,read:(id,offset)=>({id,offset,end:100,total:100,next:null,text:quote}),...options.source});
 const service=createAuditService({protocol:p,knowledge,history:{readRequest:id=>receipts.get(id),writeRequest:r=>receipts.set(r.requestId,structuredClone(r)),readRun:r=>stored.get(r.runId)},persist:r=>stored.set(r.runId,r),maxSteps:options.maxSteps||40,invoke:async({prompt,signal})=>{prompts.push(JSON.parse(prompt));calls++;const next=actions.shift();if(next==='hold'){waiting=true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{code:'AUDIT_CANCELLED'})),{once:true}));}assert(next,'Unexpected extra agent call');return {result:structuredClone(next)};}});
 let run=service.start({version:p.VERSION,controlVersion:'request-id-v1',requestId:'request',snapshot:options.snapshot||snapshot,platform:'desktop'});
 return {service,prompts,stored,get calls(){return calls;},get waiting(){return waiting;},stale(){stale=true;},get(){return service.get(run.runId,run.requestId);},async drive(){for(let i=0;i<20;i++){await tick();run=this.get();if(run.pending?.operation==='read'){service.context(run.runId,{requestId:run.requestId,callId:run.pending.callId,result:{nodes:run.pending.nodeIds.map(id=>({id,type:(options.snapshot||snapshot).nodes.find(n=>n.id===id).type,unavailable:[],fills:[],componentProperties:{Size:{type:'VARIANT',value:'48'}},...(options.nativePatch||{})}))}});}else if(run.pending||waiting||['failed','cancelled','completed'].includes(run.status))return run;}throw Error('No fixture boundary');},complete(current=true){const r=this.get();return service.context(r.runId,{requestId:r.requestId,callId:r.pending.callId,result:{current,snapshotId:'snapshot'}});},cancel(){const r=this.get();return service.cancel(r.runId,r.requestId);}};
}
test('publish keeps good rows and exposes precise grouped quote feedback without accepting the claim',async()=>{
 const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),bad()]}),'hold']),r=await f.drive();assert.equal(r.error,null);assert.equal(r.preview.received,1);assert.equal(r.preview.checks[0].id,'a');assert.equal(r.proofRepairs.pendingQuotes[0].checkId,'b');const repair=f.prompts.at(-1).history.find(h=>h.kind==='quote-repair');assert.deepEqual(repair.acceptedIds,['a']);assert.equal(repair.issues[0].sourceId,sourceId);assert.deepEqual(repair.issues[0].readRanges,[{offset:0,end:100}]);assert.equal(f.prompts.at(-1).publishedChecks.length,1);f.cancel();await tick();
});
test('finish repairs only rejected rows and still requires final native verification',async()=>{
 const fixed=bad({sourceQuote:quote}),f=fixture([plan,read,begin,finish({checks:[verdict('a'),bad()]}),finish({checks:[fixed]})]);let r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.freshness,'AWAITING_NATIVE_RECHECK');assert.equal(r.report.checks.length,2);assert.equal(r.report.checks[1].status,'FAIL');assert.equal(r.preview.received,2);assert.equal(r.report.coverage.counts.PASS,1);assert.equal(f.calls,5);r=f.complete();assert.equal(r.status,'completed');assert.equal(r.report.freshness,'NATIVE_RECHECKED');
});
test('unresolved replacement cannot silently reuse an older accepted verdict for the same ID',async()=>{
 const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),verdict('b')]}),begin,finish({checks:[bad()]}),finish({checks:[]}),finish({checks:[]})]);let r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks[0].status,'PASS');const unknown=r.report.checks[1];assert.equal(unknown.status,'UNKNOWN');assert.equal(unknown.sourceQuote,'');assert.equal(unknown.claimedStatus,'FAIL');assert.equal(unknown.agentClaim.sourceQuote,bad().sourceQuote);assert.equal(r.report.coverage.counts.PASS,1);assert.equal(r.report.coverage.counts.UNKNOWN,1);assert.match(r.report.summary,/недостаточно данных: 1/);assert.equal(r.report.agentSummary,'Untrusted draft count');f.complete();
});
test('quote repair never normalizes whitespace or chooses a source quote automatically',async()=>{
 const sourceText='Use\n- Primary;\n- Secondary.',f=fixture([plan,read,begin,finish({checks:[verdict('a',{sourceQuote:sourceText}),bad({sourceQuote:'Use Primary; Secondary.'})]}),finish({checks:[]}),finish({checks:[]})],{source:{hasRead:(_id,q)=>q===sourceText}}),r=await f.drive();assert.equal(r.report.checks[0].status,'PASS');assert.equal(r.report.checks[1].status,'UNKNOWN');assert.equal(r.report.checks[1].sourceQuote,'');f.complete();
});
test('hard binding errors cannot hide behind a bad quote and prevent committing a new batch',async()=>{
 for(const change of [{factBindings:[{factId:'wrong',evidenceId:'native-1'}]},{factBindings:[{factId:'value',evidenceId:'invented'}]},{evidenceIds:['invented']},{fix:''},{evidenceIds:[],factBindings:[]}]){
  const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),bad(change)]})]),r=await f.drive();assert.equal(r.status,'failed');assert.equal(r.preview,null);assert.equal(r.proofRepairs.pendingQuotes.length,0);assert(['AUDIT_FACT_BINDING_INVALID','AUDIT_REPORT_INVALID','AUDIT_EVIDENCE_MISSING'].includes(r.error));
 }
});
test('an unread document or metadata-only source remains a hard evidence failure',async()=>{
 const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),bad()]})],{source:{hasRead:()=>false,sources:()=>[{id:sourceId,offset:0,end:100,purpose:'routing-metadata-not-norm-read'}]}}),r=await f.drive();assert.equal(r.error,'AUDIT_EVIDENCE_MISSING');assert.equal(r.preview,null);
});
test('quote repair may reread its exact pending source in report phase, without reopening native reads',async()=>{
 const f=fixture([plan,read,begin,finish({checks:[verdict('a'),bad()]}),action('read_document',{resourceId:sourceId}),finish({checks:[bad({sourceQuote:quote})]})]),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks[1].status,'FAIL');f.complete();
 for(const next of [action('read_nodes',{nodeIds:['a']}),action('read_document',{resourceId:'knowledge/data/ds-ai-hub/unrelated.md'})]){const f=fixture([plan,read,begin,finish({checks:[verdict('a'),bad()]}),next]),r=await f.drive();assert.equal(r.error,next.action==='read_nodes'?'AUDIT_READ_INVALID':'AUDIT_PHASE_INVALID');assert.equal(r.preview.received,1);}
});
test('step budget after a rejected group preserves good rows and honest UNKNOWN with native verification',async()=>{
 const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),bad()]})],{maxSteps:3}),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.completion,'STEP_BUDGET_EXHAUSTED');assert.equal(r.report.checks[0].status,'PASS');assert.equal(r.report.checks[1].status,'UNKNOWN');assert.equal(r.report.coverage.percent,50);assert.equal(f.calls,3);f.complete();
});
test('step budget marks unrelated unevaluated rows NOT_CHECKED, not successful',async()=>{
 const extra={...row('b'),id:'extra'},f=fixture([action('plan',{plan:[...plan.plan,extra]}),read,action('publish_checks',{checks:[verdict('a'),bad()]})],{maxSteps:3}),r=await f.drive();assert.equal(r.report.coverage.counts.PASS,1);assert.equal(r.report.coverage.counts.UNKNOWN,1);assert.equal(r.report.coverage.counts.NOT_CHECKED,1);f.complete();
});
test('Stop and stale sources preserve accepted rows, without a final report',async()=>{
 for(const mode of ['stop','stale']){const f=fixture([plan,read,action('publish_checks',{checks:[verdict('a'),bad()]}),'hold']);await f.drive();if(mode==='stop')f.cancel();else f.stale();const r=f.get();assert.equal(r.status,mode==='stop'?'cancelled':'failed');assert.equal(r.report,null);assert.equal(r.preview.received,1);assert.equal(r.preview.provisional,true);if(mode==='stale')assert.equal(r.preview.freshness,'STALE');await tick();}
});
test('repaired quotes cannot bypass final native freshness or durable request replay',async()=>{
 const f=fixture([plan,read,begin,finish({checks:[verdict('a'),bad()]}),finish({checks:[bad({sourceQuote:quote})]})]);const r=await f.drive();assert.throws(()=>f.complete(false),{code:'AUDIT_STALE'});assert.equal(f.get().status,'failed');assert.equal(f.get().preview.freshness,'STALE');const replay=f.service.start({version:p.VERSION,controlVersion:'request-id-v1',requestId:r.requestId,snapshot,platform:'desktop'});assert.equal(replay.historical,true);assert.equal(f.calls,5);
});
test('field definitions expose observed type restrictions and suggest actual INSTANCE variant data',()=>{
 const field=facts.fieldDefinitions.find(f=>f.id==='variantProperties');assert.deepEqual(field.nodeTypes,['COMPONENT','COMPONENT_SET']);assert.match(field.hint,/componentProperties/);const run={snapshot,sourceTypes:new Map()},issue=facts.planIssues(run,[row('a','variantProperties')])[0];assert.equal(issue.nodeType,'INSTANCE');assert.equal(issue.code,'FACT_NODE_TYPE_MISMATCH');assert.equal(facts.planIssues(run,[row('a','componentProperties')]).length,0);
});
test('incompatible plan fields are repaired explicitly before native reads; no automatic UNKNOWN to PASS upgrade',async()=>{
 const wrong=action('plan',{plan:[row('a','variantProperties'),row('b')]}),fixed=action('plan',{plan:[row('a','componentProperties'),row('b')]}),f=fixture([wrong,fixed,read,begin,finish({checks:[verdict('a',{status:'UNKNOWN',reason:'No semantic verdict asserted'}),verdict('b')]})]),r=await f.drive();const feedback=f.prompts[1].history.find(h=>h.kind==='plan-type-repair');assert.equal(feedback.issues[0].field,'variantProperties');assert.equal(f.prompts[1].plan.length,0);assert.equal(f.prompts[1].factFieldDefinitions.find(f=>f.id==='variantProperties').nodeTypes.includes('INSTANCE'),false);assert.equal(r.report.checks[0].requiredFields[0].field,'componentProperties');assert.deepEqual(r.report.checks[0].factGaps,[]);assert.equal(r.report.checks[0].status,'UNKNOWN');assert.equal(r.report.checks[1].status,'PASS');f.complete();
});
test('a repaired plan retains rule targets and fact IDs/nodes/roles, not just check IDs',async()=>{
 for(const alter of [rows=>rows.slice(1),rows=>[{...rows[0],requiredFields:[]},rows[1]],rows=>[{...rows[0],targets:['b']},rows[1]],rows=>[{...rows[0],requiredFields:[{...rows[0].requiredFields[0],role:'context'}]},rows[1]]]){
  const wrong=action('plan',{plan:[row('a','variantProperties'),row('b')]}),changed=alter([row('a','componentProperties'),row('b')]),f=fixture([wrong,action('plan',{plan:changed})]),r=await f.drive();assert(['AUDIT_PLAN_DROPPED','AUDIT_PLAN_INVALID'].includes(r.error));assert.equal(r.preview,null);
 }
});
test('ignoring incompatible plan feedback is bounded and cannot finish an older plan',async()=>{
 const f=fixture([action('plan',{plan:[row('a','variantProperties'),row('b')]}),finish({checks:[]}),finish({checks:[]})]),r=await f.drive();assert.equal(r.error,'AUDIT_PLAN_REPAIR_LIMIT');assert.equal(f.calls,3);assert.equal(r.report,null);
});
test('known applicable missing native values remain UNKNOWN, without inventing replacements',async()=>{
 const missing=action('plan',{plan:[row('a','opacity'),row('b')]}),f=fixture([missing,read,begin,finish({checks:[verdict('a'),verdict('b')]})],{nativePatch:{unavailable:['opacity']}}),r=await f.drive();assert.equal(r.report.checks[0].status,'UNKNOWN');assert.equal(r.report.checks[0].factGaps[0].reason,'UNAVAILABLE');assert.equal(r.report.checks[1].status,'PASS');assert.equal(r.proofRepairs.planIssues.length,0);f.complete();
});
test('unverified text on UNKNOWN is kept as a claim, not rendered as a verified quotation',async()=>{
 const f=fixture([plan,read,begin,finish({checks:[verdict('a'),bad({status:'UNKNOWN'})]})]),r=await f.drive();assert.equal(r.report.checks[1].status,'UNKNOWN');assert.equal(r.report.checks[1].sourceQuote,'');assert.equal(r.report.checks[1].agentClaim.sourceQuote,bad().sourceQuote);assert.equal(r.proofRepairs.pendingQuotes.length,0);f.complete();
});
test('unknown source type is not called a type mismatch or evidence of availability',()=>{
 const proposed=row('a','variantProperties');proposed.requiredFields[0].nodeId='unread-source';proposed.requiredFields[0].role='source';assert.deepEqual(facts.planIssues({snapshot,sourceTypes:new Map()},[proposed]),[]);
});
test('a wrong native context role is rejected before isolating its bad quote',async()=>{
 const wrong={...row('b'),requiredFields:[{id:'value',field:'fills',nodeId:'a',role:'context'}]},f=fixture([action('plan',{plan:[row('a'),wrong]}),read,action('publish_checks',{checks:[verdict('a'),bad()]})]),r=await f.drive();assert.equal(r.error,'AUDIT_FACT_BINDING_INVALID');assert.equal(r.preview,null);assert.equal(r.proofRepairs.pendingQuotes.length,0);
});

test('scope admission distinguishes ancestor context, unrelated siblings and catalogue ownership',()=>{
 const area={...snapshot,nodes:[...snapshot.nodes,{id:'text',name:'Title',type:'TEXT',parentId:'a'}]},run={snapshot:area,sourceTypes:new Map([['cat','TEXT']]),sourceRoots:new Map([['cat',new Set(['cat-root'])]]),sourceOwners:new Map([['cat-root',new Set(['b'])]])},ancestor={id:'ancestor',sourceId,rule:'fixture',targets:['text'],requiredFields:[{id:'parent',field:'componentProperties',nodeId:'a',role:'target'}]},issue=facts.planIssues(run,[ancestor],{scope:true})[0];assert.equal(issue.code,'FACT_ROLE_SCOPE_MISMATCH');assert.deepEqual(issue.allowedRoles,['context']);assert.equal(facts.planIssues(run,[{...ancestor,requiredFields:[{...ancestor.requiredFields[0],role:'context'}]}],{scope:true}).length,0);
 const sibling={...ancestor,requiredFields:[{...ancestor.requiredFields[0],nodeId:'b',role:'context'}]};assert.deepEqual(facts.planIssues(run,[sibling],{scope:true})[0].allowedRoles,[]);const foreign={...ancestor,requiredFields:[{id:'foreign',field:'catalogue.characters',nodeId:'cat',role:'source'}]};run.evidence=new Map();assert.throws(()=>facts.checkFacts(run,foreign,{factBindings:[],evidenceIds:[]}),e=>e.code==='AUDIT_FACT_BINDING_INVALID'&&e.repairable===false);
});

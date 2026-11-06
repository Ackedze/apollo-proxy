'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createOverrideInventory}=require('../src/figma-audit/overrides'),{createAuditService}=require('../src/figma-audit/service');
const p=require(path.join(process.env.APOLLO_PROJECT_ROOT||path.resolve(__dirname,'../../../projects/Apollo'),'src/figma-audit/protocol'));
const snapshot={version:p.VERSION,snapshotId:'snapshot',pageId:'page',rootIds:['root'],contextParents:[],nodes:[
 {id:'root',parentId:'page',name:'Fixture root',type:'FRAME',visible:true,children:['instance','sibling']},
 {id:'instance',parentId:'root',name:'Fixture instance',type:'INSTANCE',visible:true,children:['label','hidden']},
 {id:'label',parentId:'instance',name:'Label',type:'TEXT',visible:true,children:[]},
 {id:'hidden',parentId:'instance',name:'Hidden',type:'TEXT',visible:false,children:[]},
 {id:'sibling',parentId:'root',name:'Other label',type:'TEXT',visible:true,children:[]}
]};
const raw=(fields=['textStyleId'],nodeId='label')=>({id:'instance',type:'INSTANCE',name:'Fixture instance',parentId:'root',children:['label','hidden'],visible:true,main:{id:'main',key:'fixture-key',name:'Fixture source'},componentProperties:{Size:{type:'VARIANT',value:'56'}},overrides:[{id:nodeId,overriddenFields:fields}],unavailable:[]});
const req=(field,nodeId='label',role='target')=>({id:nodeId+'-'+field,field,nodeId,role});
const sourceId='knowledge/data/ds-ai-hub/fixture.md',quote='Use the configured source for this fixture field.',contentQuote='Content overrides are allowed in this fixture.';
const row=(id,requiredFields,targets=['instance'])=>({id,sourceId,rule:'Synthetic fixture rule',targets,requiredFields});
const base=row('base',[req('fills','root')],['root']),style=row('style',[req('textStyleId'),req('textStyleId','master-label','source')]);
const verdict=(id,native,patch={})=>Object.assign({id,status:'PASS',actual:'Fixture value',expected:'Fixture norm',reason:'Synthetic fixture comparison',fix:'',severity:'fixture',sourceQuote:quote,evidenceIds:[native],factBindings:(id==='base'?base:style).requiredFields.map(f=>({factId:f.id,evidenceId:native}))},patch);
const action=(name,extra={})=>Object.assign({action:name,documents:[],query:'',resourceId:'',offset:0,nodeIds:[],plan:[],checks:[],summary:'Untrusted fixture summary',gaps:[],excluded:[]},extra);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const inspect=(inventory,plan=[],published=new Map())=>inventory.report({plan,published,coverage:p.coverage});

test('inventory before detailed reads is exact node+field metadata, with no visual values',()=>{
 const inventory=createOverrideInventory(snapshot);inventory.observe([raw()], 'native-1');const value=inspect(inventory),change=value.checks[0];
 assert.equal(change.nodeId,'label');assert.equal(change.field,'textStyleId');assert.equal(change.status,'NOT_CHECKED');assert.equal(value.pending.length,1);assert.deepEqual(change.evidenceIds,['native-1']);assert.equal('actual'in change,false);
 assert.equal(inspect(inventory,[row('size',[req('componentProperties','instance')])]).pending.length,1);
 assert.equal(inspect(inventory,[row('other',[req('textStyleId','sibling')],['root'])]).pending.length,1);
 assert.equal(inspect(inventory,[row('context',[req('textStyleId','label','context')])]).pending.length,1);
});
test('same nested field listed by two actual owners is one obligation',()=>{
 const s=structuredClone(snapshot);s.nodes[0].type='INSTANCE';const inventory=createOverrideInventory(s);
 inventory.observe([Object.assign(raw(),{id:'root'}),raw()], 'native-1');const value=inspect(inventory);assert.equal(value.inventory.fieldChanges,1);assert.equal(value.checks.length,1);assert.deepEqual(value.checks[0].ownerIds,['root','instance']);
});
test('empty override scan is distinct from absent, unavailable and malformed data',()=>{
 for(const node of [Object.assign(raw(),{overrides:undefined}),Object.assign(raw(),{overrides:[],unavailable:['overrides']}),Object.assign(raw(),{overrides:[{id:'label',overriddenFields:[null]}]})]){
  const inventory=createOverrideInventory(snapshot);inventory.observe([node],'native-1');const v=inspect(inventory);assert.equal(v.inventory.unavailableScans,1);assert.equal(v.coverage.counts.UNKNOWN,1);assert.notEqual(v.coverage.percent,100);
 }
 const inventory=createOverrideInventory(snapshot);inventory.observe([Object.assign(raw(),{overrides:[]})],'native-1');const v=inspect(inventory);assert.equal(v.checks.length,0);assert.equal(v.inventory.scanned,1);assert.equal(v.inventory.pendingScans,0);
});
test('hidden, foreign and unobserved references never grant reads or silently pass',()=>{
 for(const [nodeId,status]of [['hidden','NOT_CHECKED'],['outside','NOT_CHECKED'],['sibling','UNKNOWN']]){
  const inventory=createOverrideInventory(snapshot);inventory.observe([raw(['textStyleId'],nodeId)],'native-1');const v=inspect(inventory);assert.equal(v.checks[0].status,status);assert.equal(v.pending.length,0);assert.equal(v.checks[0].focusId,'instance');
 }
});
test('coverage preserves valid verdicts, UNKNOWN and explicit NOT_CHECKED without auto-upgrade',()=>{
 const inventory=createOverrideInventory(snapshot);inventory.observe([raw()],'native-1');const plan=[row('one',[req('textStyleId')])];
 for(const status of p.STATUSES){const v=inspect(inventory,plan,new Map([['one',{id:'one',status}]]));assert.equal(v.checks[0].status,status);assert.equal(v.pending.length,0);}
 assert.equal(inspect(inventory,plan).pending.length,1);
});
test('inventory changes invalidate an observed baseline; unknown scan can become available',()=>{
 const inventory=createOverrideInventory(snapshot);inventory.observe([raw()],'native-1');assert.throws(()=>inventory.observe([raw(['fills'])],'native-2'),{code:'AUDIT_STALE'});assert.equal(inspect(inventory).checks[0].field,'textStyleId');
 const pending=createOverrideInventory(snapshot);pending.observe([Object.assign(raw(),{overrides:undefined})],'native-1');pending.observe([raw()],'native-2');assert.equal(inspect(pending).inventory.unavailableScans,0);assert.equal(inspect(pending).inventory.fieldChanges,1);
});
test('metadata and projected plan budgets fail before committing new inventory',()=>{
 const inventory=createOverrideInventory(snapshot,{maxBytes:600});assert.throws(()=>inventory.observe([raw()],'native-1'),{code:'AUDIT_CONTEXT_BUDGET'});const v=inspect(inventory);assert.equal(v.inventory.pendingScans,1);assert.equal(v.inventory.fieldChanges,0);
});

function fixture(actions,options={}){
 const receipts=options.receipts||new Map(),saved=options.saved||new Map(),prompts=[],calls=[];let reads=0,waiting=false;
 const history={readRequest:id=>receipts.get(id),writeRequest:r=>receipts.set(r.requestId,structuredClone(r)),readRun:r=>saved.get(r.runId)};
 const knowledge=()=>({id:'fixture-release',skill:{id:'ab-audit-figma',version:'0.4.1'},documentRouting:'component-documents-v1',initial:[],instructions:'Synthetic fixture only',prepareRouting(){},routingProgress:()=>({nextReads:[]}),sources:()=>[{id:sourceId,offset:0,end:200}],assertCurrent(){},hasRead:(id,q)=>id===sourceId&&[quote,contentQuote].includes(q)});
 const service=createAuditService({protocol:p,knowledge,history,persist:r=>saved.set(r.runId,r),maxSteps:options.maxSteps||40,invoke:async({prompt,signal})=>{prompts.push(JSON.parse(prompt));const next=actions.shift();calls.push(next);if(next==='hold'){waiting=true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{code:'AUDIT_CANCELLED'})),{once:true}));}assert(next,'Unexpected extra fixture call');return {result:structuredClone(next)};}});
 const start={version:p.VERSION,controlVersion:'request-id-v1',requestId:'request',snapshot,platform:'desktop'};let run=service.start(start);
 const node=id=>{
  if(id==='instance'){reads++;return options.owner?options.owner(reads):raw();}
  if(id==='root')return {id,type:'FRAME',name:'Fixture root',children:['instance','sibling'],fills:[],unavailable:[]};
  return {id,type:'TEXT',name:'Label',parentId:id==='master-label'?'main':'instance',children:[],textStyleId:id==='master-label'?'baseline-style':options.mixed?{unavailable:'MIXED'}:'changed-style',characters:'Fixture text',unavailable:[]};
 };
 return {service,start,receipts,saved,prompts,calls,get(){return service.get(run.runId,run.requestId);},async drive(){
  for(let i=0;i<40;i++){
   await tick();run=this.get();try{if(run.pending?.operation==='read')service.context(run.runId,{requestId:run.requestId,callId:run.pending.callId,result:{nodes:run.pending.nodeIds.map(node)}});
   else if(run.pending?.operation==='source')service.context(run.runId,{requestId:run.requestId,callId:run.pending.callId,result:{root:{id:'main',type:'COMPONENT',name:'Fixture source',key:'fixture-key',children:['master-label'],unavailable:[]},nodes:[{id:'main',type:'COMPONENT',children:['master-label']},{id:'master-label',parentId:'main',type:'TEXT',name:'Label',children:[]}],excluded:[]}});
   else if(run.pending||waiting||['failed','cancelled','completed'].includes(run.status))return run;
   }catch(error){const stopped=this.get();if(stopped.status==='failed')return stopped;throw error;}
  }throw Error('Fixture did not reach a boundary');
 },complete(current=true){run=this.get();return service.context(run.runId,{requestId:run.requestId,callId:run.pending.callId,result:{current,snapshotId:snapshot.snapshotId}});},cancel(){return service.cancel(run.runId,run.requestId);}};
}
const normalActions=()=>[action('plan',{plan:[base]}),action('read_nodes',{nodeIds:['root']}),action('publish_checks',{checks:[verdict('base','native-2')]}),action('begin_report'),action('begin_report'),action('begin_report'),action('finish')];

test('routed0.4.1 receives obligations before its first model step; good rows survive bounded omission',async()=>{
 const f=fixture(normalActions()),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(f.calls.length,7);assert.equal(f.prompts[0].overrideCoverage.checks[0].field,'textStyleId');
 assert.equal(r.report.checks[0].status,'PASS');assert.equal(r.report.overrideCoverage.coverage.counts.NOT_CHECKED,1);assert.equal(r.report.coverage.percent,100);assert.equal(r.report.overrideCoverage.repair.expired,true);
 assert.equal(r.report.evidence['native-1'].identityOnly,true);assert.equal('overrides'in r.report.evidence['native-1'].result.nodes[0],false);assert.equal(r.report.evidence['native-1'].overrideMetadata[0].entries[0].fields[0],'textStyleId');
 const done=f.complete();assert.equal(done.report.overrideCoverage.freshness,'NATIVE_RECHECKED');assert.equal(done.report.overrideCoverage.provisional,false);
});
test('a correct typed source comparison can close the changed style as FAIL',async()=>{
 const bad=verdict('style','native-3',{status:'FAIL',actual:'changed-style',expected:'baseline-style',fix:'Restore the source style'});
 const f=fixture([action('read_source',{nodeIds:['main']}),action('plan',{plan:[base,style]}),action('read_nodes',{nodeIds:['root','label','master-label']}),action('publish_checks',{checks:[verdict('base','native-3'),bad]}),action('begin_report'),action('finish')]);
 const r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.overrideCoverage.checks[0].status,'FAIL');assert.equal(r.report.checks.find(c=>c.id==='style').status,'FAIL');assert.equal(r.report.overrideCoverage.repair,null);f.complete();
});
test('permitted content overrides are PASS only after typed target and exact Hub quote',async()=>{
 const content=row('content',[req('characters')]),check=verdict('content','native-2',{sourceQuote:contentQuote,factBindings:[{factId:content.requiredFields[0].id,evidenceId:'native-2'}]});
 const f=fixture([action('plan',{plan:[content]}),action('read_nodes',{nodeIds:['label']}),action('publish_checks',{checks:[check]}),action('begin_report'),action('finish')],{owner:()=>raw(['characters'])});
 const r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.overrideCoverage.checks[0].status,'PASS');assert.equal(r.report.findings.length,0);f.complete();
});
test('bootstrap override metadata cannot serve as typed visual proof',async()=>{
 const own=row('generic',[req('overrides','instance')]),check=verdict('generic','native-1',{factBindings:[{factId:own.requiredFields[0].id,evidenceId:'native-1'}]});
 const f=fixture([action('plan',{plan:[own]}),action('publish_checks',{checks:[check]}),action('begin_report'),action('begin_report'),action('begin_report'),action('finish')]);
 const r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks[0].status,'UNKNOWN');assert.equal(r.report.overrideCoverage.coverage.counts.NOT_CHECKED,1);f.complete();
});
test('an added exact field plan can be assessed after feedback without upgrading unavailable facts',async()=>{
 const changed=row('changed',[req('textStyleId')]),check=verdict('changed','native-3',{factBindings:[{factId:changed.requiredFields[0].id,evidenceId:'native-3'}]});
 const f=fixture([action('plan',{plan:[base]}),action('read_nodes',{nodeIds:['root']}),action('publish_checks',{checks:[verdict('base','native-2')]}),action('begin_report'),action('plan',{plan:[base,changed]}),action('read_nodes',{nodeIds:['label']}),action('publish_checks',{checks:[check]}),action('begin_report'),action('finish')],{mixed:true});
 const r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks.find(c=>c.id==='base').status,'PASS');assert.equal(r.report.checks.find(c=>c.id==='changed').status,'UNKNOWN');assert.equal(r.report.overrideCoverage.checks[0].status,'UNKNOWN');f.complete();
});
test('missing declared override verdict becomes NOT_CHECKED instead of discarding correct rows',async()=>{
 const changed=row('changed',[req('textStyleId')]);const actions=normalActions();actions[0]=action('plan',{plan:[base,changed]});const f=fixture(actions),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks.find(c=>c.id==='base').status,'PASS');assert.equal(r.report.checks.find(c=>c.id==='changed').status,'NOT_CHECKED');f.complete();
});
test('an unsupported changed field remains UNKNOWN without a synthetic alias',async()=>{
 const future=row('future',[req('futureField')]),check=verdict('future','native-2',{factBindings:[{factId:future.requiredFields[0].id,evidenceId:'native-2'}]});
 const f=fixture([action('plan',{plan:[future]}),action('read_nodes',{nodeIds:['label']}),action('publish_checks',{checks:[check]}),action('begin_report'),action('finish')],{owner:()=>raw(['futureField'])}),r=await f.drive();
 assert.equal(r.pending.operation,'verify');assert.equal(r.report.checks[0].status,'UNKNOWN');assert.equal(r.report.checks[0].factGaps[0].reason,'UNSUPPORTED_FACT');assert.equal(r.report.overrideCoverage.checks[0].status,'UNKNOWN');f.complete();
});
test('coverage feedback step exhaustion retains results and still performs native verify',async()=>{
 const f=fixture(normalActions(),{maxSteps:5}),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.completion,'STEP_BUDGET_EXHAUSTED');assert.equal(r.report.checks[0].status,'PASS');assert.equal(r.report.overrideCoverage.coverage.counts.NOT_CHECKED,1);f.complete();
});
test('Stop/export/restart retain residuals without running the model again',async()=>{
 const f=fixture(normalActions().slice(0,3).concat('hold'));await f.drive();const stopped=f.cancel();assert.equal(stopped.status,'cancelled');assert.equal(stopped.preview.checks[0].status,'PASS');assert.equal(stopped.overrideCoverage.coverage.counts.NOT_CHECKED,1);await tick();
 const restarted=fixture([],{receipts:f.receipts,saved:f.saved}),archived=restarted.get();assert.equal(archived.historical,true);assert.equal(archived.overrideCoverage.freshness,'HISTORICAL');assert.equal(archived.preview.overrideCoverage.freshness,'HISTORICAL');assert.equal(restarted.calls.length,0);
});
test('a changed owner inventory invalidates the run and preserves accepted rows',async()=>{
 const f=fixture(normalActions().slice(0,3).concat(action('read_nodes',{nodeIds:['instance']})),{owner:n=>raw(n===1?['textStyleId']:['fills'])}),r=await f.drive();assert.equal(r.status,'failed');assert.equal(r.error,'AUDIT_STALE');assert.equal(r.preview.checks[0].status,'PASS');assert.equal(r.overrideCoverage.freshness,'STALE');
});
test('unavailable scan stays UNKNOWN without pretending there are no overrides',async()=>{
 const f=fixture(normalActions().filter((_,i)=>i!==4&&i!==5),{owner:()=>Object.assign(raw(),{overrides:undefined})}),r=await f.drive();assert.equal(r.pending.operation,'verify');assert.equal(r.report.overrideCoverage.inventory.unavailableScans,1);assert.equal(r.report.overrideCoverage.coverage.counts.UNKNOWN,1);f.complete();
});
test('override coverage cannot bypass the final native freshness barrier',async()=>{
 const f=fixture(normalActions());await f.drive();assert.throws(()=>f.complete(false),{code:'AUDIT_STALE'});const r=f.get();assert.equal(r.status,'failed');assert.equal(r.overrideCoverage.freshness,'STALE');
});

test('proven styledTextSegments transport alias preserves the raw obligation and covers only that exact node',()=>{
 const {overrideFactField,fieldDefinitions}=require('../src/figma-audit/facts'),inventory=createOverrideInventory(snapshot,{fieldKey:overrideFactField});inventory.observe([raw(['styledTextSegments','fontSize'])],'native-1');const typed=row('ranges',[req('textSegments')]),value=inspect(inventory,[typed],new Map([['ranges',{status:'PASS'}]])),ranges=value.checks.find(c=>c.field==='styledTextSegments');assert.equal(ranges.factField,'textSegments');assert.equal(ranges.status,'PASS');assert.equal(value.inventory.fieldChanges,2);assert.equal(value.checks.find(c=>c.field==='fontSize').status,'NOT_CHECKED');assert.equal(raw(['styledTextSegments']).overrides[0].overriddenFields[0],'styledTextSegments');assert.match(fieldDefinitions.find(f=>f.id==='textSegments').hint,/Other range properties remain unproven/);
 assert.equal(inspect(inventory,[row('other',[req('textSegments','sibling')],['root'])]).checks.find(c=>c.field==='styledTextSegments').status,'NOT_CHECKED');const legacy=createOverrideInventory(snapshot);legacy.observe([raw(['styledTextSegments'])],'native-1');assert.equal(inspect(legacy,[typed],new Map([['ranges',{status:'PASS'}]])).checks[0].status,'NOT_CHECKED');
});

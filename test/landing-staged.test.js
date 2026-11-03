'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('../src/landing/checkpoints'),{createLandingService}=require('../src/landing/service');
const workflow='staged-content-v1',sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
const key='a'.repeat(40),guide={id:'knowledge/data/ds-ai-hub/products/ab/patterns/fixture.md',sha256:'b'.repeat(64),mode:'read',path:[],offset:0,text:'Documented fixture foundation and component rules; published key '+key};
const cite=row=>({id:row.id,sha256:row.sha256,path:row.path,offset:row.offset,observation:'Read the declared source range.'});
const foundation={container:{role:'surface',type:'INSTANCE',componentKey:key},mount:{role:'main',type:'SLOT',componentKey:null},layout:{spacingToken:'fixture-token'}};
const outline={facts:[{id:'offer',value:'Confirmed fixture offer'}],sections:['hero','benefits','steps','faq','cta'].map(id=>({id,role:id,contentShape:{items:1,textFields:1},sourceIds:[],nodeId:null}))};
const target={fileKey:'FixtureFile',pageId:'page',rootNodeId:'root',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
function fixture(t,{partial=false,repeat=false,wrongKey=false,stall=false,outlineRead=false,outlineOverride=null}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-staged-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const virtual={foundation:false,sections:[],texts:{},partial:false},calls=[],reads=[],mutations=[];
 const snapshot=()=>{
  const nodes=[{id:'root',parentId:'page',type:'FRAME',name:'Root',role:'',sectionId:null}];
  if(virtual.foundation)nodes.push({id:'surface',parentId:'root',type:'INSTANCE',name:'Source foundation',role:'surface',sectionId:null,componentKey:key},{id:'main',parentId:'surface',type:'SLOT',name:'Source mount',role:'main',sectionId:null});
  const sections=virtual.sections.map(id=>({id:'node-'+id,sectionId:id,fingerprint:sha([id,virtual.texts[id]||'Placeholder',wrongKey?'wrong':key])}));
  for(const row of sections)nodes.push({id:row.id,parentId:'main',type:'INSTANCE',name:row.sectionId,role:'',sectionId:row.sectionId,componentKey:wrongKey?'c'.repeat(40):key,componentProperties:{View:{type:'VARIANT',value:'Fixture'}}},{id:'text-'+row.sectionId,parentId:row.id,type:'TEXT',name:'Title',role:'',sectionId:row.sectionId,characters:virtual.texts[row.sectionId]||'Placeholder',fontName:{family:'Fixture',style:'Regular'},hasMissingFont:false});
  return {rootNodeId:'root',pageId:'page',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:nodes.length,instanceCount:virtual.foundation?1+sections.length:0,sections,text:Object.values(virtual.texts).join('\n'),coverage:'tagged-sections-and-text',native:{schemaVersion:'apollo.landing-native.v1',nodes}};
 };
 const source={id:'fixture',knowledgeVersion:'fixture',resumePin:'fixture-pin',skill:{id:'ab-generate-custom-landing',generation:{workflow},version:'0.4.0',sha256:'fixture'},assertCurrent(){},initial:{norms:[guide],instructions:{},workflow:[],resources:[]},list(query,offset){return {query,offset,total:1,next:null,resources:[{id:'knowledge/data/ds-ai-hub/'+query+'instructions.md'}]};},read(req){reads.push(req.id);return {...req,sha256:guide.sha256,text:'Documented component fixture published key '+key,next:null,total:68};}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  const ctx=JSON.parse(options.prompt.split('\n').at(-1));calls.push(ctx);let kind='continue',resources=[],sectionPatch=null,result={};const stage=ctx.execution?.stage,id=ctx.execution?.activeSectionId;
  if(!ctx.execution){kind=outlineRead&&calls.length===1?'list_resources':'build';result={};}
  else if(stage.startsWith('prepare-')){
   const componentId=id&&'knowledge/data/ds-ai-hub/products/ab/components/'+id+'/instructions.md';
   if(stall)result.partial=true;
   else if(stage==='prepare-structure'&&!ctx.resources.some(r=>r.id===componentId)||repeat){kind='list_resources';resources=[];}
   else{
    const row=stage==='prepare-structure'?ctx.resources.find(r=>r.id===componentId):guide;
    const decision=stage==='prepare-foundation'?foundation:stage==='prepare-structure'?{root:{type:'INSTANCE',componentKey:key},props:{View:'Fixture'},slots:['Title'],layout:{}}:{texts:[{target:'Title',value:'Text-'+id,factIds:['offer']}],assets:[]};
    result.preparationPatch={stage,sectionId:id,baseRevision:0,sources:[cite(row)],decision};
   }
  }else if(stage==='foundation'){virtual.foundation=true;mutations.push(stage);}
  else if(stage==='structure'){
   if(partial&&id==='hero'&&!virtual.partial){virtual.partial=true;result.partial=true;}else{if(!virtual.sections.includes(id))virtual.sections.push(id);sectionPatch={sectionId:id,nodeId:'node-'+id};}
   assert.deepEqual(Object.keys(virtual.texts),[]);mutations.push(stage+':'+id);
  }else if(stage==='content'){
   assert.equal(virtual.sections.length,5);virtual.texts[id]='Text-'+id;mutations.push(stage+':'+id);
  }else if(stage==='verify'){
   const scopes=outline.sections.map(s=>({id:s.id,nodeId:'node-'+s.id})).concat({id:'page',nodeId:'root'}),prior=ctx.execution.screenshots,missing=scopes.filter(s=>!prior.some(v=>v.nodeId===s.nodeId)),fresh=[];
   for(const scope of missing.slice(0,2)){const callId='shot-'+calls.length+'-'+scope.id;options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',id:callId,tool:'get_screenshot',status:'completed',arguments:{nodeId:scope.nodeId},result:{content:[{type:'image',mimeType:'image/png',data:'c3ludGhldGlj'}]}}});fresh.push({scope:scope.id,modelStep:ctx.limits.modelStepsLimit-ctx.limits.modelStepsRemaining,callId,verdict:'PASS',evidence:'Synthetic image only'});}
   if(missing.length<=2){kind='finish';result={summary:'Synthetic staged fixture',checks:[{verdict:'PASS',critical:true,evidence:'Synthetic source checks'}],visualReviews:prior.map(s=>({scope:s.sectionId||scopes.find(v=>v.nodeId===s.nodeId)?.id||'page',modelStep:s.modelStep,callId:s.callId,verdict:'PASS',evidence:'Synthetic image only'})).concat(fresh)};}
   else result.partial=true;
  }else throw Error('Unexpected stage '+stage);
  if(kind==='continue')result.checkpoint={sectionId:id,status:result.partial?'partial':'complete',nextAction:'Next assigned unit'};
  delete result.partial;
  const output={kind,message:stage||'Outline ready',query:kind==='list_resources'?'products/ab/components/'+(id||'fixture')+'/':'',offset:0,resources,resultJson:JSON.stringify(result)};
  if(!ctx.execution)output.specJson=JSON.stringify(ctx.spec.foundation?.plan||ctx.spec.sections.some(s=>s.nodeId)?ctx.spec:{...outline,...outlineOverride});else output.sectionPatch=sectionPatch;
  return {result:output,receipt:{mcp:{toolCalls:stage&&['foundation','structure','content'].includes(stage)?1:0}}};
 }})});
 const chat=service.create({fileKey:target.fileKey,pageId:target.pageId});
 const submit=async()=>{const c=service.poll(chat.id);service.submit(chat.id,{requestId:crypto.randomUUID(),revision:c.revision,text:'Build the fixture'});await service.whenSettled(chat.id);return service.poll(chat.id);};
 const observe=async()=>{const c=service.poll(chat.id);service.observation(chat.id,{revision:c.revision,readback:snapshot()});await service.whenSettled(chat.id);return service.poll(chat.id);};
 return {service,chat,calls,reads,mutations,snapshot,submit,observe,virtual};
}
test('outline reserves staged work within48 while legacy remains24',()=>{
 assert.equal(cp.preparationBudget(outline.sections,{workflow}).modelLimit,48);assert.equal(cp.preparationBudget(outline.sections,{workflow}).limit,6);assert.equal(cp.preparationBudget(outline.sections).limit,14);
});
test('five sections are prepared locally, assembled before content, and independently confirmed through final images',async t=>{
 const h=fixture(t,{partial:true}),start=await h.submit();assert.equal(start.status,'awaiting-canvas');assert.equal(start.source.workflow,workflow);assert.deepEqual(h.reads,[]);
 h.service.canvas(h.chat.id,{revision:start.revision,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);let current=h.service.poll(h.chat.id),turns=0;
 while(current.status==='awaiting-readback'){current=await h.observe();assert(++turns<48);}
 assert.equal(current.status,'completed',JSON.stringify(current.error||current.result?.verification));assert.equal(current.result.Ready,false);assert.equal(current.execution.structures.length,5);assert.equal(current.execution.completed.length,5);assert.deepEqual(current.spec.facts,outline.facts);assert.deepEqual(current.spec.foundation.plan.decision,foundation);assert(h.calls.length<=48);assert.equal(h.mutations[0],'foundation');assert(h.mutations.indexOf('content:hero')>h.mutations.indexOf('structure:cta'));
 assert(h.calls.findIndex(c=>c.execution?.stage==='structure'&&c.execution.activeSectionId==='hero')<h.calls.findIndex(c=>c.execution?.stage==='prepare-structure'&&c.execution.activeSectionId==='cta'));
 assert(h.calls.slice(1).every((c,i)=>c.limits.modelStepsRemaining===h.calls[i].limits.modelStepsRemaining-1));
});
test('Stop and an explicit continuation preserve the root and resume the unfinished content unit',async t=>{
 const h=fixture(t),start=await h.submit();h.service.canvas(h.chat.id,{revision:1,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);let current=h.service.poll(h.chat.id);
 for(let n=0;n<35&&!(current.execution.stage==='content'&&current.execution.activeSectionId==='benefits');n++)current=await h.observe();
 assert.equal(current.execution.stage,'content');const before=copy(current.spec.sections);h.service.cancel(h.chat.id);
 current=await h.submit();assert.equal(current.status,'awaiting-canvas');h.service.canvas(h.chat.id,{revision:current.revision,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);current=h.service.poll(h.chat.id);
 assert.equal(current.execution.stage,'content');assert.equal(current.execution.activeSectionId,'benefits');assert.deepEqual(current.spec.sections,before);assert.equal(h.virtual.sections.length,5);
 for(let n=0;n<24&&current.status==='awaiting-readback';n++)current=await h.observe();
 assert.equal(current.status,'completed',JSON.stringify(current.error));assert.equal(current.execution.completed.length,5);
});
test('a prepared delta remains pending until unchanged readback and cannot affect a neighbor',async t=>{
 const h=fixture(t),start=await h.submit();h.service.canvas(h.chat.id,{revision:1,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);
 assert.equal(h.service.poll(h.chat.id).spec.foundation,undefined);let current=await h.observe();assert.deepEqual(current.spec.foundation.plan.decision,foundation);
 while(!(current.execution.stage==='structure'&&current.execution.activeSectionId==='benefits'))current=await h.observe();
 const bad=h.snapshot();bad.native.nodes.find(n=>n.id==='text-hero').characters='Unexpected neighbor edit';
 assert.throws(()=>h.service.observation(h.chat.id,{revision:1,readback:bad}),{code:'LANDING_SECTION_SCOPE_CHANGED'});assert.equal(h.service.poll(h.chat.id).spec.sections[1].nodeId,null);
});
test('foundation descriptors are source data and support a documented frame foundation',()=>{
 const plan={decision:{container:{role:'canvas',type:'FRAME',componentKey:null},mount:{role:'children',type:'FRAME',componentKey:null},layout:{}}};
 const readback={rootNodeId:'root',native:{nodes:[{id:'root',type:'FRAME',role:''},{id:'a',parentId:'root',type:'FRAME',role:'canvas'},{id:'b',parentId:'a',type:'FRAME',role:'children'}]}};
 assert.equal(cp.foundationNodes({foundation:{plan}},readback).mount.id,'b');readback.native.nodes[2].type='INSTANCE';assert.equal(cp.foundationNodes({foundation:{plan}},readback),null);
});
test('stage transitions do not reset the fixed48 model budget',async t=>{
 const h=fixture(t,{stall:true}),start=await h.submit();h.service.canvas(h.chat.id,{revision:1,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);let current=h.service.poll(h.chat.id);
 for(let n=0;n<50&&current.status==='awaiting-readback';n++)current=await h.observe();
 assert.equal(current.error.code,'LANDING_STEP_BUDGET');assert.equal(h.calls.length,48);assert.equal(current.target.rootNodeId,'root');assert.deepEqual(h.mutations,[]);
});
test('repeated reads during unit preparation retain no-progress and the created root',async t=>{
 const h=fixture(t,{repeat:true}),start=await h.submit();h.service.canvas(h.chat.id,{revision:1,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);const current=h.service.poll(h.chat.id);
 assert.equal(current.error.code,'LANDING_NO_PROGRESS');assert.equal(current.target.rootNodeId,'root');assert.deepEqual(h.mutations,[]);assert(h.calls.length<10);
});
test('future component reads are deferred out of the outline before native root creation',async t=>{
 const h=fixture(t,{outlineRead:true}),current=await h.submit();assert.equal(current.status,'awaiting-canvas');assert.deepEqual(h.reads,[]);assert.equal(h.calls.length,2);assert.equal(h.calls[1].resourceFeedback.deferredToExecution,1);
});
test('outline plans cannot forge host admission and chosen keys require actual source evidence',()=>{
 const state={workflow,sourcePin:'pin',stage:'prepare-foundation',activeSectionId:null,queue:['hero'],completed:[],structures:[]},snapshot={rootNodeId:'root',sections:[],native:{nodes:[{id:'root',type:'FRAME',role:''}]}},spec={sections:[{id:'hero'}],foundation:{plan:{sourcePin:'pin',revision:1,decision:foundation}}};
 assert.throws(()=>cp.observed(state,snapshot,snapshot,{sectionId:null,status:'complete',nextAction:'Write'},spec,0),{code:'LANDING_PREPARATION_REQUIRED'});
 const patch={stage:'prepare-foundation',sectionId:null,baseRevision:0,sources:[cite(guide)],decision:{...foundation,container:{...foundation.container,componentKey:'c'.repeat(40)}}};
 assert.throws(()=>cp.preparationPatch(state,{preparationPatch:patch},{status:'complete'},null,[guide],0),{code:'LANDING_PREPARATION_SOURCE_UNCONFIRMED'});
});
for(const [label,outlineOverride,code]of [['unresolved brief',{questions:[{id:'q',status:'open'}]},'LANDING_BRIEF_UNRESOLVED'],['missing shape',{sections:[{id:'hero',role:'offer'}]},'LANDING_SPEC_INVALID'],['missing fact IDs',{facts:['unsupported shape']},'LANDING_SPEC_INVALID']])test('outline refuses '+label+' before canvas creation',async t=>{
 const h=fixture(t,{outlineOverride}),result=await h.submit();assert.equal(result.error.code,code);assert.equal(result.target,null);assert.deepEqual(h.mutations,[]);
});
test('content text values are verified at their independently bound targets, including equal values',()=>{
 const readback={native:{nodes:[{id:'title',name:'Title',type:'TEXT',sectionId:'hero',characters:'Business card'},{id:'cta',name:'CTA',type:'TEXT',sectionId:'hero',characters:'Apply'}]}},decision={texts:[{target:'Title',value:'Business card',factIds:[]},{target:'CTA',value:'Apply',factIds:[]}],assets:[]},plan={decision,targets:cp.bindContentTargets(decision,'hero',readback)};
 assert.equal(cp.contentConfirmed(plan,'hero',readback),true);
 const swapped=copy(readback);[swapped.native.nodes[0].characters,swapped.native.nodes[1].characters]=[swapped.native.nodes[1].characters,swapped.native.nodes[0].characters];assert.equal(cp.contentConfirmed(plan,'hero',swapped),false);
 const renamed=copy(readback);renamed.native.nodes[0].id='replacement';renamed.native.nodes[1].name='Title';assert.equal(cp.contentConfirmed(plan,'hero',renamed),false);
 const duplicate={texts:[{target:'title',value:'Same',factIds:[]},{target:'Title',value:'Same',factIds:[]}],assets:[]};assert.throws(()=>cp.bindContentTargets(duplicate,'hero',readback),{code:'LANDING_CONTENT_TARGET_INVALID'});
 const equalDecision={texts:decision.texts.map(t=>({...t,value:'Same'})),assets:[]},equalReadback=copy(readback);equalReadback.native.nodes.forEach(n=>n.characters='Same');assert.equal(cp.contentConfirmed({decision:equalDecision,targets:cp.bindContentTargets(equalDecision,'hero',readback)},'hero',equalReadback),true);
});
test('asset identities are bound to separate slots, not found elsewhere in the section',()=>{
 const a='a'.repeat(40),b='b'.repeat(40),before={native:{nodes:[{id:'left',name:'LeftImage',type:'SLOT',sectionId:'hero'},{id:'right',name:'RightImage',type:'SLOT',sectionId:'hero'}]}},decision={texts:[],assets:[{target:'LeftImage',kind:'component',key:a,resourceId:guide.id,path:[]},{target:'RightImage',kind:'component',key:b,resourceId:guide.id,path:[]}]},plan={decision,targets:cp.bindContentTargets(decision,'hero',before)},after=copy(before);
 after.native.nodes.push({id:'left-asset',parentId:'left',type:'INSTANCE',sectionId:'hero',componentKey:a},{id:'right-asset',parentId:'right',type:'INSTANCE',sectionId:'hero',componentKey:b});assert.equal(cp.contentConfirmed(plan,'hero',after),true);
 const swapped=copy(after);[swapped.native.nodes[2].componentKey,swapped.native.nodes[3].componentKey]=[b,a];assert.equal(cp.contentConfirmed(plan,'hero',swapped),false);
 const foreign=copy(after);foreign.native.nodes[2].parentId='right';assert.equal(cp.contentConfirmed(plan,'hero',foreign),false);
 const imageDecision={texts:[],assets:decision.assets.map(v=>({...v,kind:'image'}))},images=copy(before);images.native.nodes.push({id:'paint-left',parentId:'left',type:'RECTANGLE',sectionId:'hero',imageHashes:[{imageHash:a,visible:true}]},{id:'paint-right',parentId:'right',type:'RECTANGLE',sectionId:'hero',imageHashes:[{imageHash:b,visible:true}]});const imagePlan={decision:imageDecision,targets:cp.bindContentTargets(imageDecision,'hero',before)};assert.equal(cp.contentConfirmed(imagePlan,'hero',images),true);images.native.nodes[2].imageHashes[0].imageHash=b;images.native.nodes[3].imageHashes[0].imageHash=a;assert.equal(cp.contentConfirmed(imagePlan,'hero',images),false);
});
test('ambiguous, foreign and nested duplicate targets cannot share a content witness',()=>{
 const nodes=[{id:'left',name:'Image',type:'SLOT',sectionId:'hero'},{id:'right',name:'Image',type:'SLOT',sectionId:'hero'},{id:'foreign',name:'OtherImage',type:'SLOT',sectionId:'other'}],asset=target=>({target,kind:'component',key,resourceId:guide.id,path:[]});
 for(const target of ['Image','foreign','missing'])assert.throws(()=>cp.bindContentTargets({texts:[],assets:[asset(target)]},'hero',{native:{nodes}}),{code:'LANDING_CONTENT_TARGET_INVALID'});
 const nested={native:{nodes:[{id:'outer',name:'Outer',type:'FRAME',sectionId:'hero'},{id:'inner',parentId:'outer',name:'Inner',type:'SLOT',sectionId:'hero'},{id:'asset',parentId:'inner',type:'INSTANCE',componentKey:key,sectionId:'hero'}]}},decision={texts:[],assets:[asset('outer'),asset('inner')]};assert.equal(cp.contentConfirmed({decision,targets:cp.bindContentTargets(decision,'hero',nested)},'hero',nested),false);
});
test('resume rejects a changed previously confirmed structure plan before any content write',()=>{
 const structurePlan={revision:1,sourcePin:'pin',decision:{root:{type:'INSTANCE',componentKey:key},props:{},slots:[],layout:{}}},contentPlan={revision:1,sourcePin:'pin',decision:{texts:[],assets:[]},targets:{texts:[],assets:[]}},sections=['hero','benefits'].map(id=>({id,nodeId:'node-'+id,structurePlan:copy(structurePlan),contentPlan:copy(contentPlan)})),readback={sections:sections.map(s=>({id:s.nodeId,sectionId:s.id,fingerprint:sha(s.id)}))};
 const execution={schemaVersion:'apollo.landing-checkpoints.v2',workflow,sourcePin:'pin',rootNodeId:'root',ownerNonce:target.ownerNonce,queue:['hero','benefits'],stage:'content',activeSectionId:'benefits',status:'interrupted',activePlanHash:sha(contentPlan),structures:readback.sections.map(row=>({...row,planHash:sha(structurePlan)})),completed:[{...readback.sections[0],planHash:sha(contentPlan)}]},record={source:{workflow},spec:{sections},target,readback,execution};
 assert.equal(cp.start(record,'pin',null).activeSectionId,'benefits');const changed=copy(record);changed.spec.sections[0].structurePlan.decision.props.View='Changed';assert.throws(()=>cp.start(changed,'pin',null),{code:'LANDING_CHECKPOINT_STALE'});
});
test('wrong component identity cannot complete a structural unit',async t=>{
 const h=fixture(t,{wrongKey:true}),start=await h.submit();h.service.canvas(h.chat.id,{revision:start.revision,target,readback:h.snapshot()});await h.service.whenSettled(h.chat.id);let current=h.service.poll(h.chat.id);
 for(let n=0;n<12&&current.status==='awaiting-readback';n++){try{current=await h.observe();}catch{current=h.service.poll(h.chat.id);}}
 assert.equal(current.status,'interrupted');assert.equal(current.error.code,'LANDING_STRUCTURE_UNCONFIRMED');assert.equal(current.spec.sections[0].nodeId,null);
});
test('prepare delta rejects unread sources, changed business facts and writes before readback',()=>{
 const state={workflow,stage:'prepare-foundation',activeSectionId:null},point={sectionId:null,status:'complete',nextAction:'Assemble'},patch={stage:'prepare-foundation',sectionId:null,baseRevision:0,sources:[cite(guide)],decision:foundation};
 for(const [value,reads,tools]of [[patch,[],0],[{...patch,facts:['changed']},[guide],0],[patch,[guide],1]])assert.throws(()=>cp.preparationPatch(state,{preparationPatch:value},point,null,reads,tools),/LANDING_/);
});

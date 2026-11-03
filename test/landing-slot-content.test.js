'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cp=require('../src/landing/checkpoints'),fixture=require('./fixtures/landing-slot-field.json');
const clone=v=>JSON.parse(JSON.stringify(v)),sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const capability='slot-content-replacement-v1';
function setup(){
 const before=clone(fixture.before),recipe=clone(fixture.recipe),source={id:'knowledge/data/ds-ai-hub/products/ab/components/corporate-content/cookbook/02-desktop.md',mode:'read',sha256:'d'.repeat(64),path:[],offset:0,text:'```apollo-slot-content-replacement\n'+JSON.stringify(recipe)+'\n```'},citation={id:source.id,sha256:source.sha256,path:[],offset:0,observation:'Read the documented exact slot replacement operation.'};
 const state={schemaVersion:'apollo.landing-checkpoints.v2',workflow:'staged-content-v1',recipeOperations:capability,sourcePin:'pin',rootNodeId:before.rootNodeId,queue:['hero','next'],structures:[],completed:[],stage:'prepare-foundation',activeSectionId:null,freshFoundation:true};
 const decision={...clone(fixture.foundationDecision),slotContentReplacement:recipe.id},patch=cp.preparationPatch(state,{preparationPatch:{stage:state.stage,sectionId:null,baseRevision:0,sources:[citation],decision}},{status:'complete'},null,[source],0);
 let spec=cp.confirmPreparation({sections:[{id:'hero',nodeId:null,structurePlan:{decision:clone(fixture.heroPlan)}},{id:'next'}]},state,patch,before,before);
 cp.observed(state,before,before,{status:'complete',nextAction:'Create foundation'},spec,0);
 cp.observed(state,before,before,{status:'complete',nextAction:'Prepare first block'},spec,0);
 state.stage='structure';state.activeSectionId='hero';
 const after=clone(before);after.native.nodes=after.native.nodes.filter(n=>!fixture.deletedIds.includes(n.id));
 after.native.nodes.push({id:fixture.heroId,parentId:fixture.bodyId,type:'INSTANCE',name:'Hero',role:'',sectionId:'hero',componentKey:'3aec61948e342dd87176a74cf156a0a25bd430e5',componentSetKey:fixture.heroPlan.root.componentKey});
 after.sections=[{id:fixture.heroId,sectionId:'hero',fingerprint:sha('actual created Hero ID; minimal replay')}];
 return {before,after,state,spec,source,citation,decision};
}
test('recorded first Body replacement is allowed after the recipe and full fresh payload are pinned',()=>{
 const h=setup();assert.doesNotThrow(()=>cp.protect(h.state,h.before,h.after,h.spec));
 cp.observed(h.state,h.before,h.after,null,h.spec,0);assert.equal(h.state.slotContentReplacement.consumed,true);assert.equal(h.state.slotContentReplacement.blockId,fixture.heroId);
 assert.equal(h.state.stage,'structure');assert.doesNotThrow(()=>cp.protect(h.state,h.after,h.after,h.spec));
});
test('the same recorded deletion without recipe admission remains rejected',()=>{
 const h=setup();delete h.state.slotContentReplacement;
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});
for(const kind of ['foreign slot','missing block','wrong component','partial deletion','modified payload','extra payload child','existing user content','later section','wrong source pin'])test('slot replacement rejects '+kind,()=>{
 const h=setup();
 if(kind==='foreign slot')h.after.native.nodes.at(-1).parentId=h.before.rootNodeId;
 if(kind==='missing block'){h.after.sections=[];h.after.native.nodes.pop();}
 if(kind==='wrong component'){h.after.native.nodes.at(-1).componentKey='f'.repeat(40);h.after.native.nodes.at(-1).componentSetKey='e'.repeat(40);}
 if(kind==='partial deletion')h.after.native.nodes.push(clone(h.before.native.nodes.find(n=>n.id===fixture.deletedIds[1])));
 if(kind==='modified payload')h.before.native.nodes.find(n=>n.id===fixture.deletedIds[1]).characters='User content';
 if(kind==='extra payload child')h.before.native.nodes.push({id:'user-child',parentId:fixture.deletedIds[0],type:'TEXT',sectionId:null,characters:'User content'});
 if(kind==='existing user content')h.state.freshFoundation=false;
 if(kind==='later section')h.state.activeSectionId='next';
 if(kind==='wrong source pin')h.state.sourcePin='other';
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),/LANDING_/);
});
for(const field of ['name','componentKey','boundVariables'])test('permitted payload removal does not permit a foundation '+field+' change',()=>{
 const h=setup(),node=h.after.native.nodes.find(n=>n.id==='14924:65257');node[field]=field==='boundVariables'?{}:'changed';
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),/LANDING_/);
});
test('recipe selection needs a real complete read, matching owner key and exact native mount',()=>{
 const h=setup(),state={workflow:'staged-content-v1',recipeOperations:capability,stage:'prepare-foundation',activeSectionId:null},value={stage:state.stage,sectionId:null,baseRevision:0,sources:[h.citation],decision:h.decision};
 for(const reads of [[],[{...h.source,mode:'summary'}],[{...h.source,text:h.source.text.replace(fixture.recipe.containerKey,'f'.repeat(40))}],[{...h.source,text:h.source.text.slice(0,-8)}]])assert.throws(()=>cp.preparationPatch(state,{preparationPatch:value},{status:'complete'},null,reads,0),/LANDING_/);
 const bad=setup();bad.state.slotContentReplacement.mountId='wrong';assert.throws(()=>cp.protect(bad.state,bad.before,bad.after,bad.spec),/LANDING_/);
});
test('an observed extra sibling is preserved even when the documented placeholder is removed',()=>{
 const h=setup();h.after.native.nodes.push({id:'extra-sibling',parentId:fixture.bodyId,type:'FRAME',name:'User sibling',sectionId:null});
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});
test('a preexisting foundation never gains a new default-payload deletion permission',()=>{
 const h=setup(),record={source:{workflow:h.state.workflow,recipeOperations:capability},spec:h.spec,target:{rootNodeId:h.before.rootNodeId,ownerNonce:'owner'},readback:h.before};
 const state=cp.start(record,'pin');assert.equal(state.freshFoundation,false);state.stage='foundation';
 assert.throws(()=>cp.observed(state,h.before,h.before,{status:'complete',nextAction:'First block'},h.spec,0),{code:'LANDING_SLOT_REPLACEMENT_UNCONFIRMED'});
});
test('a resumed consumed operation requires the same slot and already created block',()=>{
 const h=setup();cp.observed(h.state,h.before,h.after,null,h.spec,0);h.state.status='interrupted';
 const record={source:{workflow:h.state.workflow,recipeOperations:capability},spec:h.spec,target:{rootNodeId:h.before.rootNodeId,ownerNonce:'owner'},readback:h.after,execution:h.state};h.state.ownerNonce='owner';
 assert.equal(cp.start(record,'pin').slotContentReplacement.consumed,true);
 for(const mutate of [r=>r.readback.native.nodes.find(n=>n.id===fixture.heroId).parentId=r.readback.rootNodeId,r=>r.readback.sections=[],r=>r.readback.native.nodes.find(n=>n.id===fixture.bodyId).id='new-slot']){
  const bad=clone(record);mutate(bad);assert.throws(()=>cp.start(bad,'pin'),{code:'LANDING_CHECKPOINT_STALE'});
 }
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cp=require('../src/landing/checkpoints'),fixture=require('./fixtures/landing-slot-field.json');
const copy=x=>JSON.parse(JSON.stringify(x)),sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function setup(){
 const before=copy(fixture.before),decision={root:{type:'INSTANCE',componentKey:fixture.heroPlan.root.componentKey},props:{View:'Page'},slots:[],layout:{}},structurePlan={revision:1,sourcePin:'pin',decision};
 const plan={revision:1,sourcePin:'pin',decision:fixture.foundationDecision,slotContentRecipe:fixture.recipe};
 const state={schemaVersion:'apollo.landing-checkpoints.v2',workflow:'staged-content-v1',recipeOperations:'slot-content-replacement-v1',sourcePin:'pin',rootNodeId:before.rootNodeId,ownerNonce:before.ownerNonce,stage:'structure',activeSectionId:'hero',queue:['hero'],structures:[],completed:[],freshFoundation:true,activePlanHash:sha(structurePlan),slotContentReplacement:{sourcePin:'pin',foundationPlanHash:sha(plan),rootNodeId:before.rootNodeId,containerId:fixture.containerId||before.native.nodes.find(n=>n.role===fixture.foundationDecision.container.role).id,mountId:fixture.bodyId,nodes:before.native.nodes.filter(n=>fixture.deletedIds.includes(n.id)),consumed:false}};
 state.mcpObservations=[{sectionId:'hero',sourcePin:'pin',tool:'use_figma',truncated:false,text:JSON.stringify({ownership:{rootId:before.rootNodeId,owner:before.ownerNonce},createdNodeIds:['reported:obsolete']})}];
 const spec={foundation:{plan},sections:[{id:'hero',structurePlan}]},after=copy(before);after.native.nodes=after.native.nodes.filter(n=>!fixture.deletedIds.includes(n.id));const hero={id:'Icanonical:hero',parentId:fixture.bodyId,type:'INSTANCE',name:'Hero',role:'',sectionId:'hero',componentKey:decision.root.componentKey,componentProperties:{View:{type:'VARIANT',value:'Page'}}};after.native.nodes.push(hero);after.nodeCount=after.native.nodes.length;after.sections=[{id:hero.id,sectionId:'hero',fingerprint:sha('hero')}];return {before,after,state,spec,hero};
}
test('independently proved default collection additions do not change protected ancestors',()=>{
 const h=setup(),collection='VariableCollectionId:new/1:1';h.after.native.schemaVersion='apollo.landing-native.v2';h.after.native.modeDefaults={[collection]:'1:0'};
 for(const n of h.after.native.nodes.filter(n=>n.sectionId===null))n.resolvedVariableModes={...n.resolvedVariableModes,[collection]:'1:0'};
 assert.doesNotThrow(()=>cp.protect(h.state,h.before,h.after,h.spec));
});
for(const mode of ['missing-proof','non-default','existing-change','explicit-change','binding-change'])test('default admission still rejects '+mode,()=>{
 const h=setup(),collection='VariableCollectionId:new/1:1',root=h.after.native.nodes[0];h.after.native.schemaVersion='apollo.landing-native.v2';h.after.native.modeDefaults={[collection]:'1:0'};root.resolvedVariableModes={...root.resolvedVariableModes,[collection]:'1:0'};
 if(mode==='missing-proof')delete h.after.native.modeDefaults[collection];if(mode==='non-default')root.resolvedVariableModes[collection]='1:9';if(mode==='existing-change')root.resolvedVariableModes[Object.keys(h.before.native.nodes[0].resolvedVariableModes)[0]]='foreign';if(mode==='explicit-change')root.explicitVariableModes={[collection]:'1:0'};if(mode==='binding-change')root.boundVariables={fills:[{type:'VARIABLE_ALIAS',id:'changed'}]};
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});
test('a missing reported ID binds only the unique observed active typed child in its pinned mount',()=>{
 const h=setup(),bound=cp.confirmPatch(h.spec,{sectionId:'hero',nodeId:'reported:obsolete'},h.after,h.state);assert.equal(bound.sections[0].nodeId,h.hero.id);assert.equal(bound.sections[0].nodeBinding.reportedId,'reported:obsolete');
});
for(const mode of ['known-foreign-id','wrong-key','wrong-mount','duplicate-tag','wrong-source','unobserved-id'])test('canonical reconciliation refuses '+mode,()=>{
 const h=setup();let nodeId='reported:obsolete';if(mode==='known-foreign-id')nodeId=h.before.rootNodeId;if(mode==='unobserved-id')nodeId='arbitrary:typo';if(mode==='wrong-key')h.hero.componentKey='f'.repeat(40);if(mode==='wrong-mount')h.hero.parentId='foreign';if(mode==='duplicate-tag')h.after.sections.push({id:'other',sectionId:'hero',fingerprint:sha('other')});if(mode==='wrong-source')h.spec.sections[0].structurePlan.sourcePin='different';
 assert.throws(()=>cp.confirmPatch(h.spec,{sectionId:'hero',nodeId},h.after,h.state),{code:'LANDING_SECTION_PATCH_UNCONFIRMED'});
});
for(const schema of ['apollo.landing-native.v1','apollo.landing-native.v3'])test('default additions cannot be certified by '+schema,()=>{
 const h=setup(),collection='VariableCollectionId:new/1:1';h.after.native.schemaVersion=schema;h.after.native.modeDefaults={[collection]:'1:0'};h.after.native.nodes[0].resolvedVariableModes={...h.after.native.nodes[0].resolvedVariableModes,[collection]:'1:0'};
 assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});
test('a previously proved default cannot change or disappear from subsequent v2 evidence',()=>{
 const h=setup(),id='VariableCollectionId:established/1:1';h.before.native.schemaVersion='apollo.landing-native.v2';h.before.native.modeDefaults={[id]:'1:0'};h.after.native.schemaVersion='apollo.landing-native.v2';
 for(const proof of [{},{[id]:'1:9'}]){h.after.native.modeDefaults=proof;assert.throws(()=>cp.protect(h.state,h.before,h.after,h.spec),{code:'LANDING_SECTION_SCOPE_CHANGED'});}
});

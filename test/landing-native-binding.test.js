'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cp=require('../src/landing/checkpoints'),fixture=require('./fixtures/landing-slot-field.json');
const copy=v=>JSON.parse(JSON.stringify(v)),sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function setup(){
 const plan={revision:1,sourcePin:'pin',sources:[],decision:copy(fixture.heroPlan)},spec={facts:[{id:'offer',value:'Confirmed'}],foundation:{plan:{decision:copy(fixture.foundationDecision)}},sections:[{id:'hero',structurePlan:plan},{id:'other',role:'Preserve'}]};
 const state={workflow:'staged-content-v1',sourcePin:'pin',stage:'structure',activeSectionId:'hero',activePlanHash:sha(plan),queue:['hero','other'],structures:[],completed:[]},before=copy(fixture.before),after=copy(before);
 const hero={id:fixture.heroId,parentId:fixture.bodyId,type:'INSTANCE',name:'Hero',role:'',sectionId:'hero',componentKey:'a'.repeat(40),componentSetKey:fixture.heroPlan.root.componentKey,componentProperties:{View:{type:'VARIANT',value:'Page'},Appearance:{type:'VARIANT',value:'Light'},Background:{type:'VARIANT',value:'False'},Compact:{type:'VARIANT',value:'False'},'BlurEffect#123':{type:'BOOLEAN',value:true}}};
 after.native.nodes.push(hero);after.nodeCount++;after.instanceCount++;after.sections=[{id:hero.id,sectionId:'hero',fingerprint:sha(hero)}];
 return {spec,state,before,after,hero,patch:{sectionId:'hero',nodeId:hero.id}};
}
test('retained bool/VARIANT settings bind to the exact native API and complete without changing semantic choices',()=>{
 const h=setup(),original=copy(h.spec),bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state),plan=bound.sections[0].structurePlan;
 assert.equal(plan.revision,2);assert.deepEqual(plan.decision.props,{View:'Page',Appearance:'Light',Background:'False',Compact:'False','BlurEffect#123':true});assert.equal(plan.apiBinding.origin,'host-native-api-binding');assert.equal(plan.apiBinding.readbackHash,sha(h.after));assert.equal(h.state.activePlanHash,sha(plan));cp.assertPrepared(bound,h.state);
 assert.deepEqual(h.spec,original);assert.deepEqual(bound.facts,original.facts);assert.deepEqual(bound.sections[1],original.sections[1]);for(const key of ['root','slots','layout'])assert.deepEqual(plan.decision[key],original.sections[0].structurePlan.decision[key]);
 cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0);assert.equal(h.state.structures.length,1);assert.equal(h.state.stage,'prepare-structure');assert.equal(h.state.activeSectionId,'other');
});
for(const attack of ['changed-value','text-property','ambiguous-alias','wrong-key','wrong-source'])test('native property binding refuses '+attack,()=>{
 const h=setup();if(attack==='changed-value')h.hero.componentProperties.Background.value='True';if(attack==='text-property')h.hero.componentProperties.Background.type='TEXT';if(attack==='ambiguous-alias')h.hero.componentProperties['BlurEffect#456']={type:'BOOLEAN',value:true};if(attack==='wrong-key')h.hero.componentSetKey='b'.repeat(40);if(attack==='wrong-source')h.spec.sections[0].structurePlan.sourcePin='other';
 const plan=copy(h.spec.sections[0].structurePlan),bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.deepEqual(bound.sections[0].structurePlan,plan);assert.throws(()=>cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0),{code:'LANDING_STRUCTURE_UNCONFIRMED'});
});
test('a string cannot be silently converted to a BOOLEAN public property',()=>{
 const h=setup();h.spec.sections[0].structurePlan.decision.props.BlurEffect='True';const bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.equal(bound.sections[0].structurePlan.decision.props.BlurEffect,'True');assert.equal(bound.sections[0].structurePlan.apiBinding,undefined);
});

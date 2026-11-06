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
test('unbound semantic action names reopen only active preparation without dropping intent',()=>{
 const h=setup();h.spec.sections[0].structurePlan.decision.props.PrimaryAction=true;const original=copy(h.spec.sections[0].structurePlan);h.state.activePlanHash=sha(original);
 const bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.deepEqual(bound.sections[0].structurePlan,original);assert.deepEqual(h.state.bindingIssue.unbound,['PrimaryAction']);
 cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0);assert.equal(h.state.stage,'prepare-structure');assert.equal(h.state.activeSectionId,'hero');assert.equal(h.state.structures.length,0);assert.equal(bound.sections[0].structurePlan.decision.props.PrimaryAction,true);assert.equal(h.state.lastCheckpoint.complete,false);
});
test('an unknown action name cannot hide a known variant value conflict',()=>{
 const h=setup();h.spec.sections[0].structurePlan.decision.props.PrimaryAction=true;h.hero.componentProperties.Background.value='True';const bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);
 assert.throws(()=>cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0),{code:'LANDING_STRUCTURE_UNCONFIRMED'});
});
test('API repair is bounded per section, with no global two-component ceiling',()=>{
 const h=setup();for(const key of ['PrimaryAction','SecondaryAction','BottomSlot'])h.spec.sections[0].structurePlan.decision.props[key]=true;h.state.activePlanHash=sha(h.spec.sections[0].structurePlan);
 h.state.apiBindingRepairs=4;h.state.apiBindingRepairsBySection=[{sectionId:'other',attempts:2},{sectionId:'previous',attempts:2}];
 const bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.deepEqual(h.state.bindingIssue.unbound,['PrimaryAction','SecondaryAction','BottomSlot']);
 cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0);assert.equal(h.state.stage,'prepare-structure');assert.equal(h.state.apiBindingRepairs,5);assert.equal(h.state.apiBindingRepairsBySection.find(row=>row.sectionId==='hero').attempts,1);
 h.state.stage='structure';h.state.apiBindingRepairsBySection.find(row=>row.sectionId==='hero').attempts=2;
 assert.throws(()=>cp.observed(h.state,h.before,h.after,{status:'complete',nextAction:'Next'},bound,0),{code:'LANDING_NATIVE_API_BINDING_REQUIRED'});assert.equal(h.state.structures.length,0);
});
function canonicalReceipt(format='v1'){
 const h=setup();h.state.rootNodeId=h.after.rootNodeId;h.state.ownerNonce=h.after.ownerNonce;h.patch.nodeId='reported:temporary';h.hero.id='Icanonical:hero';h.after.sections[0].id=h.hero.id;
 const root=h.after.native.nodes.find(n=>n.id===h.after.rootNodeId),ownership={rootId:h.state.rootNodeId,owner:h.state.ownerNonce,parentId:root.parentId,pageId:h.after.pageId,active:h.after.leaseNonce};
 h.value=format==='root'?{root:{id:ownership.rootId,owner:ownership.owner,parentId:ownership.parentId,pageId:ownership.pageId,active:ownership.active},createdNodeIds:[h.patch.nodeId]}:{schemaVersion:'apollo.mcp-write-result.v1',operationId:'operation',sourcePin:'pin',stage:'structure',sectionId:'hero',ownership,createdNodeIds:[h.patch.nodeId],mutatedNodeIds:[],section:null};
 h.observation={tool:'use_figma',sectionId:'hero',sourcePin:'pin',operationId:'operation',executionStage:'structure',truncated:false,text:JSON.stringify(h.value)};
 h.state.mcpObservations=[h.observation];return h;
}
for(const format of ['v1','root'])test('canonical binding accepts correlated '+format+' receipt and retains semantic plan',()=>{
 const h=canonicalReceipt(format),bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.equal(bound.sections[0].nodeId,h.hero.id);assert.deepEqual(bound.facts,h.spec.facts);assert.deepEqual(bound.sections[1],h.spec.sections[1]);
});
for(const mode of ['wrong-operation','wrong-stage','wrong-source','wrong-section','wrong-owner','wrong-parent','wrong-page','wrong-lease','conflicting-root','unknown-version','unreported-id','truncated'])test('versioned write receipt refuses '+mode,()=>{
 const h=canonicalReceipt();
 if(mode==='wrong-operation')h.value.operationId='other';if(mode==='wrong-stage')h.value.stage='content';if(mode==='wrong-source')h.value.sourcePin='other';if(mode==='wrong-section')h.value.sectionId='other';
 if(mode==='wrong-owner')h.value.ownership.owner='foreign';if(mode==='wrong-parent')h.value.ownership.parentId='foreign';if(mode==='wrong-page')h.value.ownership.pageId='foreign';if(mode==='wrong-lease')h.value.ownership.active='foreign';
 if(mode==='conflicting-root')h.value.root={id:'foreign',owner:h.state.ownerNonce};if(mode==='unknown-version')h.value.schemaVersion='foreign';if(mode==='unreported-id')h.value.createdNodeIds=[];if(mode==='truncated')h.observation.truncated=true;
 h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:['unknown-version','unreported-id'].includes(mode)?'LANDING_SECTION_PATCH_UNCONFIRMED':'LANDING_MCP_RECEIPT_INVALID'});
});
for(const field of ['owner','parentId','pageId','active'])test('legacy root receipt preserves independent '+field+' proof',()=>{
 const h=canonicalReceipt('root');h.value.root[field]='foreign';h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_SECTION_PATCH_UNCONFIRMED'});
});
test('a direct canonical ID cannot bypass a conflicting versioned ownership receipt',()=>{
 const h=canonicalReceipt();h.patch.nodeId=h.hero.id;h.value.ownership.owner='foreign';h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_MCP_RECEIPT_INVALID'});
});

test('an unsupported write-result version cannot bypass validation through a direct canonical ID',()=>{
 const h=canonicalReceipt();h.patch.nodeId=h.hero.id;h.value.schemaVersion='apollo.mcp-write-result.v2';h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_MCP_RECEIPT_INVALID'});
});
for(const field of ['createdNodeIds','mutatedNodeIds'])for(const mode of ['missing','null','object','number-id','empty-id','long-id','too-many'])test('new receipt refuses '+field+' '+mode,()=>{
 const h=canonicalReceipt();
 if(mode==='missing')delete h.value[field];if(mode==='null')h.value[field]=null;if(mode==='object')h.value[field]={};if(mode==='number-id')h.value[field]=[42];if(mode==='empty-id')h.value[field]=[''];if(mode==='long-id')h.value[field]=['x'.repeat(513)];if(mode==='too-many')h.value[field]=Array(257).fill('id');
 h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_MCP_RECEIPT_INVALID'});
});
for(const mode of ['missing','array','string','missing-id','empty-parent','number-type','wrong-context'])test('new receipt refuses section '+mode,()=>{
 const h=canonicalReceipt();h.value.section={id:h.patch.nodeId,parentId:h.hero.parentId,type:h.hero.type,sectionId:'hero'};
 if(mode==='missing')delete h.value.section;if(mode==='array')h.value.section=[];if(mode==='string')h.value.section='hero';if(mode==='missing-id')delete h.value.section.id;if(mode==='empty-parent')h.value.section.parentId='';if(mode==='number-type')h.value.section.type=42;if(mode==='wrong-context')h.value.section.sectionId='other';
 h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_MCP_RECEIPT_INVALID'});
});
test('a typed temporary section remains valid when independent readback returns the canonical ID',()=>{
 const h=canonicalReceipt();h.value.section={id:h.patch.nodeId,parentId:h.hero.parentId,type:h.hero.type,sectionId:'hero'};h.observation.text=JSON.stringify(h.value);const bound=cp.confirmPatch(h.spec,h.patch,h.after,h.state);assert.equal(bound.sections[0].nodeId,h.hero.id);assert.equal(bound.sections[0].nodeBinding.reportedId,h.patch.nodeId);
});
for(const field of ['createdNodeIds','mutatedNodeIds'])test('new receipt accepts the producer array cardinality bound for '+field,()=>{
 const h=canonicalReceipt();h.value[field]=[h.patch.nodeId,...Array(255).fill('id')];h.observation.text=JSON.stringify(h.value);assert.equal(cp.confirmPatch(h.spec,h.patch,h.after,h.state).sections[0].nodeId,h.hero.id);
});
test('new receipt preserves producer ID length bound and refuses an oversized complete result',()=>{
 const h=canonicalReceipt();h.patch.nodeId='x'.repeat(512);h.value.createdNodeIds=[h.patch.nodeId];h.value.mutatedNodeIds=['y'.repeat(512)];h.observation.text=JSON.stringify(h.value);assert.equal(cp.confirmPatch(h.spec,h.patch,h.after,h.state).sections[0].nodeId,h.hero.id);
 h.value.mutatedNodeIds=Array(8).fill('y'.repeat(512));h.observation.text=JSON.stringify(h.value);assert.throws(()=>cp.confirmPatch(h.spec,h.patch,h.after,h.state),{code:'LANDING_MCP_RECEIPT_INVALID'});
});

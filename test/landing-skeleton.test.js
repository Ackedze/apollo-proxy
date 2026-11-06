'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plan=require('../src/landing/native-plan'),cp=require('../src/landing/checkpoints');
const A='a'.repeat(40),B='b'.repeat(40),guide={id:'knowledge/data/ds-ai-hub/products/ab/components/fixture/figma-keys.json',sha256:'c'.repeat(64),path:[],offset:0,mode:'read',text:'Published '+A},cite=r=>({id:r.id,sha256:r.sha256,path:r.path,offset:r.offset,observation:'Read source.'});
const tree=()=>({schemaVersion:plan.SCHEMA,rootId:'block',mountId:null,rootLayout:{},nodes:[{id:'block',parent:'$mount',kind:'instance',key:A,importType:'COMPONENT',props:{}}]}),decision=()=>({root:{type:'INSTANCE',componentKey:A},props:{},slots:[],layout:{nativePlan:tree()}});
test('native plan rejects cycles, multiple roots, text/code, library layout overrides and direct instance children',()=>{
 const mutations=[p=>p.nodes.push({...p.nodes[0]}),p=>p.nodes[0].parent='block',p=>p.nodes[0].kind='TEXT',p=>p.nodes[0].code='figma.createFrame()',p=>p.nodes[0].layout={fields:{paddingTop:24}},p=>p.nodes.push({id:'child',parent:'block',kind:'layout',layout:{fields:{layoutMode:'VERTICAL'}}}),p=>p.rootLayout={fields:{layoutMode:'HORIZONTAL'}}];
 for(const mutate of mutations){const d=decision();mutate(d.layout.nativePlan);assert.throws(()=>plan.validate(d.layout.nativePlan,'structure',d),/LANDING_NATIVE_PLAN_INVALID/);}
 assert.throws(()=>plan.bindProps({Title:'Copy'},{Title:{type:'TEXT',value:'Default'}})??(()=>{throw Error('TEXT_REFUSED');})(),/TEXT_REFUSED/);
});
test('key proof requires cited read Hub ranges, with exact retained citation candidates for correction',()=>{
 const state={workflow:'staged-content-v1',skeletonExecutor:plan.VERSION,stage:'prepare-structure',activeSectionId:'hero'},point={sectionId:'hero',status:'complete'},adapter={...guide,id:guide.id.replace('figma-keys.json','adapter.figma.md'),text:'Rules without key'},patch={stage:state.stage,sectionId:'hero',baseRevision:1,sources:[cite(adapter)],decision:decision()};
 let error;try{cp.preparationPatch(state,{preparationPatch:patch},point,null,[adapter,guide],0);}catch(e){error=e;}
 assert.equal(error.code,'LANDING_PREPARATION_SOURCE_UNCONFIRMED');assert.equal(error.diagnostic.sourceClosure[0].key,A);assert.equal(error.diagnostic.sourceClosure[0].candidates[0].id,guide.id);
 patch.sources.push(cite(guide));assert(cp.preparationPatch(state,{preparationPatch:patch},point,null,[adapter,guide],0));
 const technical={...guide,id:'workflow/example.md'};patch.sources=[cite(technical)];assert.throws(()=>cp.preparationPatch(state,{preparationPatch:patch},point,null,[technical],0),/LANDING_PREPARATION_SOURCE_UNCONFIRMED/);
});
test('foundation recipe path cannot bypass proof for additional native-plan variable keys',()=>{
 const recipe={schemaVersion:'apollo.slot-content-replacement.v1',id:'Fixture.Body.default',containerKey:A,slot:{type:'SLOT',name:'Body'},defaultChildren:[{type:'FRAME',name:'SwapMe',children:[]}]},row={...guide,text:guide.text+'\n```apollo-slot-content-replacement\n'+JSON.stringify(recipe)+'\n```'};
 const d={container:{role:'host',type:'INSTANCE',componentKey:A},mount:{role:'body',type:'SLOT',componentKey:null},slotContentReplacement:recipe.id,layout:{nativePlan:{schemaVersion:plan.SCHEMA,rootId:'host',mountId:'body',rootLayout:{bindings:{itemSpacing:B}},nodes:[{id:'host',parent:'$root',kind:'instance',key:A,importType:'COMPONENT',role:'host'},{id:'body',parent:'host',kind:'slot',selector:[{type:'SLOT',name:'Body'}],role:'body'}]}}};
 const state={workflow:'staged-content-v1',skeletonExecutor:plan.VERSION,recipeOperations:'slot-content-replacement-v1',stage:'prepare-foundation',activeSectionId:null},patch={stage:state.stage,sectionId:null,baseRevision:0,sources:[cite(row)],decision:d};
 assert.throws(()=>cp.preparationPatch(state,{preparationPatch:patch},{sectionId:null,status:'complete'},null,[row],0),/LANDING_PREPARATION_SOURCE_UNCONFIRMED/);
});
test('native receipt bindings are verified against actual key, parent, props, layout and variable facts',()=>{
 const p=tree(),bindings=[{id:'block',nodeId:'block-id'}],base={rootNodeId:'root',native:{nodes:[{id:'root',type:'FRAME'},{id:'block-id',parentId:'mount',type:'INSTANCE',nativeKey:'block',componentKey:A,componentProperties:{}}],variables:{},collections:{}}};
 assert(plan.confirm(p,bindings,base,'structure','mount'));
 for(const mutate of [r=>r.native.nodes[1].componentKey=B,r=>r.native.nodes[1].parentId='foreign',r=>r.native.nodes[1].nativeKey='foreign']){const r=structuredClone(base);mutate(r);assert.throws(()=>plan.confirm(p,bindings,r,'structure','mount'),/LANDING_NATIVE_PLAN_INVALID/);}
 p.nodes[0].layout={bindings:{width:B}};base.native.nodes[1].boundVariables={width:{type:'VARIABLE_ALIAS',id:'var'}};assert.throws(()=>plan.confirm(p,bindings,base,'structure','mount'),/LANDING_NATIVE_PLAN_INVALID/);base.native.variables.var={key:B};assert(plan.confirm(p,bindings,base,'structure','mount'));
});
test('INSTANCE_SWAP compares an observed imported key rather than treating its native node ID as a key',()=>{
 const actual={'Icon#1:0':{type:'INSTANCE_SWAP',value:'node:123'}};assert.equal(plan.bindProps({Icon:A},actual),null);assert.deepEqual(plan.bindProps({Icon:A},actual,false,{'Icon#1:0':A}),{'Icon#1:0':A});assert.equal(plan.bindProps({Icon:A},actual,false,{'Icon#1:0':B}),null);
});
test('requested replacement reanchors an already consumed Body receipt only after the new first block is confirmed',()=>{
 const crypto=require('node:crypto'),approval=require('../src/landing/structure-approval'),slots=require('../src/landing/slot-content'),p=tree(),sourcePin='fixture',owner='a'.repeat(64),first={id:'hero',nodeId:'new',structurePlan:{sourcePin,decision:decision()},nativeBindings:[{id:'block',nodeId:'new'}]};
 const rows=[{id:'root',type:'FRAME'},{id:'host',parentId:'root',type:'INSTANCE',role:'host',componentKey:A},{id:'body',parentId:'host',type:'SLOT',role:'body',name:'Body'}],binding={consumed:true,blockId:'old',mountId:'body',containerId:'host',rootNodeId:'root',nodes:[{id:'original-default'}]},prior={id:'old',sectionId:'hero',fingerprint:'e'.repeat(64)};
 const record={source:{skeletonExecutor:plan.VERSION},target:{rootNodeId:'root',ownerNonce:owner},spec:{foundation:{plan:{decision:{container:{type:'INSTANCE',componentKey:A,role:'host'},mount:{type:'SLOT',componentKey:null,role:'body'}}}},sections:[first]},execution:{sourcePin,freshFoundation:true,slotContentReplacement:structuredClone(binding),structureRevision:{status:'requested',sourcePin,rootNodeId:'root',ownerNonce:owner,requestId:'user-change',sections:[prior]},structures:[{id:'new',sectionId:'hero',planHash:crypto.createHash('sha256').update(JSON.stringify(first.structurePlan)).digest('hex')}]}};
 const before={sections:[prior]},after={rootNodeId:'root',sections:[{id:'new',sectionId:'hero'}],native:{nodes:rows.concat({id:'new',parentId:'body',type:'INSTANCE',nativeKey:'block',sectionId:'hero',componentKey:A,componentProperties:{}})}};
 assert.equal(slots.retained(binding,after,cp.foundationNodes(record.spec,after)),false);approval.reanchorConsumedDefault(record,before,after);assert.equal(record.execution.slotContentReplacement.consumed,true);assert.equal(record.execution.slotContentReplacement.blockId,'new');assert(slots.retained(record.execution.slotContentReplacement,after,cp.foundationNodes(record.spec,after)));assert.deepEqual(record.execution.slotContentReplacement.nodes,binding.nodes);
 record.execution.slotContentReplacement=structuredClone(binding);assert.throws(()=>approval.reanchorConsumedDefault(record,{sections:[]},after),/LANDING_SLOT_REPLACEMENT_UNCONFIRMED/);assert.deepEqual(record.execution.slotContentReplacement,binding);
});

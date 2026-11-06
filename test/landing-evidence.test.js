'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{validateNative,screenshot,assess}=require('../src/landing/evidence');
const {renderHash}=require('../src/landing/evidence');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const sections=['hero','benefits','steps','faq','cta'].map((id,i)=>({id,nodeId:'section:'+i})),nodes=[{id:'root',parentId:'page',type:'FRAME',name:'Owned root',role:'',sectionId:null},{id:'host',parentId:'root',type:'INSTANCE',name:'CorporateContent',role:'host',componentKey:'source-key',sectionId:null},{id:'body',parentId:'host',type:'SLOT',name:'Body',role:'body',sectionId:null}].concat(sections.map(s=>({id:s.nodeId,parentId:'body',type:'INSTANCE',name:s.id,role:'',sectionId:s.id,componentKey:'fixture-key'})));
 const record={target:{rootNodeId:'root'},spec:{host:{componentKey:'source-key'},sections},readback:{rootNodeId:'root',nodeCount:nodes.length,sections:sections.map(s=>({id:s.nodeId,sectionId:s.id,fingerprint:s.id})),native:{schemaVersion:'apollo.landing-native.v1',nodes}},execution:{screenshots:[]}};
 const scopes=sections.map(s=>({id:s.id,nodeId:s.nodeId})).concat({id:'page',nodeId:'root'}),reviews=[];
 for(const [i,scope]of scopes.entries()){
  const shot=screenshot({type:'item.completed',item:{id:'call-'+i,tool:'get_screenshot',status:'completed',arguments:JSON.stringify({nodeId:scope.nodeId}),result:{content:[{type:'image',mimeType:'image/png',data:'c3ludGhldGlj'}]}}},{activeSectionId:scope.id},i);
  shot.readbackHash='fixture';shot.nativeHash=renderHash(record.readback,shot.nodeId);shot.fingerprints=Object.fromEntries(record.readback.sections.map(s=>[s.id,s.fingerprint]));record.execution.screenshots.push(shot);reviews.push({scope:scope.id,modelStep:i,callId:shot.callId,verdict:'PASS',evidence:'Synthetic visual judgement'});
 }
 return {record,result:{checks:[{verdict:'PASS',evidence:'Synthetic source check',critical:true}],visualReviews:reviews}};
}
test('five-section structure, delivered images, agent checks and owner acceptance stay distinct',()=>{
 const {record,result}=fixture();validateNative(record.readback,record.target);const evidence=assess(record,result);assert.equal(evidence.complete,true);assert.equal(evidence.structure.origin,'host-native');assert.equal(evidence.norms.origin,'agent-report');assert.equal(evidence.ownerAcceptance,'PENDING');assert(evidence.visual.every(v=>v.verdict==='PASS'&&v.origin==='agent-visual-report'));assert(!JSON.stringify(evidence).includes('c3ludGhldGlj'));
});
for(const gap of ['no-images','no-review','critical-unknown','missing-font','stale-section','URL-only','later-use-figma','geometry-changed'])test('assembly remains unverified for '+gap,()=>{
 const {record,result}=fixture();if(gap==='no-images')record.execution.screenshots[0].images=[];if(gap==='no-review')result.visualReviews.shift();if(gap==='critical-unknown')result.checks[0].verdict='UNKNOWN';if(gap==='missing-font')record.readback.native.nodes.push({id:'text',type:'TEXT',hasMissingFont:true});if(gap==='stale-section')record.readback.sections[0].fingerprint='changed';if(gap==='later-use-figma')record.execution.screenshots[0].superseded=true;if(gap==='geometry-changed')record.readback.native.nodes[3].width=999;if(gap==='URL-only')record.execution.screenshots[0]=screenshot({type:'item.completed',item:{id:'call-0',tool:'get_screenshot',status:'completed',arguments:{nodeId:'section:0'},result:{content:[{type:'text',text:'https://example.invalid/image.png'}]}}},{activeSectionId:'hero'},0);
 assert.equal(assess(record,result).complete,false);
});
for(const invalid of ['missing-host','host-key','body-frame','outside-body','wrong-order'])test('independent structure refuses '+invalid,()=>{
 const {record,result}=fixture(),nodes=record.readback.native.nodes;if(invalid==='missing-host')nodes[1].role='';if(invalid==='host-key')nodes[1].componentKey='wrong';if(invalid==='body-frame')nodes[2].type='FRAME';if(invalid==='outside-body')nodes[3].parentId='root';if(invalid==='wrong-order')[nodes[3],nodes[4]]=[nodes[4],nodes[3]];assert.throws(()=>assess(record,result),{code:'LANDING_RESULT_INCOMPLETE'});
});
test('native tree count, duplicate IDs and parent order fail closed',()=>{
 const {record}=fixture();for(const attack of ['count','duplicate','parent']){const readback=copy(record.readback);if(attack==='count')readback.nodeCount++;if(attack==='duplicate')readback.native.nodes[1].id='root';if(attack==='parent')readback.native.nodes[1].parentId='section:0';assert.throws(()=>validateNative(readback,record.target),{code:'LANDING_READBACK_INVALID'});}
});
test('native v2 requires bounded typed default evidence and the actual declared root parent',()=>{
 const {record}=fixture(),target={...record.target,pageId:'page'};record.readback.native.schemaVersion='apollo.landing-native.v2';record.readback.native.modeDefaults={'VariableCollectionId:source/1:1':'1:0'};assert.doesNotThrow(()=>validateNative(record.readback,target));
 for(const attack of ['missing','array','number','too-many','future','wrong-root-parent']){
  const value=copy(record.readback);if(attack==='missing')delete value.native.modeDefaults;if(attack==='array')value.native.modeDefaults=[];if(attack==='number')value.native.modeDefaults={source:1};if(attack==='too-many')value.native.modeDefaults=Object.fromEntries(Array.from({length:129},(_,i)=>['source'+i,'1:0']));if(attack==='future')value.native.schemaVersion='apollo.landing-native.v3';if(attack==='wrong-root-parent')value.native.nodes[0].parentId='foreign';assert.throws(()=>validateNative(value,target),{code:'LANDING_READBACK_INVALID'});
 }
});


test('AB CorporateContent evidence policy does not impose AB host norms on another packaged skill',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{createLandingService}=require('../src/landing/service');const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'generation-evidence-scope-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let prompt;
 const source={id:'fixture',knowledgeVersion:'fixture',skill:{id:'synthetic-form',generation:{},version:'1.0.0',sha256:'fixture'},assertCurrent(){},initial:{norms:[],workflow:[],instructions:{},resources:[]}};
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{prompt=options.prompt;return {result:{kind:'question',message:'Fixture',specJson:JSON.stringify({sections:[]}),query:'',offset:0,resources:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};}})}),chat=service.create({fileKey:'FixtureFile',pageId:'page',skillId:'synthetic-form'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Fixture'});await service.whenSettled(chat.id);assert.equal(service.poll(chat.id).source.nativeEvidenceVersion,undefined);assert(!prompt.includes('Generation-profile bootstrap must tag'));
});

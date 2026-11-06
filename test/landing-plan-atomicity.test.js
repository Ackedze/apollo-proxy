'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service'),{WORKFLOW}=require('../src/landing/checkpoints');
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(t,change){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-plan-atomicity-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source={id:'fixture',knowledgeVersion:'fixture',resumePin:'fixture-pin',skill:{id:'ab-generate-custom-landing',version:'0.4.1',sha256:'fixture',generation:{workflow:WORKFLOW}},assertCurrent(){},initial:{norms:[],workflow:[],instructions:{},resources:[]}};
 let response,calls=0;
 const make=()=>createLandingService({root,knowledge:()=>source,createCli:()=>({run:async()=>{calls++;return {result:copy(response),receipt:{usage:{measurementId:'fixture-usage',actualInputTokens:1,actualOutputTokens:1},mcp:{toolCalls:0}}};}})});
 const created=make().create({fileKey:'FixtureFile',pageId:'page'}),file=path.join(root,created.id+'.json'),record=JSON.parse(fs.readFileSync(file));
 record.revision=1;record.status='interrupted';
 record.target={fileKey:'FixtureFile',pageId:'page',rootNodeId:'root',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
 record.spec={version:1,target:{fileKey:'FixtureFile',pageId:'page',rootNodeId:'root'},facts:Array.from({length:10},(_,i)=>({id:'fact-'+i,text:'Confirmed fixture fact '+i})),decisions:['Keep confirmed decisions'],questions:[],foundation:{plan:{sourcePin:source.resumePin,revision:0,decision:{container:{componentKey:'fixture-host'}}}},sections:['hero','details'].map(id=>({id,nodeId:'node-'+id,role:id,contentShape:{items:1,textFields:1},structurePlan:{sourcePin:source.resumePin,revision:0,decision:{root:{componentKey:'fixture-'+id},props:{View:'Fixture'}}}}))};
 record.execution={workflow:WORKFLOW,sourcePin:source.resumePin,status:'interrupted',stage:'structure',activeSectionId:'hero',queue:['hero','details'],completed:[]};
 record.readback={rootNodeId:'root',pageId:'page',ownerNonce:record.target.ownerNonce,leaseNonce:record.target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:1,instanceCount:0,sections:[],text:'',coverage:'tagged-sections-and-text'};
 record.readerState={schemaVersion:'apollo.generation-reader.v1',sourcePin:source.resumePin,reads:[],indexes:[]};
 fs.writeFileSync(file,JSON.stringify(record));
 const candidate=copy(record.spec);change(candidate);
 response={kind:'build',message:'Continue fixture',specJson:JSON.stringify(candidate),query:'',offset:0,resources:[],resultJson:'{}'};
 const service=make();
 return {record,candidate,file,service,make,calls:()=>calls,async run(){service.submit(record.id,{requestId:crypto.randomUUID(),revision:1,text:'Continue'});await service.whenSettled(record.id);return service.poll(record.id);}};
}

const rejected=[
 ['missing edit scope after a lossy replan',spec=>{spec.facts=spec.facts.slice(0,8);delete spec.foundation.plan;delete spec.sections[0].structurePlan;},'LANDING_EDIT_SCOPE_INVALID'],
 ['unknown edit section',spec=>{spec.editSectionIds=['missing'];},'LANDING_EDIT_SCOPE_INVALID'],
 ['duplicate edit sections',spec=>{spec.editSectionIds=['hero','hero'];},'LANDING_EDIT_SCOPE_INVALID'],
 ['unrequested neighbor edit',spec=>{spec.editSectionIds=['hero'];spec.sections[1].contentShape.items=2;},'LANDING_EDIT_SCOPE_INVALID'],
 ['empty sections',spec=>{spec.sections=[];},'LANDING_SPEC_INVALID'],
 ['duplicate fact IDs',spec=>{spec.facts[1].id=spec.facts[0].id;},'LANDING_SPEC_INVALID'],
 ['unresolved brief',spec=>{spec.questions=[{id:'unanswered',status:'open'}];},'LANDING_BRIEF_UNRESOLVED']
];
for(const [name,change,code]of rejected)test('rejected planner build preserves the accepted plan: '+name,async t=>{
 const h=fixture(t,change),result=await h.run(),expected={...h.record.spec,version:2};
 assert.equal(result.status,'interrupted');assert.equal(result.error.code,code);assert.equal(h.calls(),1);
 assert.deepEqual(result.spec,expected);
 for(const key of ['target','readback','execution'])assert.deepEqual(result[key],h.record[key]);
 const stored=JSON.parse(fs.readFileSync(h.file));
 assert.deepEqual(stored.spec,expected);assert.deepEqual(stored.readerState,h.record.readerState);
 assert.deepEqual(h.make().poll(result.id).spec,expected);
 assert.equal(result.usage.at(-1).measurementId,'fixture-usage');assert.equal(result.failures.at(-1).error.code,code);
});

test('accepted scoped edit saves the new plan after validation',async t=>{
 const h=fixture(t,spec=>{spec.editSectionIds=['hero'];spec.sections[0].contentShape.items=2;}),result=await h.run();
 assert.equal(result.status,'awaiting-canvas');assert.equal(result.error,null);assert.equal(h.calls(),1);
 assert.deepEqual(result.spec,{...h.candidate,version:2});
 assert.deepEqual(result.spec.sections[1],h.record.spec.sections[1]);assert.deepEqual(result.target,h.record.target);
 assert.deepEqual(JSON.parse(fs.readFileSync(h.file)).spec,result.spec);
 h.service.cancel(result.id);
});

test('unchanged staged continuation still preserves prepared plans without new edit IDs',async t=>{
 const h=fixture(t,()=>{}),result=await h.run();
 assert.equal(result.status,'awaiting-canvas');assert.equal(result.error,null);assert.equal(h.calls(),1);
 assert.deepEqual(result.spec,{...h.record.spec,version:2});assert.deepEqual(result.target,h.record.target);
 h.service.cancel(result.id);
});

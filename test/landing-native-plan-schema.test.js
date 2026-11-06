'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const wire=require('../src/landing/write-step'),native=require('../src/landing/native-plan');
const copy=structuredClone,A='a'.repeat(40),B='b'.repeat(40);
const map=v=>({entries:Object.entries(v).map(([key,value])=>({key,value}))});
const settings=v=>({...v,fields:map(v.fields||{}),bindings:map(v.bindings||{}),modes:v.modes||[]});
function encodePlan(p,stage){
 return {...copy(p),rootLayout:stage==='prepare-foundation'?settings(p.rootLayout):copy(p.rootLayout),nodes:p.nodes.map(n=>{
  const out={...copy(n),role:n.role??null,layout:n.kind==='slot'?copy(n.layout||{}):settings(n.layout||{})};
  if(['instance','layout'].includes(n.kind))out.name=n.name??null;
  if(['instance','configure'].includes(n.kind))out.props=map(n.props||{});
  return out;
 })};
}
function fixture(stage='prepare-foundation'){
 const foundation=stage==='prepare-foundation';
 const plan=foundation?{schemaVersion:native.SCHEMA,rootId:'host',mountId:'body',rootLayout:{fields:{layoutMode:'VERTICAL',width:1440}},nodes:[
  {id:'host',parent:'$root',kind:'instance',key:A,importType:'COMPONENT',role:'host',name:'Library root',props:{Enabled:true},layout:{fields:{layoutSizingHorizontal:'FILL'}}},
  {id:'configured',parent:'host',kind:'configure',role:'configured',selector:[{type:'FRAME',name:'Wrapper'},{type:'INSTANCE',name:'Container'}],props:{View:'Page'}},
  {id:'body',parent:'configured',kind:'slot',role:'body',selector:[{type:'SLOT',name:'Body'}]},
  {id:'row',parent:'body',kind:'layout',layout:{fields:{layoutMode:'HORIZONTAL',itemSpacing:24},bindings:{itemSpacing:B},modes:[{collection:'Grid',mode:'Desktop'}]}}
 ]}:{schemaVersion:native.SCHEMA,rootId:'block',mountId:null,rootLayout:{},nodes:[{id:'block',parent:'$mount',kind:'instance',key:A,importType:'COMPONENT_SET',props:{View:'Page',Enabled:false,Icon:B}}]};
 const decision=foundation?{container:{type:'INSTANCE',role:'host',componentKey:A},mount:{type:'SLOT',role:'body',componentKey:null},layout:{nativePlan:encodePlan(plan,stage)},slotContentReplacement:null}:{root:{type:'INSTANCE',componentKey:A},props:map(plan.nodes[0].props),slots:[],layout:{nativePlan:encodePlan(plan,stage)}};
 return {plan,reply:{kind:'continue',message:'Source-cited native preparation',query:'',offset:0,resources:[],sectionPatch:null,payload:{checkpoint:{sectionId:foundation?null:'hero',status:'complete',nextAction:'Execute after readback'},preparationPatch:{stage,sectionId:foundation?null:'hero',baseRevision:0,sources:[{id:'knowledge/data/ds-ai-hub/fixture.md',sha256:'c'.repeat(64),path:[],offset:0,observation:'Published fixture keys.'}],decision},technicalPatch:null,apiObservations:[],report:null}}};
}
function rejects(reply,field,expected){
 assert.throws(()=>wire.read(reply,'prepare-foundation',true),e=>e.code==='LANDING_STEP_PAYLOAD_INVALID'&&e.diagnostic.field.includes(field)&&(!expected||e.diagnostic.expected.includes(expected))&&typeof e.diagnostic.received==='string');
}
for(const stage of ['prepare-foundation','prepare-structure'])test('native wire round trip preserves all sourced fields, public props, keys and selectors: '+stage,()=>{
 const f=fixture(stage),before=copy(f.reply),result=wire.read(f.reply,stage,true),d=result.preparationPatch.decision;
 assert(native.validate(d.layout.nativePlan,stage.slice(8),d));assert.deepEqual(f.reply,before);
 const expected=copy(f.plan);for(const n of expected.nodes){n.layout=n.kind==='slot'?(n.layout||{}):{fields:n.layout?.fields||{},bindings:n.layout?.bindings||{},modes:n.layout?.modes||[]};if(['instance','configure'].includes(n.kind))n.props=n.props||{};}
 if(stage==='prepare-foundation')expected.rootLayout={fields:expected.rootLayout.fields,bindings:{},modes:[]};
 assert.deepEqual(d.layout.nativePlan,expected);
 const visit=s=>{if(s&&typeof s==='object'){if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual(s.required,Object.keys(s.properties));}Object.values(s).forEach(visit);}};visit(wire.schema(stage,true));
});
test('root layout properties require the explicit fields envelope before native admission',()=>{
 const {reply}=fixture();reply.payload.preparationPatch.decision.layout.nativePlan.rootLayout.layoutMode='VERTICAL';
 rejects(reply,'rootLayout.layoutMode','not allowed');
 const n=copy(reply.payload.preparationPatch.decision.layout.nativePlan);n.rootLayout={layoutMode:'VERTICAL'};
 assert.throws(()=>native.validate(n,'foundation',reply.payload.preparationPatch.decision),e=>e.diagnostic.field==='rootLayout.layoutMode'&&e.diagnostic.expected.includes('rootLayout.fields')&&e.diagnostic.received==='string: "VERTICAL"' );
});
test('selecting a native slot cannot rename it; the exact forbidden field is diagnosed',()=>{
 const {reply}=fixture(),p=reply.payload.preparationPatch.decision.layout.nativePlan;p.nodes[2].name='Body';
 rejects(reply,'nodes[2].name','kind=slot');
 const decoded=fixture().plan;decoded.nodes[2].name='Body';
 assert.throws(()=>native.validate(decoded,'foundation',reply.payload.preparationPatch.decision),e=>e.diagnostic.field==='nodes[2].name'&&e.diagnostic.expected.includes('selector')&&e.diagnostic.received==='string: "Body"' );
});
for(const [name,mutate,field] of [
 ['slot props',p=>p.nodes[2].props=map({}), 'nodes[2].props'],
 ['configure rename',p=>p.nodes[1].name='New', 'nodes[1].name'],
 ['unknown layout property',p=>p.rootLayout.fields.entries.push({key:'paddingUnknown',value:24}), 'rootLayout.fields'],
 ['library padding override',p=>p.nodes[0].layout.fields.entries.push({key:'paddingTop',value:24}), 'nodes[0].layout.fields'],
 ['string numeric layout',p=>p.rootLayout.fields.entries.find(e=>e.key==='width').value='1440', 'rootLayout.fields'],
 ['unknown mode field',p=>p.nodes[3].layout.modes[0].unknown='x', 'modes[0].unknown'],
 ['duplicate property',p=>p.rootLayout.fields.entries.push({key:'width',value:1440}), 'rootLayout.fields.entries']
])test('strict native wire rejects '+name,()=>{const {reply}=fixture();mutate(reply.payload.preparationPatch.decision.layout.nativePlan);rejects(reply,field);});
test('strict shape does not admit a structurally invalid selector or parent graph',()=>{
 for(const mutate of [p=>p.nodes[2].selector[0].type='FRAME',p=>p.nodes[3].parent='host']){
  const {reply}=fixture();mutate(reply.payload.preparationPatch.decision.layout.nativePlan);const d=wire.read(reply,'prepare-foundation',true).preparationPatch.decision;
  assert.throws(()=>native.validate(d.layout.nativePlan,'foundation',d),{code:'LANDING_NATIVE_PLAN_INVALID'});
 }
});
test('native schema choice is explicit; legacy staged maps and content/verify schemas remain unchanged',()=>{
 assert(wire.schema('prepare-foundation').properties.payload.anyOf[0].properties.preparationPatch.anyOf[0].properties.decision.properties.layout.properties.entries);
 assert.deepEqual(wire.schema('prepare-content',true),wire.schema('prepare-content'));
 assert.deepEqual(wire.schema('verify',true),wire.schema('verify'));
 assert.notDeepEqual(wire.schema('prepare-foundation',true),wire.schema('prepare-foundation'));
});

test('actual CLI adapter receives the native schema and returns a typed preparation without Figma tools',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),{createAgentCli}=require('../src/generation-agent/agent-cli');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-wire-cli-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'workspace'));fs.mkdirSync(path.join(root,'traces'));const {reply}=fixture();let captured;
 const cli=createAgentCli({generatedRoot:root,model:'fixture-model',environment:{PATH:process.env.PATH,HOME:os.homedir()},maxRuntimeMs:2000,spawnProcess(_binary,args){
  captured=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin=new Writable({write(_chunk,_encoding,done){done();},final(done){done();queueMicrotask(()=>{fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(reply));child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})+'\n');child.emit('close',0);});}});return child;
 }});
 const schema=wire.schema('prepare-foundation',true),out=await cli.run({workspace:path.join(root,'workspace'),traceDirectory:path.join(root,'traces'),profile:'landing-plan',prompt:wire.nativeInstructions,schema});
 assert.deepEqual(captured,schema);assert.deepEqual(out.result,reply);const d=wire.read(out.result,'prepare-foundation',true).preparationPatch.decision;assert(native.validate(d.layout.nativePlan,'foundation',d));assert.equal(out.receipt.mcp,null);
});

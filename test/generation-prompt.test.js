const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {mountPromptRoutes}=require('../src/generation-agent/prompt-service');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const input={prompt:'Синтетический экран',platform:'desktop',viewport:{width:1600,height:900}};
const request=()=>({schemaVersion:'apollo.v4-prompt-plan-request.v1-experimental',requestId:'prompt-plan:0123456789abcdef:1',input:structuredClone(input)});
const spec=()=>({schemaVersion:'apollo.screen-spec.v1-experimental',id:'screen',platform:input.platform,viewport:input.viewport,root:'content',nodes:[{kind:'component',id:'content',mappingId:'content',props:{},slots:{Body:['text']}},{kind:'text',id:'text',text:'Synthetic'}],states:{initial:'default',values:['default']},events:[],transitions:[],unresolved:[]});
function fixture(overrides={}){
 const calls=[],contracts=[{componentId:'content',revision:1,manualSourceHash:hash('manual'),archiveSha256:hash('archive'),sourceStatus:'draft'}];
 const context={packet:{contracts:[{pin:contracts[0],manual:{rules:[{text:'Synthetic norm must precede planning.'}],semanticApi:[{id:'Body'}]}}],mappings:[{id:'content',componentId:'content'}]},contracts,contextHash:hash('packet'),assertCurrent(){calls.push('fresh');}};
 const provider={hash,validate:s=>s?.schemaVersion==='apollo.screen-spec.v1-experimental'&&!s.status?[]:[{}],readPromptContext:async()=>{calls.push('contracts');return context;}};
 let handler;mountPromptRoutes({post(route,h){assert.equal(route,'/generation/plan');handler=h;}},Object.assign({provider,plan:async(prompt,schema)=>{calls.push('agent');assert.match(prompt,/Synthetic norm must precede planning/);assert.match(prompt,/USER_INPUT=/);assert.equal(schema.additionalProperties,false);return{specJson:JSON.stringify(spec())};}},overrides),()=>{throw Error('Unexpected real provider');});
 const invoke=async body=>{let status=200,result;await handler({body},{setHeader(){},status(s){status=s;return this;},json(r){result=r;}});return {status,result};};
 return {invoke,calls,context,provider};
}
test('authoring norms reach the agent before a Draft spec; no target is executed',async()=>{
 const f=fixture(),r=await f.invoke(request());assert.equal(r.status,200);assert.deepEqual(f.calls,['contracts','fresh','agent','fresh']);
 assert.equal(r.result.result.status,'draft');assert.equal(r.result.result.executionAllowed,false);assert.equal(r.result.result.contracts[0].sourceStatus,'draft');
 const copy=structuredClone(r.result.result);delete copy.resultHash;assert.equal(r.result.result.resultHash,hash(copy));
});
test('request cannot supply source, paths, hashes, acceptance or malformed viewport',async()=>{
 const f=fixture();for(const edit of [b=>b.source={},b=>b.apolloRoot='/private',b=>b.schemaVersion='wrong',b=>b.requestId='foreign',b=>b.input.context={},b=>b.input.prompt='',b=>b.input.prompt='x'.repeat(12001),b=>b.input.viewport.width=0,b=>b.input.viewport.height=1.5]){const b=request();edit(b);assert.equal((await f.invoke(b)).status,400);}assert.deepEqual(f.calls,[]);
});
test('malformed, promoted, wrong-platform and invented-port outputs are rejected',async()=>{
 for(const [edit,code]of [[s=>s.status='ready','PROMPT_SPEC_INVALID'],[s=>s.platform='mobile-web','PROMPT_SPEC_INVALID'],[s=>s.viewport={width:360,height:900},'PROMPT_SPEC_INVALID'],[s=>s.nodes[0].mappingId='invented','PROMPT_SPEC_MAPPING_UNSUPPORTED'],[s=>s.nodes[0].props={invented:true},'PROMPT_SPEC_PORT_UNSUPPORTED']]){
  const s=spec();edit(s);const f=fixture({plan:async()=>({specJson:JSON.stringify(s)})}),r=await f.invoke(request());assert.equal(r.status,422);assert.equal(r.result.code,code);
 }
 const f=fixture({plan:async()=>({specJson:'{invalid'})});assert.equal((await f.invoke(request())).result.code,'PROMPT_SPEC_INVALID');
});
test('changed contracts reject an in-flight model answer and errors contain no source details',async()=>{
 const f=fixture();let checks=0;f.context.assertCurrent=()=>{if(++checks===2)throw Object.assign(Error('/private/manual secret'),{code:'PROMPT_INPUTS_STALE'});};
 const r=await f.invoke(request());assertFailure(r.result,'PROMPT_INPUTS_STALE');
 const bad=fixture({plan:async()=>{throw Error('/private/prompt secret');}});assert.equal((await bad.invoke(request())).result.code,'PROMPT_PLANNING_FAILED');
});
test('one active planner; failure releases the route for retry',async()=>{
 let release;const f=fixture({plan:()=>new Promise(r=>release=r)}),first=f.invoke(request());
 await new Promise(r=>setImmediate(r));assert.equal((await f.invoke(request())).result.code,'PROMPT_PLANNER_BUSY');release({specJson:JSON.stringify(spec())});assert.equal((await first).status,200);
 const next=f.invoke(request());await new Promise(r=>setImmediate(r));release({specJson:JSON.stringify(spec())});assert.equal((await next).status,200);
});
test('missing agent is a bounded failure before reading private contracts',async()=>{
 const f=fixture({plan:null});assert.equal((await f.invoke(request())).result.code,'PROMPT_PLANNER_UNAVAILABLE');assert.deepEqual(f.calls,[]);
});

test('planning sends each context once and retains the complete authoring projection without native execution targets',()=>{
 const {plannerPrompt}=require('../src/generation-agent/prompt-service'),f=fixture();
 const records={semantic:{ports:['currencyType','major.text']},manuals:[{rules:['Complete source norm']}],typed:{bindings:[{port:'major.text',type:'TEXT'}]}};
 f.context.packet.figmaMappingRecords=records;
 f.context.packet.targetContext={target:'figma',skills:[{text:'Complete generation instructions'}],targetMapping:{typedNativeBindings:{portCount:19},genericMapping:{targets:'native-only-physical-target'.repeat(60000)}}};
 const before=structuredClone(f.context.packet),prompt=plannerPrompt(input,f.context.packet);
 const field=name=>JSON.parse(prompt.split('\n').find(line=>line.startsWith(name+'=')).slice(name.length+1));
 assert.deepEqual(field('CONTRACT_CONTEXT'),{contracts:before.contracts,mappings:before.mappings,figmaMappingRecords:records});
 assert.deepEqual(field('TARGET_CONTEXT'),{target:'figma',skills:before.targetContext.skills,targetMapping:{typedNativeBindings:{portCount:19}}});
 assert.equal(prompt.includes('native-only-physical-target'),false);assert(prompt.length<900000);
 assert.deepEqual(f.context.packet,before);
});
test('an oversized complete prompt is rejected before launching the model, without truncating source norms',async()=>{
 let modelCalls=0;const f=fixture({plan:async()=>{modelCalls++;return{specJson:JSON.stringify(spec())};}});
 f.context.packet.contracts[0].manual.rules[0].text='Source norm '.repeat(90000);
 const before=structuredClone(f.context.packet),r=await f.invoke(request());
 assert.equal(r.status,413);assert.equal(r.result.code,'PROMPT_CONTEXT_LIMIT');assert.equal(modelCalls,0);assert.deepEqual(f.context.packet,before);
});
test('planner reuses native lossless deduplication while retaining each complete rule and every binding',()=>{
 const {plannerPrompt}=require('../src/generation-agent/prompt-service'),f=fixture(),rule={id:'SYNTHETIC-LARGE',text:'UNIQUE-NORM:'+ 'x'.repeat(330000)},manual={semanticApi:[{id:'Body'}],rules:[rule]},source={pointer:'/rules/0',sha256:hash('manual')};
 f.context.packet.contracts[0].manual=manual;const link={componentId:'content',RuleID:rule.id,source,rule};
 f.context.packet.figmaMappingRecords={semantic:{ports:['Body']},typed:{bindings:[{port:'Body'}]},manuals:[{pin:{path:'/synthetic/manual',sha256:hash('manual')},manual}],ruleLinks:{links:[link]},profiles:{choices:[]},targets:{profiles:[]},denials:[]};
 f.context.packet.targetContext={target:'figma',targetMapping:{genericMapping:structuredClone(f.context.packet.figmaMappingRecords)},ruleLinks:{links:[link]}};
 const before=structuredClone(f.context.packet),prompt=plannerPrompt(input,f.context.packet),field=name=>JSON.parse(prompt.split('\n').find(line=>line.startsWith(name+'=')).slice(name.length+1)),view=field('CONTRACT_CONTEXT');
 assert.deepEqual(view.contracts,before.contracts);assert.equal(view.figmaMappingRecords.manuals[0].componentId,'content');assert.equal(view.figmaMappingRecords.manuals[0].manual,undefined);assert.deepEqual(view.figmaMappingRecords.typed,before.figmaMappingRecords.typed);assert.deepEqual(view.figmaMappingRecords.ruleLinks.links[0].source,source);assert.equal(view.figmaMappingRecords.ruleLinks.links[0].rule,undefined);assert.equal(prompt.split('UNIQUE-NORM:').length-1,1);assert(prompt.length<900000);assert.deepEqual(f.context.packet,before);
});
test('planner retains a divergent mapping manual instead of treating it as a duplicate',()=>{
 const {plannerPrompt}=require('../src/generation-agent/prompt-service'),f=fixture(),other={rules:[{id:'OTHER',text:'Different complete norm'}]};
 f.context.packet.figmaMappingRecords={manuals:[{manual:other,pin:{path:'/different'}}]};f.context.packet.targetContext={target:'figma',targetMapping:{}};
 const prompt=plannerPrompt(input,f.context.packet),view=JSON.parse(prompt.split('\n').find(line=>line.startsWith('CONTRACT_CONTEXT=')).slice('CONTRACT_CONTEXT='.length));assert.deepEqual(view.figmaMappingRecords.manuals[0].manual,other);
});

test('canonical ScreenSpec rejects a model state map and the prompt supplies a valid default state array',async()=>{
 const {validateScreenSpec}=require('../../../projects/Apollo/packages/generation-core/dist/planning.cjs');
 const {plannerPrompt}=require('../src/generation-agent/prompt-service');
 const s=spec();s.states.values={default:{}};
 const f=fixture({plan:async()=>({specJson:JSON.stringify(s)})});f.provider.validate=validateScreenSpec;
 const r=await f.invoke(request());assert.equal(r.status,422);assert.equal(r.result.code,'PROMPT_SPEC_INVALID');
 const example=JSON.parse(plannerPrompt(input,f.context.packet).match(/states=(\{"initial":"default","values":\["default"\]\})/)[1]);
 const valid=spec();valid.states=example;assert.deepEqual(validateScreenSpec(valid),[]);
});

function rows(){return {schemaVersion:'apollo.screen-spec.v2-experimental',id:'screen',platform:input.platform,viewport:input.viewport,root:'rows',
 nodes:[{kind:'stack',id:'rows',direction:'vertical',gap:24,children:['five','two']},...[[5,'five'],[2,'two']].map(([count,id])=>({kind:'component',id,mappingId:'buttons',props:{},slots:{},
  actions:{port:'Elements',items:Array.from({length:count},(_,i)=>({id:id+'_'+(i+1),label:'Кнопка '+(i+1),behavior:'none'}))}}))],
 states:{initial:'default',values:['default']},events:[],transitions:[],unresolved:[],capabilityGaps:[
  {code:'OVERFLOW_COLLECTION_UNSUPPORTED',message:'Для пяти элементов нужен версионный producer/native/profile handoff.',nodeId:'five'},
  {code:'PAGE_BACKGROUND_UNSUPPORTED',message:'Запрошенный белый фон пока не имеет page semantic port/host binding.'}]};}
function canonicalFixture(value,plan){
 const f=fixture({plan:plan||(async()=>({specJson:JSON.stringify(value)}))});
 f.provider.validate=require('../../../projects/Apollo/packages/generation-core/dist/planning.cjs').validateScreenSpec;
 const pin={componentId:'buttons',revision:1,manualSourceHash:hash('button manual'),archiveSha256:hash('button archive'),sourceStatus:'draft'};
 f.context.packet.contracts.push({pin,manual:{semanticApi:[{id:'Elements'}]}});f.context.contracts.push(pin);
 f.context.packet.mappings.push({id:'buttons',componentId:'buttons'});
 return f;
}
test('canonical v2 Draft preserves static placeholders, 5+2 order, gap24 and technical gaps without invented questions or actions',async()=>{
 const s=rows(),f=canonicalFixture(s,async prompt=>{
  assert.match(prompt,/schemaVersion="apollo.screen-spec.v2-experimental"/);assert.match(prompt,/capabilityGaps обязателен/);
  assert.match(prompt,/behavior:"none" без eventId/);assert.match(prompt,/placeholder labels/);assert.match(prompt,/не спрашивай его цвет повторно/);
  return {specJson:JSON.stringify(s)};
 });
 const body=request();body.input.prompt='Две статичные строки 5+2, placeholder labels разрешены, gap 24, белый фон. Бизнес-действия не нужны.';
 const r=await f.invoke(body);assert.equal(r.status,200);assert.equal(r.result.result.schemaVersion,'apollo.v4-prompt-plan.v1-experimental');
 assert.deepEqual(r.result.result.spec,s);assert.equal(r.result.result.status,'draft');assert.equal(r.result.result.executionAllowed,false);
 assert.deepEqual(f.calls,['contracts','fresh','fresh']);assert.deepEqual(r.result.result.spec.nodes.slice(1).map(n=>n.actions.items.length),[5,2]);
});
test('canonical v2 allows mixed declared business actions and explicit no-action content without adding handlers or disabling static items',async()=>{
 const s=rows();delete s.nodes[1].actions.items[0].behavior;s.nodes[1].actions.items[0].eventId='open';s.events=[{id:'open'}];
 const f=canonicalFixture(s),r=await f.invoke(request());assert.equal(r.status,200);assert.deepEqual(r.result.result.spec,s);
 assert.equal(r.result.result.spec.nodes[1].actions.items[1].disabled,undefined);
});
test('canonical v2 rejects ambiguous/undeclared actions, missing or malformed capability gaps and invalid stack gaps',async()=>{
 for(const edit of [s=>{s.nodes[1].actions.items[0].eventId='open';s.events=[{id:'open'}];},s=>{delete s.nodes[1].actions.items[0].behavior;s.nodes[1].actions.items[0].eventId='undeclared';},
  s=>delete s.capabilityGaps,s=>s.capabilityGaps[0].code='bad code',s=>s.capabilityGaps[0].nodeId='missing',s=>s.capabilityGaps[0].accepted=true,
  s=>s.capabilityGaps[0].message='',s=>s.nodes[0].gap=-1,s=>s.nodes[0].gap=1025,s=>s.schemaVersion='apollo.screen-spec.v3-experimental']){
  const s=rows();edit(s);const r=await canonicalFixture(s).invoke(request());assert.equal(r.status,422);assert.equal(r.result.code,'PROMPT_SPEC_INVALID');
 }
});
test('capability gaps do not bypass mapping/port checks or permit a guessed Boolean Overflow prop',async()=>{
 for(const [edit,code] of [[s=>s.nodes[1].props.Overflow=true,'PROMPT_SPEC_PORT_UNSUPPORTED'],[s=>s.nodes[1].mappingId='missing','PROMPT_SPEC_MAPPING_UNSUPPORTED']]){
  const s=rows();edit(s);const r=await canonicalFixture(s).invoke(request());assert.equal(r.status,422);assert.equal(r.result.code,code);
 }
 const s=rows();s.nodes[1].props.Overflow=true;const f=canonicalFixture(s);
 f.context.packet.contracts[1].manual.semanticApi.push({id:'Overflow'});
 f.context.packet.mappings[1].propertyMappings=[{from:'Overflow',to:null,transform:'unsupported-direct-prop',gapId:'BG-AUTO-OVERFLOW'}];
 assert.equal((await f.invoke(request())).result.code,'PROMPT_SPEC_PORT_UNSUPPORTED');
 delete s.nodes[1].props.Overflow;s.nodes[1].props.overflow='true';
 f.context.packet.contracts[1].manual.semanticApi.push({id:'overflow',bindings:[{representationId:'synthetic.figma',path:'component.properties.Overflow'}]});
 assert.equal((await f.invoke(request())).result.code,'PROMPT_SPEC_PORT_UNSUPPORTED');
 const admission=JSON.parse(require('../src/generation-agent/prompt-service').plannerPrompt(input,f.context.packet).split('\n').find(line=>line.startsWith('PROP_ADMISSION=')).slice('PROP_ADMISSION='.length));
 assert.deepEqual(admission.find(m=>m.mappingId==='buttons').unsupportedDirectProps,['Overflow','overflow']);
 delete s.nodes[1].props.overflow;const accepted=await f.invoke(request());assert.equal(accepted.status,200);assert.deepEqual(accepted.result.result.spec,s);
 assert.deepEqual(accepted.result.result.spec.nodes.slice(1).map(n=>n.actions.items.length),[5,2]);
});
test('canonical v1 remains supported with declared events and rejects v2-only behavior/capability gaps',async()=>{
 const s=rows();s.schemaVersion='apollo.screen-spec.v1-experimental';delete s.capabilityGaps;
 for(const n of s.nodes.slice(1))for(const item of n.actions.items){delete item.behavior;item.eventId='open';}s.events=[{id:'open'}];
 assert.equal((await canonicalFixture(s).invoke(request())).status,200);
 for(const edit of [v=>{v.nodes[1].actions.items[0].behavior='none';delete v.nodes[1].actions.items[0].eventId;},v=>v.capabilityGaps=[]]){
  const v=structuredClone(s);edit(v);assert.equal((await canonicalFixture(v).invoke(request())).result.code,'PROMPT_SPEC_INVALID');
 }
});
test('v2 still checks fresh contracts before and after model work',async()=>{
 const s=rows();let calls=0;
 const f=canonicalFixture(s,async()=>{calls++;return {specJson:JSON.stringify(s)};});
 f.context.assertCurrent=()=>{throw Object.assign(Error('private detail'),{code:'PROMPT_INPUTS_STALE'});};
 assertFailure((await f.invoke(request())).result,'PROMPT_INPUTS_STALE');assert.equal(calls,0);
 let checks=0;f.context.assertCurrent=()=>{if(++checks===2)throw Object.assign(Error('private detail'),{code:'PROMPT_INPUTS_STALE'});};
 assertFailure((await f.invoke(request())).result,'PROMPT_INPUTS_STALE');assert.equal(calls,1);
});

// Scripted replies verify the instruction contract and route preservation; they do not accept model/native behavior.
const naturalPrompt27='собери экран с белым фоном. поставь 2 ряда кнопок, отступ между ними 24 пикселя. В первой группе пять действий: Кнопка 1, Кнопка 2, Кнопка 3, Кнопка 4, Кнопка 5. Во втором ряду всего две кнопки: Сохранит и Отменить.';
test('natural layout needs no click-behavior question and retains literal intent/settings (synthetic)',async()=>{
 for(const target of ['figma','frontend']){
  const s=rows();s.nodes[2].actions.items.forEach((item,i)=>item.label=['Сохранит','Отменить'][i]);
  const body=request();body.input.prompt=naturalPrompt27;
  const f=canonicalFixture(s,async prompt=>{
   const user=JSON.parse(prompt.split('\n').find(line=>line.startsWith('USER_INPUT=')).slice(11));assert.deepEqual(user,body.input);
   assert.match(prompt,/без заданной бизнес-логики выбирай behavior:"none"/);
   assert.match(prompt,/Подпись кнопки сама по себе не задаёт бизнес-действие/);
   assert.match(prompt,/не добавляй unresolved только из-за отсутствия поведения нажатия/);
   assert.match(prompt,/Не превращай отсутствие бизнес-действия в disabled=true/);
   return {specJson:JSON.stringify(s)};
  });f.context.packet.targetContext={target};
  const r=await f.invoke(body);assert.equal(r.status,200);assert.deepEqual(r.result.result.spec,s);
  assert.deepEqual(s.nodes.slice(1).map(n=>n.actions.items.map(i=>i.label)),[['Кнопка 1','Кнопка 2','Кнопка 3','Кнопка 4','Кнопка 5'],['Сохранит','Отменить']]);
  assert.deepEqual(s.nodes.slice(1).flatMap(n=>n.actions.items).map(i=>[i.behavior,i.eventId,i.disabled]),Array.from({length:7},()=>['none',undefined,undefined]));
  assert.deepEqual(s.unresolved,[]);assert.equal(s.nodes[0].gap,24);assert.equal(r.result.result.executionAllowed,false);
  assert.deepEqual(s.viewport,body.input.viewport);assert.equal(s.platform,body.input.platform);assert.deepEqual(r.result.result.spec.capabilityGaps,s.capabilityGaps);
 }
});
test('explicit executable intent retains its event and material question/capability gap (synthetic)',async()=>{
 for(const target of ['figma','frontend']){
  const s=rows(),action=s.nodes[2].actions.items[0];action.label='Сохранит';delete action.behavior;action.eventId='save-requested';s.events=[{id:'save-requested'}];
  s.unresolved=['Какие данные требуется сохранить?'];s.capabilityGaps.push({code:'SAVE_API_UNAVAILABLE',message:'API сохранения отсутствует в переданном контексте.',nodeId:'two'});
  const body=request();body.input.prompt=naturalPrompt27+' По нажатию Сохранит выполни сохранение данных через событие save-requested; состав данных пока не определён.';
  const f=canonicalFixture(s,async prompt=>{
   assert.match(prompt,/не подменяй объявленный eventId статичным behavior:"none"/);
   assert.match(prompt,/для явно запрошенной исполняемой логики не хватает существенного продуктового решения, сохрани вопрос в unresolved/);
   assert.match(prompt,/отсутствующий API или обработчик остаётся capabilityGap/);
   assert.deepEqual(JSON.parse(prompt.split('\n').find(line=>line.startsWith('USER_INPUT=')).slice(11)),body.input);
   return {specJson:JSON.stringify(s)};
  });f.context.packet.targetContext={target};
  const r=await f.invoke(body);assert.equal(r.status,200);assert.deepEqual(r.result.result.spec,s);assert.equal(action.eventId,'save-requested');assert.equal(action.behavior,undefined);
  assert.deepEqual(r.result.result.spec.unresolved,s.unresolved);assert.equal(r.result.result.executionAllowed,false);assert.equal(s.nodes[1].actions.items[0].behavior,'none');
 }
});

function assertFailure(result,code){assert.equal(result.success,false);assert.equal(result.code,code);assert.equal(result.diagnostic.code,code);assert.equal(result.diagnostic.schemaVersion,'apollo.generation-failure.v1');assert.equal(result.diagnostic.requestId,request().requestId);assert.match(result.diagnostic.errorId,/^err:/);assert(!JSON.stringify(result).includes('private'));}

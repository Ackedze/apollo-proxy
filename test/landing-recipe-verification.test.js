'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SCHEMA,readProfile,evaluate,captureForProfile,readContentInventory}=require('../src/landing/recipe-verification');
const {packObservation,unpackObservation}=require('../src/figma-mcp/observation-codec');
const {observeRecipeRoot}=require('../src/figma-mcp/recipe-observation');
const {retainedReleaseRoot}=require('../src/landing/runtime');
const releases=require('../src/data-release');
const route=(relation='self',match={})=>[{relation,match}];
function profile(assertions,extra={}){
 const declaration={schemaVersion:SCHEMA,rules:[{id:'physical-layout',label:'Фактическая геометрия',source:'knowledge/data/ds-ai-hub/recipe.md#layout',stages:['structure','content'],scope:route(),minScopes:1,assertions,...extra}]};
 return readProfile({generation:{verification:{schemaVersion:SCHEMA,file:'references/verification.json'}},bodies:{'references/verification.json':JSON.stringify(declaration)}});
}
const node=(id,parentId,facts={})=>({id,parentId,type:'FRAME',name:id,visible:true,facts:{x:0,y:0,right:100,bottom:100,width:100,height:100,layoutSizingVertical:'HUG',...facts},properties:{},bindings:{},variables:{},resolved:{}});
const context={rootId:'root',revision:7,sourcePin:'pinned-source',stage:'structure'};
const snapshot=nodes=>({schemaVersion:'apollo.recipe-observation.v1',rootId:'root',complete:true,nodes});
const value=(field,equals,targets=route())=>({id:field,label:field,op:'value',field,equals,targets});
const shippedProfile=ids=>{
 const file='references/verification.json';
 const skill=path.resolve(__dirname,'../../../shared/design-system_ab/apollo/skills/ab-generate-custom-landing');
 const declaration=JSON.parse(fs.readFileSync(path.join(skill,file),'utf8'));
 return readProfile({generation:{verification:{schemaVersion:SCHEMA,file}},bodies:{[file]:JSON.stringify({...declaration,rules:declaration.rules.filter(rule=>ids.includes(rule.id))})}});
};
const instance=(id,parentId,familyKey,properties={},facts={})=>({
 ...node(id,parentId,facts),type:'INSTANCE',familyKey,
 properties:Object.fromEntries(Object.entries(properties).map(([name,value])=>[name,{type:'VARIANT',value}])),
});
test('shipped landing rules read the native Form surface and four Benefits cards in two frames',()=>{
 const p=shippedProfile(['modal-footer-form-surface','benefits-capacity-4']);
 const style=instance('style','plate','2b46e94cdecdab7d4cb977055c0405b2f6204127',{Type:'Primary',BackgroundColor:'base-bg-alt (gray)'});
 style.variables.fills='8e2800951104c0afbc2ed28e5331d61aa4214a9a';
 const tree=[node('root',null),{...node('shell','root'),name:'UniversalModal'},
  instance('footer','shell','dfefda60dd9cac5197b6164262023ac53cb9300d'),
  {...node('slot','footer'),type:'SLOT',name:'Content'},
  instance('form','slot','ad69491dc9acf4caa4228724ee5f9899aa7cd07a'),
  instance('plate','form','c49f08db71ab44ea64f0880730220de1d93ac263'),style,
  instance('benefits','shell','5eb973ab22e01c40d556cc600f1a5c15101b8192',{Capacity:'4'}),
  node('row-a','benefits'),node('row-b','benefits')];
 const cards=Array.from({length:4},(_,i)=>instance('card-'+i,i<2?'row-a':'row-b','61cba21130d5adfd36b798bb4a41f6ccd148c1aa',{},{height:186}));
 const checked=()=>evaluate(p,snapshot([...tree,...cards]),context);
 assert.equal(checked().passed,true);
 style.properties.BackgroundColor.value='modal-bg (white)';
 style.variables.fills='be3bf2c65d1f3fd8c66b5d74e95d79a608ee8f72';
 assert.equal(checked().checks.filter(check=>check.status==='failed').length,2);
 style.properties.BackgroundColor.value='base-bg-alt (gray)';
 delete style.variables.fills;
 assert.equal(checked().checks[0].status,'unknown');
 style.variables.fills='8e2800951104c0afbc2ed28e5331d61aa4214a9a';
 cards[3].facts.height=188;
 assert.match(checked().checks[0].evidence,/equal-outer-height/);
 cards[3].visible=false;
 assert.match(checked().checks[0].evidence,/"count":3/);
});
test('shipped inventory reads four modal ImageView slots, excludes icons and counts an image Graphic once',()=>{
 const p=shippedProfile(['content-inventory']);
 const benefits=instance('benefits','content','5eb973ab22e01c40d556cc600f1a5c15101b8192');
 const card=instance('card',benefits.id,'61cba21130d5adfd36b798bb4a41f6ccd148c1aa');
 const graphic=instance('graphic',card.id,'b221a157df3d0f2a3ea77e5ddb2e0481825850c0',{Presets:'Icon'});graphic.name='[D] Graphic';
 const image=(id,parentId)=>({...instance(id,parentId,'1'.repeat(40)),name:'ImageView'});
 const promoCards=Array.from({length:3},(_,i)=>instance('promo-'+i,'content','efdc65ad205ceb06c6940d074b9f131f15ebc5e8'));
 const tree=[node('root',null),{...node('shell','root'),name:'UniversalModal'},
  instance('hero','shell','e691885120337235bc0443186870e7b120567f40'),image('hero-slot','hero'),
  {...node('content','shell'),name:'ModalContent'},benefits,card,graphic,image('nested-graphic','graphic'),
  ...promoCards.flatMap(row=>[row,image('slot-'+row.id,row.id)]),
 ];
 const inventory=()=>readContentInventory(p,evaluate(p,snapshot(tree),context));
 const initial=inventory();
 assert.deepEqual(initial.slots,['hero-slot','slot-promo-0','slot-promo-1','slot-promo-2']);
 assert.deepEqual(initial.families,{benefits:'Benefits'});
 tree[3].familyKey='2'.repeat(40);
 assert.deepEqual(inventory(),initial);
 graphic.properties.Presets.value='Image';
 assert.deepEqual(inventory().slots,[...initial.slots,'graphic']);
 delete graphic.properties.Presets;
 assert.equal(inventory(),null);
});
test('empty or executable declarations fail closed; old skills have no new gate',()=>{
 assert.equal(readProfile({generation:{}}),null);
 for(const assertions of [[],[{id:'x',label:'x',op:'eval',targets:route(),code:'return true'}]])assert.throws(()=>profile(assertions),{code:'LANDING_VERIFICATION_INVALID'});
 assert.throws(()=>profile([value('height',100)],{scope:route('descendants',{fields:{constructor:'anything'}})}),{code:'LANDING_VERIFICATION_INVALID'});
});
test('repair opt-in is a separate strict resource and leaves the verification schema compatible',()=>{
 const legacy=profile([value('width',100)]),declaration=legacy.declaration;
 const skill={generation:{verification:{schemaVersion:SCHEMA,file:'references/verification.json'}},bodies:{'references/verification.json':JSON.stringify(declaration)}};
 assert.deepEqual(readProfile(skill),legacy);
 for(const enabled of [true,false]){
  const current=readProfile({...skill,bodies:{...skill.bodies,'references/recovery.json':JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1',repairStructure:enabled})}});
  assert.equal(current.declaration.repairStructure,enabled);
  assert.deepEqual(current.declaration.rules,declaration.rules);
  assert.notEqual(current.sha256,legacy.sha256);
 }
 const malformed=['{',JSON.stringify({schemaVersion:'other',repairStructure:true}),JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1'}),JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1',repairStructure:'true'}),JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1',repairStructure:true,code:'execute'})];
 for(const body of malformed)assert.throws(()=>readProfile({...skill,bodies:{...skill.bodies,'references/recovery.json':body}}),{code:'LANDING_VERIFICATION_INVALID'});
 assert.throws(()=>readProfile({generation:{},bodies:{'references/recovery.json':JSON.stringify({schemaVersion:'apollo.recipe-recovery.v1',repairStructure:true})}}),{code:'LANDING_VERIFICATION_INVALID'});
 assert.throws(()=>readProfile({...skill,bodies:{'references/verification.json':JSON.stringify({...declaration,repairStructure:true})}}),{code:'LANDING_VERIFICATION_INVALID'});
});
test('unsupported fields, missing targets and incomplete facts are unknown, never passed',()=>{
 for(const field of ['unsupported','property:Legal','binding:fills','variable:fills','resolved:itemSpacing']){
  const result=evaluate(profile([value(field,'expected')]),snapshot([node('root',null)]),context);assert.equal(result.passed,false);assert.equal(result.checks[0].status,'unknown');
 }
 for(const change of [s=>s.complete=false,s=>s.nodes=[],s=>s.rootId='other',s=>s.nodes.push(node('outside','missing'))]){
  const s=snapshot([node('root',null)]);change(s);assert.equal(evaluate(profile([value('height',100)]),s,context).passed,false);
 }
 const missing=profile([value('height',100,route('descendants',{name:'absent'}))]);assert.equal(evaluate(missing,snapshot([node('root',null)]),context).checks[0].status,'unknown');
});
test('every matched descendant is checked, including a late node not named by an agent',()=>{
 const p=profile([value('height',100,route('descendants',{name:'card'}))]);
 const root=node('root',null),a=node('a','root'),b=node('b','root',{height:80});a.name=b.name='card';
 const result=evaluate(p,snapshot([root,a,b]),context);assert.equal(result.passed,false);assert.equal(result.checks[0].status,'failed');assert.match(result.checks[0].evidence,/"id":"b"/);
 assert.equal(evaluate(p,snapshot([root,a]),context).passed,true);
});
test('field selectors count HUG anchors; sizing and heights cannot be forged by equal outer roots',()=>{
 const cards=route('children'),wrappers=[...cards,{relation:'children',match:{name:'wrapper'}}];
 const p=profile([
  {id:'anchor',label:'Опора',op:'count',targets:route('children',{fields:{layoutSizingVertical:'HUG'}}),min:1},
  {id:'roots',label:'Root',op:'same',field:'height',targets:cards},
  {id:'wrappers',label:'Wrapper',op:'same',field:'height',targets:wrappers},
 ]);
 const root=node('root',null),nodes=[root];
 for(let i=0;i<3;i++){nodes.push(node('c'+i,'root',{height:186,layoutSizingVertical:i===1?'HUG':'FILL'}));const w=node('w'+i,'c'+i,{height:78});w.name='wrapper';nodes.push(w);}
 assert.equal(evaluate(p,snapshot(nodes),context).passed,true);
 nodes.find(n=>n.id==='w0').facts.height=54;assert.equal(evaluate(p,snapshot(nodes),context).passed,false);
 nodes.find(n=>n.id==='w0').facts.height=78;nodes.find(n=>n.id==='c1').facts.layoutSizingVertical='FILL';assert.equal(evaluate(p,snapshot(nodes),context).passed,false);
});
test('real public boolean keys and type/value evidence distinguish false, missing and ambiguous',()=>{
 const root=node('root',null);root.properties={'⚖️ Legal#12:3':{type:'BOOLEAN',value:false}};
 const p=profile([value('property:⚖️ Legal',false)]);let result=evaluate(p,snapshot([root]),context);
 assert.equal(result.passed,true);assert.match(result.checks[0].evidence,/Legal#12:3/);assert.match(result.checks[0].evidence,/BOOLEAN/);
 root.properties['⚖️ Legal#other']={type:'BOOLEAN',value:false};assert.equal(evaluate(p,snapshot([root]),context).checks[0].status,'unknown');
 delete root.properties['⚖️ Legal#other'];root.properties['⚖️ Legal#12:3'].value='false';assert.equal(evaluate(p,snapshot([root]),context).passed,false);
});
test('native values, geometry and bindings are independent facts; recolor changes the receipt',()=>{
 const root=node('root',null),a=node('a','root',{height:28}),b=node('b','root',{height:28});a.native={height:28};a.bindings.fills=b.bindings.fills='color-id';
 const p=profile([{id:'native',label:'Native',op:'value',field:'height',native:true,targets:route('children',{name:'a'})},{id:'fit',label:'Fit',op:'inside',targets:route('children'),other:route()},{id:'color',label:'Color',op:'same',field:'binding:fills',targets:route('children')}]);
 const before=evaluate(p,snapshot([root,a,b]),context);assert.equal(before.passed,true);
 b.bindings.fills='other';const after=evaluate(p,snapshot([root,a,b]),context);assert.equal(after.passed,false);assert.notEqual(after.snapshotHash,before.snapshotHash);
 b.bindings.fills='color-id';a.facts.height=30;assert.equal(evaluate(p,snapshot([root,a,b]),context).passed,false);
 a.facts.height=28;delete a.native.height;assert.equal(evaluate(p,snapshot([root,a,b]),context).checks[0].status,'unknown');
});
test('false applicability is distinct from unknown; an entirely inapplicable stage cannot approve',()=>{
 const condition=value('width',200);delete condition.id;delete condition.label;
 const p=profile([value('height',100)],{when:[condition]});
 assert.equal(evaluate(p,snapshot([node('root',null)]),context).passed,false);
 const root=node('root',null,{width:200});assert.equal(evaluate(p,snapshot([root]),context).passed,true);
 delete root.facts.width;assert.equal(evaluate(p,snapshot([root]),context).checks[0].status,'unknown');
});
function fakeNode(id,type,parent=null){const n={id,type,name:id,parent,visible:true,x:0,y:0,rotation:0,width:100,height:100,paddingLeft:4,paddingRight:6,fills:[],layoutGrids:[],children:[],componentProperties:{},boundVariables:{},absoluteBoundingBox:{x:0,y:0,width:100,height:100}};if(parent)parent.children.push(n);return n;}
const observe=async(root,figma)=>vm.runInNewContext('('+observeRecipeRoot.toString()+')(root)',{root,figma});
test('trusted observation resolves main/variable facts, hidden ancestry and native selected variant',async()=>{
 const root=fakeNode('root','FRAME'),native=fakeNode('main','COMPONENT');native.key='a'.repeat(40);native.parent={type:'COMPONENT_SET',key:'b'.repeat(40)};
 const item=fakeNode('instance','INSTANCE',root);item.getMainComponentAsync=async()=>native;item.boundVariables.itemSpacing={type:'VARIABLE_ALIAS',id:'spacing'};
 const stopper=fakeNode('stopper','FRAME',item),defaultStopper=fakeNode('native-stopper','FRAME',native);stopper.name=defaultStopper.name='Stopper';stopper.height=defaultStopper.height=28;stopper.minHeight=defaultStopper.minHeight=24;
 const hidden=fakeNode('hidden','FRAME',root);hidden.visible=false;fakeNode('nested','FRAME',hidden);
 const result=await observe(root,{variables:{getVariableByIdAsync:async()=>({key:'v'.repeat(40),resolveForConsumer:()=>({value:16})})}});
 assert.equal(result.complete,true);assert.equal(result.nodes.find(n=>n.id==='nested').visible,false);
 const actual=result.nodes.find(n=>n.id==='instance');assert.equal(actual.familyKey,'b'.repeat(40));assert.equal(actual.resolved.itemSpacing,16);assert.equal(actual.facts.contentWidth,90);
 assert.equal(result.nodes.find(n=>n.id==='stopper').native.height,28);assert.equal(result.nodes[0].facts.fillCount,0);
});
test('mutation during async host observation invalidates the snapshot',async()=>{
 const root=fakeNode('root','FRAME'),item=fakeNode('instance','INSTANCE',root);
 item.getMainComponentAsync=async()=>{root.width=120;return null;};
 const observed=await observe(root,{});assert.equal(observed.complete,false);
});
test('hidden instance descendants are read regardless of the caller flag, then the flag is restored',async()=>{
 const root=fakeNode('root','FRAME'),instance=fakeNode('instance','INSTANCE',root),hidden=fakeNode('info','TEXT',instance);hidden.visible=false;hidden.characters='Retained hidden consent';
 const all=instance.children,figma={skipInvisibleInstanceChildren:true};Object.defineProperty(instance,'children',{get(){return figma.skipInvisibleInstanceChildren?[]:all;}});instance.getMainComponentAsync=async()=>null;
 const result=await observe(root,figma);assert.equal(result.complete,true);assert.equal(result.nodes.find(n=>n.id==='info').visible,false);assert.equal(figma.skipInvisibleInstanceChildren,true);
 Object.defineProperty(root,'name',{get(){throw Error('Read failed');}});await assert.rejects(observe(root,figma));assert.equal(figma.skipInvisibleInstanceChildren,true);
});
test('native image inset comparison catches a shared shift without fixing variant-specific offsets',async()=>{
 const root=fakeNode('root','FRAME'),main=fakeNode('main','COMPONENT');main.key='a'.repeat(40);
 const instance=fakeNode('instance','INSTANCE',root);instance.getMainComponentAsync=async()=>main;
 const image=fakeNode('image','FRAME',instance),nativeImage=fakeNode('native-image','FRAME',main);image.name=nativeImage.name='ImageContainer';image.y=nativeImage.y=-12;
 const p=profile([{id:'native-edge',label:'Край native',op:'value',field:'insetTop',native:true,targets:route('descendants',{name:'ImageContainer'})}]);
 assert.equal(evaluate(p,await observe(root,{}),context).passed,true);
 image.y=0;assert.equal(evaluate(p,await observe(root,{}),context).passed,false);
});
test('resume only selects a retained current/previous owned release, never an arbitrary path',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'landing-retained-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const a='a'.repeat(64),b='b'.repeat(64),current=path.join(root,'versions',a),previous=path.join(root,'versions',b);fs.mkdirSync(current,{recursive:true});fs.mkdirSync(previous,{recursive:true});fs.writeFileSync(path.join(current,'manifest.json'),JSON.stringify({id:a}));
 const state={schemaVersion:releases.STORE_SCHEMA,current:{contentVersion:a,path:current},previous:{contentVersion:b,path:previous}};fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state));
 assert.equal(retainedReleaseRoot(current,a),current);assert.equal(retainedReleaseRoot(current,b),previous);
 assert.throws(()=>retainedReleaseRoot(current,'c'.repeat(64)),{code:'LANDING_DATA_STALE'});
 state.previous.path='/elsewhere';fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state));assert.throws(()=>retainedReleaseRoot(current,b),{code:'LANDING_DATA_STALE'});
});
test('lossless observation encoding keeps all facts and rejects malformed or truncated data',()=>{
 const original=snapshot(Array.from({length:305},(_,i)=>node('n'+i,i?'n0':null)));
 original.nodes[0].properties=JSON.parse('{"__proto__":{"type":"BOOLEAN","value":false},"Legal#1:2":{"type":"BOOLEAN","value":false}}');
 const encoded=packObservation(original);assert.deepEqual(unpackObservation(JSON.parse(JSON.stringify(encoded))),original);
 assert(JSON.stringify(encoded).length<JSON.stringify(original).length*.7);
 assert.equal({}.type,undefined);
 for(const data of [[0,999999],[0],[2,0,1,0,2],[3],{unsafe:true}])assert.throws(()=>unpackObservation({...encoded,data}),{code:'LANDING_ROOT_OBSERVATION_INVALID'});
 let deep=null;for(let i=0;i<100;i++)deep=[1,deep];assert.throws(()=>unpackObservation({...encoded,data:deep}),{code:'LANDING_ROOT_OBSERVATION_INVALID'});
});
test('observation compression survives Unicode, dictionary resets and invalid streams',()=>{
 let seed=7,text='Кириллица 🎨 \ud800';for(let i=0;i<300000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=String.fromCharCode(32+(seed%95));}
 const original=snapshot([node('root',null)]);original.nodes[0].text=text;assert.deepEqual(unpackObservation(packObservation(original)),original);
 for(const data of ['AA==','AAA=','!!!!','A==='])assert.throws(()=>unpackObservation({schemaVersion:'apollo.recipe-observation.packed.v1',compression:'lzw16-base64',data}),{code:'LANDING_ROOT_OBSERVATION_INVALID'});
});
test('profile-driven capture preserves public property keys and avoids unrelated native reads',async()=>{
 const p=profile([{id:'native',label:'Native height',op:'value',field:'height',native:true,targets:route('children')},value('property:⚖️ Legal',false,route('children'))]);
 const capture=captureForProfile(p);assert.deepEqual(capture,{nativeFields:['height'],propertyNames:['⚖️ Legal'],bindingFields:[],variableFields:[],resolvedFields:[],nativeTargets:[{}]});
 const root=fakeNode('root','FRAME'),main=fakeNode('main','COMPONENT'),instance=fakeNode('instance','INSTANCE',root);main.key='a'.repeat(40);main.height=28;instance.height=28;
 Object.defineProperty(main,'componentProperties',{get(){throw Error('Unused native properties must not be read');}});
 instance.getMainComponentAsync=async()=>main;instance.componentProperties={'⚖️ Legal#1:2':{type:'BOOLEAN',value:false},Unrelated:{type:'TEXT',value:'not needed'}};
 const observed=await vm.runInNewContext('('+observeRecipeRoot.toString()+')(root,capture)',{root,capture,figma:{}}),n=observed.nodes.find(n=>n.id==='instance');
 assert.deepEqual(JSON.parse(JSON.stringify(n.native)),{height:28});assert.deepEqual(Object.keys(n.properties),['⚖️ Legal#1:2']);assert.equal(evaluate(p,observed,context).passed,true);
});
test('component resolution is bounded and parallel without losing descendants',async()=>{
 const root=fakeNode('root','FRAME');let running=0,peak=0,read=0;
 for(let i=0;i<80;i++){const n=fakeNode('i'+i,'INSTANCE',root);n.getMainComponentAsync=async()=>{running++;peak=Math.max(peak,running);await new Promise(resolve=>setImmediate(resolve));running--;read++;return null;};}
 const result=await observe(root,{});assert.equal(result.complete,true);assert.equal(result.nodes.length,81);assert.equal(read,80);assert(peak>1&&peak<=64);
});
test('profile capture reads required variable keys but resolves only required values',async()=>{
 const root=fakeNode('root','FRAME');root.boundVariables={itemSpacing:{type:'VARIABLE_ALIAS',id:'spacing'},paddingLeft:{type:'VARIABLE_ALIAS',id:'padding'},unrelated:{type:'VARIABLE_ALIAS',id:'unused'}};
 root.fills=[{type:'SOLID',boundVariables:{color:{type:'VARIABLE_ALIAS',id:'color'}}}];
 const capture={nativeFields:[],propertyNames:[],bindingFields:['itemSpacing','paddingLeft','fills'],variableFields:['paddingLeft'],resolvedFields:['itemSpacing']},reads=[],resolves=[];
 const figma={variables:{async getVariableByIdAsync(id){reads.push(id);return {key:id,resolveForConsumer(){resolves.push(id);return {value:16};}};}}};
 const result=await vm.runInNewContext('('+observeRecipeRoot.toString()+')(root,capture)',{root,capture,figma}),actual=result.nodes[0];
 assert.deepEqual(reads,['spacing','padding']);assert.deepEqual(resolves,['spacing']);assert.equal(actual.bindings.fills,'color');assert.equal(actual.variables.paddingLeft,'padding');assert.equal(actual.resolved.itemSpacing,16);assert.equal(actual.bindings.unrelated,undefined);
});
test('native pruning keeps every possible required target and its ancestry',async()=>{
 const p=profile([{id:'native',label:'Native stopper',op:'value',field:'height',native:true,targets:route('descendants',{name:'Stopper'})}]),capture=captureForProfile(p),root=fakeNode('root','FRAME'),main=fakeNode('main','COMPONENT'),instance=fakeNode('instance','INSTANCE',root),stopper=fakeNode('stopper','FRAME',instance),nativeStopper=fakeNode('native-stopper','FRAME',main);main.key='a'.repeat(40);stopper.name=nativeStopper.name='Stopper';stopper.height=nativeStopper.height=28;instance.getMainComponentAsync=async()=>main;
 const unused=fakeNode('unused','INSTANCE',root),unusedMain={id:'unused-main',key:'b'.repeat(40)};let nativeReads=0;Object.defineProperty(unusedMain,'height',{get(){nativeReads++;return 100;}});unused.getMainComponentAsync=async()=>unusedMain;
 const read=()=>vm.runInNewContext('('+observeRecipeRoot.toString()+')(root,capture)',{root,capture,figma:{}});
 const observed=await read();assert.equal(observed.nodes.length,4);assert.equal(observed.complete,true);assert.equal(evaluate(p,observed,context).passed,true);assert.equal(nativeReads,0);assert.equal(observed.nodes.find(n=>n.id==='unused').componentKey,'b'.repeat(40));
 stopper.height=30;assert.equal(evaluate(p,await read(),context).passed,false);assert.deepEqual(capture.nativeTargets,[{name:'Stopper'}]);
});

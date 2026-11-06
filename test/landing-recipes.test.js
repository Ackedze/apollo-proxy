const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const compactRun=process.env.LANDING_TEST_COMPACT_RECIPES==='1',recipes=require('../src/landing/figma-recipes');
if(compactRun){const artifact=require('../src/landing/figma-recipes.compact.json'),names=Object.keys(recipes);Object.assign(recipes,vm.runInThisContext('(function(){'+names.map(name=>artifact.recipes[name].code).join('\n')+';return {'+names.join(',')+'};})()'));}

test('published source inspection recipe uses narrowed documented fields and bounded results',async t=>{
 const prior=global.figma;global.figma={skipInvisibleInstanceChildren:true};t.after(()=>{global.figma=prior;});
 const {readMcpSourceFacts,boundedMcpResult}=require('../src/landing/figma-recipes');
 const strict=value=>new Proxy(value,{get(t,k){if(typeof k==='string'&&!(k in t))throw Error('Unsupported native field '+k);return t[k];}}),set=strict({type:'COMPONENT_SET',componentPropertyDefinitions:{Body:{type:'SLOT'}}}),payload=strict({id:'default',type:'FRAME',name:'Default'}),slot=strict({id:'slot',type:'SLOT',name:'Body',componentPropertyReferences:{slotContentId:'Body'},children:[payload]}),component=strict({id:'source',type:'COMPONENT',key:'published',parent:set,variantProperties:null,width:40,height:40,children:[slot]});
 const value=await readMcpSourceFacts(component,'published');assert.equal(value.children[0].refs.slotContentId,'Body');assert.equal(value.definitions[0].type,'SLOT');assert.equal(value.subtreeComplete,false);assert.equal(boundedMcpResult(value),value);assert.throws(()=>boundedMcpResult({value:'€'.repeat(4500)}),/MCP_RESULT_SCOPE_TOO_LARGE/);await assert.rejects(readMcpSourceFacts(component,'foreign'),/MCP_SOURCE_KEY_MISMATCH/);
});
test('default correspondence reads hidden layers and normalizes only component-to-instance representation',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),prior=global.figma;global.figma={skipInvisibleInstanceChildren:true};t.after(()=>{global.figma=prior;});
 const leaves=[{type:'FRAME',name:'BottomAddon',visible:false},{type:'FRAME',name:'TopAddon',visible:false},{type:'INSTANCE',name:'Indicator',visible:false,componentProperties:{View:{type:'VARIANT',value:'Red'}},mainComponent:{key:'indicator'},getMainComponentAsync:async()=>({key:'indicator'})},{type:'BOOLEAN_OPERATION',name:'Shape',visible:true},{type:'FRAME',name:'ShapeContent',visible:true}];
 const source={id:'source-40',type:'COMPONENT',key:'published',name:'Size=40',variantProperties:{Size:'40'},width:40,height:40,children:[{id:'source-content',type:'FRAME',name:'Content',children:leaves.map((n,i)=>({id:'source-'+i,...n}))}]};
 const actualLeaves=leaves.map((n,i)=>({id:'instance-'+i,...n})),instance={id:'instance-40',type:'INSTANCE',name:'IconView',variantProperties:{Size:'40'},width:40,height:40,get mainComponent(){return source;},getMainComponentAsync:async()=>source,children:[{id:'instance-content',type:'FRAME',name:'Content',get children(){return global.figma.skipInvisibleInstanceChildren?actualLeaves.filter(n=>n.visible):actualLeaves;}}]};
 assert.equal(instance.children[0].children.length,2,'Historical MCP view pruned three real hidden children');
 let proof=await compareMcpDefaults(source,instance);assert.equal(proof.equal,true);assert.equal(proof.nodesCompared,7);assert.equal(global.figma.skipInvisibleInstanceChildren,false);
 actualLeaves[0].name='Wrong hidden payload';proof=await compareMcpDefaults(source,instance);assert.equal(proof.equal,false);assert.deepEqual(proof.differences,[{path:'default.children[0].children[0].name',sourceNodeId:'source-0',nodeId:'instance-0'}]);actualLeaves[0].name='BottomAddon';
 actualLeaves.pop();assert((await compareMcpDefaults(source,instance)).differences.some(d=>d.path.endsWith('.children.length')));actualLeaves.push({id:'instance-4',...leaves[4]});
 instance.variantProperties={Size:'64'};assert((await compareMcpDefaults(source,instance)).differences.some(d=>d.path==='default.variantProperties'));instance.variantProperties={Size:'40'};
 instance.getMainComponentAsync=async()=>({key:'foreign'});assert((await compareMcpDefaults(source,instance)).differences.some(d=>d.path==='default.mainKey'));instance.getMainComponentAsync=async()=>source;
 instance.width=41;assert((await compareMcpDefaults(source,instance)).differences.some(d=>d.path==='default.width'));
});
test('payload reflow is reported separately while hidden styles, references and mixed text remain strict',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),prior=global.figma;global.figma={};t.after(()=>{global.figma=prior;});
 const segment={fontName:{family:'Alfa Interface Sans',style:'Bold'},fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]},text={id:'source-text',type:'TEXT',name:'Content',visible:true,characters:'Default',componentPropertyReferences:{characters:'Label#1:0'},width:1228,height:16,y:37,getStyledTextSegments:()=>[segment]},source={id:'source-payload',type:'FRAME',name:'SwapMe',layoutSizingVertical:'FILL',height:90,children:[text]},actualText={...text,id:'actual-text',y:17},actual={...source,id:'actual-payload',height:50,children:[actualText]};
 let proof=await compareMcpDefaults(source,actual);assert.equal(proof.equal,true);assert.equal(proof.contextualGeometry.length,2,'Derived geometry is explicitly not an accepted geometry check');
 actualText.componentPropertyReferences={characters:'Foreign#1:0'};assert((await compareMcpDefaults(source,actual)).differences.some(d=>d.path.endsWith('.componentPropertyReferences')));actualText.componentPropertyReferences=text.componentPropertyReferences;
 actualText.getStyledTextSegments=()=>[{...segment,fontName:{family:'SF Pro Text',style:'Bold'}}];assert((await compareMcpDefaults(source,actual)).differences.some(d=>d.path.endsWith('.styledTextSegments')));
 actualText.getStyledTextSegments=()=>[segment];actualText.fills=[];assert((await compareMcpDefaults(source,actual)).differences.some(d=>d.path.endsWith('.fills')));
});
test('serialized worker comparator is standalone and refuses unavailable complete traversal',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),prior=global.figma;global.figma={get skipInvisibleInstanceChildren(){return true;},set skipInvisibleInstanceChildren(_){}};t.after(()=>{global.figma=prior;});
 await assert.rejects(compareMcpDefaults({id:'source',type:'FRAME'},{id:'actual',type:'FRAME'}),/MCP_SOURCE_TRAVERSAL_UNKNOWN/);
 const vm=require('node:vm'),context={figma:{skipInvisibleInstanceChildren:true}},standalone=vm.runInNewContext('('+compareMcpDefaults.toString()+')',context);assert.equal((await standalone({id:'source',type:'FRAME'},{id:'actual',type:'FRAME'})).equal,true);assert.equal(context.figma.skipInvisibleInstanceChildren,false);
});
test('source-mode recipe preserves explicitly owned font mode under a different page mode without changing the page',async t=>{
 const {createMcpInstance}=require('../src/landing/figma-recipes'),loaded=[],modeCalls=[],created=[],mutated=[],collection={id:'font-collection',modes:[{modeId:'desktop'},{modeId:'ios'}]},page={id:'owned-root',resolvedVariableModes:{'font-collection':'ios'},appendChild(n){n.parent=this;}},text={type:'TEXT',boundVariables:{fontFamily:[{id:'font-variable'}]},getStyledTextSegments:()=>[{fontName:{family:'Alfa Interface Sans',style:'Bold'}}]},component={type:'COMPONENT',key:'published-key',resolvedVariableModes:{'font-collection':'desktop'},children:[text],findAllWithCriteria:()=>[text],createInstance(){assert.equal(loaded.length,2,'Canonical fonts must be loaded before birth');return{id:'fresh-instance',resolvedVariableModes:{'font-collection':'ios'},findAll:()=>[{id:'fresh-text'}],setExplicitVariableModeForCollection(c,m){modeCalls.push([c.id,m]);this.resolvedVariableModes[c.id]=m;}};}};
 component.explicitVariableModes={'font-collection':'desktop'};
 const prior=global.figma;global.figma={variables:{getVariableCollectionByIdAsync:async()=>collection,getVariableByIdAsync:async()=>({valuesByMode:{desktop:'Alfa Interface Sans',ios:'SF Pro Text'}})},loadFontAsync:async f=>loaded.push(f)};t.after(()=>{global.figma=prior;});
 const result=await createMcpInstance(component,'published-key',page,created,mutated);assert.equal(result.resolvedVariableModes['font-collection'],'desktop');assert.equal(page.resolvedVariableModes['font-collection'],'ios');assert.deepEqual(modeCalls,[['font-collection','desktop']]);assert.deepEqual(created,['fresh-instance']);assert.deepEqual(mutated,['owned-root','fresh-instance']);assert.deepEqual(loaded.map(f=>f.family),['Alfa Interface Sans','SF Pro Text']);assert.equal(component.resolvedVariableModes['font-collection'],'desktop');
 await assert.rejects(createMcpInstance(component,'foreign',page,[],[]),/SOURCE_KEY_MISMATCH/);collection.modes=[];await assert.rejects(createMcpInstance(component,'published-key',page,[],[]),/SOURCE_MODE_UNKNOWN/);assert.equal(modeCalls.length,1);
});
test('fresh instances inherit scene appearance instead of freezing the library ancestor context',async t=>{
 const {createMcpInstance}=require('../src/landing/figma-recipes'),prior=global.figma;t.after(()=>{global.figma=prior;});
 global.figma={skipInvisibleInstanceChildren:true,variables:{getVariableCollectionByIdAsync:async()=>{throw Error('Ambient mode must not be copied');}}};
 const body={id:'body',resolvedVariableModes:{surface:'level1'},appendChild(n){n.parent=this;}},slot={id:'slot',explicitVariableModes:{surface:'level2'}},component={type:'COMPONENT',key:'published',resolvedVariableModes:{surface:'level0',theme:'blue'},explicitVariableModes:{},children:[],findAllWithCriteria:()=>[],createInstance:()=>({id:'plate',explicitVariableModes:{},get resolvedVariableModes(){return this.parent.resolvedVariableModes;},findAll:()=>[slot]})};
 const created=[],mutated=[],plate=await createMcpInstance(component,'published',body,created,mutated);assert.equal(plate.resolvedVariableModes.surface,'level1');assert.deepEqual(plate.explicitVariableModes,{});assert.equal(slot.explicitVariableModes.surface,'level2');body.resolvedVariableModes.surface='level3';assert.equal(plate.resolvedVariableModes.surface,'level3');assert.deepEqual(created,['plate']);
});

function contextualPayload(t){
 const prior=global.figma;t.after(()=>{global.figma=prior;});
 const alias={type:'VARIABLE_ALIAS',id:'font-variable'},collection={id:'font',defaultModeId:'library',modes:[{modeId:'library'},{modeId:'system'}]};
 const inherited=n=>{for(let p=n;p&&p.type!=='DOCUMENT';p=p.parent)if(p.explicitVariableModes?.font)return p.explicitVariableModes.font;return collection.defaultModeId;};
 function node(id,type,name,parent,mode){const n={id,type,name,parent,children:[],explicitVariableModes:{},resolvedVariableModes:{font:mode},boundVariables:{}};parent?.children.push(n);return n;}
 const sourcePage=node('source-page','PAGE','Library',null,'library'),page=node('page','PAGE','Scene',null,'system');page.explicitVariableModes.font='system';
 const component=node('source','COMPONENT','CorporateContent',sourcePage,'library');component.key='published';component.variantProperties={};
 const instance=node('instance','INSTANCE','CorporateContent',page,'system');instance.getMainComponentAsync=async()=>component;Object.defineProperty(instance,'mainComponent',{get:()=>component,configurable:true});instance.variantProperties={};
 const sourceSlot=node('source-slot','SLOT','Body',component,'library'),slot=node('slot','SLOT','Body',instance,'system');
 const source=node('source-payload','FRAME','SwapMe',sourceSlot,'library'),actual=node('payload','FRAME','SwapMe',slot,'system');
 const sourceText=node('source-text','TEXT','Content',source,'library'),text=node('text','TEXT','Content',actual,'system');
 for(const [n,family]of [[sourceText,'Library Sans'],[text,'System Sans']]){
  n.characters='Default';n.fontName={family,style:'Bold'};n.boundVariables={fontFamily:[alias]};n.getRangeBoundVariable=()=>alias;
  n.getStyledTextSegments=()=>[{start:0,end:7,characters:n.characters,fontName:n.fontName,fontSize:12,fills:[]}];
 }
 const variable={id:alias.id,variableCollectionId:collection.id,resolvedType:'STRING',resolveForConsumer:n=>({resolvedType:'STRING',value:inherited(n)==='system'?'System Sans':'Library Sans'})};
 global.figma={skipInvisibleInstanceChildren:true,mixed:Symbol('mixed'),variables:{getVariableCollectionByIdAsync:async()=>collection,getVariableByIdAsync:async()=>variable}};
 return {source,actual,sourceText,text,component,instance,sourceSlot,slot,page,collection,variable};
}
test('default payload uses independently proved ancestor modes and bound font resolution',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,true);assert.equal(result.nodesCompared,2);
 assert.equal(result.contextualValues.filter(row=>row.path.endsWith('.resolvedVariableModes')).length,2);
 const font=result.contextualValues.find(row=>row.path.endsWith('.fontName'));assert.equal(font.sourceValue.family,'Library Sans');assert.equal(font.value.family,'System Sans');
 assert.deepEqual(f.actual.explicitVariableModes,{});assert.equal(f.page.explicitVariableModes.font,'system');assert.equal(f.text.fontName.family,'System Sans');
});
for(const change of ['wrong-resolved-mode','own-mode','ancestor-mode','source-owned-mode','foreign-owner','foreign-slot','foreign-slot-reference','foreign-nested-owner','foreign-binding','unbound-range','mixed-range','wrong-font','font-style','segment-style','missing-collection','missing-variable'])test('pristine context refuses '+change,async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 if(change==='wrong-resolved-mode')f.text.resolvedVariableModes.font='library';
 if(change==='own-mode')f.text.explicitVariableModes.font='system';
 if(change==='ancestor-mode')f.slot.explicitVariableModes.font='system';
 if(change==='source-owned-mode')f.component.explicitVariableModes.font='library';
 if(change==='foreign-owner')f.instance.getMainComponentAsync=async()=>({key:'foreign'});
 if(change==='foreign-slot')f.slot.name='Foreign';
 if(change==='foreign-slot-reference')f.slot.componentPropertyReferences={slotContentId:'Other'};
 if(change==='foreign-nested-owner'){
  const a={id:'source-nested',type:'INSTANCE',name:'Nested',parent:f.component,children:[f.sourceSlot],getMainComponentAsync:async()=>({key:'nested'})},b={id:'nested',type:'INSTANCE',name:'Nested',parent:f.instance,children:[f.slot],getMainComponentAsync:async()=>({key:'foreign'})};
  f.component.children=[a];f.instance.children=[b];f.sourceSlot.parent=a;f.slot.parent=b;
 }
 if(change==='foreign-binding')f.text.boundVariables.fontFamily=[{type:'VARIABLE_ALIAS',id:'other'}];
 if(change==='unbound-range')f.text.getRangeBoundVariable=()=>null;
 if(change==='mixed-range')f.text.getRangeBoundVariable=()=>global.figma.mixed;
 if(change==='wrong-font')f.text.fontName.family='Unrelated Sans';
 if(change==='font-style')f.text.fontName.style='Regular';
 if(change==='segment-style')f.text.getStyledTextSegments=()=>[{start:0,end:7,characters:'Default',fontName:{family:'System Sans',style:'Regular'},fontSize:12,fills:[]}];
 if(change==='missing-collection')global.figma.variables.getVariableCollectionByIdAsync=async()=>null;
 if(change==='missing-variable')global.figma.variables.getVariableByIdAsync=async()=>null;
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,false);assert(result.differences.length>0);
});
test('pristine context remains strict for explicit overrides with the same resolved value',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 f.page.explicitVariableModes.font='library';for(const n of [f.actual,f.text])n.resolvedVariableModes.font='library';f.text.fontName.family='Library Sans';
 f.text.explicitVariableModes.font='library';const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,false);assert(result.differences.some(d=>d.path.endsWith('.explicitVariableModes')));
});
test('serialized pristine context recipe uses only the injected Figma API',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t),vm=require('node:vm');
 const standalone=vm.runInNewContext('('+compareMcpDefaults.toString()+')',{figma:global.figma});assert.equal((await standalone(f.source,f.actual)).equal,true);
});
test('pristine context without a source owner refuses before reading scene fields from pages',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 f.component.type='FRAME';f.instance.type='FRAME';
 for(const page of [f.component.parent,f.page])Object.defineProperty(page,'boundVariables',{get(){throw Error('Page has no boundVariables');}});
 assert.equal((await compareMcpDefaults(f.source,f.actual)).equal,false);
});
for(const change of ['owner','parent','range-binding'])test('pristine context refuses '+change+' drift during variable lookup',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 global.figma.variables.getVariableByIdAsync=async()=>{
  if(change==='owner')f.instance.getMainComponentAsync=async()=>({key:'foreign'});
  if(change==='parent'){const replacement=Object.assign({},f.slot,{id:'replacement-slot'});f.instance.children=[replacement];f.actual.parent=replacement;}
  if(change==='range-binding')f.text.getRangeBoundVariable=()=>null;
  return f.variable;
 };
 assert.equal((await compareMcpDefaults(f.source,f.actual)).equal,false);
});
test('pristine rejection preserves exact mode and font values in serializable diagnostics',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 f.text.resolvedVariableModes.font='invalid';f.text.fontName.family='Unrelated Sans';
 const result=JSON.parse(JSON.stringify(await compareMcpDefaults(f.source,f.actual)));
 assert.equal(result.equal,false);const modes=result.differences.find(d=>d.path.endsWith('.resolvedVariableModes')),font=result.differences.find(d=>d.path.endsWith('.fontName'));
 assert.deepEqual(modes.sourceValue,{font:'library'});assert.deepEqual(modes.value,{font:'invalid'});
 assert.deepEqual(font.sourceValue,{family:'Library Sans',style:'Bold'});assert.deepEqual(font.value,{family:'Unrelated Sans',style:'Bold'});
});
test('a coincidentally equal font still requires correct bound resolution in the new context',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 f.text.fontName.family='Library Sans';assert.equal((await compareMcpDefaults(f.source,f.actual)).equal,false);
});
for(const change of ['payload-fill','text-parent'])test('final pristine freshness refuses '+change+' mutation during metadata reads',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 if(change==='payload-fill')global.figma.variables.getVariableCollectionByIdAsync=async()=>{f.actual.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];return f.collection;};
 if(change==='text-parent')global.figma.variables.getVariableByIdAsync=async()=>{
  f.actual.children=[];f.text.parent={id:'foreign-frame',type:'FRAME',children:[f.text],explicitVariableModes:{font:'system'},parent:f.page};return f.variable;
 };
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,false);assert(result.differences.length>0);
});
for(const change of ['collection-modes','variable-values','resolved-font'])test('final pristine freshness refuses changed proof input '+change,async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);let variableRead=false;
 f.variable.valuesByMode={library:'Library Sans',system:'System Sans'};
 global.figma.variables.getVariableByIdAsync=async()=>{variableRead=true;if(change==='collection-modes')f.collection.modes.push({modeId:'other'});return f.variable;};
 f.instance.getMainComponentAsync=async()=>{
  if(variableRead&&change==='variable-values')f.variable.valuesByMode.system='Changed Sans';
  if(variableRead&&change==='resolved-font')f.variable.resolveForConsumer=()=>({resolvedType:'STRING',value:'Changed Sans'});
  return f.component;
 };
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,false);assert(result.differences.some(d=>d.path==='default.freshness'));
});
test('default mode proof does not read scene-only variable fields from Document',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 const document=new Proxy({id:'document',type:'DOCUMENT',parent:null},{get(target,key){if(key==='explicitVariableModes')throw Error('Unsupported Document field');return target[key];}});
 f.component.parent.parent=document;f.page.parent=document;assert.equal((await compareMcpDefaults(f.source,f.actual)).equal,true);
});
test('a main swap after one final async read cannot pass while another main read is pending',async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t),aMain={id:'main-a',key:'a'},bMain={id:'main-b',key:'b'},foreign={id:'foreign',key:'foreign'};let current=aMain,bReads=0;
 function leaf(id,parent,main,getMain){const n={id,parent,type:'INSTANCE',name:id.slice(id.indexOf('-')+1),children:[],boundVariables:{},explicitVariableModes:{},componentProperties:{},get mainComponent(){return main();},getMainComponentAsync:getMain};parent.children.push(n);return n;}
 leaf('source-a',f.source,()=>aMain,async()=>aMain);leaf('actual-a',f.actual,()=>current,async()=>current);
 leaf('source-b',f.source,()=>bMain,async()=>{if(++bReads===2)await new Promise(resolve=>queueMicrotask(()=>{current=foreign;resolve();}));return bMain;});leaf('actual-b',f.actual,()=>bMain,async()=>bMain);
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(current,foreign);assert.equal(result.equal,false);
});
for(const mode of ['missing','write-only'])test('unavailable synchronous main identity refuses proof: '+mode,async t=>{
 const {compareMcpDefaults}=require('../src/landing/figma-recipes'),f=contextualPayload(t);
 if(mode==='missing')delete f.instance.mainComponent;else Object.defineProperty(f.instance,'mainComponent',{get(){throw Error('Dynamic-page mainComponent is write-only');}});
 const result=await compareMcpDefaults(f.source,f.actual);assert.equal(result.equal,false);assert(result.differences.some(d=>d.reason==='CURRENT_MAIN_IDENTITY_UNAVAILABLE'));
});
if(!compactRun)test('compact source is deterministic, current and executes all existing pristine positive/negative fixtures',()=>{
 const esbuild=require(path.join(process.env.APOLLO_PROJECT_ROOT||path.resolve(__dirname,'../../../projects/Apollo'),'node_modules/esbuild')),artifact=require('../src/landing/figma-recipes.compact.json'),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
 assert.equal(artifact.minifier.version,esbuild.version);assert.equal(typeof require('../src/landing/mcp-receipt').recipeSources(),'string');
 for(const[name,fn]of Object.entries(recipes)){const row=artifact.recipes[name];assert.equal(row.sourceSha256,sha(fn.toString()));assert.equal(row.code,esbuild.transformSync(fn.toString(),{minify:true,target:'es2020'}).code);assert.equal(row.codeSha256,sha(row.code));}
 const result=require('node:child_process').spawnSync(process.execPath,['--test',__filename],{encoding:'utf8',env:{...process.env,LANDING_TEST_COMPACT_RECIPES:'1'},maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);
});
test('write result uses host context and actual ownership; Stop or wrong scope cannot produce a successful receipt',()=>{
 const {finishMcpWrite}=recipes,page={id:'page',type:'PAGE'},parent={id:'parent',type:'SECTION',parent:page},values={owner:'owner',active:'lease'},root={id:'root',type:'FRAME',parent,getSharedPluginData:(_ns,key)=>values[key]},section={id:'temporary',type:'INSTANCE',parent:root,getSharedPluginData:()=> 'hero'};
 const context={schemaVersion:'apollo.mcp-write-result.v1',operationId:'operation',sourcePin:'pin',stage:'structure',sectionId:'hero',target:{rootNodeId:'root',parentNodeId:'parent',pageId:'page',ownerNonce:'owner',leaseNonce:'lease'}},changes={createdNodeIds:['temporary'],mutatedNodeIds:['root'],section};
 const result=finishMcpWrite(context,root,changes);assert.deepEqual(result.ownership,{rootId:'root',parentId:'parent',pageId:'page',owner:'owner',active:'lease'});assert.equal(result.section.id,'temporary');assert.equal(result.operationId,'operation');
 for(const key of ['owner','active']){const old=values[key];values[key]='revoked';assert.throws(()=>finishMcpWrite(context,root,changes),/MCP_WRITE_SCOPE_CHANGED/);values[key]=old;}
 section.parent=parent;assert.throws(()=>finishMcpWrite(context,root,changes),/MCP_WRITE_SCOPE_CHANGED/);section.parent=root;assert.throws(()=>finishMcpWrite(context,root,{...changes,createdNodeIds:[null]}),/MCP_WRITE_RESULT_INVALID/);
 assert.throws(()=>finishMcpWrite(context,root,{...changes,mutatedNodeIds:Array(100).fill('canonical-identifier-'.repeat(3))}),/MCP_WRITE_RESULT_TOO_LARGE/);
});
test('one bounded write consumes a pristine default before SLOT commit; changed content is preserved',async t=>{
 const prior=global.figma;global.figma={skipInvisibleInstanceChildren:false};t.after(()=>{global.figma=prior;});
 const page={id:'page',type:'PAGE'},parent={id:'parent',type:'SECTION',parent:page},values={owner:'owner',active:'lease'},root={id:'root',type:'FRAME',parent,getSharedPluginData:(_ns,key)=>values[key]},body={id:'body',type:'SLOT',parent:root,children:[]};
 const text=id=>({id,type:'TEXT',name:'Content',characters:'Default',children:[],getStyledTextSegments:()=>[]}),sourceText=text('source-text'),actualText=text('actual-text'),source={id:'source',type:'FRAME',name:'Default',children:[sourceText]},actual={id:'actual',type:'FRAME',name:'Default',children:[actualText],parent:body,remove(){body.children.splice(body.children.indexOf(this),1);this.removed=true;}};sourceText.parent=source;actualText.parent=actual;body.children.push(actual);
 const hero={id:'temporary',type:'INSTANCE',parent:null,getSharedPluginData:()=> 'hero'};body.appendChild=node=>{body.children.push(node);node.parent=body;};
 const context={schemaVersion:'apollo.mcp-write-result.v1',operationId:'operation',sourcePin:'pin',stage:'structure',sectionId:'hero',target:{rootNodeId:'root',parentNodeId:'parent',pageId:'page',ownerNonce:'owner',leaseNonce:'lease'}};
 const artifact=require('../src/landing/figma-recipes.compact.json'),code=['boundedMcpResult','compareMcpDefaults','finishMcpWrite'].map(name=>artifact.recipes[name].code).join('\n')+`
 const before=await compareMcpDefaults(source,actual);if(!before.equal)throw Error('DEFAULT_CHANGED');
 body.appendChild(hero);if(hero.parent!==body)throw Error('PLACEMENT_CHANGED');
 const current=await compareMcpDefaults(source,actual);if(!current.equal)throw Error('DEFAULT_CHANGED');
 if(root.getSharedPluginData('apollolanding','active')!==context.target.leaseNonce)throw Error('STOPPED');
 actual.remove();return finishMcpWrite(context,root,{createdNodeIds:[hero.id],mutatedNodeIds:[body.id,actual.id],section:hero});`;
 const run=new Function('source','actual','body','hero','root','context','return (async()=>{'+code+'})()');
 actualText.characters='User change';await assert.rejects(run(source,actual,body,hero,root,context),/DEFAULT_CHANGED/);assert.deepEqual(body.children,[actual]);assert.equal(actual.removed,undefined);actualText.characters='Default';
 const result=await run(source,actual,body,hero,root,context);assert.deepEqual(body.children,[hero]);assert.equal(actual.removed,true);assert.equal(result.section.id,'temporary');hero.id='Icanonical:hero';assert.equal(result.section.id,'temporary');
 const toolArguments={fileKey:'FixtureFile',description:'Bounded default replacement',skillNames:'resource:figma-use,resource:figma-generate-design',code};assert(Buffer.byteLength(JSON.stringify(toolArguments))<=16384);
});

test('instance creation checks current ownership after font-loading awaits and before any mutation',async t=>{
 const prior=global.figma;t.after(()=>{global.figma=prior;});let active=true,created=false;
 global.figma={loadFontAsync:async()=>{active=false;}};
 const component={type:'COMPONENT',key:'published',explicitVariableModes:{},findAllWithCriteria:()=>[{getStyledTextSegments:()=>[{fontName:{family:'Fixture',style:'Regular'}}]}],createInstance(){created=true;throw Error('MUTATION_REACHED');}},parent={appendChild(){throw Error('MUTATION_REACHED');}};
 await assert.rejects(recipes.createMcpInstance(component,'published',parent,[],[],()=>{if(!active)throw Error('STOPPED');}),/STOPPED/);assert.equal(created,false);
});

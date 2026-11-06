'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const releases=require('../src/data-release'),catalog=require('../src/skills/catalog'),{openKnowledge}=require('../src/landing/knowledge');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-knowledge-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const releaseRoot=path.join(root,'release'),runtimeRoot=path.join(root,'runtime');
 const put=(base,file,body)=>{const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),target=path.join(base,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {file,sha256:catalog.sha(bytes),bytes:bytes.length};};
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),files:[put(runtimeRoot,'instructions/landing/figma-workflow.md','# Loaded workflow file: figma-use/SKILL.md\nSynthetic native API\n# Loaded workflow file: figma-generate-design/SKILL.md\nSynthetic design workflow')]};runtime.id=releases.idOf(runtime);put(runtimeRoot,'portable-runtime.json',runtime);
 const files=[],descriptor={schemaVersion:'apollo.skill-package.v1',id:catalog.LANDING_ID,version:'0.3.0',name:'Landing',description:'Synthetic skill',executorId:'apollo.landing',files:catalog.LANDING_FILES.map(file=>{const pin=put(releaseRoot,'skills/'+catalog.LANDING_ID+'/'+file,file==='SKILL.md'?'---\nversion: "0.3.0"\n---\nSynthetic landing skill':'Synthetic reference');files.push(pin);return {path:file,sha256:pin.sha256,bytes:pin.bytes};})};files.push(put(releaseRoot,'skills/'+catalog.LANDING_ID+'/manifest.json',descriptor));
 files.push(put(releaseRoot,'knowledge/data/ds-ai-hub/AGENTS.md','Synthetic consumption instructions'));
 for(const file of ['manifest.json','patterns/landing-pages.md','patterns/business-segment-styles.md','patterns/draft-layout.md'])files.push(put(releaseRoot,'knowledge/data/ds-ai-hub/products/ab/'+file,file.endsWith('.json')?{product:'Synthetic'}:'Synthetic normative rules'));
 files.push(put(releaseRoot,'knowledge/data/ds-ai-hub/fixtures/doc.json',{small:[1,2,3],large:'x'.repeat(40000)}));
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,generatedAt:'2026-10-31T00:00:00Z',dataId:'d'.repeat(64),knowledgeVersion:'fixture',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};manifest.id=releases.idOf(manifest);put(releaseRoot,'manifest.json',manifest);return {releaseRoot,runtimeRoot,source:()=>openKnowledge({releaseRoot,runtimeRoot}),put,manifest};
}
test('contract envelopes remain inaccessible while pinned technical API symbols stay readable',t=>{
 const f=fixture(t),sourceId='contracts/components/synthetic/r1/source.json',manual={component:{componentId:'synthetic',contractId:'synthetic.desktop',platform:'desktop',componentKey:'fixture-key'},rules:[{id:'fixture-rule',text:'Synthetic normative rule'}]};
 const envelope=f.put(f.releaseRoot,sourceId,{documentType:'component-contract-source',manual,variantEvidence:{}});
 f.manifest.files.push(envelope,f.put(f.releaseRoot,'contracts/manifest.json',{contracts:[{id:'synthetic.desktop',componentId:'synthetic',revision:1,file:sourceId.slice('contracts/'.length),sha256:envelope.sha256}]}));
 const types='Header 🧭\ninterface Example { name: string }\n',offset=types.indexOf('interface Example'),symbols={sourceResource:'workflow/figma-use/references/plugin-api-standalone.d.ts',sourceSha256:catalog.sha(Buffer.from(types.trim())),offsetUnits:'utf16-characters',symbols:{Example:[{offset,end:types.trim().length,limit:types.trim().length-offset}]}};
 const runtimeFile=path.join(f.runtimeRoot,'portable-runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimeFile)),workflowFile='instructions/landing/figma-workflow.md',old=fs.readFileSync(path.join(f.runtimeRoot,workflowFile),'utf8');
 runtime.files[0]=f.put(f.runtimeRoot,workflowFile,old+'\n# Loaded workflow file: figma-use/references/plugin-api-standalone.d.ts\n'+types+'\n# Loaded workflow file: figma-use/references/plugin-api-standalone.symbols.json\n'+JSON.stringify(symbols));runtime.id=releases.idOf(runtime);f.put(f.runtimeRoot,'portable-runtime.json',runtime);f.manifest.runtimeId=runtime.id;f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source();assert.equal(source.list('contracts').total,0);
 for(const request of [{id:'contracts/manifest.json'},{id:sourceId,mode:'keys'},{id:sourceId,path:['manual','component']},{id:sourceId,path:['manual','rules']}])assert.throws(()=>source.read(request),{code:'LANDING_RESOURCE_INVALID'});
 const lookup=JSON.parse(source.read({id:'workflow/figma-use/references/plugin-api-standalone.symbols.json',path:['symbols','Example']}).text)[0],signature=source.read({id:symbols.sourceResource,offset:lookup.offset,limit:lookup.limit});assert.equal(signature.text,'interface Example { name: string }');assert.equal(signature.sha256,symbols.sourceSha256);
 assert.equal(source.initial.knowledgePolicy,'ds-ai-hub-only-v1');
});
test('installed skill and full mandatory norms are readable without a source checkout; JSON context stays addressed and bounded',t=>{
 const f=fixture(t),source=f.source(),id='knowledge/data/ds-ai-hub/fixtures/doc.json';assert.equal(source.skill.version,'0.3.0');assert.equal(source.initial.norms.length,5);assert.equal(source.initial.workflow.length,2);
 assert.deepEqual(JSON.parse(source.read({id,mode:'keys'}).text),['small','large']);assert.deepEqual(JSON.parse(source.read({id,path:['small'],offset:1,limit:1}).text),[2]);assert.equal(source.read({id}).tooLarge,true);assert.throws(()=>source.read({id,path:['__proto__']}),/INVALID/);assert.throws(()=>source.read({id:'../../private'}),/INVALID/);assert.equal(source.list('fixtures doc').resources.length,1);
 fs.appendFileSync(path.join(f.releaseRoot,id),' ');assert.throws(()=>source.assertCurrent(),/STALE/);
});
test('skill integrity refuses a replaced symlink and executable files cannot enter a release',t=>{
 const f=fixture(t),source=f.source(),file=path.join(f.releaseRoot,'skills',catalog.LANDING_ID,'SKILL.md'),bytes=fs.readFileSync(file);fs.writeFileSync(path.join(f.releaseRoot,'same.md'),bytes);fs.unlinkSync(file);fs.symlinkSync('../../same.md',file);assert.throws(()=>source.assertCurrent(),/STALE/);
 const bad=fixture(t);bad.manifest.files.push(bad.put(bad.releaseRoot,'skills/'+catalog.LANDING_ID+'/run.js','throw Error()'));bad.manifest.id=releases.idOf(bad.manifest);bad.put(bad.releaseRoot,'manifest.json',bad.manifest);assert.throws(()=>bad.source(),{code:'DATA_RELEASE_EXECUTABLE_FORBIDDEN'});
});
test('retired generation endpoints return 410 without invoking a model or touching user files',()=>{
 let prefixes,handler;require('../src/landing/retired').mountRetiredGenerationRoutes({use:(routes,fn)=>{prefixes=routes;handler=fn;}});assert(prefixes.includes('/generation'));assert(prefixes.includes('/agent/mcp'));assert(!prefixes.includes('/analyze'));let code,body;handler({}, {status:v=>{code=v;return {json:v=>body=v};}});assert.equal(code,410);assert.equal(body.code,'GENERATION_RETIRED');
});

test('missing mandatory hub instructions is reported before model execution',t=>{
 const f=fixture(t);f.manifest.files=f.manifest.files.filter(p=>p.file!=='knowledge/data/ds-ai-hub/AGENTS.md');f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);assert.throws(()=>f.source(),{code:'LANDING_REQUIRED_KNOWLEDGE_MISSING'});
});

test('asset roles expose only exact packaged Hub sources even when legacy raw catalogs are present',t=>{
 const f=fixture(t);let source=f.source();for(const role of ['glyph26Metadata','hubAssets','hubTokens'])assert.deepEqual(source.initial.assetSources[role],{available:false,ids:[]});
 const hub=['knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json','knowledge/data/ds-ai-hub/core/web/assets/figma-libraries.json','knowledge/data/ds-ai-hub/core/web/tokens/colors/figma-libraries.json'];
 const external=['knowledge/data/design-system_ab/JSONS/indexes/icons/synthetic.json','knowledge/data/design-system_ab/JSONS/images/synthetic.json'];
 for(const file of hub.concat(external))f.manifest.files.push(f.put(f.releaseRoot,file,{synthetic:'fixture'}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);source=f.source();
 assert.equal(source.initial.assetSources.hubAssets.ids.length,2);assert.equal(source.initial.assetSources.hubTokens.ids.length,1);assert.equal(source.initial.assetSources.glyph26Metadata.ids[0],hub[0]);
 for(const id of external){assert.equal(source.list(id).total,0);assert.throws(()=>source.read({id}),{code:'LANDING_RESOURCE_INVALID'});}
 assert.equal(JSON.parse(source.read({id:hub[1],mode:'keys'}).text)[0],'synthetic');assert.throws(()=>source.read({id:'../../private'}),/INVALID/);
});


test('landing assets survive knowledge packaging and addressed release reads with integrity guards',async t=>{
 const f=fixture(t),builder=require('../scripts/build-knowledge-package');
 const parent=path.dirname(f.releaseRoot),ds=path.join(parent,'ds'),hub=path.join(parent,'hub');
 const putSource=(root,file,body)=>f.put(root,file,body);
 putSource(ds,'JSONS/apollo/indexes/componentContractIndex.json',{schemaVersion:2,packages:[{componentKey:'fixture',packagePath:'web/components/fixture',artifacts:{}}]});
 putSource(ds,'JSONS/apollo/designPatternRules.json',{rules:[]});putSource(ds,'redpolrules/dictionary.json',{rules:[]});
 putSource(hub,'AGENTS.md','Synthetic instructions');putSource(hub,'products/ab/manifest.json',{});
 for(const name of ['landing-pages','business-segment-styles','draft-layout'])putSource(hub,`products/ab/patterns/${name}.md`,'Synthetic rules');
 putSource(hub,'products/ab/components/fixture/meta.json',{});putSource(hub,'core/web/components/fixture/meta.json',{});
 const glyph='core/web/assets/assets_glyph-26.json';putSource(hub,glyph,{SyntheticIcon:{size:24,figma:'synthetic'}});
 const catalogs=['JSONS/images/Сorp _ Image Library -- Продуктовые имиджи.json','JSONS/images/Сorp _ Image Library -- Вспомогательные имиджи.json','JSONS/indexes/images/Сorp _ Image Library -- Продуктовые имиджи.index.json','JSONS/indexes/images/Сorp _ Image Library -- Вспомогательные имиджи.index.json','JSONS/indexes/icons/Icons -- glyph-26.index.json'];
 for(const name of catalogs)putSource(ds,name,{components:[{key:'synthetic-key'}]});
 const built=await builder.buildKnowledgePackage({'design-system-root':ds,'ds-ai-hub-root':hub,output:path.join(parent,'package-output'),'design-system-commit':'1'.repeat(40),'ds-ai-hub-commit':'2'.repeat(40),'generated-at':'2026-10-31T00:00:00Z',directoryOnly:true,channel:'stable',minEngine:'1.0.1',maxEngine:'1.0.1'});
 const expected=['data/ds-ai-hub/'+glyph,...catalogs.map(p=>'data/design-system_ab/'+p)];
 for(const file of expected){const artifact=built.manifest.artifacts.find(a=>a.path===file);assert(artifact,file);assert.equal(artifact.sha256,catalog.sha(fs.readFileSync(path.join(built.packageRoot,file))))}
 // Package the exact built bytes under the release knowledge/ prefix; preserve fixture skill pins.
 fs.rmSync(path.join(f.releaseRoot,'knowledge'),{recursive:true});fs.cpSync(built.packageRoot,path.join(f.releaseRoot,'knowledge'),{recursive:true});
 f.manifest.files=f.manifest.files.filter(p=>!p.file.startsWith('knowledge/'));
 function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else{const bytes=fs.readFileSync(file);f.manifest.files.push({file:path.relative(f.releaseRoot,file).split(path.sep).join('/'),sha256:catalog.sha(bytes),bytes:bytes.length})}}}
 collect(path.join(f.releaseRoot,'knowledge'));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source();assert.equal(source.initial.assetSources.hubAssets.ids.length,1);
 const id=source.initial.assetSources.glyph26Metadata.ids[0];assert.equal(JSON.parse(source.read({id,mode:'keys'}).text)[0],'SyntheticIcon');assert.equal(JSON.parse(source.read({id,path:['SyntheticIcon'],mode:'read'}).text).size,24);
 for(const file of catalogs){const id='knowledge/data/design-system_ab/'+file;assert.equal(source.list(id).total,0);assert.throws(()=>source.read({id}),{code:'LANDING_RESOURCE_INVALID'});}
 assert.throws(()=>source.read({id:'knowledge/data/ds-ai-hub/core/web/assets/../../secret.json'}),/INVALID/);
 fs.appendFileSync(path.join(f.releaseRoot,id),' ');assert.throws(()=>source.assertCurrent(),/STALE/);
});

// Exact addressed requests from failed raw output b4812fa4; fixture content is synthetic.

function asWriteDelta(value,options){
 if(options.profile!=='landing-figma'||Object.hasOwn(value,'sectionPatch'))return value;
 const {specJson,...step}=value,state=JSON.parse(options.prompt.split('\n').at(-1)),id=state.execution.activeSectionId;
 const section=JSON.parse(specJson).sections.find(s=>s.id===id);
 return {...step,sectionPatch:step.kind==='continue'&&id&&section?.nodeId?{sectionId:id,nodeId:section.nodeId}:null};
}
const failedAssetBatch=[{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/instructions.md","mode":"read","path":[],"offset":0,"limit":12000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/adapter.figma.md","mode":"read","path":[],"offset":0,"limit":8000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/cookbook/02-select-root-and-layout.md","mode":"read","path":[],"offset":0,"limit":4000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/cookbook/03-compose-content.md","mode":"read","path":[],"offset":0,"limit":4000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/cookbook/04-graphic-and-surface.md","mode":"read","path":[],"offset":0,"limit":4000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/cookbook/06-verify.md","mode":"read","path":[],"offset":0,"limit":5000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/benefit-card/figma-keys.json","mode":"read","path":["components"],"offset":0,"limit":100},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/instructions.md","mode":"read","path":[],"offset":0,"limit":9000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/adapter.figma.md","mode":"read","path":[],"offset":0,"limit":7000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/cookbook/02-select-family.md","mode":"read","path":[],"offset":0,"limit":3000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/cookbook/03-compose.md","mode":"read","path":[],"offset":0,"limit":4000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/cookbook/04-content-and-states.md","mode":"read","path":[],"offset":0,"limit":4000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/cookbook/05-verify.md","mode":"read","path":[],"offset":0,"limit":5000},{"id":"knowledge/data/ds-ai-hub/products/ab/components/faq/figma-keys.json","mode":"read","path":["components"],"offset":0,"limit":100},{"id":"knowledge/data/design-system_ab/JSONS/indexes/images/Сorp _ Image Library -- Продуктовые имиджи.index.json","mode":"read","path":["components"],"offset":0,"limit":100},{"id":"knowledge/data/design-system_ab/JSONS/indexes/images/Сorp _ Image Library -- Вспомогательные имиджи.index.json","mode":"read","path":["components"],"offset":0,"limit":100},{"id":"knowledge/data/design-system_ab/JSONS/indexes/icons/Icons -- glyph-26.index.json","mode":"keys","path":[],"offset":0,"limit":100},{"id":"knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json","mode":"read","path":["CardLine24Icon"],"offset":0,"limit":10},{"id":"knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json","mode":"read","path":["ShoppingCartLine24Icon"],"offset":0,"limit":10},{"id":"knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json","mode":"read","path":["ChartLine24Icon"],"offset":0,"limit":10},{"id":"knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json","mode":"read","path":["WalletLine24Icon"],"offset":0,"limit":10}];
test('Hub portion of retained asset batch preserves good reads and recovers missing glyph keys in the same job',async t=>{
 const f=fixture(t),glyph=failedAssetBatch[17].id;
 for(const id of new Set(failedAssetBatch.map(r=>r.id)))f.manifest.files.push(f.put(f.releaseRoot,id,id===glyph?{ActualFixtureIcon:{size:24}}:id.endsWith('.json')?{components:[{key:'fixture'}]}:'Fixture document'));
 f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source();let calls=0;const steps=[];
 const spec={sections:[{id:'hero',nodeId:'2:1'}]},make=(kind,resources=[])=>({kind,message:kind,specJson:JSON.stringify(spec),resources,query:'',offset:0,resultJson:JSON.stringify({summary:'Fixture',checks:[],issues:[],limits:[]})});
 const service=require('../src/landing/service').createLandingService({root:path.join(path.dirname(f.releaseRoot),'jobs'),knowledge:()=>source,createCli:()=>({run:async options=>{
  const state=JSON.parse(options.prompt.split('\n').at(-1));steps.push(state);calls++;
  let result;
  if(calls===1)result=make('request_context',failedAssetBatch.filter(row=>row.id.startsWith('knowledge/data/ds-ai-hub/')));
  else if(calls===2){assert.equal(state.resources.length,18);assert.equal(state.resources.filter(r=>r.error).length,4);assert(state.resources.slice(0,14).every(r=>r.text&&!r.error));assert.equal(state.resources[14].error.code,'LANDING_RESOURCE_PATH_INVALID');assert.equal(state.resources[14].text,undefined);result=make('request_context',[{id:glyph,mode:'keys',path:[],offset:0,limit:100}]);}
  else if(calls===3){assert.deepEqual(JSON.parse(state.resources.at(-1).text),['ActualFixtureIcon']);result=make('request_context',[{id:glyph,mode:'read',path:['ActualFixtureIcon'],offset:0,limit:10}]);}
  else if(calls===4){assert.equal(JSON.parse(state.resources.at(-1).text).size,24);result=make('build');}
  else if(calls===5||calls===6){result={...make('continue'),resultJson:JSON.stringify({checkpoint:{sectionId:calls===5?null:'hero',status:'complete',nextAction:'Next work unit'}})};}
  else {assert.equal(calls,7);result=make('finish');}
  return {result:asWriteDelta(result,options),receipt:{usage:{measurementId:'fixture-'+calls,actualInputTokens:1,actualOutputTokens:1},mcp:{toolCalls:0}}};
 }})});
 let run=service.create({fileKey:'FileKey123',pageId:'0:1'});service.submit(run.id,{requestId:'77beb5e6-78e2-431f-8020-54e860094f4f',revision:run.revision,text:'Fixture'});await service.whenSettled(run.id);run=service.poll(run.id);assert.equal(run.status,'awaiting-canvas',JSON.stringify(run.error));assert.equal(calls,4);assert.equal(run.usage.length,4);assert.equal(run.sources.filter(r=>r.id===glyph).length,2,'failed paths are not successful source evidence');
 const target={fileKey:'FileKey123',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
 const observation={rootNodeId:'1:1',pageId:'0:1',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:3,instanceCount:1,sections:[{id:'2:1',sectionId:'hero',fingerprint:'d'.repeat(64)}],text:'Fixture',coverage:'tagged-sections-and-text'};
 const empty={...observation,sections:[],nodeCount:1,instanceCount:0};service.canvas(run.id,{revision:run.revision,target,readback:empty});await service.whenSettled(run.id);run=service.poll(run.id);assert.equal(run.status,'awaiting-readback');service.observation(run.id,{revision:run.revision,readback:empty});await service.whenSettled(run.id);service.observation(run.id,{revision:run.revision,readback:observation});await service.whenSettled(run.id);run=service.observation(run.id,{revision:run.revision,readback:observation});assert.equal(run.status,'completed');assert.equal(run.usage.length,7);assert.equal(run.messages.filter(m=>m.role==='user').length,1);
});
test('missing JSON path is a visible failed read; unsafe/unlisted and stale inputs still throw',t=>{
 const f=fixture(t),source=f.source(),id='knowledge/data/ds-ai-hub/fixtures/doc.json';
 const miss=source.read({id,path:['CardLine24Icon']});assert.equal(miss.error.code,'LANDING_RESOURCE_PATH_INVALID');assert.equal(miss.text,undefined);assert.deepEqual(miss.error.availablePath,[]);assert.deepEqual(JSON.parse(source.read({id,mode:'keys',path:miss.error.availablePath}).text),['small','large']);
 assert.deepEqual(JSON.parse(source.read({id,path:['small'],offset:0,limit:1}).text),[1]);
 for(const key of ['__proto__','constructor','prototype','../secret'])assert.throws(()=>source.read({id,path:[key]}),/INVALID/);
 assert.throws(()=>source.read({id:'../../private'}),/INVALID/);
 fs.appendFileSync(path.join(f.releaseRoot,id),' ');assert.throws(()=>source.read({id,path:['missing']}),/STALE/);
});

for(const [name,request,code,count] of [
 ['missing read no-progress',{path:['missing']},'LANDING_NO_PROGRESS',3],
 ['unlisted id',{id:'../../private'},'LANDING_RESOURCE_INVALID',1],
 ['prototype key',{path:['__proto__']},'LANDING_RESOURCE_INVALID',1],
 ['traversal key',{path:['../secret']},'LANDING_RESOURCE_INVALID',1],
])test('reader recovery retains fatal guard: '+name,async t=>{
 const f=fixture(t),source=f.source();let calls=0;
 const service=require('../src/landing/service').createLandingService({root:path.join(path.dirname(f.releaseRoot),'jobs'),knowledge:()=>source,createCli:()=>({run:async()=>{calls++;return {result:{kind:'request_context',message:'Read',specJson:'{"sections":[]}',resources:[{id:'knowledge/data/ds-ai-hub/fixtures/doc.json',mode:'read',path:[],offset:0,limit:100,...request}],query:'',offset:0,resultJson:'{}'},receipt:{usage:{measurementId:'guard-'+calls},mcp:{toolCalls:0}}};}})});
 let run=service.create({fileKey:'FileKey123',pageId:'0:1'});service.submit(run.id,{requestId:'77beb5e6-78e2-431f-8020-54e860094f4f',revision:run.revision,text:'Fixture'});await service.whenSettled(run.id);run=service.poll(run.id);assert.equal(run.status,'interrupted');assert.equal(run.error.code,code);assert.equal(calls,count);assert.equal(run.usage.length,count);assert.equal(run.target,null);
});

test('byte-bounded array pages preserve all215 Unicode entries and use actual next offsets',t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/fixtures/pages.json',rows=Array.from({length:215},(_,i)=>({i,name:'Я🚀'.repeat(320),payload:'"\\'.repeat(300)}));f.manifest.files.push(f.put(f.releaseRoot,id,{components:rows}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source(),seen=[];let offset=0,pages=0;
 do{const row=source.read({id,path:['components'],offset,limit:50});assert(Buffer.byteLength(JSON.stringify(row))<=32768);assert.equal(row.tooLarge,undefined);assert.equal(row.total,215);const values=JSON.parse(row.text);assert.equal(row.returned,values.length);seen.push(...values);if(row.next!==null)assert.equal(row.next,offset+values.length);offset=row.next;assert(++pages<216);}while(offset!==null);
 assert.deepEqual(seen,rows);assert(pages>5);
});
test('oversized single item returns a usable child path without skipping it',t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/fixtures/huge.json';f.manifest.files.push(f.put(f.releaseRoot,id,{components:[{key:'confirmed',payload:'x'.repeat(40000)}]}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);const source=f.source(),row=source.read({id,path:['components'],limit:50});
 assert.equal(row.tooLarge,true);assert.equal(row.returned,0);assert.equal(row.total,1);assert.deepEqual(row.availablePath,['components','0']);assert.deepEqual(JSON.parse(source.read({id,mode:'keys',path:row.availablePath}).text),['key','payload']);assert.equal(JSON.parse(source.read({id,path:row.availablePath.concat('key')}).text),'confirmed');
});
test('text pages account for UTF8/envelope bytes and never split surrogate pairs',t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/unicode.md',text='🚀Я"\\'.repeat(9000);f.manifest.files.push(f.put(f.releaseRoot,id,text));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);const source=f.source();let offset=0,joined='';do{const row=source.read({id,offset,limit:16000});assert(Buffer.byteLength(JSON.stringify(row))<=32768);joined+=row.text;offset=row.next;}while(offset!==null);assert.equal(joined,text);
});
test('Hub JSON retains full selection flags through read while summary and external catalogs cannot supply evidence',t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/fixtures/selections.json',external='knowledge/data/design-system_ab/JSONS/indexes/images/synthetic.index.json',entries=[{name:'Image',key:'confirmed-key',hidden:false,published:true,deprecated:false}];
 for(const file of [id,external])f.manifest.files.push(f.put(f.releaseRoot,file,{kind:'component-index',components:entries}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);const source=f.source();
 assert.deepEqual(JSON.parse(source.read({id,path:['components']}).text),entries);const failed=source.read({id,mode:'summary',path:['components']});assert.equal(failed.error.code,'LANDING_RESOURCE_MODE_INVALID');assert.equal(failed.text,undefined);assert.deepEqual(failed.error.allowedModes,['read','keys']);
 assert.equal(source.list(external).total,0);assert.throws(()=>source.read({id:external,mode:'summary',path:['components']}),{code:'LANDING_RESOURCE_INVALID'});
});

test('retained Hub keys summary shape returns repairable feedback and continues through keys/read without false source evidence',async t=>{
 const f=fixture(t),id='knowledge/data/ds-ai-hub/products/ab/components/promo-main-block/figma-keys.json';
 f.manifest.files.push(f.put(f.releaseRoot,id,{components:{'d-promo-main-block':{key:'a'.repeat(40)}}}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source(),listed=source.list('products/ab/components/promo-main-block').resources.find(row=>row.id===id);assert.deepEqual(listed.capabilities.modes,['read','keys']);assert.equal(listed.capabilities.summary,undefined);
 let calls=0;const service=require('../src/landing/service').createLandingService({root:path.join(path.dirname(f.releaseRoot),'recover-mode'),knowledge:()=>source,createCli:()=>({run:async options=>{
  const ctx=JSON.parse(options.prompt.split('\n').at(-1));calls++;let kind='request_context',mode='summary',selected=['components'];
  if(calls===2){assert.equal(ctx.resources[0].error.code,'LANDING_RESOURCE_MODE_INVALID');assert.deepEqual(ctx.resources[0].error.allowedModes,['read','keys']);assert.equal(ctx.resources[0].text,undefined);mode='keys';}
  if(calls===3){assert.deepEqual(JSON.parse(ctx.resources.at(-1).text),['d-promo-main-block']);mode='read';selected.push('d-promo-main-block');}
  if(calls===4){assert.equal(JSON.parse(ctx.resources.at(-1).text).key,'a'.repeat(40));kind='question';}
  return {result:{kind,message:'Synthetic recovery',specJson:'{"sections":[]}',query:'',offset:0,resources:kind==='question'?[]:[{id,mode,path:selected,offset:0,limit:50}],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};
 }})});const chat=service.create({fileKey:'FileKey123',pageId:'0:1'});service.submit(chat.id,{requestId:'45de5fd3-b85c-410b-ae8c-2487d3e7033d',revision:0,text:'Synthetic recovery'});await service.whenSettled(chat.id);const r=service.poll(chat.id);assert.equal(r.status,'needs-input',JSON.stringify(r.error));assert.equal(calls,4);assert.deepEqual(r.sources.filter(row=>row.id===id).map(row=>row.mode),['keys','read']);
 const stored=JSON.parse(fs.readFileSync(path.join(path.dirname(f.releaseRoot),'recover-mode',chat.id+'.json')));assert(stored.readerState.reads.every(row=>row.request.mode!=='summary'));
 assert.throws(()=>source.read({id:'../../private',mode:'summary'}),/INVALID/);assert.throws(()=>source.read({id,mode:'summary',path:['__proto__']}),/INVALID/);
});
test('a second skill supplies its own sources/instructions and appears in the shared generation status',async t=>{
 const f=fixture(t),id='synthetic-form',body='---\nname: synthetic-form\nmetadata:\n  version: "1.0.0"\n---\nUse the form rules and read references through the indexed reader.';
 const skill= f.put(f.releaseRoot,'skills/'+id+'/SKILL.md',body),ref=f.put(f.releaseRoot,'skills/'+id+'/references/fields.json',{fields:['account','amount']}),rule=f.put(f.releaseRoot,'knowledge/data/ds-ai-hub/products/ab/patterns/synthetic-form.md','Synthetic form rules');f.manifest.files.push(skill,ref,rule);
 const descriptor={schemaVersion:'apollo.skill-package.v2',id,version:'1.0.0',name:'Synthetic form',description:'Synthetic form skill',executorId:catalog.GENERATION_EXECUTOR,files:[skill,ref].map(pin=>({path:pin.file.split('/').slice(2).join('/'),bytes:pin.bytes,sha256:pin.sha256})),generation:{platforms:['desktop'],requiredResources:[rule.file],initialQueries:['synthetic-form'],initialFiles:['SKILL.md'],hostInstructions:'Use the documented form host.',workflow:catalog.DIRECT_WORKFLOW}};
 f.manifest.files.push(f.put(f.releaseRoot,'skills/'+id+'/manifest.json',descriptor));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 assert.throws(()=>openKnowledge({...f,skillId:id}),{code:'DATA_RELEASE_RUNTIME_INCOMPATIBLE'});
 const runtimeFile=path.join(f.runtimeRoot,'portable-runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimeFile));runtime.capabilities={generationSkills:catalog.GENERATION_CAPABILITY,generationWorkflow:catalog.DIRECT_WORKFLOW};runtime.id=releases.idOf(runtime);f.put(f.runtimeRoot,'portable-runtime.json',runtime);f.manifest.runtimeId=runtime.id;f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=openKnowledge({...f,skillId:id});assert.equal(source.skill.id,id);assert.deepEqual(Object.keys(source.initial.instructions),['SKILL.md']);assert(source.initial.norms.some(row=>row.id.endsWith('/AGENTS.md')));assert(!source.initial.norms.some(row=>row.id.endsWith('/landing-pages.md')));assert.equal(source.initial.hostInstructions,descriptor.generation.hostInstructions);assert.deepEqual(JSON.parse(source.read({id:ref.file}).text),{fields:['account','amount']});
 const routes=new Map(),app={get:(route,fn)=>routes.set(route,fn),post:()=>{}};require('../src/landing/runtime').mountConfiguredLandingRoutes(app,{...f,root:path.join(path.dirname(f.releaseRoot),'jobs'),environment:{}});let status;routes.get('/landing/status')({}, {json:value=>status=value});assert.equal(status.available,true);assert.deepEqual(status.skills.map(s=>s.id),[id]);assert.equal(status.flow,catalog.DIRECT_WORKFLOW);assert.equal(status.defaultSkillId,id);
 let prompt;const service=require('../src/landing/service').createLandingService({root:path.join(path.dirname(f.releaseRoot),'form-jobs'),knowledge:skillId=>openKnowledge({...f,skillId}),createCli:()=>({run:async options=>{prompt=options.prompt;return{result:{kind:'question',message:'Which form fields?',specJson:'{"sections":[]}',resources:[],query:'',offset:0,resultJson:'{}'},receipt:{usage:null,mcp:{toolCalls:0}}};}})});
 const chat=service.create({fileKey:'FileKey123',pageId:'0:1',skillId:id});assert.equal(chat.skillId,id);service.submit(chat.id,{requestId:'77beb5e6-78e2-431f-8020-54e860094f4f',revision:chat.revision,text:'Synthetic form'});await service.whenSettled(chat.id);assert.equal(JSON.parse(prompt.split('\n').at(-1)).selectedSkill.id,id);assert(!prompt.includes('landing-pages'));assert.equal(service.poll(chat.id).status,'needs-input');assert.throws(()=>service.create({id:chat.id,fileKey:'FileKey123',pageId:'0:1',skillId:catalog.LANDING_ID}),/CONFLICT/);
 descriptor.generation.hostInstructions='';descriptor.generation.initialQueries=[];const descriptorPin=f.put(f.releaseRoot,'skills/'+id+'/manifest.json',descriptor);f.manifest.files[f.manifest.files.findIndex(pin=>pin.file===descriptorPin.file)]=descriptorPin;f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);const emptyProfile=openKnowledge({...f,skillId:id});assert.equal(emptyProfile.initial.hostInstructions,'');assert.equal(emptyProfile.initial.resources.query,'');
});

test('landing runtime closes addressed component, variable and recovery references without adding initial workflow bodies',t=>{
 const f=fixture(t),file='instructions/landing/figma-workflow.md',body=fs.readFileSync(path.resolve(__dirname,'../../../projects/Apollo',file),'utf8'),runtime=JSON.parse(fs.readFileSync(path.join(f.runtimeRoot,'portable-runtime.json')));
 runtime.files[0]=f.put(f.runtimeRoot,file,body);runtime.id=releases.idOf(runtime);f.put(f.runtimeRoot,'portable-runtime.json',runtime);f.manifest.runtimeId=runtime.id;f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);
 const source=f.source(),ids=['figma-use/references/working-with-design-systems/wwds-components.md','figma-use/references/working-with-design-systems/wwds-variables.md','figma-use/references/validation-and-recovery.md','figma-generate-design/references/componentization.md'];
 assert.equal(source.initial.workflow.length,2);for(const suffix of ids){const id='workflow/'+suffix;assert.equal(source.list(id).resources[0].id,id);const row=source.read({id,limit:16000});assert.equal(row.next,null);assert(row.text.length>1000);assert.equal(source.initial.workflow.some(item=>item.id===id),false);}
});

test('direct-only runtime refuses a legacy-only installed package before any CLI or Figma execution',t=>{
 const f=fixture(t),routes=new Map(),app={get:(route,fn)=>routes.set(route,fn),post:()=>{}};require('../src/landing/runtime').mountConfiguredLandingRoutes(app,{...f,root:path.join(path.dirname(f.releaseRoot),'direct-legacy-jobs'),environment:{}});let status;routes.get('/landing/status')({}, {json:value=>status=value});assert.equal(status.available,false);assert.equal(status.code,'LANDING_DIRECT_SKILL_REQUIRED');assert.equal(status.flow,catalog.DIRECT_WORKFLOW);assert.equal(fs.existsSync(path.join(path.dirname(f.releaseRoot),'direct-legacy-jobs')),false);
});

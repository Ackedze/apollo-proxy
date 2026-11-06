'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('../src/skills/catalog'),releases=require('../src/data-release'),{openKnowledge}=require('../src/landing/knowledge'),{componentRequests}=require('../src/landing/context'),{createLandingService}=require('../src/landing/service');
const HUB='knowledge/data/ds-ai-hub/';
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hub-generation-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const releaseRoot=path.join(root,'release'),runtimeRoot=path.join(root,'runtime');
 const put=(base,file,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),target=path.join(base,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {file,bytes:bytes.length,sha256:catalog.sha(bytes)};};
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),capabilities:{generationSkills:catalog.GENERATION_CAPABILITY},files:[put(runtimeRoot,'instructions/landing/figma-workflow.md','# Loaded workflow file: figma-use/SKILL.md\nSynthetic API\n# Loaded workflow file: figma-generate-design/SKILL.md\nSynthetic design workflow')]};runtime.id=releases.idOf(runtime);put(runtimeRoot,'portable-runtime.json',runtime);
 const skill=put(releaseRoot,'skills/'+catalog.LANDING_ID+'/SKILL.md','---\nname: ab-generate-custom-landing\nmetadata:\n  version: "0.4.2"\n---\nUse only installed Hub documents.');
 const descriptor={schemaVersion:'apollo.skill-package.v2',id:catalog.LANDING_ID,version:'0.4.2',name:'Landing fixture',description:'Synthetic fixture',executorId:catalog.GENERATION_EXECUTOR,files:[{path:'SKILL.md',bytes:skill.bytes,sha256:skill.sha256}],generation:{platforms:['desktop'],requiredResources:[HUB+'products/ab/manifest.json'],initialQueries:['products/ab/patterns/'],initialFiles:['SKILL.md'],hostInstructions:'Read the current Hub component package.'}};
 const files=[skill,put(releaseRoot,'skills/'+catalog.LANDING_ID+'/manifest.json',descriptor),put(releaseRoot,HUB+'AGENTS.md','Synthetic Hub rules'),put(releaseRoot,HUB+'products/ab/manifest.json',{id:'ab'}),put(releaseRoot,'contracts/components/button/source.json',{manual:{rules:['forbidden contract body']}}),put(releaseRoot,'knowledge/data/design-system_ab/JSONS/button.json',{components:[{key:'forbidden-key'}]})];
 const add=(relative,value)=>{const pin=put(releaseRoot,HUB+relative,value),at=files.findIndex(p=>p.file===pin.file);if(at<0)files.push(pin);else files[at]=pin;return pin;};
 const unit=(id,p,extra={})=>({id,path:p,platforms:['web'],targets:['figma'],...extra});
 const units=[unit('Button','core/web/components/button/guidelines.md',{targets:[]}),unit('Button.adapter.figma','core/web/components/button/figma/adapter.md'),unit('Button.cookbook','core/web/components/button/figma/cookbook.md'),unit('Button.adapter.code','core/web/components/button/code/adapter.md',{targets:['code']}),unit('CorporateContent.instructions','products/ab/components/corporate-content/instructions.md'),unit('CorporateContent.adapter.figma','products/ab/components/corporate-content/adapter.figma.md'),unit('CorporateContent.cookbook.desktop','products/ab/components/corporate-content/cookbook/02-desktop.md'),unit('ptrn:components.corporate-page','products/ab/patterns/corporate-page.md',{targets:[]})];
 for(const row of units)add(row.path,'Synthetic source '+row.id);
 add('core/web/components/button/meta.json',{id:'Button'});add('core/web/components/button/figma/keys.json',{roots:[{key:'b'.repeat(40)}]});add('core/web/components/button/figma/model.json',{root:'Button'});
 add('products/ab/components/corporate-content/meta.json',{id:'CorporateContent',relatedPatterns:['ptrn:components.corporate-page']});add('products/ab/components/corporate-content/figma-keys.json',{components:{desktop:{key:'c'.repeat(40)}}});
 add('registry/index.json',{schemaVersion:1,units});add('products/ab/knowledge-graph.json',{nodes:[],edges:[{from:'CorporateContent',kind:'composes',targetType:'core-unit',target:'Button',targetPath:'core/web/components/button/meta.json'}]});
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,generatedAt:'2026-11-04T00:00:00Z',dataId:'d'.repeat(64),knowledgeVersion:'synthetic-hub-only',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};
 const seal=()=>{manifest.id=releases.idOf(manifest);put(releaseRoot,'manifest.json',manifest);};seal();
 return {root,releaseRoot,runtimeRoot,files,units,manifest,put,add,seal,source:()=>openKnowledge({releaseRoot,runtimeRoot})};
}
test('installed generation namespace excludes contract/raw bodies but preserves skill and technical workflow',t=>{
 const f=fixture(t),source=f.source();assert.equal(source.initial.knowledgePolicy,'ds-ai-hub-only-v1');
 for(const id of ['contracts/components/button/source.json','knowledge/data/design-system_ab/JSONS/button.json']){assert.equal(source.list(id).total,0);for(const mode of ['read','keys','summary'])assert.throws(()=>source.read({id,mode}),{code:'LANDING_RESOURCE_INVALID'});}
 assert(source.read({id:'skills/'+catalog.LANDING_ID+'/SKILL.md'}).text.includes('installed Hub'));assert.equal(source.read({id:'workflow/figma-use/SKILL.md'}).text,'Synthetic API');
 const oldPin=catalog.sha(Buffer.from(JSON.stringify([catalog.sha(fs.readFileSync(path.join(f.releaseRoot,'manifest.json'))),catalog.sha(fs.readFileSync(path.join(f.runtimeRoot,'instructions/landing/figma-workflow.md'))),source.skill.sha256])));assert.notEqual(source.resumePin,oldPin);
});
test('actual Core and Corp package layouts use the shared selector and exact pinned Hub metadata',t=>{
 const f=fixture(t),source=f.source(),button=source.list('core/web/components/button/'),corp=source.list('products/ab/components/corporate-content');
 assert.equal(button.routing.releaseId,f.manifest.id);assert(button.routing.metadataSources.every(p=>p.id.startsWith(HUB)&&/^[a-f0-9]{64}$/.test(p.sha256)&&p.purpose==='navigation-not-norm-read'));
 assert.deepEqual(button.routing.gaps,[]);const requests=componentRequests(button);assert(requests.some(r=>r.id.endsWith('/guidelines.md')));assert(requests.some(r=>r.id.endsWith('/figma/adapter.md')));assert(requests.some(r=>r.id.endsWith('/figma/cookbook.md')));assert(requests.some(r=>r.id.endsWith('/figma/keys.json')));assert(requests.every(r=>!r.id.includes('/code/')));
 assert(corp.routing.requiredSources.every(r=>r.id.includes('/corporate-content/')));assert(corp.routing.candidateSources.some(r=>r.id===HUB+'products/ab/patterns/corporate-page.md'));assert(corp.routing.candidateSources.some(r=>r.id===HUB+'core/web/components/button/guidelines.md'));
 assert(componentRequests(corp).every(r=>!r.id.includes('/button/')&&!r.id.endsWith('/corporate-page.md')),'conditional dependencies are not silently promoted');
 assert(source.list('CorporateContent').resources.some(r=>r.id.endsWith('/corporate-content/instructions.md')));
});
test('a skill cannot reopen an external data namespace through requiredResources',t=>{
 const f=fixture(t),id='skills/'+catalog.LANDING_ID+'/manifest.json',descriptor=JSON.parse(fs.readFileSync(path.join(f.releaseRoot,id),'utf8'));descriptor.generation.requiredResources=['knowledge/data/design-system_ab/JSONS/button.json'];const pin=f.put(f.releaseRoot,id,descriptor);f.files[f.files.findIndex(p=>p.file===id)]=pin;f.seal();assert.throws(()=>f.source(),{code:'LANDING_KNOWLEDGE_POLICY_INVALID'});
});
test('missing or ambiguous Hub routing metadata is visible and never replaced by legacy indices',t=>{
 const f=fixture(t);f.manifest.files=f.manifest.files.filter(p=>p.file!==HUB+'registry/index.json');f.seal();const missing=f.source().list('core/web/components/button').routing;assert(missing.gaps.some(g=>g.code==='HUB_ROUTING_SOURCE_NOT_PACKAGED'));assert.deepEqual(missing.requiredSources,[]);assert(!missing.gaps.some(g=>g.code==='HUB_COMPONENT_OVERVIEW_MISSING'),'missing routing metadata does not prove that existing component documents are absent');
 const second=fixture(t);second.add('registry/index.json',{units:second.units.concat({...second.units[0],path:'core/web/components/button/other.md'})});second.seal();const ambiguous=second.source().list('core/web/components/button').routing;assert(ambiguous.gaps.some(g=>g.code==='HUB_UNIT_AMBIGUOUS'));assert(!ambiguous.requiredSources.some(s=>s.id.endsWith('/guidelines.md')));
});
test('routing metadata drift invalidates subsequent reads even before any normative body was consumed',t=>{
 const f=fixture(t),source=f.source();source.list('core/web/components/button');fs.appendFileSync(path.join(f.releaseRoot,HUB+'registry/index.json'),' ');assert.throws(()=>source.read({id:HUB+'core/web/components/button/guidelines.md'}),{code:'LANDING_DATA_STALE'});
});
test('service batches current Core sources, preserves navigation/read separation and reports routing in model context',async t=>{
 const f=fixture(t),source=f.source();let calls=0;
 const service=createLandingService({root:path.join(f.root,'jobs'),knowledge:()=>source,createCli:()=>({run:async options=>{
  const ctx=JSON.parse(options.prompt.split('\n').at(-1));calls++;
  if(calls===2){assert.equal(ctx.knowledgePolicy,'ds-ai-hub-only-v1');assert(ctx.index.routing.requiredSources.length);assert(ctx.resources.some(r=>r.id.endsWith('/figma/adapter.md')));assert(ctx.resources.every(r=>r.id.startsWith(HUB)));assert(!ctx.resources.some(r=>r.id===HUB+'registry/index.json'));}
  return {result:{kind:calls===1?'list_resources':'question',message:'Synthetic source selection',specJson:'{"sections":[]}',query:'core/web/components/button/',offset:0,resources:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};
 }})});const chat=service.create({fileKey:'FixtureFile',pageId:'0:1'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Synthetic three buttons'});await service.whenSettled(chat.id);const result=service.poll(chat.id);assert.equal(result.status,'needs-input',JSON.stringify(result.error));assert.equal(calls,2);assert(result.sources.some(s=>s.id.endsWith('/guidelines.md')));assert(!result.sources.some(s=>s.id===HUB+'registry/index.json'||s.id===HUB+'products/ab/knowledge-graph.json'));assert.equal(result.target,null);
});
test('an agent batch cannot smuggle a contract after a legitimate Hub read',async t=>{
 const f=fixture(t),source=f.source();let calls=0;
 const service=createLandingService({root:path.join(f.root,'negative-jobs'),knowledge:()=>source,createCli:()=>({run:async()=>{calls++;return {result:{kind:'request_context',message:'Synthetic forbidden source',specJson:'{"sections":[]}',query:'',offset:0,resources:[{id:HUB+'core/web/components/button/guidelines.md',mode:'read',path:[],offset:0,limit:100},{id:'contracts/components/button/source.json',mode:'read',path:['manual'],offset:0,limit:100}],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};}})});
 const chat=service.create({fileKey:'FixtureFile',pageId:'0:1'});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Synthetic source boundary'});await service.whenSettled(chat.id);const result=service.poll(chat.id);assert.equal(result.error.code,'LANDING_RESOURCE_INVALID');assert.equal(calls,1);assert(result.sources.every(s=>s.id.startsWith(HUB)));assert(result.sources.some(s=>s.id.endsWith('/guidelines.md')));assert.equal(result.target,null);
});

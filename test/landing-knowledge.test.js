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
 files.push(put(releaseRoot,'knowledge/data/design-system_ab/JSONS/doc.json',{small:[1,2,3],large:'x'.repeat(40000)}));
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,generatedAt:'2026-10-31T00:00:00Z',dataId:'d'.repeat(64),knowledgeVersion:'fixture',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};manifest.id=releases.idOf(manifest);put(releaseRoot,'manifest.json',manifest);return {releaseRoot,runtimeRoot,source:()=>openKnowledge({releaseRoot,runtimeRoot}),put,manifest};
}
test('installed skill and full mandatory norms are readable without a source checkout; JSON context stays addressed and bounded',t=>{
 const f=fixture(t),source=f.source(),id='knowledge/data/design-system_ab/JSONS/doc.json';assert.equal(source.skill.version,'0.3.0');assert.equal(source.initial.norms.length,5);assert.equal(source.initial.workflow.length,2);
 assert.deepEqual(JSON.parse(source.read({id,mode:'keys'}).text),['small','large']);assert.deepEqual(JSON.parse(source.read({id,path:['small'],offset:1,limit:1}).text),[2]);assert.equal(source.read({id}).tooLarge,true);assert.throws(()=>source.read({id,path:['__proto__']}),/INVALID/);assert.throws(()=>source.read({id:'../../private'}),/INVALID/);assert.equal(source.list('JSONS doc').resources.length,1);
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

test('asset roles expose absence explicitly and exact pinned Unicode IDs when published',t=>{
 const f=fixture(t);let source=f.source();for(const role of ['glyph26Metadata','glyph26Index','corpImageCatalogs','corpImageIndexes'])assert.deepEqual(source.initial.assetSources[role],{available:false,ids:[]});
 const files=['knowledge/data/ds-ai-hub/core/web/assets/assets_glyph-26.json','knowledge/data/design-system_ab/JSONS/indexes/icons/Icons -- glyph-26.index.json','knowledge/data/design-system_ab/JSONS/images/Сorp _ Image Library -- Продуктовые имиджи.json','knowledge/data/design-system_ab/JSONS/indexes/images/Сorp _ Image Library -- Продуктовые имиджи.index.json'];
 for(const file of files)f.manifest.files.push(f.put(f.releaseRoot,file,{synthetic:'fixture'}));f.manifest.id=releases.idOf(f.manifest);f.put(f.releaseRoot,'manifest.json',f.manifest);source=f.source();for(const role of Object.keys(source.initial.assetSources))assert.equal(source.initial.assetSources[role].available,true);
 assert.equal(source.list('Corp Image Library').total,0,'ASCII Corp must not be assumed to match Cyrillic Сorp');const id=source.initial.assetSources.corpImageCatalogs.ids[0];assert.equal(JSON.parse(source.read({id,mode:'keys'}).text)[0],'synthetic');assert.throws(()=>source.read({id:'../../private'}),/INVALID/);
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
 const source=f.source();assert.equal(source.initial.assetSources.corpImageCatalogs.ids.length,2);assert.equal(source.initial.assetSources.corpImageIndexes.ids.length,2);assert.equal(source.initial.assetSources.glyph26Index.ids.length,1);
 const id=source.initial.assetSources.glyph26Metadata.ids[0];assert.equal(JSON.parse(source.read({id,mode:'keys'}).text)[0],'SyntheticIcon');assert.equal(JSON.parse(source.read({id,path:['SyntheticIcon'],mode:'read'}).text).size,24);
 const imageId=source.initial.assetSources.corpImageCatalogs.ids[0];assert.equal(JSON.parse(source.read({id:imageId,path:['components'],mode:'read',offset:0,limit:1}).text)[0].key,'synthetic-key');
 assert.throws(()=>source.read({id:'knowledge/data/ds-ai-hub/core/web/assets/../../secret.json'}),/INVALID/);
 fs.appendFileSync(path.join(f.releaseRoot,id),' ');assert.throws(()=>source.assertCurrent(),/STALE/);
});

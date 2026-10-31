'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const releases=require('../src/data-release'),catalog=require('../src/skills/catalog'),{openKnowledge}=require('../src/landing/knowledge');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-knowledge-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const releaseRoot=path.join(root,'release'),runtimeRoot=path.join(root,'runtime');
 const put=(base,file,body)=>{const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),target=path.join(base,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {file,sha256:catalog.sha(bytes),bytes:bytes.length};};
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),files:[put(runtimeRoot,'instructions/landing/figma-workflow.md','# Loaded workflow file: figma-use/SKILL.md\nSynthetic native API\n# Loaded workflow file: figma-generate-design/SKILL.md\nSynthetic design workflow')]};runtime.id=releases.idOf(runtime);put(runtimeRoot,'portable-runtime.json',runtime);
 const files=[],descriptor={schemaVersion:'apollo.skill-package.v1',id:catalog.LANDING_ID,version:'0.3.0',name:'Landing',description:'Synthetic skill',executorId:'apollo.landing',files:catalog.LANDING_FILES.map(file=>{const pin=put(releaseRoot,'skills/'+catalog.LANDING_ID+'/'+file,file==='SKILL.md'?'---\nversion: "0.3.0"\n---\nSynthetic landing skill':'Synthetic reference');files.push(pin);return {path:file,sha256:pin.sha256,bytes:pin.bytes};})};files.push(put(releaseRoot,'skills/'+catalog.LANDING_ID+'/manifest.json',descriptor));
 for(const file of ['manifest.json','patterns/landing-pages.md','patterns/business-segment-styles.md','patterns/draft-layout.md'])files.push(put(releaseRoot,'knowledge/data/ds-ai-hub/products/ab/'+file,file.endsWith('.json')?{product:'Synthetic'}:'Synthetic normative rules'));
 files.push(put(releaseRoot,'knowledge/data/design-system_ab/JSONS/doc.json',{small:[1,2,3],large:'x'.repeat(40000)}));
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,generatedAt:'2026-10-31T00:00:00Z',dataId:'d'.repeat(64),knowledgeVersion:'fixture',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};manifest.id=releases.idOf(manifest);put(releaseRoot,'manifest.json',manifest);return {releaseRoot,runtimeRoot,source:()=>openKnowledge({releaseRoot,runtimeRoot}),put,manifest};
}
test('installed skill and full mandatory norms are readable without a source checkout; JSON context stays addressed and bounded',t=>{
 const f=fixture(t),source=f.source(),id='knowledge/data/design-system_ab/JSONS/doc.json';assert.equal(source.skill.version,'0.3.0');assert.equal(source.initial.norms.length,4);assert.equal(source.initial.workflow.length,2);
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

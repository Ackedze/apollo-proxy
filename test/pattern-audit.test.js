'use strict';
const test=require.main===module?require('node:test').test:()=>{};
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const releases=require('../src/data-release'),{openPatternKnowledge,HUB}=require('../src/pattern-audit/knowledge');
function fixture(t){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pattern-md-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const releaseRoot=path.join(home,'release'),runtimeRoot=path.join(home,'runtime');fs.mkdirSync(releaseRoot);fs.mkdirSync(runtimeRoot);
 const protocol=fs.readFileSync(path.resolve(process.env.APOLLO_PROJECT_ROOT||path.join(__dirname,'../../../projects/Apollo'),'src/figma-audit/protocol.js'));
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.1',nativeSourceHash:'a'.repeat(64),capabilities:{figmaAudit:require('../src/skills/catalog').auditCapabilityForWire('apollo.figma-audit.v3')},files:[{file:'src/figma-audit/protocol.js',bytes:protocol.length,sha256:releases.sha(protocol)}]};
 fs.mkdirSync(path.join(runtimeRoot,'src/figma-audit'),{recursive:true});fs.writeFileSync(path.join(runtimeRoot,'src/figma-audit/protocol.js'),protocol);runtime.id=releases.idOf(runtime);fs.writeFileSync(path.join(runtimeRoot,'portable-runtime.json'),JSON.stringify(runtime));
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,runtimeId:runtime.id,generatedAt:new Date(0).toISOString(),knowledgeVersion:'pattern-fixture',dataId:'b'.repeat(64),files:[]};
 function pin(id,body){const bytes=Buffer.from(body),file=path.join(releaseRoot,id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);manifest.files.push({file:id,bytes:bytes.length,sha256:releases.sha(bytes)});}
 function repin(){delete manifest.id;manifest.id=releases.idOf(manifest);fs.writeFileSync(path.join(releaseRoot,'manifest.json'),JSON.stringify(manifest));}
 pin(HUB+'AGENTS.md','Only use observed facts and pinned product rules.');
 pin(HUB+'products/ab/patterns/layout.md','---\nstatus: verified\n---\n# Сетка\n\nМежду самостоятельными блоками формы используйте 24 px.\n\nFigma example: https://www.figma.com/design/FORBIDDEN/?node-id=1-2\n');
 pin(HUB+'core/web/tokens/colors.md','Semantic color tokens are shared web Markdown.');
 pin(HUB+'CONTRACT.md','Hub document structure and provenance requirements.');
 pin(HUB+'products/abm/patterns/mobile.md','Secret other-product norm');
 pin(HUB+'products/ab/patterns/rules.json','{"mustNotBeRead":true}');
 repin();return {home,releaseRoot,runtimeRoot,manifest,pin,repin};
}
test('MD-only installed package needs neither component contracts nor their index',t=>{
 const f=fixture(t),source=openPatternKnowledge(f),id=HUB+'products/ab/patterns/layout.md';
 assert.equal(f.manifest.files.some(p=>/contracts|componentContractIndex/.test(p.file)),false);
 assert.equal(source.list('Semantic color').items[0].id,HUB+'core/web/tokens/colors.md');
 assert(source.read(HUB+'CONTRACT.md').text.includes('provenance'));
 assert.equal(source.documentRouting,null);assert.equal(source.customizationFacts,null);
 assert.equal(source.list('самостоятельными блоками').items[0].id,id);
 assert.equal(source.hasRead(id,'Между самостоятельными блоками'),false,'text search must not become norm-reading evidence');
 const read=source.read(id);assert.equal(source.hasRead(id,'Между самостоятельными блоками'),true);assert(read.text.includes('FORBIDDEN'));
 assert.equal(source.list('other-product').total,0);assert.equal(source.list('rules.json').total,0);
 assert.throws(()=>source.read(HUB+'products/ab/patterns/rules.json'),{code:'AUDIT_RESOURCE_UNKNOWN'});
 assert.throws(()=>source.read(HUB+'products/abm/patterns/mobile.md'),{code:'AUDIT_RESOURCE_UNKNOWN'});
 assert.throws(()=>source.read('https://www.figma.com/design/FORBIDDEN/'),{code:'AUDIT_RESOURCE_UNKNOWN'});
});
test('new Markdown becomes searchable solely by updating the package',t=>{
 const f=fixture(t),id=HUB+'products/ab/patterns/new-example.md';f.pin(id,'# Новый паттерн\nУникальное правило без регистрации в JSON.');f.repin();
 const source=openPatternKnowledge(f);assert.equal(source.list('Уникальное правило').items[0].id,id);assert.equal(source.hasRead(id,'Уникальное правило'),false);assert(source.initial[0].documents.some(d=>d.id===id));
});
test('fragments preserve UTF-16 ranges, unread tails and exact citations',t=>{
 const f=fixture(t),id=HUB+'products/ab/patterns/long.md';f.pin(id,'x'.repeat(11999)+'😀 Правило в хвосте документа.');f.repin();
 const source=openPatternKnowledge(f),first=source.read(id);assert.equal(first.end,11999);assert.equal(source.hasRead(id,'Правило в хвосте'),false);
 const tail=source.read(id,first.next);assert.equal(tail.next,null);assert(tail.text.startsWith('😀'));assert.equal(source.hasRead(id,'Правило в хвосте'),true);
 assert.throws(()=>source.read(id,-1),{code:'AUDIT_RESOURCE_INVALID'});assert.throws(()=>source.read('../outside.md'),{code:'AUDIT_RESOURCE_UNKNOWN'});
});
test('changed or symlinked source cannot be accepted under its old package pin',t=>{
 for(const type of ['bytes','symlink']){
  const f=fixture(t),id=HUB+'products/ab/patterns/layout.md',source=openPatternKnowledge(f),file=path.join(f.releaseRoot,id);source.read(id);
  if(type==='bytes')fs.appendFileSync(file,'changed');else{const copy=path.join(f.home,'copy.md');fs.copyFileSync(file,copy);fs.unlinkSync(file);fs.symlinkSync(copy,file);}
  assert.throws(()=>source.assertCurrent(),{code:'AUDIT_DATA_STALE'});
 }
});
module.exports={fixture};

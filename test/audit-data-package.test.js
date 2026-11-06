'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,preparation}=require('./audit-data.test');
const {createAuditDataReader}=require('../src/audit-data/reader');
const {preparationFromRuntime,PREPARATION_FILE}=require('../src/audit-data/builder'),p=require('../src/audit-data/protocol'),releases=require('../src/data-release');

test('required catalog/index sources cannot be missing or symlinked into a complete audit package',async t=>{
 for(const mode of ['missing','symlink']){
  const f=await fixture(t);await fs.unlink(f.catalogFile);
  if(mode==='symlink'){const outside=await f.write(f.root,'outside.json',JSON.stringify(f.catalog));await fs.symlink(outside,f.catalogFile);}
  await assert.rejects(f.build(),error=>mode==='missing'?error.code==='ENOENT':error.code==='AUDIT_DATA_SOURCE_PATH_INVALID');
  assert.equal(await fs.stat(path.join(f.root,'output/package')).catch(()=>null),null);
 }
});
test('source edits between inventory and compression refuse instead of publishing mixed bytes',async t=>{
 const f=await fixture(t),original=preparation();
 const injected=Object.assign({},original,{async preparePolicies(...args){const policy=await original.preparePolicies(...args);await fs.appendFile(f.catalogFile,' ');return policy;}});
 await assert.rejects(require('../scripts/build-knowledge-package').buildKnowledgePackage({'design-system-root':f.designRoot,'ds-ai-hub-root':f.hubRoot,'audit-abm-root':f.abmRoot,auditPreparation:injected,'design-system-commit':'1'.repeat(40),'ds-ai-hub-commit':'2'.repeat(40),'generated-at':'2026-11-04T00:00:00Z',output:path.join(f.root,'output'),channel:'stable',minEngine:require('../src/knowledge-package').ENGINE_VERSION,maxEngine:require('../src/knowledge-package').ENGINE_VERSION,directoryOnly:true}),/SOURCE_CHANGED/);
});
test('metadata cache notices equal-size edits even when mtime is restored',async t=>{
 const f=await fixture(t),built=await f.build(),reader=createAuditDataReader({knowledgeRoot:built.packageRoot}),manifest=await reader.manifest(),file=path.join(built.packageRoot,p.MANIFEST),stat=await fs.stat(file),before=await fs.readFile(file,'utf8');
 const after=before.replace('apollo.v3-audit-preparation.v1','apollo.v3-audit-preparation.v2');assert.notEqual(before,after);assert.equal(Buffer.byteLength(before),Buffer.byteLength(after));
 await fs.writeFile(file,after);await fs.utimes(file,stat.atime,stat.mtime);await assert.rejects(reader.asset(manifest.dataId,manifest.policyFileId),/SOURCE_CHANGED/);
});
test('identical source bytes produce identical native identities and compressed asset pins',async t=>{
 const f=await fixture(t),first=await f.build(path.join(f.root,'first')),second=await f.build(path.join(f.root,'second'));
 assert.deepEqual(second.auditData.manifest,first.auditData.manifest);assert.equal(second.manifest.checksum.value,first.manifest.checksum.value);
});
test('preparation code is selected from a verified code runtime and cannot come from the data package',async t=>{
 const f=await fixture(t),built=await f.build();assert.throws(()=>preparationFromRuntime(built.packageRoot));
 const root=path.join(f.root,'runtime'),body='module.exports={VERSION:"apollo.v3-audit-preparation.v1",marker:1};';
 const file=await f.write(root,PREPARATION_FILE,body),runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.8',nativeSourceHash:'a'.repeat(64),capabilities:{auditDataPreparation:p.SCHEMA},files:[{file:PREPARATION_FILE,sha256:p.sha(body),bytes:Buffer.byteLength(body)}]};
 runtime.id=releases.idOf(runtime);await f.write(root,'portable-runtime.json',runtime);assert.equal(preparationFromRuntime(root).marker,1);
 await fs.appendFile(file,' ');assert.throws(()=>preparationFromRuntime(root),/ARTIFACT_CHANGED/);
});

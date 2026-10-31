'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const catalog=require('../src/skills/catalog');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'skill-catalog-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(file,body)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);return target;};
  const descriptor={schemaVersion:'apollo.skill-package.v1',id:catalog.ID,version:'0.2.0',name:'Fixture',description:'Synthetic instructions',executorId:'apollo.layer-names',files:catalog.FILES.map(file=>{
    const bytes=Buffer.from('fixture:'+file);put(catalog.ID+'/'+file,bytes);return{path:file,sha256:catalog.sha(bytes),bytes:bytes.length};
  })};
  function seal(){const bytes=Buffer.from(JSON.stringify(descriptor));put(catalog.ID+'/manifest.json',bytes);put('manifest.json',JSON.stringify({schemaVersion:'apollo.skill-catalog.v1',skills:[{id:catalog.ID,path:catalog.ID+'/manifest.json',sha256:catalog.sha(bytes),bytes:bytes.length}]}));}
  seal();return{root,put,descriptor,seal};
}
test('one source catalog admits both instruction profiles and detects subsequent source drift',t=>{
  const f=fixture(t),admitted=catalog.readCatalog(f.root);admitted.assertCurrent();assert.match(admitted.sha256,/^[a-f0-9]{64}$/);
  f.put(catalog.ID+'/run/SKILL.md','changed');
  assert.throws(()=>admitted.assertCurrent(),{code:'SKILL_CATALOG_INVALID'});assert.throws(()=>catalog.readCatalog(f.root),{code:'SKILL_CATALOG_INVALID'});
});
test('declared missing files and manifest changes fail closed',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.root,catalog.ID,'profile.json'));
  assert.throws(()=>catalog.readCatalog(f.root),{code:'SKILL_CATALOG_INVALID'});
  fs.unlinkSync(path.join(f.root,'manifest.json'));assert.throws(()=>catalog.readCatalog(f.root),{code:'SKILL_CATALOG_INVALID'});
});
for(const file of ['../escape','/absolute','run/protocol.js'])test('catalog refuses extra or executable source '+file,t=>{
  const f=fixture(t);f.descriptor.files[0].path=file;f.seal();assert.throws(()=>catalog.readCatalog(f.root),{code:'SKILL_CATALOG_INVALID'});
});
test('catalog source cannot redirect a pinned instruction through a symlink',t=>{
  const f=fixture(t),file=path.join(f.root,catalog.ID,'SKILL.md'),bytes=fs.readFileSync(file);
  f.put('other.md',bytes);fs.unlinkSync(file);fs.symlinkSync('../other.md',file);
  assert.throws(()=>catalog.readCatalog(f.root),{code:'SKILL_CATALOG_INVALID'});
});
test('one catalog admits the known landing executor alongside naming and rejects executable/unknown substitutions',t=>{
 const f=fixture(t),landing={schemaVersion:'apollo.skill-package.v1',id:catalog.LANDING_ID,version:'0.3.0',name:'Landing',description:'Synthetic landing',executorId:'apollo.landing',files:catalog.LANDING_FILES.map(file=>{const bytes=Buffer.from('fixture:'+file);f.put(catalog.LANDING_ID+'/'+file,bytes);return {path:file,sha256:catalog.sha(bytes),bytes:bytes.length};})},bytes=Buffer.from(JSON.stringify(landing));f.put(catalog.LANDING_ID+'/manifest.json',bytes);
 const manifest=JSON.parse(fs.readFileSync(path.join(f.root,'manifest.json')));manifest.skills.push({id:catalog.LANDING_ID,path:catalog.LANDING_ID+'/manifest.json',sha256:catalog.sha(bytes),bytes:bytes.length});f.put('manifest.json',JSON.stringify(manifest));const result=catalog.readCatalog(f.root);assert.equal(result.entries.length,2);result.assertCurrent();assert.throws(()=>catalog.packageFiles(Buffer.from(JSON.stringify({...landing,executorId:'arbitrary.shell'})),catalog.LANDING_ID),/INVALID/);f.put(catalog.LANDING_ID+'/references/proxy.md','drift');assert.throws(()=>result.assertCurrent(),/INVALID/);
});

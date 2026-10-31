const test=require('node:test'),assert=require('node:assert/strict');
const {buildIndex}=require('../src/style-token-catalog/deprecated-styles');
const {digest}=require('../src/style-token-catalog/protocol');
const policy={schemaVersion:'apollo.deprecated-style-policy.v1',version:1,createdAt:'2026-10-31T00:00:00Z',deprecatedSources:['JSONS/styles/old.json']};
const row=(key='a'.repeat(40),type='paint')=>({key,type,name:'Synthetic style'});
const source=(name,styles)=>({path:'JSONS/styles/'+name+'.json',sha256:digest(styles),catalog:{meta:{library:'Synthetic library'},styles}});
test('index uses explicit source policy and native keys, deduplicates effect rows and is deterministic',()=>{
 const sources=[source('old',[row(),row('b'.repeat(40),'drop shadow'),row('b'.repeat(40),'inner shadow')]),source('active',[row('c'.repeat(40))])];
 const index=buildIndex(policy,sources);assert.equal(index.styles.length,2);assert.equal(index.styles[1].type,'EFFECT');assert.ok(index.styles.every(s=>s.status==='deprecated'));
 assert.deepEqual(index,buildIndex(policy,sources.slice().reverse()));const data=Object.assign({},index);delete data.indexId;assert.equal(index.indexId,digest(data));
 assert.notEqual(index.indexId,buildIndex(Object.assign({},policy,{version:2}),sources).indexId);
});
test('conflicting type or undeclared source never silently wins deprecation status',()=>{
 const shared=row(),sources=[source('old',[shared]),source('active',[shared])];
 assert.equal(buildIndex(policy,sources).styles[0].status,'ambiguous');
 assert.equal(buildIndex(policy,[source('old',[shared,row(shared.key,'text')])]).styles[0].status,'ambiguous');
 assert.throws(()=>buildIndex(policy,[source('other',[shared])]),{code:'DEPRECATED_STYLE_SOURCE_MISSING'});
 assert.throws(()=>buildIndex(policy,[source('old',[row('invalid')])]),{code:'INVALID_STYLE_SOURCE'});
});
test('older packages have explicit missing-index coverage; rebuilding a linked index preserves its immutable base',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {writePackagedIndex,readPackagedIndex,POLICY,INDEX}=require('../src/style-token-catalog/deprecated-styles'),{sha256}=require('../src/style-token-catalog/protocol');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-style-index-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest=Buffer.from(JSON.stringify({artifacts:[]}));fs.writeFileSync(path.join(root,'manifest.json'),manifest);
 const snapshot={knowledge:{manifestSha256:sha256(manifest)},assertFresh:()=>{}};
 assert.throws(()=>readPackagedIndex(root,snapshot),{code:'DEPRECATED_STYLE_INDEX_NOT_PACKAGED'});
 const policyFile=path.join(root,POLICY),indexFile=path.join(root,INDEX);fs.mkdirSync(path.dirname(policyFile),{recursive:true});fs.writeFileSync(policyFile,JSON.stringify(policy));
 const styles=path.join(root,'data/design-system_ab/JSONS/styles');fs.mkdirSync(styles,{recursive:true});fs.writeFileSync(path.join(styles,'old.json'),JSON.stringify(source('old',[row()]).catalog));
 const base=path.join(root,'immutable-base.json');fs.writeFileSync(base,'immutable');fs.linkSync(base,indexFile);
 const index=writePackagedIndex(root);assert.equal(index.styles.length,1);assert.equal(fs.readFileSync(base,'utf8'),'immutable');
 fs.rmSync(policyFile);assert.equal(writePackagedIndex(root),null);assert.equal(fs.existsSync(indexFile),false);
});

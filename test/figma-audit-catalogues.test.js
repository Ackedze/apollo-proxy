'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCatalogueBaselines,selectedStructure}=require('../src/figma-audit/catalogues');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const key='a'.repeat(40),alternate='b'.repeat(40),family='c'.repeat(40),style='d'.repeat(40);
function component(){return {key:family,name:'[D] Button',platform:'Desktop',defaultVariant:key,variants:[{key,name:'View=Primary, Size=56'},{key:alternate,name:'View=Secondary, Size=64'}],variantStructures:{[key]:[],[alternate]:[{op:'update',id:2,value:{text:{characters:'Label',fontSize:20,lineHeight:24}}}]},structure:[{id:1,parentId:null,path:'View=Primary, Size=56',name:'Button',type:'COMPONENT',visible:true,layout:{width:120,height:56}},{id:2,parentId:1,path:'View=Primary, Size=56 / Label',name:'Label',type:'TEXT',visible:true,text:{characters:'Label',fontSize:16,lineHeight:20},styles:{text:{styleKey:'S:'+style+',1:1'}}}]};}
function fixture(t,body={components:[component()]}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'audit-catalogue-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'data/v3-audit/assets'),{recursive:true});
 const text=JSON.stringify(body),bytes=Buffer.from(text),id=sha(text),location='data/v3-audit/assets/'+id+'.json',stored=Buffer.from(JSON.stringify({fixture:'stored envelope'})),assetFile=path.join(root,location);fs.writeFileSync(assetFile,stored);
 const row={id,sha256:sha(bytes),bytes:bytes.length,urls:['https://example.test/JSONS/web/components/core/Web%20_%20Core%20--%20Button.json'],storage:{path:location,bytes:stored.length,sha256:sha(stored)}},manifest={dataId:'e'.repeat(64),files:[row]};fs.writeFileSync(path.join(root,'manifest.json'),'{}');fs.writeFileSync(path.join(root,'data/v3-audit/manifest.json'),JSON.stringify(manifest));let reads=0,hold=null;
 const reader={manifest:async()=>structuredClone(manifest),asset:async(dataId,fileId)=>{reads++;if(hold)await hold();return {dataId,fileId,sha256:row.sha256,text};}},provider=createCatalogueBaselines({knowledgeRoot:root,reader});
 return {root,row,manifest,provider,assetFile,reads:()=>reads,hold:f=>{hold=f;},target:(id='button',variant=key,set=family)=>({id,type:'INSTANCE',main:{key:variant,set:{key:set}}}),subject:(id='button')=>({nodeId:id,componentId:'Button'})};
}
test('one asset decode and selected projection serve repeated buttons without raw catalogue output',async t=>{
 const f=fixture(t),nodes=Array.from({length:7},(_,i)=>f.target('button'+i)),subjects=nodes.map(n=>f.subject(n.id)),r=await f.provider.prepare(nodes,subjects);
 assert.equal(f.reads(),1);assert.equal(r.references.length,1);assert.equal(r.references[0].targetIds.length,7);assert.equal(r.gaps.length,0);assert.equal(r.evidence[0].kind,'catalogue');assert.equal(r.evidence[0].provenance.freshness,'PINNED_PACKAGED_EXPORT');assert.equal(r.references[0].component.variants.length,1);
 const again=await f.provider.prepare([f.target('other',alternate)],[f.subject('other')]);assert.equal(f.reads(),1);assert.equal(again.references[0].structure.find(n=>n.id===2).text.fontSize,20);assert.equal(again.references[0].structure[0].path,'View=Secondary, Size=64');assert.equal(r.references[0].structure[1].text.fontSize,16);
});
test('empty selected patch is a valid base; unknown key never falls back to default',async t=>{
 const f=fixture(t),base=component(),saved=JSON.stringify(base);assert.equal(selectedStructure(base,key)[1].text.fontSize,16);assert.equal(JSON.stringify(base),saved);
 assert.throws(()=>selectedStructure(base,'f'.repeat(40)),{code:'AUDIT_CATALOGUE_VARIANT_UNAVAILABLE'});
 const r=await f.provider.prepare([f.target('unknown','f'.repeat(40))],[f.subject('unknown')]);assert.equal(r.references.length,0);assert.equal(r.gaps[0].code,'CATALOGUE_VARIANT_MISSING');
});
test('ambiguous keys, wrong family and missing variant patch remain explicit gaps',async t=>{
 for(const mode of ['ambiguous','family','patch']){
  const c=component();if(mode==='patch')delete c.variantStructures[alternate];const f=fixture(t,{components:mode==='ambiguous'?[c,structuredClone(c)]:[c]}),node=f.target('button',mode==='patch'?alternate:key,mode==='family'?'f'.repeat(40):family),r=await f.provider.prepare([node],[f.subject()]);
  assert.equal(r.references.length,0);assert.match(r.gaps[0].code,/AMBIGUOUS|MISMATCH|UNAVAILABLE/);
 }
});
test('unavailable fields stay absent; zero and false remain observed values',()=>{
 const c=component();c.structure[0].opacity=0;c.structure[0].visible=false;const nodes=selectedStructure(c,key);assert.equal(nodes[0].opacity,0);assert.equal(nodes[0].visible,false);assert.equal(Object.hasOwn(nodes[0],'effects'),false);assert.equal(Object.hasOwn(nodes[1].text,'fontName'),false);
});
test('a selected key on another platform is a gap, not a default substitution',async t=>{
 const f=fixture(t),r=await f.provider.prepare([f.target()],[f.subject()],{platform:'mobile'});assert.equal(r.references.length,0);assert.equal(r.gaps[0].code,'CATALOGUE_PLATFORM_MISMATCH');
});
test('asset or data drift during and after preparation is rejected without another decode',async t=>{
 for(const timing of ['during','after','manifest']){
  const f=fixture(t);if(timing==='during')f.hold(async()=>fs.appendFileSync(f.assetFile,'changed'));
  if(timing==='during')await assert.rejects(f.provider.prepare([f.target()],[f.subject()]),{code:'AUDIT_CATALOGUE_STALE'});
  else{await f.provider.prepare([f.target()],[f.subject()]);fs.appendFileSync(timing==='after'?f.assetFile:path.join(f.root,'data/v3-audit/manifest.json'),'changed');assert.throws(()=>f.provider.assertCurrent(),{code:'AUDIT_CATALOGUE_STALE'});}
  assert.equal(f.reads(),1);
 }
});
test('source path escape and output overflow refuse rather than silently truncating facts',async t=>{
 const f=fixture(t);f.row.storage.path='../outside.json';await assert.rejects(f.provider.prepare([f.target()],[f.subject()]),{code:'AUDIT_CATALOGUE_PATH_INVALID'});
 const g=fixture(t),tiny=createCatalogueBaselines({knowledgeRoot:g.root,maxBytes:1,reader:{manifest:async()=>g.manifest,asset:async(dataId,fileId)=>({dataId,fileId,sha256:g.row.sha256,text:JSON.stringify({components:[component()]})})}});await assert.rejects(tiny.prepare([g.target()],[g.subject()]),{code:'AUDIT_CATALOGUE_BUDGET'});
});
test('concurrent projections share a held asset read and do not share mutable target arrays',async t=>{
 const f=fixture(t);const results=await Promise.all([f.provider.prepare([f.target('a')],[f.subject('a')]),f.provider.prepare([f.target('b')],[f.subject('b')])]);assert.equal(f.reads(),1);assert.deepEqual(results[0].references[0].targetIds,['a']);assert.deepEqual(results[1].references[0].targetIds,['b']);
});

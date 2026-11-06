'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const p=require('../src/audit-data/protocol'),{createAuditDataReader}=require('../src/audit-data/reader');
const A=path.resolve(__dirname,'../../../projects/Apollo'),key='a'.repeat(40),other='b'.repeat(40);
let preparedCode;
function loadApollo(relative){
 const esbuild=require(path.join(A,'node_modules/esbuild'));
 const built=esbuild.buildSync({entryPoints:[path.join(A,'src/v3-audit',relative)],bundle:true,write:false,metafile:true,platform:'node',format:'cjs',logLevel:'silent'});
 assert(!Object.keys(built.metafile.inputs).some(file=>/component-contract-core|experimentalContractV2|predicate\/index/.test(file)));
 const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);return module.exports;
}
function preparation(){return preparedCode||(preparedCode=loadApollo('data-preparation.ts'));}
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'apollo-v3-audit-data-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const designRoot=path.join(root,'design-system_ab'),abmRoot=path.join(root,'desing-system_abm'),hubRoot=path.join(root,'hub'),base='https://ackedze.github.io/design-system_ab/JSONS/';
 const write=async(sourceRoot,relative,value)=>{const file=path.join(sourceRoot,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));return file;};
 const packagePath='web/components/example';
 const index={schemaVersion:2,documentType:'component-contract-index',coverage:{defaultPolicy:'none'},packages:[{componentKey:'example',packageName:'Example',packagePath,coverage:'required',figmaKeys:[key],aliases:['Example'],sourceCatalogPath:packagePath+'/Example.json',artifacts:{generatedContract:'contract.generated.json',rules:'rules.json',composition:'composition-contract.json',overrides:'overrides.json',agentContext:'agent-context.json',auditMapping:'audit-mapping.json',examples:'examples.json'}}]};
 await write(designRoot,'JSONS/referenceSourcesMVP.json',{schemaVersion:2,baseUrl:base,catalogManifests:[{url:'https://ackedze.github.io/desing-system_abm/JSONS/referenceSourcesMVP.json',channels:['iOS','Android']}],apollo:{patternRulesPath:'apollo/designPatternRules.json',componentContractIndexPath:'apollo/indexes/componentContractIndex.json'},catalogs:[{fileName:'tokens.json',path:'tokens/tokens.json',source:{kind:'tokens'}},{fileName:'styles.json',path:'styles/styles.json',source:{kind:'styles'}},{fileName:'Example.json',path:packagePath+'/Example.json',source:{kind:'components',indexPath:packagePath+'/Example.index.json'}}]});
 await write(designRoot,'JSONS/apollo/indexes/componentContractIndex.json',index);
 await write(designRoot,'JSONS/apollo/designPatternRules.json',{schemaVersion:1,rules:[]});
 await write(designRoot,'JSONS/tokens/tokens.json',{meta:{fileName:'tokens.json'},collections:[{id:'colors',key:'c'.repeat(40),name:'Colors',variables:[{id:'color',key:other,name:'Color',resolvedType:'COLOR',valuesByMode:{default:{r:0,g:0,b:0,a:1}}}]}]});
 await write(designRoot,'JSONS/styles/styles.json',{meta:{fileName:'styles.json'},styles:[]});
 const catalog={meta:{fileName:'Example.json',library:'Synthetic Library',description:'Привет 😀'},components:[{key,name:'Example',status:'current',platform:'Desktop',role:'Main',structure:[{id:1,parentId:null,path:'Example',name:'Example',type:'COMPONENT',visible:true,componentInstance:{componentKey:key,variantProperties:{View:'Forbidden'}}}],variantStructures:{[other]:[{op:'update',id:1,value:{layout:{itemSpacing:16}}}]}}]};
 const catalogFile=await write(designRoot,'JSONS/'+packagePath+'/Example.json',JSON.stringify(catalog,null,2)+'\r\n');
 await write(designRoot,'JSONS/'+packagePath+'/Example.index.json',{catalogPath:packagePath+'/Example.json',components:[{key,name:'Example'}]});
 const api={schemaVersion:'apollo.ds-contracts.v1',contracts:[{id:'example',name:'Example',normalizedName:'example',componentKey:key,status:'current',role:'Main',platform:'Desktop',figma:{variants:{properties:{View:['Primary']},allowedCombinations:[{View:'Primary'}],variantKeys:[]}}}]};
 for(const [file,body] of Object.entries({'contract.generated.json':api,'rules.json':{schemaVersion:1,rules:[]},'composition-contract.json':{contracts:[]},'overrides.json':{},'agent-context.json':{},'audit-mapping.json':{},'examples.json':{examples:[]}}))await write(designRoot,'JSONS/'+packagePath+'/'+file,body);
 await write(designRoot,'redpolrules/dictionary.json',{rules:[]});
 await write(abmRoot,'JSONS/referenceSourcesMVP.json',{schemaVersion:2,baseUrl:'https://ackedze.github.io/desing-system_abm/JSONS/',catalogs:[{fileName:'Mobile.json',path:'components/Mobile.json',source:{kind:'components',indexPath:'components/Mobile.index.json'}}]});
 await write(abmRoot,'JSONS/components/Mobile.json',{meta:{library:'Synthetic ABM'},components:[{key:other,name:'Mobile',structure:[],variantStructures:{[key]:[]}}]});
 await write(abmRoot,'JSONS/components/Mobile.index.json',{catalogPath:'components/Mobile.json',components:[{key:other,name:'Mobile'}]});
 await write(hubRoot,'products/ab/components/example/meta.json',{id:'Example'});await write(hubRoot,'core/web/components/example/figma-keys.json',{componentKey:key});
 for(const [name,value] of [['init',null],['config','user.name'],['config','user.email']]){
  if(name==='init')execFileSync('git',['-C',abmRoot,'init','-q']);
  else execFileSync('git',['-C',abmRoot,name,value,value==='user.name'?'Apollo Test':'fixture@example.invalid']);
 }
 execFileSync('git',['-C',abmRoot,'add','.']);execFileSync('git',['-C',abmRoot,'commit','-qm','fixture']);
 const build=async(output=path.join(root,'output'))=>require('../scripts/build-knowledge-package').buildKnowledgePackage({'design-system-root':designRoot,'ds-ai-hub-root':hubRoot,'audit-abm-root':abmRoot,auditPreparation:preparation(),'design-system-commit':'1'.repeat(40),'ds-ai-hub-commit':'2'.repeat(40),'generated-at':'2026-11-04T00:00:00Z',output,channel:'stable',minEngine:require('../src/knowledge-package').ENGINE_VERSION,maxEngine:require('../src/knowledge-package').ENGINE_VERSION,directoryOnly:true});
 return {root,designRoot,abmRoot,hubRoot,write,build,catalog,catalogFile,index,base,key,other};
}
async function reseal(packageRoot,mutate){
 const file=path.join(packageRoot,p.MANIFEST),manifest=JSON.parse(await fs.readFile(file));await mutate(manifest);
 const body=Object.assign({},manifest);delete body.dataId;manifest.dataId=p.sha(p.canonical(body));await fs.writeFile(file,JSON.stringify(manifest)+'\n');
 const {artifactManifest,manifestChecksum}=require('../scripts/build-knowledge-package'),artifacts=await artifactManifest(packageRoot),rootFile=path.join(packageRoot,'manifest.json'),outer=JSON.parse(await fs.readFile(rootFile));
 Object.assign(outer,{artifacts,artifactCount:artifacts.length,totalBytes:artifacts.reduce((n,row)=>n+row.size,0),checksum:manifestChecksum(artifacts)});await fs.writeFile(rootFile,JSON.stringify(outer)+'\n');return manifest;
}
function native(){
 const page={id:'page',name:'Synthetic Page',type:'PAGE',parent:null,children:[]},main={id:'main',key,name:'Example',type:'COMPONENT',remote:true,parent:page,children:[]};
 const node={id:'instance',name:'Example',type:'INSTANCE',visible:true,parent:page,children:[],overrides:[],variantProperties:{View:'Forbidden'},componentProperties:{View:{type:'VARIANT',value:'Forbidden'}},getMainComponentAsync:async()=>main};page.children=[node];
 globalThis.figma={mixed:Symbol('mixed'),currentPage:page,currentUser:{id:null,name:'Synthetic'},root:{name:'Synthetic'},editorType:'figma',variables:{getVariableCollectionByIdAsync:async()=>null},importComponentByKeyAsync:async()=>main,getNodeByIdAsync:async id=>id===node.id?node:null};return node;
}
module.exports={fixture,preparation,loadApollo,reseal,native,key,other};
if(require.main===module){
 test('packaged V3 data preserves raw Athena/variant/Unicode bytes and original API constraints',async t=>{
  const f=await fixture(t),built=await f.build(),reader=createAuditDataReader({knowledgeRoot:built.packageRoot}),manifest=await reader.manifest();
  const row=manifest.files.find(row=>row.urls.includes(f.base+'web/components/example/Example.json'));
  const asset=await reader.asset(manifest.dataId,row.id);assert.equal(asset.text,await fs.readFile(f.catalogFile,'utf8'));assert.deepEqual(JSON.parse(asset.text).components[0].variantStructures,f.catalog.components[0].variantStructures);
  const policies=JSON.parse((await reader.asset(manifest.dataId,manifest.policyFileId)).text);assert.equal(policies.packages[0].loadedArtifacts.rules,true);assert.equal(policies.packages[0].rulesEntry,null);assert.deepEqual(policies.packages[0].apiEntry.contracts[0].figma.variants.allowedCombinations,[{View:'Primary'}]);
  assert(manifest.files.some(row=>row.urls.some(url=>url.includes('/desing-system_abm/'))));assert(!JSON.stringify(manifest).includes(f.root));
  assert.equal(built.auditData.sourcePins.length,manifest.files.length-1);await require('../src/knowledge-package').validatePackageDirectory(built.packageRoot);
 });
 test('reader rejects stale IDs, undeclared assets, mutation and checkout roots without a package fallback',async t=>{
  const f=await fixture(t),built=await f.build(),reader=createAuditDataReader({knowledgeRoot:built.packageRoot}),manifest=await reader.manifest();
  await assert.rejects(reader.asset('0'.repeat(64),manifest.policyFileId),/CHANGED_RELOAD/);await assert.rejects(reader.asset(manifest.dataId,'f'.repeat(64)),/UNDECLARED/);
  const copy=await reader.manifest();copy.files.length=0;assert((await reader.manifest()).files.length>0);
  await assert.rejects(createAuditDataReader({knowledgeRoot:f.designRoot}).manifest(),/PACKAGE_MISSING/);
  const row=manifest.files[0],file=path.join(built.packageRoot,row.storage.path);await fs.appendFile(file,' ');await assert.rejects(reader.asset(manifest.dataId,row.id),/MISMATCH|CHANGED/);
 });
 test('decoder enforces the accepted original length and hash even for a self-consistent corrupt envelope',async t=>{
  for(const mode of ['gzip','overflow','hash']){
   const f=await fixture(t),built=await f.build(path.join(f.root,mode)),manifest=await reseal(built.packageRoot,async data=>{
    const row=data.files[0],file=path.join(built.packageRoot,row.storage.path),envelope=JSON.parse(await fs.readFile(file));
    envelope.data=(mode==='gzip'?Buffer.from('not gzip'):require('node:zlib').gzipSync(Buffer.alloc(row.bytes+(mode==='overflow'?1:0),120))).toString('base64');
    const bytes=Buffer.from(JSON.stringify(envelope));await fs.writeFile(file,bytes);row.storage.sha256=p.sha(bytes);row.storage.bytes=bytes.length;
   });
   const reader=createAuditDataReader({knowledgeRoot:built.packageRoot});await assert.rejects(reader.asset(manifest.dataId,manifest.files[0].id),/ASSET_MISMATCH/);
  }
 });
 test('service accepts opaque IDs only, returns safe errors, and never resolves a caller path',async t=>{
  const f=await fixture(t),built=await f.build(),routes=new Map();require('../src/audit-data/service').mountAuditDataRoutes({get:(route,handler)=>routes.set(route,handler)},{knowledgeRoot:built.packageRoot});
  async function call(route,request){let status=200,body;const response={set(){return response;},status(n){status=n;return response;},json(value){body=value;}};await routes.get(route)(request,response);return{status,body};}
  const current=await call('/v1/audit-data/manifest',{query:{}});assert.equal(current.status,200);
  const bad=await call('/v1/audit-data/:dataId/assets/:fileId',{query:{},params:{dataId:current.body.dataId,fileId:'../secret'}});assert.equal(bad.status,400);assert.deepEqual(bad.body,{error:'AUDIT_DATA_REQUEST_INVALID'});assert(!JSON.stringify(bad).includes(f.root));
  assert.equal((await call('/v1/audit-data/manifest',{query:{sourceRoot:f.designRoot}})).status,400);
 });
}

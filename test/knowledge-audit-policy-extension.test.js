const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const builder=require('../scripts/build-knowledge-package'),knowledge=require('../src/knowledge-package');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-policy-extension-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const design=path.join(root,'design'),hub=path.join(root,'hub');await fs.mkdir(hub);
 const write=async(relative,value)=>{const file=path.join(design,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
 await write('JSONS/apollo/indexes/componentContractIndex.json',{schemaVersion:2,packages:[{packagePath:'fixture',artifacts:{}}]});
 await write('JSONS/apollo/designPatternRules.json',{rules:[]});await write('redpolrules/dictionary.json',{});
 for(const dir of ['products/ab/components/fixture','core/web/components/fixture']){await fs.mkdir(path.join(hub,dir),{recursive:true});await fs.writeFile(path.join(hub,dir,'figma-keys.json'),'{}');}
 await write('JSONS/apollo/auditPolicies.json',{schemaVersion:1,rawTypography:{rules:[]}});
 await write('JSONS/tokens/t.json',{meta:{library:'Tokens',fileName:'Tokens'},collections:[]});
 const styles=['009 _ Shadows BlueTint Light.json','010 _ Colors Indigo Light.json','011 _ Colors Indigo Dark.json','012 _ Colors Indigo Static.json','020 _ Colors BlueTint Light.json','022 _ Colors BlueTint Static.json','Web _ Core Helpers.json','Web _ Core.json','Web _ Typography.json'];for(const name of styles)await write('JSONS/styles/'+name,{meta:{library:'Styles',fileName:name},styles:[]});
 const reference={apollo:{auditPolicyConfigPath:'apollo/auditPolicies.json'},catalogs:[{path:'tokens/t.json',fileName:'Tokens'},...styles.map(name=>({path:'styles/'+name,fileName:name}))],libraries:['Icons','Logotypes'].map((name,i)=>({name,catalogs:[{source:{kind:'components',indexPath:'indexes/'+(i?'logotypes':'icons')+'/one.index.json'}}]}))};
 await write('JSONS/referenceSourcesMVP.json',reference);for(const l of reference.libraries)await write('JSONS/'+l.catalogs[0].source.indexPath,{kind:'component-index',library:l.name,components:[]});
 const git=(...args)=>cp.execFileSync('git',['-C',design,...args],{encoding:'utf8'}).trim();git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture policy');const commit=git('rev-parse','HEAD');
 const built=await builder.buildKnowledgePackage({'design-system-root':design,'ds-ai-hub-root':hub,'design-system-commit':commit,'ds-ai-hub-commit':'2'.repeat(40),'generated-at':'2026-11-02T00:00:00Z',output:path.join(root,'base'),channel:'stable',minEngine:knowledge.ENGINE_VERSION,maxEngine:knowledge.ENGINE_VERSION,directoryOnly:true});
 // Reproduce a closed older package: complete catalogs, one unrelated extra token artifact, missing policy delivery files.
 const manifest=built.manifest;for(const a of manifest.artifacts.filter(a=>a.path.endsWith('/style-token-catalog-provenance.json')||a.path.endsWith('/referenceSourcesMVP.json')||a.path.includes('/JSONS/indexes/icons/')||a.path.includes('/JSONS/indexes/logotypes/')))await fs.unlink(path.join(built.packageRoot,a.path));
 const extra=path.join(built.packageRoot,'data/design-system_ab/JSONS/tokens/unreferenced.json');await fs.writeFile(extra,JSON.stringify({meta:{library:'Unreferenced',fileName:'Unreferenced'},collections:[]}));
 const artifacts=await builder.artifactManifest(built.packageRoot);Object.assign(manifest,{artifacts,artifactCount:artifacts.length,totalBytes:artifacts.reduce((n,a)=>n+a.size,0),checksum:builder.manifestChecksum(artifacts)});await fs.writeFile(path.join(built.packageRoot,'manifest.json'),JSON.stringify(manifest));await knowledge.validatePackageDirectory(built.packageRoot);
 return{root,design,base:built.packageRoot,manifest,options:{'base-package':built.packageRoot,'design-system-root':design,output:path.join(root,'extended'),directoryOnly:true}};
}
test('base-package restores complete V3 policy inputs while preserving every frozen artifact',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.base,'manifest.json'));const result=await builder.buildKnowledgePackage(f.options);
 assert.equal(result.manifest.artifactCount,f.manifest.artifactCount+3);assert.notEqual(result.manifest.contentVersion,f.manifest.contentVersion);
 for(const a of f.manifest.artifacts)assert.deepEqual(await fs.readFile(path.join(result.packageRoot,a.path)),await fs.readFile(path.join(f.base,a.path)));
 const snapshot=require('../src/style-token-catalog/inventory').loadPackageSnapshot(result.packageRoot);assert.equal(snapshot.sources.size,11);assert(require('../src/style-token-catalog/audit-policy').readPackagedPolicy(result.packageRoot,snapshot).indexId);
 assert.deepEqual(await fs.readFile(path.join(f.base,'manifest.json')),before);assert.equal(result.tarball,null);
});
test('dirty policy source cannot enter an immutable-base extension',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.design,'JSONS/indexes/icons/one.index.json'),'{}');
 await assert.rejects(builder.buildKnowledgePackage(f.options),/pinned source commit/);await assert.rejects(fs.stat(path.join(f.options.output,'package')),{code:'ENOENT'});
});

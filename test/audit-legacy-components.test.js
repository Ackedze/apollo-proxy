'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const p=require('../src/audit-data/protocol');
const {compileLegacyComponents}=require('../src/audit-data/policies/liquid-glass');
const {identifyLegacyComponent}=require('../../../projects/Apollo/src/v3-audit/policies/liquidGlassComponentPolicy');
const {createLegacyComponentsReader}=require('../src/audit-data/legacy-components-reader');
const family='1'.repeat(40),variant='2'.repeat(40),local='3'.repeat(40),unrelated='4'.repeat(40);
function fixture(){
 const payload={manifest:{schema:'apollo.offline-audit-index.v1',version:1},components:{rows:{
  [family]:{type:'component',name:'Catalog name',status:'active',platforms:['iOS'],sources:[1]},
  [variant]:{type:'variant',name:'State=On',componentKey:family},
 }},sources:{sources:[{id:1,fileKey:'SyntheticLibrary',catalogPath:'abm/ios/Fixture.json'}]}};
 const config={schemaVersion:1,platform:'iOS',families:[
  {key:family,name:'Declared name',fileKey:'SyntheticLibrary',allowLocalSupplement:false},
  {key:local,name:'Missing family',fileKey:'OtherLibrary',allowLocalSupplement:true},
 ]};
 const bytes=()=>Buffer.from(JSON.stringify({schema:'apollo.embedded-audit.v1',dataId:p.sha(JSON.stringify(payload)),payload}));
 return {payload,config,bytes};
}
test('legacy preparation uses catalog variants and explicit local families without rewriting the audit index',()=>{
 const f=fixture(),before=f.bytes(),registry=compileLegacyComponents(before,f.config);
 assert.deepEqual(f.bytes(),before);
 assert.equal(registry.families[0].name,'Catalog name');
 assert.equal(registry.families[0].catalogStatus,'active');
 assert.deepEqual(registry.families[0].variantKeys,[variant]);
 assert.deepEqual(registry.families[1].variantKeys,[]);
 assert.equal(registry.coverage.localVariantMatching,'requires-component-set-key');
 assert.equal(compileLegacyComponents(before,f.config).registryId,registry.registryId);
 assert.deepEqual(identifyLegacyComponent(registry,{platform:'iOS',mainComponentKey:variant,name:'Renamed by designer'}),
  {status:'legacy',familyKey:family,source:'catalog',matchBasis:'variant-key'});
 assert.equal(identifyLegacyComponent(registry,{platform:'iOS',mainComponentKey:family}).matchBasis,'main-component-key');
 assert.deepEqual(identifyLegacyComponent(registry,{platform:'iOS',mainComponentKey:unrelated,componentSetKey:local}),
  {status:'legacy',familyKey:local,source:'local-supplement',matchBasis:'component-set-key'});
 for(const identity of [{mainComponentKey:unrelated},{componentId:'12:34',name:'Missing family'},{name:'Switch'}]){
  assert.equal(identifyLegacyComponent(registry,Object.assign({platform:'iOS'},identity)).status,'unknown');
 }
 assert.equal(identifyLegacyComponent(registry,{platform:'Android',mainComponentKey:variant}).status,'not-applicable');
 assert.equal(identifyLegacyComponent(registry,{platform:'iOS',mainComponentKey:variant,componentSetKey:local}).reason,'identity-conflict');
});
test('catalog identity conflicts fail, and local entries move to catalog provenance when the index gains them',()=>{
 for(const mutate of [f=>delete f.payload.components.rows[family],f=>f.payload.components.rows[family].conflicts=['conflict'],
  f=>f.payload.components.rows[family].platforms=['Android'],f=>f.payload.sources.sources[0].fileKey='OtherLibrary',
  f=>f.payload.components.rows[family]={type:'ambiguous'}]){
  const f=fixture();mutate(f);assert.throws(()=>compileLegacyComponents(f.bytes(),f.config),/AUDIT_LEGACY_COMPONENTS_/);
 }
 const f=fixture();f.payload.components.rows[local]={type:'component',name:'Now cataloged',status:'active',platforms:['iOS'],sources:[2]};
 f.payload.sources.sources.push({id:2,fileKey:'OtherLibrary',catalogPath:'abm/ios/Other.json'});
 assert.equal(compileLegacyComponents(f.bytes(),f.config).families[1].source,'catalog');
 const corrupt=JSON.parse(f.bytes());corrupt.dataId='0'.repeat(64);
 assert.throws(()=>compileLegacyComponents(Buffer.from(JSON.stringify(corrupt)),f.config),/AUDIT_ATHENA_INDEX_INVALID/);
});
test('configuration rejects duplicate keys, unsupported platforms and silent supplementation of required catalog entries',()=>{
 for(const mutate of [f=>f.config.families.push(f.config.families[0]),f=>f.config.platform='Android',
  f=>f.config.families[1].allowLocalSupplement='true',f=>f.config.families[1].key='12:34',
  f=>f.config.families[1].allowLocalSupplement=false]){
  const f=fixture();mutate(f);assert.throws(()=>compileLegacyComponents(f.bytes(),f.config),/AUDIT_LEGACY_COMPONENTS_/);
 }
});
test('configured file is read explicitly, reloads on change and never falls back after invalid input',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-legacy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const f=fixture(),file=path.join(dir,'scope.json');await fs.writeFile(file,JSON.stringify(f.config));
 const read=createLegacyComponentsReader({file,readIndex:async()=>f.bytes()});
 const before=await read();f.config.families.pop();await fs.writeFile(file,JSON.stringify(f.config));
 assert.notEqual((await read()).registryId,before.registryId);
 await fs.writeFile(file,'invalid');await assert.rejects(read(),/CONFIG_INVALID/);
 await fs.writeFile(file,' '.repeat(1024*1024+1));await assert.rejects(read(),/CONFIG_INVALID/);
 await fs.unlink(file);await assert.rejects(read(),/CONFIG_INVALID/);
 await assert.rejects(createLegacyComponentsReader({readIndex:async()=>f.bytes()})(),/NOT_CONFIGURED/);
});

test('package policy is the default; an explicit override never silently falls back to it',async t=>{
 const f=fixture(),bytes=Buffer.from(JSON.stringify(f.config));let packageReads=0;
 const readPolicy=async()=>{packageReads++;return bytes;};
 const packaged=await createLegacyComponentsReader({readIndex:async()=>f.bytes(),readPolicy})();
 assert.equal(packaged.policySource,'package');assert.equal(packaged.policySha256,p.sha(bytes));
 assert.equal(packaged.families.length,2);assert.equal(packageReads,1);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-policy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'override.json');await fs.writeFile(file,bytes);
 const read=createLegacyComponentsReader({file,readIndex:async()=>f.bytes(),readPolicy});
 assert.equal((await read()).policySource,'local-override');assert.equal(packageReads,1);
 await fs.writeFile(file,'invalid');await assert.rejects(read(),/CONFIG_INVALID/);
 await fs.unlink(file);await assert.rejects(read(),/CONFIG_INVALID/);assert.equal(packageReads,1);
 await assert.rejects(createLegacyComponentsReader({readIndex:async()=>f.bytes(),readPolicy:async()=>{throw Error('AUDIT_DATA_ASSET_MISMATCH');}})(),/ASSET_MISMATCH/);
});

test('a conditional family reports only False; True, unknown state and conflicting evidence never become legacy',()=>{
 const f=fixture(),enabled='5'.repeat(40),property='👻 LiquidGlassEffect';
 f.config.families[0].variantCondition={property,equals:'False',variantValues:{[variant]:'False',[enabled]:'True'}};
 const registry=compileLegacyComponents(f.bytes(),f.config);
 const identify=input=>identifyLegacyComponent(registry,Object.assign({platform:'iOS'},input));
 assert.equal(identify({mainComponentKey:variant}).status,'legacy');
 assert.equal(identify({mainComponentKey:enabled}).status,'not-applicable');
 assert.equal(identify({componentSetKey:family,variantProperties:{[property]:'False'}}).status,'legacy');
 assert.equal(identify({componentSetKey:family,variantProperties:{[property]:'True'}}).status,'not-applicable');
 assert.equal(identify({componentSetKey:family}).reason,'variant-condition-unavailable');
 assert.equal(identify({mainComponentKey:unrelated,componentSetKey:family}).status,'unknown');
 assert.equal(identify({mainComponentKey:variant,variantProperties:{[property]:'True'}}).reason,'variant-condition-conflict');
 assert.equal(identify({mainComponentKey:enabled,variantProperties:{[property]:'False'}}).status,'unknown');
 assert.equal(identify({componentSetKey:family,variantProperties:{[property]:false}}).status,'unknown');
 assert.equal(identify({componentSetKey:family,variantProperties:{BlurEffect:'default'}}).status,'unknown');
 // State on a parent does not suppress a separately supplied legacy nested instance.
 assert.equal(identify({componentSetKey:local}).status,'legacy');
 for(const condition of [false,null,{property,equals:'True',variantValues:{}},
  {property,equals:'False',variantValues:{[unrelated]:'maybe'}}]){
  f.config.families[0].variantCondition=condition;
  assert.throws(()=>compileLegacyComponents(f.bytes(),f.config),/CONFIG_INVALID/);
 }
 f.config.families[0].variantCondition={property,equals:'False',variantValues:{[variant]:'False'}};
 f.payload.components.rows[variant].componentKey=unrelated;
 assert.throws(()=>compileLegacyComponents(f.bytes(),f.config),/IDENTITY_CONFLICT/);
});

test('ResultScreen-style condition treats a confirmed absent property as False, but not an unreadable property bundle',()=>{
 const f=fixture(),property='👻 LiquidGlassEffect';
 f.config.families[0].variantCondition={property,equals:'False',missingPropertyValue:'False',variantValues:{}};
 const registry=compileLegacyComponents(f.bytes(),f.config);
 const identify=properties=>identifyLegacyComponent(registry,{platform:'iOS',componentSetKey:family,variantProperties:properties});
 assert.equal(identify({}).status,'legacy');
 assert.equal(identify({BlurEffect:'default'}).status,'legacy');
 assert.equal(identify({[property]:'False'}).status,'legacy');
 assert.equal(identify({[property]:'True'}).status,'not-applicable');
 for(const unavailable of [undefined,null,[]])assert.equal(identify(unavailable).status,'unknown');
 assert.equal(identifyLegacyComponent(registry,{platform:'iOS',mainComponentKey:unrelated,variantProperties:{}}).status,'unknown');
 assert.equal(identifyLegacyComponent(registry,{platform:'Android',componentSetKey:family,variantProperties:{}}).status,'not-applicable');
 f.config.families[0].variantCondition.missingPropertyValue='True';
 assert.throws(()=>compileLegacyComponents(f.bytes(),f.config),/CONFIG_INVALID/);
});

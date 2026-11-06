'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createIdentityRouter,identityKeys,HUB,METADATA}=require('../src/figma-audit/routing');
function fixture(extra={}){
 const base=HUB+'products/ab/components/unseen/';
 const data=new Map([
  [METADATA[0],{schemaVersion:2,packages:[{componentKey:'synthetic.unseen',packageName:'Unseen',packagePath:'components/unseen',figmaKeys:['set','variant','inner']}],components:{set:'synthetic.unseen',variant:'synthetic.unseen',inner:'synthetic.unseen'}}],
  [METADATA[1],{routes:[{patternId:'pattern:unseen',components:['Unseen']}]}],
  [METADATA[2],{schemaVersion:1,units:[]}],[METADATA[3],{schemaVersion:1,nodes:[],edges:[]}],
  [base+'meta.json',{id:'Unseen'}],[base+'figma-keys.json',{components:{public:{componentKey:'set',defaultVariant:{componentKey:'variant'}}}}],
  [HUB+'core/ios/components/unseen/meta.json',{id:'Unseen'}],[HUB+'core/ios/components/unseen/figma-keys.json',{components:{public:{componentKey:'set'}}}]
 ]);
 for(const [id,value]of extra.data||[])data.set(id,value);
 const calls=[],router=createIdentityRouter({readJson:id=>data.get(id),resourceIds:[...data.keys()],selectDocuments:args=>{calls.push(args);return extra.selectDocuments?extra.selectDocuments(args):{requiredSources:[],candidateSources:[],gaps:[]};}});
 return {router,calls,data};
}
test('unseen renamed instance resolves exact variant/set keys and delegates explicit patterns, without mobile collision',()=>{
 const f=fixture(),result=f.router([{id:'instance',name:'Button MISLEADING',main:{id:'master',key:'variant',set:{key:'set'}}}]);
 assert.equal(result.subjects[0].componentId,'Unseen');assert.equal(result.subjects[0].proof,'observed-published-key');assert.equal(result.gaps.length,0);assert.deepEqual(f.calls[0].componentIds,['Unseen']);assert.deepEqual(f.calls[0].patternIds,['pattern:unseen']);assert.equal(f.calls[0].target,'figma');assert(!result.subjects[0].metadata.some(id=>id.includes('ios')));
});
test('inner published identity can use a unique shared package key proof, never name aliases',()=>{
 const f=fixture(),result=f.router([{id:'part',main:{key:'inner'}}]);assert.equal(result.subjects[0].proof,'shared-package-published-key');
 const unknown=f.router([{id:'unknown',name:'Unseen',main:{key:'not-indexed'}}]);assert.equal(unknown.subjects.length,0);assert.equal(unknown.gaps[0].code,'IDENTITY_UNMAPPED');
});
test('ambiguous Hub ownership and conflicting variant/set owners remain explicit gaps',()=>{
 const other=HUB+'core/web/components/other/',f=fixture({data:[[other+'meta.json',{id:'Unseen'}],[other+'figma/keys.json',{components:{root:{componentSetKey:'set'}}}]]});
 assert.equal(f.router([{id:'a',main:{key:'set'}}]).gaps[0].code,'HUB_FAMILY_AMBIGUOUS');
 const index=f.data.get(METADATA[0]);index.components.variant='different';assert.equal(f.router([{id:'b',main:{key:'variant',set:{key:'set'}}}]).gaps[0].code,'IDENTITY_AMBIGUOUS');
});
test('missing keys/Hub metadata and unsupported index schemas cannot become an invented family',()=>{
 const f=fixture();assert.equal(f.router([{id:'missing',main:null}]).gaps[0].code,'IDENTITY_UNAVAILABLE');
 f.data.get(METADATA[0]).packages[0].figmaKeys=[];
 assert.equal(f.router([{id:'inner',main:{key:'inner'}}]).gaps[0].code,'HUB_FAMILY_MISSING');
 assert.throws(()=>fixture({data:[[METADATA[0],{schemaVersion:999}]]}),{code:'AUDIT_DATA_REQUIRED'});
 assert.deepEqual(identityKeys({componentIdentity:{key:'v',setKey:'s'}}),['s','v']);
});

test('shared trigger key is disambiguated only by indexed canonical owner plus published-key proof',()=>{
 const other=HUB+'core/web/components/wrapper/',f=fixture({data:[[other+'meta.json',{id:'Wrapper'}],[other+'figma/keys.json',{components:{trigger:{componentSetKey:'set'}}}]]});
 f.data.get(METADATA[0]).packages[0].packageName='Unseen';
 const result=f.router([{id:'button',name:'Wrapper',main:{key:'set'}}]);assert.equal(result.gaps.length,0);assert.equal(result.subjects[0].componentId,'Unseen');assert.equal(result.subjects[0].ownerName,'Unseen');
});

test('actual selector never receives a singleton foreign family sharing the observed published key',()=>{
 const {selectHubDocuments}=require('../src/knowledge-routing/hub-documents'),base=HUB+'products/ab/components/unseen/',f=fixture({selectDocuments:selectHubDocuments,data:[[base+'meta.json',{id:'PickerButton',source:{package:'components/picker-button'}}],[base+'guidelines.md','Synthetic.'],[base+'adapter.figma.md','Synthetic.'],[METADATA[2],{schemaVersion:1,units:[{id:'PickerButton',path:'products/ab/components/unseen/guidelines.md',platforms:['web'],targets:[]},{id:'PickerButton.adapter.figma',path:'products/ab/components/unseen/adapter.figma.md',platforms:['web'],targets:['figma']}]}]]});
 const owner=f.data.get(METADATA[0]).packages[0];owner.packageName='Button';owner.packagePath='components/button';
 const result=f.router([{id:'selected',name:'PickerButton',main:{key:'set'}}]);assert.equal(result.subjects.length,0);assert.equal(result.gaps[0].code,'HUB_OWNER_MISMATCH');assert.deepEqual(result.requiredSources,[]);assert.deepEqual(f.calls[0].componentIds,[]);
});
test('every direct/shared-package candidate needs positive owner proof and cannot contradict explicit source provenance',()=>{
 for(const mode of ['contradictory-source','missing-owner','foreign-id']){
  const meta={id:mode==='foreign-id'?'Foreign':'Unseen'};if(mode==='contradictory-source')meta.source={package:'components/foreign'};
  const f=fixture({data:[[HUB+'products/ab/components/unseen/meta.json',meta]]}),owner=f.data.get(METADATA[0]).packages[0];
  if(mode==='missing-owner'){delete owner.packageName;delete owner.packagePath;}
  for(const key of ['set','inner']){const result=f.router([{id:mode+'-'+key,main:{key}}]);assert.equal(result.subjects.length,0,mode);assert.equal(result.gaps[0].code,'HUB_OWNER_MISMATCH');}
 }
 const base=HUB+'products/ab/components/unseen/meta.json',f=fixture({data:[[base,{id:'Unseen',source:{package:'JSONS/components/unseen'}}]]}),result=f.router([{id:'owned',main:{key:'set'}}]);assert.equal(result.subjects[0].componentId,'Unseen');assert.equal(result.gaps.length,0);
 const foreign=fixture({data:[[base,{id:'Foreign',source:{package:'components/unseen'}}]]});assert.equal(foreign.router([{id:'alias',main:{key:'set'}}]).gaps[0].code,'HUB_OWNER_MISMATCH');
});

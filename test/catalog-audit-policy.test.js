const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildIndex,readPackagedPolicy}=require('../src/style-token-catalog/audit-policy');
const {digest,sha256}=require('../src/style-token-catalog/protocol');
const key='a'.repeat(40),policy={schemaVersion:1,rawTypography:{rules:[{id:'status',nodeName:'Label',reasonCode:'variant-owned-text-case',componentKeys:[key],ancestorPath:[]}]}};
const input=()=>({snapshotId:digest('snapshot'),sources:[{path:'JSONS/styles/known.json',sha256:digest('source')}],catalogs:[{kind:'styles',catalog:{styles:[{key,type:'paint'}]}},{kind:'tokens',catalog:{collections:[{variables:[{key,resolvedType:'COLOR'}]}]}}],policy,paintComponents:[{catalog:{kind:'component-index',library:'Icons',components:[{key,variants:[{key:'b'.repeat(40)}]}]}}]});
test('V3 compact policy retains typed catalog membership and exact paint component keys',()=>{
 const x=buildIndex(input());assert.deepEqual(x.resources,[{kind:'style',key,type:'PAINT'},{kind:'variable',key,type:'COLOR'}]);assert.deepEqual(x.paintComponentKeys,[key,'b'.repeat(40)]);assert.equal(x.rawTypography[0].id,'status');
 const data=Object.assign({},x);delete data.indexId;assert.equal(digest(data),x.indexId);
});
test('conflicting catalog types stay ambiguous; invalid catalog keys and unscoped exceptions fail closed',()=>{
 let x=input();x.catalogs.push({kind:'styles',catalog:{styles:[{key,type:'text'}]}});assert.equal(buildIndex(x).resources[0].type,null);
 x=input();x.catalogs[0].catalog.styles[0].key='bad';assert.throws(()=>buildIndex(x),{code:'AUDIT_POLICY_CATALOG_INVALID'});
 x=input();x.policy={schemaVersion:1,rawTypography:{rules:[Object.assign({},policy.rawTypography.rules[0],{componentKeys:[]})]}};assert.throws(()=>buildIndex(x),{code:'AUDIT_POLICY_INVALID'});
});
test('packaged V3 policy reads only manifest-pinned inputs; missing indexes, policy drift and library spoof fail closed',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-catalog-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const artifacts=[],put=(relative,value)=>{const bytes=Buffer.from(JSON.stringify(value)),file=path.join(root,'data/design-system_ab',relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);artifacts.push({path:'data/design-system_ab/'+relative,sha256:sha256(bytes),size:bytes.length});return file;};
 const ref={apollo:{auditPolicyConfigPath:'apollo/auditPolicies.json'},libraries:['Icons','Logotypes'].map((name,i)=>({name,catalogs:[{source:{kind:'components',indexPath:'indexes/'+(i?'logotypes':'icons')+'/one.index.json'}}]}))};
 ref.libraries[0].catalogs.push({path:'tokens/icons.json',source:{kind:'tokens'}});
 put('JSONS/referenceSourcesMVP.json',ref);const policyFile=put('JSONS/apollo/auditPolicies.json',policy);for(const lib of ref.libraries)put('JSONS/'+lib.catalogs[0].source.indexPath,{kind:'component-index',library:lib.name,components:[{key}]});
 const bytes=Buffer.from(JSON.stringify({artifacts}));fs.writeFileSync(path.join(root,'manifest.json'),bytes);
 const snapshot={snapshotId:digest('snapshot'),knowledge:{manifestSha256:sha256(bytes)},sources:new Map([['source',{id:'design-system_ab/JSONS/styles/known.json',kind:'styles',availability:'available',sha256:digest('source')}]]),rawCatalogs:new Map([['design-system_ab/JSONS/styles/known.json',{styles:[{key,type:'paint'}]}]]),assertFresh:()=>{}};
 assert.equal(readPackagedPolicy(root,snapshot).resources.length,1);
 fs.writeFileSync(policyFile,'{}');assert.throws(()=>readPackagedPolicy(root,snapshot));
 fs.writeFileSync(policyFile,JSON.stringify(policy));fs.rmSync(path.join(root,'data/design-system_ab/JSONS/indexes/icons/one.index.json'));assert.throws(()=>readPackagedPolicy(root,snapshot));
});
test('knowledge collection includes the complete compact policy input without raw icon catalogs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-policy-files-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 put('JSONS/apollo/indexes/componentContractIndex.json',{schemaVersion:2,packages:[]});put('JSONS/referenceSourcesMVP.json',{});put('JSONS/indexes/icons/one.index.json',{});put('JSONS/indexes/logotypes/one.index.json',{});put('JSONS/icons/private-big.json',{});
 const files=await require('../scripts/build-knowledge-package').collectDesignSystemFiles(root);
 for(const file of ['JSONS/referenceSourcesMVP.json','JSONS/indexes/icons/one.index.json','JSONS/indexes/logotypes/one.index.json'])assert(files.includes(file));assert(!files.includes('JSONS/icons/private-big.json'));
});

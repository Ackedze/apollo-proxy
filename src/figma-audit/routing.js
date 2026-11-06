'use strict';
const VERSION='component-documents-v1',HUB='knowledge/data/ds-ai-hub/';
const METADATA=[
 'knowledge/data/design-system_ab/JSONS/apollo/indexes/componentContractIndex.json',
 'knowledge/data/design-system_ab/apollo/pattern-registry.json',
 HUB+'registry/index.json',HUB+'products/ab/knowledge-graph.json'
];
const keyFields=new Set(['componentKey','componentSetKey']);
const supported=id=>typeof id==='string'&&/^(products\/ab\/components|core\/web\/components)\/[a-z0-9-]+\/(?:meta\.json|figma-keys\.json|figma\/keys\.json)$/.test(id);
function publishedKeys(value,result=new Set()){
 if(value&&typeof value==='object')for(const [field,child]of Object.entries(value)){
  if(keyFields.has(field)&&typeof child==='string'&&child)result.add(child);
  else if(child&&typeof child==='object')publishedKeys(child,result);
 }return result;
}
function identityKeys(node){return [...new Set([node.main?.key,node.main?.set?.key,node.componentIdentity?.key,node.componentIdentity?.setKey].filter(v=>typeof v==='string'&&v))].sort();}
function createIdentityRouter({readJson,resourceIds,selectDocuments}){
 const [index,patterns,registry,graph]=METADATA.map(readJson);
 if(index?.schemaVersion!==2||!Array.isArray(index.packages)||!index.components||!Array.isArray(patterns?.routes)||registry?.schemaVersion!==1||!Array.isArray(registry.units)||graph?.schemaVersion!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Object.assign(Error('AUDIT_DATA_REQUIRED'),{code:'AUDIT_DATA_REQUIRED',status:503});
 if(index.packages.some(p=>typeof p?.componentKey!=='string'||!Array.isArray(p.figmaKeys))||new Set(index.packages.map(p=>p.componentKey)).size!==index.packages.length)throw Object.assign(Error('AUDIT_DATA_REQUIRED'),{code:'AUDIT_DATA_REQUIRED',status:503});
 const packages=new Map(index.packages.map(p=>[p.componentKey,p])),families=[];
 for(const id of resourceIds.filter(id=>id.startsWith(HUB)&&supported(id.slice(HUB.length))&&id.endsWith('/meta.json')).sort()){
  const meta=readJson(id),base=id.slice(0,-'meta.json'.length),keyId=[base+'figma-keys.json',base+'figma/keys.json'].find(p=>resourceIds.includes(p));
  if(typeof meta?.id!=='string'||!keyId)continue;
  families.push({id:meta.id,sourcePackage:meta.source?.package,metaId:id,keyId,keys:publishedKeys(readJson(keyId))});
 }
 return nodes=>{
  const subjects=[],gaps=[];
  for(const node of nodes){
   const keys=identityKeys(node),owners=[...new Set(keys.map(k=>index.components[k]).filter(Boolean))];
   const gap=(code,reason)=>gaps.push({code,nodeId:node.id,reason});
   if(!keys.length){gap('IDENTITY_UNAVAILABLE','Нет опубликованного ключа компонента.');continue;}
   if(owners.length!==1||!packages.has(owners[0])){gap(owners.length>1?'IDENTITY_AMBIGUOUS':'IDENTITY_UNMAPPED','Ключи не определяют единственного владельца в индексе.');continue;}
   const owner=packages.get(owners[0]);
   let matches=families.filter(f=>keys.some(k=>f.keys.has(k)));
   const proof=matches.length?'observed-published-key':'shared-package-published-key';
   if(!matches.length)matches=families.filter(f=>(owner.figmaKeys||[]).some(k=>f.keys.has(k)));
   if(matches.length){
    const owned=matches.filter(f=>{
     if(typeof owner.packageName!=='string'||f.id!==owner.packageName)return false;
     return f.sourcePackage===undefined||typeof owner.packagePath==='string'&&(f.sourcePackage===owner.packagePath||f.sourcePackage==='JSONS/'+owner.packagePath);
    });
    if(!owned.length){gap('HUB_OWNER_MISMATCH','Опубликованный ключ найден в Hub, но владелец семейства не подтверждён или противоречит индексу.');continue;}
    matches=owned;
   }
   if(matches.length!==1){gap(matches.length?'HUB_FAMILY_AMBIGUOUS':'HUB_FAMILY_MISSING','Нет единственного семейства Hub, подтверждённого опубликованными ключами.');continue;}
   subjects.push({nodeId:node.id,componentId:matches[0].id,packageId:owner.componentKey,keys,proof,ownerName:owner.packageName,metadata:[matches[0].metaId,matches[0].keyId]});
  }
  const componentIds=[...new Set(subjects.map(s=>s.componentId))].sort(),patternIds=[...new Set(patterns.routes.filter(r=>Array.isArray(r.components)&&r.components.some(id=>componentIds.includes(id))).map(r=>r.patternId))].sort();
  const selected=selectDocuments({units:registry.units,graph,availableIds:resourceIds,componentIds,patternIds,product:'ab',platform:'web',target:'figma'});
  return {version:VERSION,subjects,requiredSources:selected.requiredSources,candidateSources:selected.candidateSources,gaps:gaps.concat(selected.gaps),metadata:METADATA.slice()};
 };
}
module.exports={VERSION,HUB,METADATA,identityKeys,createIdentityRouter,publishedKeys};

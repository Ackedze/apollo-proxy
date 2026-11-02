'use strict';
const fs=require('node:fs'),path=require('node:path');
const {digest,KEY,fail}=require('./protocol');
const {pinnedFile}=require('./inventory');
const ROOT='data/design-system_ab/',REFERENCE='JSONS/referenceSourcesMVP.json';
const ROUTE='/v1/style-token-catalog/audit-policy';
const nativeType=type=>type==='paint'?'PAINT':type==='text'?'TEXT':['drop shadow','inner shadow','layer blur','background blur'].includes(type)?'EFFECT':null;
function typographyRules(policy){
  if(policy?.schemaVersion!==1||!Array.isArray(policy.rawTypography?.rules))fail('AUDIT_POLICY_INVALID',503);
  const seen=new Set();return policy.rawTypography.rules.map(r=>{
    if(!r||!['id','nodeName','reasonCode'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=500)
      ||seen.has(r.id)||!Array.isArray(r.componentKeys)||r.componentKeys.some(k=>!KEY.test(k))
      ||!Array.isArray(r.ancestorPath)||r.ancestorPath.some(n=>typeof n!=='string'||!n||n.length>500)
      ||!r.componentKeys.length&&!r.ancestorPath.length)fail('AUDIT_POLICY_INVALID',503);
    seen.add(r.id);return{id:r.id,nodeName:r.nodeName,reasonCode:r.reasonCode,componentKeys:r.componentKeys,ancestorPath:r.ancestorPath};
  });
}
function buildIndex({snapshotId,sources,catalogs,policy,paintComponents}){
  const resources=new Map();
  const add=(kind,key,type)=>{
    if(!KEY.test(key)||!type)fail('AUDIT_POLICY_CATALOG_INVALID',503);
    const id=kind+':'+key,old=resources.get(id);
    resources.set(id,{kind,key,type:old&&old.type!==type?null:type});
  };
  for(const source of catalogs){
    if(source.kind==='styles')for(const s of source.catalog.styles)add('style',s.key,nativeType(s.type));
    else for(const c of source.catalog.collections)for(const v of c.variables)add('variable',v.key,v.resolvedType);
  }
  const paintComponentKeys=new Set();for(const source of paintComponents){
    const c=source.catalog;
    if(c.kind!=='component-index'||!['Icons','Logotypes'].includes(c.library)||!Array.isArray(c.components))fail('AUDIT_POLICY_COMPONENT_INDEX_INVALID',503);
    for(const entry of c.components)for(const key of [entry.key,...(entry.variants||[]).map(v=>v.key)]){
      if(!KEY.test(key))fail('AUDIT_POLICY_COMPONENT_INDEX_INVALID',503);paintComponentKeys.add(key);
    }
  }
  const data={schemaVersion:'apollo.catalog-audit-policy.v1',snapshotId,sources:sources.slice().sort((a,b)=>a.path.localeCompare(b.path)),
    resources:Array.from(resources.values()).sort((a,b)=>(a.kind+':'+a.key).localeCompare(b.kind+':'+b.key)),
    paintComponentKeys:Array.from(paintComponentKeys).sort(),rawTypography:typographyRules(policy)};
  return Object.assign({indexId:digest(data)},data);
}
function readPackagedPolicy(packageRoot,snapshot){
  snapshot.assertFresh();
  const manifest=JSON.parse(pinnedFile(packageRoot,'manifest.json',snapshot.knowledge.manifestSha256,fs.statSync(path.join(packageRoot,'manifest.json')).size));
  const sources=[];
  const read=relative=>{
    const pin=manifest.artifacts.find(a=>a.path===ROOT+relative);if(!pin)fail('AUDIT_POLICY_NOT_PACKAGED',503);
    const value=JSON.parse(pinnedFile(packageRoot,pin.path,pin.sha256,pin.size));sources.push({path:relative,sha256:pin.sha256});return value;
  };
  const reference=read(REFERENCE),policyPath=reference.apollo?.auditPolicyConfigPath;
  if(typeof policyPath!=='string'||!/^apollo\/[^/]+\.json$/.test(policyPath))fail('AUDIT_POLICY_INVALID',503);
  const policy=read('JSONS/'+policyPath),paintComponents=[];
  const libraries=(reference.libraries||[]).filter(l=>['Icons','Logotypes'].includes(l.name));
  if(libraries.length!==2||new Set(libraries.map(l=>l.name)).size!==2)fail('AUDIT_POLICY_LIBRARY_SOURCE_MISSING',503);
  const paths=new Set();for(const lib of libraries){
    if(!Array.isArray(lib.catalogs)||!lib.catalogs.length)fail('AUDIT_POLICY_LIBRARY_SOURCE_MISSING',503);
    for(const row of lib.catalogs){if(row.source?.kind==='tokens')continue;if(row.source?.kind!=='components')fail('AUDIT_POLICY_INVALID',503);const p=row.source.indexPath;
      if(typeof p!=='string'||!/^indexes\/(icons|logotypes)\/[^/]+\.index\.json$/.test(p)||paths.has(p))fail('AUDIT_POLICY_INVALID',503);
      paths.add(p);const catalog=read('JSONS/'+p);if(catalog.library!==lib.name)fail('AUDIT_POLICY_COMPONENT_INDEX_INVALID',503);paintComponents.push({catalog});
    }
  }
  const catalogs=[];for(const s of snapshot.sources.values()){
    if(s.availability!=='available')fail('AUDIT_POLICY_CATALOG_UNAVAILABLE',503);
    sources.push({path:s.id.slice('design-system_ab/'.length),sha256:s.sha256});catalogs.push({kind:s.kind,catalog:snapshot.rawCatalogs.get(s.id)});
  }
  const index=buildIndex({snapshotId:snapshot.snapshotId,sources,catalogs,policy,paintComponents});snapshot.assertFresh();return index;
}
function mountAuditPolicyRoute(app,{designSystemRoot,getSnapshot}){
  const packageRoot=path.resolve(designSystemRoot,'../..');
  app.get(ROUTE,(req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    try{if(Object.keys(req.query).length)fail('QUERY_PARAMETERS_UNSUPPORTED');res.json(readPackagedPolicy(packageRoot,getSnapshot()));}
    catch(error){res.status(error.status||503).json({error:error.code||'AUDIT_POLICY_UNAVAILABLE'});}
  });
}
module.exports={ROUTE,buildIndex,readPackagedPolicy,mountAuditPolicyRoute};

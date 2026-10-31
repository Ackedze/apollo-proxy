'use strict';
const fs=require('node:fs'),path=require('node:path');
const {digest,canonical,KEY,fail}=require('./protocol');
const {pinnedFile}=require('./inventory');
const POLICY='data/design-system_ab/apollo/deprecated-style-policy.json';
const INDEX='data/design-system_ab/apollo/deprecated-styles.index.json';
const ROUTE='/v1/style-token-catalog/deprecated-styles';
const nativeType=type=>type==='paint'?'PAINT':type==='text'?'TEXT':['drop shadow','inner shadow','layer blur','background blur'].includes(type)?'EFFECT':null;
function buildIndex(policy,catalogs){
  if(policy?.schemaVersion!=='apollo.deprecated-style-policy.v1'||!Number.isSafeInteger(policy.version)||policy.version<1||!Number.isFinite(Date.parse(policy.createdAt))
    ||!Array.isArray(policy.deprecatedSources)||!policy.deprecatedSources.length||new Set(policy.deprecatedSources).size!==policy.deprecatedSources.length)fail('DEPRECATED_STYLE_POLICY_INVALID',503);
  const paths=new Set(catalogs.map(c=>c.path));
  if(policy.deprecatedSources.some(p=>!/^JSONS\/styles\/[^/]+\.json$/.test(p)||!paths.has(p)))fail('DEPRECATED_STYLE_SOURCE_MISSING',503);
  const deprecated=new Set(policy.deprecatedSources),byKey=new Map();
  for(const source of catalogs.slice().sort((a,b)=>a.path<b.path?-1:1)){
    if(!Array.isArray(source.catalog.styles))fail('INVALID_STYLE_SOURCE',503);
    for(const style of source.catalog.styles){
      const type=nativeType(style.type);
      if(!KEY.test(style.key)||!type||typeof style.name!=='string'||!style.name||style.name.length>500)fail('INVALID_STYLE_SOURCE',503);
      if(!byKey.has(style.key))byKey.set(style.key,[]);
      byKey.get(style.key).push({type,name:style.name,library:source.catalog.meta?.library||source.path,sourceId:source.path,deprecated:deprecated.has(source.path)});
    }
  }
  const styles=[];
  for(const [key,rows]of byKey){
    if(!rows.some(r=>r.deprecated))continue;
    const types=Array.from(new Set(rows.map(r=>r.type))),ambiguous=rows.some(r=>!r.deprecated)||types.length!==1;
    styles.push({key,type:types.length===1?types[0]:null,name:rows[0].name,library:rows[0].library,status:ambiguous?'ambiguous':'deprecated',sourceIds:Array.from(new Set(rows.map(r=>r.sourceId))).sort()});
  }
  styles.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const data={schemaVersion:'apollo.deprecated-styles.v1',policyVersion:policy.version,createdAt:policy.createdAt,policySha256:digest(policy),sources:catalogs.map(c=>({path:c.path,sha256:c.sha256})).sort((a,b)=>a.path<b.path?-1:1),styles};
  return Object.assign({indexId:digest(data)},data);
}
function writePackagedIndex(packageRoot){
  const policyPath=path.join(packageRoot,POLICY),indexPath=path.join(packageRoot,INDEX);
  // Older packages/fixtures do not claim a deprecation check.
  if(!fs.existsSync(policyPath)){fs.rmSync(indexPath,{force:true});return null;}
  const dir=path.join(packageRoot,'data/design-system_ab/JSONS/styles');
  const catalogs=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort().map(name=>{
    const bytes=fs.readFileSync(path.join(dir,name));
    return{path:'JSONS/styles/'+name,sha256:require('./protocol').sha256(bytes),catalog:JSON.parse(bytes)};
  });
  const index=buildIndex(JSON.parse(fs.readFileSync(policyPath)),catalogs);
  fs.rmSync(indexPath,{force:true});
  fs.writeFileSync(indexPath,JSON.stringify(index)+'\n');return index;
}
function readPackagedIndex(packageRoot,snapshot){
  snapshot.assertFresh();
  const manifest=JSON.parse(pinnedFile(packageRoot,'manifest.json',snapshot.knowledge.manifestSha256,fs.statSync(path.join(packageRoot,'manifest.json')).size));
  const read=relative=>{const pin=manifest.artifacts.find(a=>a.path===relative);if(!pin)fail('DEPRECATED_STYLE_INDEX_NOT_PACKAGED',503);return JSON.parse(pinnedFile(packageRoot,pin.path,pin.sha256,pin.size));};
  const policy=read(POLICY),index=read(INDEX),catalogs=[];
  for(const source of snapshot.sources.values())if(source.kind==='styles'&&source.availability==='available')catalogs.push({path:source.id.slice('design-system_ab/'.length),sha256:source.sha256,catalog:snapshot.rawCatalogs.get(source.id)});
  if(canonical(index)!==canonical(buildIndex(policy,catalogs)))fail('DEPRECATED_STYLE_INDEX_MISMATCH',409);
  snapshot.assertFresh();return index;
}
function mountDeprecatedStyleRoutes(app,{designSystemRoot,getSnapshot}){
  const packageRoot=path.resolve(designSystemRoot,'../..');
  app.get(ROUTE,(req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    try{if(Object.keys(req.query).length)fail('QUERY_PARAMETERS_UNSUPPORTED');res.json(readPackagedIndex(packageRoot,getSnapshot()));}
    catch(error){res.status(error.status||503).json({error:error.code||'DEPRECATED_STYLE_INDEX_UNAVAILABLE'});}
  });
}
module.exports={POLICY,INDEX,ROUTE,buildIndex,writePackagedIndex,readPackagedIndex,mountDeprecatedStyleRoutes};

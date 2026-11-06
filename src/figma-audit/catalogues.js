'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonical}=require('../audit-data/protocol');
const PROFILE='component-customizations-v1';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const paths=['/Web _ Core -- Button.json','/Web _ Corp Components -- TitleView.json'];
function styleKey(value){return typeof value==='string'?value.replace(/^S:/,'').split(',')[0]:undefined;}
function technicalNode(node){
 const result={};
 for(const key of ['id','parentId','path','type','name','visible','styles','layout','text','fills','strokes','fillToken','strokeToken','strokeWeight','strokeAlign','radius','opacity','effects','componentInstance','typographyToken','layoutSizingHorizontal','layoutSizingVertical'])if(Object.hasOwn(node,key))result[key]=clone(node[key]);
 return result;
}
// Athena patch consumption only. Norms and admissibility never enter this reader.
function selectedStructure(component,key){
 const variant=component.variants?.find(v=>v.key===key);
 if(!variant||!Array.isArray(component.structure)||!component.structure.length)fail('AUDIT_CATALOGUE_VARIANT_UNAVAILABLE');
 const patches=component.variantStructures?.[key];
 if(!Array.isArray(patches)&&key!==component.defaultVariant)fail('AUDIT_CATALOGUE_VARIANT_UNAVAILABLE');
 const rows=clone(component.structure),byId=new Map(rows.map(n=>[n.id,n]));
 if(byId.size!==rows.length)fail('AUDIT_CATALOGUE_AMBIGUOUS');
 for(const patch of patches||[]){
  if(patch.op==='update'&&byId.has(patch.id)&&patch.value&&typeof patch.value==='object')Object.assign(byId.get(patch.id),clone(patch.value));
  else if(patch.op==='remove'&&byId.has(patch.id)){byId.delete(patch.id);rows.splice(rows.findIndex(n=>n.id===patch.id),1);}
  else if(patch.op==='add'&&patch.node&&!byId.has(patch.node.id)){const node=clone(patch.node);rows.push(node);byId.set(node.id,node);}
  else fail('AUDIT_CATALOGUE_PATCH_INVALID');
 }
 const root=rows.find(n=>!n.path?.includes(' / '))||rows[0],prefix=root?.path;
 if(typeof variant.name!=='string'||!variant.name||!prefix)fail('AUDIT_CATALOGUE_VARIANT_UNAVAILABLE');
 for(const row of rows)if(row.path===prefix)row.path=variant.name;else if(row.path?.startsWith(prefix+' /'))row.path=variant.name+row.path.slice(prefix.length);
 return rows.map(technicalNode);
}
function createCatalogueBaselines({knowledgeRoot,reader=require('../audit-data/reader').createAuditDataReader({knowledgeRoot}),maxBytes=400000}){
 const root=path.resolve(knowledgeRoot),decoded=new Map(),projections=new Map(),pins=new Map();let manifest=null;
 function pin(relative,expected){
  const target=path.join(root,relative);
  if(!target.startsWith(root+path.sep)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))fail('AUDIT_CATALOGUE_PATH_INVALID');
  const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target)fail('AUDIT_CATALOGUE_STALE');
  const bytes=fs.readFileSync(target),value={bytes:bytes.length,sha256:sha(bytes)};
  if(expected&&(value.bytes!==expected.bytes||value.sha256!==expected.sha256))fail('AUDIT_CATALOGUE_STALE');
  pins.set(relative,value);return bytes;
 }
 function assertCurrent(){for(const [relative,value]of Array.from(pins))pin(relative,value);}
 async function open(){
  if(manifest){assertCurrent();return manifest;}
  pin('manifest.json');const actual=JSON.parse(pin('data/v3-audit/manifest.json'));
  const next=await reader.manifest();assertCurrent();
  if(actual.dataId!==next.dataId)fail('AUDIT_CATALOGUE_STALE');
  manifest=next;return manifest;
 }
 async function asset(row){
  assertCurrent();if(decoded.has(row.id))return decoded.get(row.id);
  const task=(async()=>{
   const stored=row.storage;if(!stored||typeof stored.path!=='string')fail('AUDIT_CATALOGUE_UNAVAILABLE');
   pin(stored.path,{bytes:stored.bytes,sha256:stored.sha256});
   const result=await reader.asset(manifest.dataId,row.id);assertCurrent();
   if(result.dataId!==manifest.dataId||result.fileId!==row.id||result.sha256!==row.sha256||typeof result.text!=='string'||Buffer.byteLength(result.text)!==row.bytes||sha(result.text)!==row.sha256)fail('AUDIT_CATALOGUE_STALE');
   let parsed;try{parsed=JSON.parse(result.text);}catch{fail('AUDIT_CATALOGUE_UNAVAILABLE');}
   return parsed;
  })();decoded.set(row.id,task);return task;
 }
 async function prepare(nodes,subjects,{platform='desktop'}={}){
  const targets=nodes.filter(n=>subjects.some(s=>s.nodeId===n.id&&['TitleView','Button'].includes(s.componentId))),references=new Map(),gaps=[];
  if(!targets.length)return {version:PROFILE,dataId:null,references:[],gaps:[{code:'PILOT_COMPONENTS_NOT_FOUND',reason:'В области не подтверждены семейства TitleView или Button.'}],evidence:[]};
  const document=await open(),files=[];
  const families=new Set(subjects.filter(s=>targets.some(n=>n.id===s.nodeId)).map(s=>s.componentId));
  for(const suffix of paths.filter((_,i)=>families.has(i===0?'Button':'TitleView'))){
   const matches=document.files.filter(file=>file.urls?.some(url=>{try{return decodeURIComponent(url).endsWith(suffix);}catch{return false;}}));
   if(matches.length!==1){gaps.push({code:'CATALOGUE_SOURCE_UNAVAILABLE',source:suffix});continue;}
   const row=matches[0],body=await asset(row);if(!Array.isArray(body.components))fail('AUDIT_CATALOGUE_UNAVAILABLE');files.push({row,body});
  }
  for(const target of targets){
   const key=target.main?.key,matches=[];
   for(const source of files)for(const component of source.body.components)if(Array.isArray(component.variants)&&component.variants.some(v=>v.key===key))matches.push({source,component});
   if(matches.length!==1){gaps.push({nodeId:target.id,code:matches.length?'CATALOGUE_VARIANT_AMBIGUOUS':'CATALOGUE_VARIANT_MISSING'});continue;}
   const {source,component}=matches[0];
   if(typeof component.platform!=='string'||component.platform.toLowerCase()!==String(platform).toLowerCase()){gaps.push({nodeId:target.id,code:'CATALOGUE_PLATFORM_MISMATCH'});continue;}
   if(target.main?.set?.key&&component.key!==target.main.set.key){gaps.push({nodeId:target.id,code:'CATALOGUE_FAMILY_MISMATCH'});continue;}
   const cacheKey=source.row.id+':'+component.key+':'+key;
   let projection=projections.get(cacheKey);
   if(!projection){
    let structure;try{structure=selectedStructure(component,key);}catch(error){if(!['AUDIT_CATALOGUE_VARIANT_UNAVAILABLE'].includes(error.code))throw error;gaps.push({nodeId:target.id,code:error.code});continue;}
    const variant=component.variants.find(v=>v.key===key),id='reference-'+sha(cacheKey).slice(0,48);
    const slice={key:component.key,name:component.name,defaultVariant:component.defaultVariant,structure:clone(component.structure),variants:[clone(variant)],variantStructures:{}};
    if(Array.isArray(component.variantStructures?.[key]))slice.variantStructures[key]=clone(component.variantStructures[key]);
    projection={id,dataId:document.dataId,fileId:source.row.id,sha256:source.row.sha256,sourceUrls:source.row.urls.slice(),componentKey:component.key,variantKey:key,platform:component.platform||null,component:slice,structureHash:sha(canonical(structure)),structure};
    projections.set(cacheKey,projection);
   }
   if(!references.has(projection.id))references.set(projection.id,Object.assign({},projection,{targetIds:[]}));
   references.get(projection.id).targetIds.push(target.id);
  }
  const refs=Array.from(references.values()),evidence=refs.map(ref=>({id:'catalogue-'+sha(ref.id).slice(0,48),kind:'catalogue',referenceId:ref.id,ownerIds:ref.targetIds.slice(),provenance:{dataId:ref.dataId,fileId:ref.fileId,sha256:ref.sha256,componentKey:ref.componentKey,variantKey:ref.variantKey,platform:ref.platform,freshness:'PINNED_PACKAGED_EXPORT'},result:{nodes:ref.structure.map(n=>({id:'catalogue-'+sha(ref.id+':'+n.id).slice(0,48),type:n.type,name:n.name,path:n.path,rawId:n.id,catalogue:technicalNode(n),unavailable:[]}))}}));
  const result={version:PROFILE,dataId:document.dataId,references:refs,gaps,evidence};
  if(Buffer.byteLength(JSON.stringify(result))>maxBytes*2)fail('AUDIT_CATALOGUE_BUDGET');
  assertCurrent();return result;
 }
 return {prepare,assertCurrent};
}
module.exports={PROFILE,createCatalogueBaselines,selectedStructure,technicalNode,styleKey};

'use strict';
const fs=require('node:fs'),path=require('node:path'),catalog=require('../skills/catalog'),releases=require('../data-release');
const {selectHubDocuments}=require('../knowledge-routing/hub-documents');
const {createSourcePlanner}=require('./source-plan');
const HUB='knowledge/data/ds-ai-hub/',POLICY='ds-ai-hub-only-v1';
const searchText=value=>value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const sha=catalog.sha;
const MAX_READ_BYTES=32768;
function pageResult(base,value,offset,limit){
 const array=Array.isArray(value),total=value.length,max=Math.min(limit,array?100:limit,Math.max(0,total-offset));
 const row=count=>Object.assign({},base,{next:offset+count<total?offset+count:null,total,returned:count,text:array?JSON.stringify(value.slice(offset,offset+count)):value.slice(offset,offset+count)});
 let low=0,high=max;
 while(low<high){const n=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(row(n)))<=MAX_READ_BYTES)low=n;else high=n-1;}
 if(!array&&low>0&&/[\uD800-\uDBFF]/.test(value[offset+low-1])&&/[\uDC00-\uDFFF]/.test(value[offset+low]||''))low--;
 if(!low&&max)return Object.assign({},base,{tooLarge:true,total,returned:0,next:null,availablePath:array?base.path.concat(String(offset)):base.path,hint:array?'One item exceeds the response budget. Read keys at availablePath, then read the needed child fields. No item was read.':'Select a narrower JSON path or read keys. No value was read.'});
 const result=row(low);if(Buffer.byteLength(JSON.stringify(result))>MAX_READ_BYTES)fail('LANDING_RESOURCE_INVALID');return result;
}
function readLandingSkill(root,id=catalog.LANDING_ID,manifest=null){
 if(!catalog.skillId(id))fail('LANDING_SKILL_UNAVAILABLE');root=path.resolve(root);const folder=path.join(root,'skills',id),pins=[];
 function read(file,expected){
  const target=path.join(folder,file);let bytes;
  try{const s=fs.lstatSync(target);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(target)!==target||s.size>65536)fail('LANDING_SKILL_UNAVAILABLE');bytes=fs.readFileSync(target);}catch{fail('LANDING_SKILL_UNAVAILABLE');}
  const outer=manifest?.files.find(pin=>pin.file==='skills/'+id+'/'+file);
  if(manifest&&!outer||outer&&(bytes.length!==outer.bytes||sha(bytes)!==outer.sha256)||expected&&(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256))fail('LANDING_SKILL_STALE');pins.push({file:target,sha256:sha(bytes)});return bytes;
 }
 const bytes=read('manifest.json'),descriptor=JSON.parse(bytes),files=catalog.packageFiles(bytes,id),bodies={};
 for(const pin of files)bodies[pin.path]=read(pin.path,pin).toString('utf8');
 if(!bodies['SKILL.md'].includes('version: "'+descriptor.version+'"'))fail('LANDING_SKILL_STALE');
 return {id,name:descriptor.name,description:descriptor.description,generation:descriptor.generation||null,version:descriptor.version,sha256:sha(bytes),bodies,assertCurrent(){for(const pin of pins){const stat=fs.lstatSync(pin.file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(pin.file)!==pin.file||sha(fs.readFileSync(pin.file))!==pin.sha256)fail('LANDING_SKILL_STALE');}}};
}
function openKnowledge({releaseRoot,runtimeRoot,skillId=catalog.LANDING_ID}){
 if(!path.isAbsolute(releaseRoot||'')||!path.isAbsolute(runtimeRoot||''))fail('LANDING_DATA_REQUIRED');
 const manifest=releases.readReleaseFiles(releaseRoot,runtimeRoot),skill=readLandingSkill(releaseRoot,skillId,manifest),manifestFile=path.join(releaseRoot,'manifest.json'),manifestBytes=fs.readFileSync(manifestFile),manifestHash=sha(manifestBytes),used=new Map(),resources=new Map();
 if(releases.idOf(JSON.parse(manifestBytes))!==manifest.id)fail('LANDING_DATA_STALE');
 for(const pin of manifest.files)if((pin.file.startsWith(HUB)||pin.file.startsWith('skills/'+skillId+'/'))&&/\.(json|md|yaml|yml|txt)$/.test(pin.file))resources.set(pin.file,{...pin});
 const workflowFile=path.join(runtimeRoot,'instructions/landing/figma-workflow.md');
 let workflow;try{workflow=fs.readFileSync(workflowFile,'utf8');}catch{fail('LANDING_WORKFLOW_REQUIRED');}
 const workflowHash=sha(Buffer.from(workflow)),parts=workflow.split(/^# Loaded workflow file: (.+)$/m);
 for(let i=1;i<parts.length;i+=2){const id='workflow/'+parts[i].trim(),text=parts[i+1].trim();resources.set(id,{file:id,sha256:sha(Buffer.from(text)),bytes:Buffer.byteLength(text),text});}
 const bootstrap=['workflow/figma-use/SKILL.md','workflow/figma-generate-design/SKILL.md'];
 if(bootstrap.some(id=>!resources.has(id)))fail('LANDING_WORKFLOW_REQUIRED');
 function assertCurrent(){
  if(sha(fs.readFileSync(manifestFile))!==manifestHash||sha(fs.readFileSync(workflowFile))!==workflowHash)fail('LANDING_DATA_STALE');skill.assertCurrent();
  for(const [file,pin]of used){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file||sha(fs.readFileSync(file))!==pin)fail('LANDING_DATA_STALE');}
 }
 function sourceText(pin){
  if(pin.text!==undefined)return pin.text;
  const file=path.join(releaseRoot,pin.file),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)fail('LANDING_RESOURCE_INVALID');
  const bytes=fs.readFileSync(file);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('LANDING_DATA_STALE');used.set(file,pin.sha256);return bytes.toString('utf8');
 }
 function read(request){
  const pin=resources.get(request?.id),mode=request?.mode||'read',offset=request?.offset??0,limit=request?.limit??12000,keys=request?.path||[];
  if(!pin||!['read','keys','summary'].includes(mode)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16000||!Array.isArray(keys)||keys.length>24||keys.some(k=>!['string','number'].includes(typeof k)||['__proto__','constructor','prototype'].includes(k)||(typeof k==='string'&&/(^|[\\/])\.\.($|[\\/])/.test(k))))fail('LANDING_RESOURCE_INVALID');
  assertCurrent();const text=sourceText(pin);
  const base={id:pin.file,sha256:pin.sha256,path:keys,mode,offset};if(Buffer.byteLength(JSON.stringify(base))>MAX_READ_BYTES-1024)fail('LANDING_RESOURCE_INVALID');let value;
  const invalid=(code,availablePath,allowedModes,hint)=>({...base,error:{code,availablePath,allowedModes,hint}});
  if(pin.file.endsWith('.json')){
   value=JSON.parse(text);for(let i=0;i<keys.length;i++){const key=keys[i];if(value===null||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,key))return {id:pin.file,sha256:pin.sha256,path:keys,mode,offset,error:{code:'LANDING_RESOURCE_PATH_INVALID',availablePath:keys.slice(0,i),hint:'Read keys at availablePath, then select an observed key. This read failed; no asset was selected.'}};value=value[key];}
   if(mode==='summary'){
    return invalid('LANDING_RESOURCE_MODE_INVALID',keys,['read','keys'],'Hub JSON supports read and keys. Read observed child fields; no source body was read.');
   }
   if(mode==='keys')value=Array.isArray(value)?value.map((_,i)=>i):value&&typeof value==='object'?Object.keys(value):[];
   if(Array.isArray(value))return pageResult(base,value,offset,limit);
   if(offset!==0)return invalid('LANDING_RESOURCE_RANGE_INVALID',keys,['read','keys'],'This JSON value is not an array. Read it with offset=0, or select an observed array child.');
   const result=Object.assign({},base,{next:null,total:null,text:JSON.stringify(value)});
   if(Buffer.byteLength(JSON.stringify(result))>MAX_READ_BYTES)return Object.assign({},base,{tooLarge:true,returned:0,next:null,total:null,availablePath:keys,hint:'Read keys at availablePath and select needed fields. No value was read.'});
   return result;
  }
  if(keys.length||mode!=='read')return invalid(mode!=='read'?'LANDING_RESOURCE_MODE_INVALID':'LANDING_RESOURCE_PATH_INVALID',[],['read'],'Read this text document with mode=read and path=[]. offset/limit are character ranges; follow next. No source body was read.');return pageResult(base,text,offset,limit);
 }
 function routing(query){
  const match=query.match(/^(?:knowledge\/data\/ds-ai-hub\/)?((?:products\/([a-z0-9-]+)|core\/web)\/components\/[a-z0-9-]+)\/?$/);
  if(!match)return null;
  const prefix=HUB+match[1]+'/',metadataSources=[],gaps=[];
  function metadata(id){
   const pin=resources.get(id);if(!pin){gaps.push({code:'HUB_ROUTING_SOURCE_NOT_PACKAGED',id,reason:'Routing metadata is absent from the installed Hub projection.'});return null;}
   const text=sourceText(pin);metadataSources.push({id,sha256:pin.sha256,purpose:'navigation-not-norm-read'});
   try{return JSON.parse(text);}catch{gaps.push({code:'HUB_ROUTING_METADATA_INVALID',id,reason:'Routing metadata is not valid JSON.'});return null;}
  }
  const meta=metadata(prefix+'meta.json'),registry=metadata(HUB+'registry/index.json'),graph=metadata(HUB+'products/'+(match[2]||'ab')+'/knowledge-graph.json');
  if(registry!==null&&!Array.isArray(registry?.units))gaps.push({code:'HUB_ROUTING_METADATA_INVALID',id:HUB+'registry/index.json',reason:'Registry units are not an array.'});
  if(graph!==null&&!Array.isArray(graph?.edges))gaps.push({code:'HUB_ROUTING_METADATA_INVALID',id:HUB+'products/'+(match[2]||'ab')+'/knowledge-graph.json',reason:'Graph edges are not an array.'});
  const componentIds=typeof meta?.id==='string'&&meta.id?[meta.id]:[],edges=Array.isArray(graph?.edges)?graph.edges.slice():[];
  for(const id of Array.isArray(meta?.relatedPatterns)?meta.relatedPatterns:[])if(typeof id==='string')edges.push({from:meta.id,kind:'related-pattern',targetType:'knowledge-unit',target:id});
  const selection=Array.isArray(registry?.units)?selectHubDocuments({units:registry.units,graph:{edges},availableIds:[...resources.keys()],componentIds,product:match[2]||'ab',platform:'web',target:'figma'}):{requiredSources:[],candidateSources:[],gaps:[]};
  if(!componentIds.length)gaps.push({code:'HUB_COMPONENT_ID_MISSING',id:prefix+'meta.json',reason:'The component package has no declared canonical identity.'});
  const technicalSources=[...resources.keys()].filter(id=>id.startsWith(prefix)&&/\/(?:meta\.json|figma-keys\.json|figma\/(?:keys|model)\.json)$/.test(id)).map(id=>({id,reasons:['component-technical-data']}));
  return {releaseId:manifest.id,policy:POLICY,metadataSources,...selection,technicalSources,gaps:gaps.concat(selection.gaps)};
 }
 function list(query='',offset=0){
  if(typeof query!=='string'||query.length>256||!Number.isSafeInteger(offset)||offset<0)fail('LANDING_RESOURCE_INVALID');
  assertCurrent();const words=query.split(/\s+/).map(searchText).filter(Boolean),rows=query.trim()&&!words.length?[]:Array.from(resources.values()).filter(pin=>words.every(word=>searchText(pin.file).includes(word))).sort((a,b)=>a.file.localeCompare(b.file)),route=offset===0?routing(query):null;
  return {query,offset,total:rows.length,next:offset+64<rows.length?offset+64:null,resources:rows.slice(offset,offset+64).map(({file,bytes,sha256})=>({id:file,bytes,sha256,capabilities:{modes:file.endsWith('.json')?['read','keys']:['read'],pathItems:'string'}})),...(route?{routing:route}:{})};
 }
 const base='knowledge/data/ds-ai-hub/',legacyRequired=['AGENTS.md','products/ab/manifest.json','products/ab/patterns/landing-pages.md','products/ab/patterns/business-segment-styles.md','products/ab/patterns/draft-layout.md'].map(file=>base+file);
 const required=skill.generation?[...new Set([base+'AGENTS.md',...skill.generation.requiredResources])]:legacyRequired;
 if(required.some(id=>!id.startsWith(HUB)))fail('LANDING_KNOWLEDGE_POLICY_INVALID');
 if(required.some(id=>!resources.has(id)))fail('LANDING_REQUIRED_KNOWLEDGE_MISSING');
 const norms=[];
 for(const id of required.concat(['README.md'].map(file=>base+file).filter(id=>resources.has(id)))){
  let offset=0;do{const row=read({id,offset,limit:16000});if(row.tooLarge)fail('LANDING_REQUIRED_KNOWLEDGE_MISSING');norms.push(row);offset=row.next;}while(offset!==null);
 }
 const assetSources={};
 for(const [role,match] of Object.entries({glyph26Metadata:id=>id===HUB+'core/web/assets/assets_glyph-26.json',hubAssets:id=>id.startsWith(HUB+'core/web/assets/')||id.startsWith(HUB+'products/ab/assets/'),hubTokens:id=>id.startsWith(HUB+'core/web/tokens/')||id.startsWith(HUB+'core/common/tokens/')})){const ids=[...resources.keys()].filter(match).sort();assetSources[role]={available:ids.length>0,ids};}
 const instructions=skill.generation?Object.fromEntries(skill.generation.initialFiles.map(file=>[file,skill.bodies[file]])):skill.bodies;
 const resumePin=sha(Buffer.from(JSON.stringify([manifestHash,workflowHash,skill.sha256,POLICY])));
 const plan=createSourcePlanner({resources,skill,sourcePin:resumePin,releaseId:manifest.id,metadata:id=>JSON.parse(sourceText(resources.get(id))),routing,assertCurrent});
 return {id:manifest.id,knowledgeVersion:manifest.knowledgeVersion,skill,resumePin,assertCurrent,read,list,plan,
  initial:{knowledgePolicy:POLICY,assetSources,selectedSkill:{id:skill.id,name:skill.name,resourcesRoot:'skills/'+skill.id+'/'},hostInstructions:skill.generation?skill.generation.hostInstructions:'Read hub manifest, landing-pages, business-segment-styles, draft-layout and CorporateContent rules. Tag the CorporateContent instance role=host in apollolanding.',skillVersion:skill.version,skillHash:skill.sha256,knowledgeVersion:manifest.knowledgeVersion,releaseId:manifest.id,instructions,norms,workflow:bootstrap.map(id=>({id,text:resources.get(id).text})),resources:list(skill.generation?skill.generation.initialQueries[0]||'':'products/ab/patterns/'),indexes:skill.generation?.initialQueries.map(query=>list(query))||[]}};
}
module.exports={readLandingSkill,openKnowledge};

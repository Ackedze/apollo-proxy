'use strict';
const fs=require('node:fs'),path=require('node:path'),catalog=require('../skills/catalog'),releases=require('../data-release');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const sha=catalog.sha;
function readLandingSkill(root){
 root=path.resolve(root);const folder=path.join(root,'skills',catalog.LANDING_ID),pins=[];
 function read(file,expected){
  const target=path.join(folder,file);let bytes;
  try{const s=fs.lstatSync(target);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(target)!==target||s.size>65536)fail('LANDING_SKILL_UNAVAILABLE');bytes=fs.readFileSync(target);}catch{fail('LANDING_SKILL_UNAVAILABLE');}
  if(expected&&(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256))fail('LANDING_SKILL_STALE');pins.push({file:target,sha256:sha(bytes)});return bytes;
 }
 const bytes=read('manifest.json'),descriptor=JSON.parse(bytes),files=catalog.packageFiles(bytes,catalog.LANDING_ID),bodies={};
 for(const pin of files)bodies[pin.path]=read(pin.path,pin).toString('utf8');
 if(!bodies['SKILL.md'].includes('version: "'+descriptor.version+'"'))fail('LANDING_SKILL_STALE');
 return {version:descriptor.version,sha256:sha(bytes),bodies,assertCurrent(){for(const pin of pins){const stat=fs.lstatSync(pin.file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(pin.file)!==pin.file||sha(fs.readFileSync(pin.file))!==pin.sha256)fail('LANDING_SKILL_STALE');}}};
}
function openKnowledge({releaseRoot,runtimeRoot}){
 if(!path.isAbsolute(releaseRoot||'')||!path.isAbsolute(runtimeRoot||''))fail('LANDING_DATA_REQUIRED');
 const manifest=releases.readReleaseFiles(releaseRoot,runtimeRoot),skill=readLandingSkill(releaseRoot),manifestFile=path.join(releaseRoot,'manifest.json'),manifestHash=sha(fs.readFileSync(manifestFile)),used=new Map(),resources=new Map();
 for(const pin of manifest.files)if(/^(knowledge\/data\/(ds-ai-hub|design-system_ab)\/|contracts\/)/.test(pin.file)&&/\.(json|md|yaml|yml|txt)$/.test(pin.file))resources.set(pin.file,{...pin});
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
 function read(request){
  const pin=resources.get(request?.id),mode=request?.mode||'read',offset=request?.offset??0,limit=request?.limit??12000,keys=request?.path||[];
  if(!pin||!['read','keys'].includes(mode)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16000||!Array.isArray(keys)||keys.length>24||keys.some(k=>!['string','number'].includes(typeof k)||['__proto__','constructor','prototype'].includes(k)))fail('LANDING_RESOURCE_INVALID');
  assertCurrent();let text=pin.text;
  if(text===undefined){const file=path.join(releaseRoot,pin.file),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)fail('LANDING_RESOURCE_INVALID');const bytes=fs.readFileSync(file);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('LANDING_DATA_STALE');used.set(file,pin.sha256);text=bytes.toString('utf8');}
  let value,next=null,total;
  if(pin.file.endsWith('.json')){
   value=JSON.parse(text);for(const key of keys){if(!value||!Object.prototype.hasOwnProperty.call(value,key))fail('LANDING_RESOURCE_PATH_INVALID');value=value[key];}
   if(mode==='keys')value=Array.isArray(value)?value.map((_,i)=>i):value&&typeof value==='object'?Object.keys(value):[];
   if(Array.isArray(value)){total=value.length;const count=Math.min(limit,100);value=value.slice(offset,offset+count);next=offset+count<total?offset+count:null;}
   else if(offset!==0)fail('LANDING_RESOURCE_PATH_INVALID');
   text=JSON.stringify(value);if(Buffer.byteLength(text)>32768)return {id:pin.file,sha256:pin.sha256,path:keys,mode,offset,tooLarge:true,hint:'Request keys or a narrower JSON path/range.'};
  }else{if(keys.length||mode!=='read')fail('LANDING_RESOURCE_PATH_INVALID');total=text.length;text=text.slice(offset,offset+limit);next=offset+limit<total?offset+limit:null;}
  return {id:pin.file,sha256:pin.sha256,path:keys,mode,offset,next,total:total??null,text};
 }
 function list(query='',offset=0){
  if(typeof query!=='string'||query.length>256||!Number.isSafeInteger(offset)||offset<0)fail('LANDING_RESOURCE_INVALID');
  const words=query.toLowerCase().split(/\s+/).filter(Boolean),rows=Array.from(resources.values()).filter(pin=>words.every(word=>pin.file.toLowerCase().includes(word))).sort((a,b)=>a.file.localeCompare(b.file));
  return {query,offset,total:rows.length,next:offset+64<rows.length?offset+64:null,resources:rows.slice(offset,offset+64).map(({file,bytes,sha256})=>({id:file,bytes,sha256}))};
 }
 const base='knowledge/data/ds-ai-hub/',required=['products/ab/manifest.json','products/ab/patterns/landing-pages.md','products/ab/patterns/business-segment-styles.md','products/ab/patterns/draft-layout.md'].map(file=>base+file);
 if(required.some(id=>!resources.has(id)))fail('LANDING_REQUIRED_KNOWLEDGE_MISSING');
 const norms=[];
 for(const id of required.concat(['AGENTS.md','README.md'].map(file=>base+file).filter(id=>resources.has(id)))){
  let offset=0;do{const row=read({id,offset,limit:16000});if(row.tooLarge)fail('LANDING_REQUIRED_KNOWLEDGE_MISSING');norms.push(row);offset=row.next;}while(offset!==null);
 }
 return {id:manifest.id,knowledgeVersion:manifest.knowledgeVersion,skill,assertCurrent,read,list,
  initial:{skillVersion:skill.version,skillHash:skill.sha256,knowledgeVersion:manifest.knowledgeVersion,releaseId:manifest.id,instructions:skill.bodies,norms,workflow:bootstrap.map(id=>({id,text:resources.get(id).text})),resources:list('products/ab/patterns/')}};
}
module.exports={readLandingSkill,openKnowledge};

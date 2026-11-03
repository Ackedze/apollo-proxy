'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const ID='ab-audit-figma';
function openAuditKnowledge({releaseRoot,runtimeRoot,readRelease=require('../data-release').readReleaseFiles}){
 if(!path.isAbsolute(releaseRoot||'')||!path.isAbsolute(runtimeRoot||''))fail('AUDIT_DATA_REQUIRED');
 const manifest=readRelease(releaseRoot,runtimeRoot),manifestBytes=fs.readFileSync(path.join(releaseRoot,'manifest.json')),manifestHash=sha(manifestBytes);
 const resources=new Map(manifest.files.filter(p=>/^knowledge\/data\/ds-ai-hub\/.+\.(md|json|yaml|yml|txt)$/.test(p.file)||p.file.startsWith('skills/'+ID+'/')).map(p=>[p.file,p]));
 const used=new Map(),reads=[];
 function file(id){const pin=resources.get(id);if(!pin)fail('AUDIT_RESOURCE_UNKNOWN');const target=path.join(releaseRoot,id),stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target)fail('AUDIT_DATA_STALE');const bytes=fs.readFileSync(target);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('AUDIT_DATA_STALE');used.set(id,pin);return bytes.toString('utf8');}
 function assertCurrent(){if(sha(fs.readFileSync(path.join(releaseRoot,'manifest.json')))!==manifestHash)fail('AUDIT_DATA_STALE');for(const id of used.keys())file(id);}
 if(!resources.has('skills/'+ID+'/manifest.json'))fail('AUDIT_SKILL_UNAVAILABLE');
 const descriptorText=file('skills/'+ID+'/manifest.json'),descriptor=JSON.parse(descriptorText);
 require('../skills/catalog').packageFiles(Buffer.from(JSON.stringify(descriptor)),ID);
 if(descriptor.executorId!=='apollo.figma-audit')fail('AUDIT_SKILL_UNAVAILABLE');
 for(const pin of descriptor.files){const id='skills/'+ID+'/'+pin.path;const outer=resources.get(id);if(!outer||outer.sha256!==pin.sha256||outer.bytes!==pin.bytes)fail('AUDIT_DATA_STALE');}
 for(const id of descriptor.audit.requiredResources)if(!resources.has(id))fail('AUDIT_KNOWLEDGE_MISSING');
 function read(id,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');assertCurrent();const body=file(id);if(offset>body.length)fail('AUDIT_RESOURCE_INVALID');let end=Math.min(body.length,offset+12000);if(/[\uD800-\uDBFF]/.test(body[end-1]||'')&&/[\uDC00-\uDFFF]/.test(body[end]||''))end--;
  const row={id,sha256:resources.get(id).sha256,offset,end,next:end<body.length?end:null,total:body.length,text:body.slice(offset,end)};reads.push({id,sha256:row.sha256,offset,end});return row;
 }
 const initial=descriptor.audit.initialFiles.map(name=>read('skills/'+ID+'/'+name));
 // Bootstrap resources are paginated too; unconsumed tails remain visible.
 initial.push(...descriptor.audit.requiredResources.map(id=>read(id)));
 return {id:manifest.id,knowledgeVersion:manifest.knowledgeVersion,skill:{id:ID,version:descriptor.version,sha256:resources.get('skills/'+ID+'/manifest.json').sha256},instructions:descriptor.audit.hostInstructions,initial,read,assertCurrent,
  list(query='',offset=0){assertCurrent();if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');const words=query.toLowerCase().split(/\s+/).filter(Boolean),found=Array.from(resources.values()).filter(p=>p.file.startsWith('knowledge/')&&words.every(w=>p.file.toLowerCase().includes(w)));return {items:found.slice(offset,offset+40).map(p=>({id:p.file,sha256:p.sha256,bytes:p.bytes})),next:offset+40<found.length?offset+40:null,total:found.length};},
  sources:()=>[{id:'manifest.json',sha256:manifestHash,offset:0,end:manifestBytes.toString('utf8').length,purpose:'release-descriptor'},{id:'skills/'+ID+'/manifest.json',sha256:resources.get('skills/'+ID+'/manifest.json').sha256,offset:0,end:descriptorText.length,purpose:'skill-descriptor'},...reads],hasRead:(id,quote)=>typeof quote==='string'&&quote.length>=8&&quote.length<=2000&&reads.some(r=>r.id===id&&file(id).slice(r.offset,r.end).includes(quote))};
}
module.exports={openAuditKnowledge,ID};

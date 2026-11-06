'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {VERSION:ROUTING,METADATA,createIdentityRouter}=require('./routing');
const {VERSION:LIFECYCLE,INDEXES,createLifecycleLookup}=require('./lifecycle');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const ID='ab-audit-figma',SEED_BYTES=120000;
const searchText=value=>value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'');
function openAuditKnowledge({releaseRoot,runtimeRoot,readRelease=require('../data-release').readReleaseFiles}){
 if(!path.isAbsolute(releaseRoot||'')||!path.isAbsolute(runtimeRoot||''))fail('AUDIT_DATA_REQUIRED');
 const manifest=readRelease(releaseRoot,runtimeRoot),manifestBytes=fs.readFileSync(path.join(releaseRoot,'manifest.json')),manifestHash=sha(manifestBytes);
 const resources=new Map(manifest.files.filter(p=>/^knowledge\/data\/ds-ai-hub\/.+\.(md|json|yaml|yml|txt)$/.test(p.file)||METADATA.includes(p.file)||INDEXES.includes(p.file)||p.file.startsWith('skills/'+ID+'/')).map(p=>[p.file,p]));
 const used=new Map(),metadata=new Map(),reads=[];
 const privateResource=id=>METADATA.includes(id)||INDEXES.includes(id)||/^knowledge\/data\/ds-ai-hub\/(?:products\/ab\/components|core\/web\/components)\/[^/]+\/(?:meta\.json|figma-keys\.json|figma\/keys\.json)$/.test(id);
 function file(id){const pin=resources.get(id);if(!pin)fail('AUDIT_RESOURCE_UNKNOWN');const target=path.join(releaseRoot,id),stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target)fail('AUDIT_DATA_STALE');const bytes=fs.readFileSync(target);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('AUDIT_DATA_STALE');used.set(id,pin);return bytes.toString('utf8');}
 function assertCurrent(){if(sha(fs.readFileSync(path.join(releaseRoot,'manifest.json')))!==manifestHash)fail('AUDIT_DATA_STALE');for(const id of used.keys())file(id);}
 if(!resources.has('skills/'+ID+'/manifest.json'))fail('AUDIT_SKILL_UNAVAILABLE');
 const descriptorText=file('skills/'+ID+'/manifest.json'),descriptor=JSON.parse(descriptorText);
 require('../skills/catalog').packageFiles(Buffer.from(JSON.stringify(descriptor)),ID);
 if(descriptor.executorId!=='apollo.figma-audit')fail('AUDIT_SKILL_UNAVAILABLE');
 for(const pin of descriptor.files){const id='skills/'+ID+'/'+pin.path;const outer=resources.get(id);if(!outer||outer.sha256!==pin.sha256||outer.bytes!==pin.bytes)fail('AUDIT_DATA_STALE');}
 if(descriptor.audit.documentRouting!==ROUTING||METADATA.some(id=>!resources.has(id))||descriptor.audit.catalogLifecycle===LIFECYCLE&&INDEXES.some(id=>!resources.has(id)))fail('AUDIT_DATA_REQUIRED');
 for(const id of descriptor.audit.requiredResources)if(!resources.has(id)||privateResource(id))fail('AUDIT_KNOWLEDGE_MISSING');
 function readJson(id){const body=file(id);metadata.set(id,{id,sha256:resources.get(id).sha256,offset:0,end:body.length,purpose:INDEXES.includes(id)?'lifecycle-index-not-hub-norm':'routing-metadata-not-norm-read'});try{return JSON.parse(body);}catch{fail('AUDIT_DATA_REQUIRED');}}
 const lifecycle=descriptor.audit.catalogLifecycle===LIFECYCLE?createLifecycleLookup(readJson):null;
 const resolve=createIdentityRouter({readJson,resourceIds:[...resources.keys()],selectDocuments:require('../knowledge-routing/hub-documents').selectHubDocuments});
 function fragment(id,offset){
  if(!resources.has(id)||privateResource(id))fail('AUDIT_RESOURCE_UNKNOWN');
  if(!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');const body=file(id);if(offset>body.length)fail('AUDIT_RESOURCE_INVALID');let end=Math.min(body.length,offset+12000);if(/[\uD800-\uDBFF]/.test(body[end-1]||'')&&/[\uDC00-\uDFFF]/.test(body[end]||''))end--;
  return {id,sha256:resources.get(id).sha256,offset,end,next:end<body.length?end:null,total:body.length,text:body.slice(offset,end)};
 }
 function read(id,offset=0){assertCurrent();const row=fragment(id,offset);reads.push({id,sha256:row.sha256,offset,end:row.end});return row;}
 const initial=descriptor.audit.initialFiles.map(name=>read('skills/'+ID+'/'+name));
 initial.push(...descriptor.audit.requiredResources.map(id=>read(id)));
 const customizationFacts=descriptor.audit.customizationFacts||null;
 const catalogues=customizationFacts?require('./catalogues').createCatalogueBaselines({knowledgeRoot:path.join(releaseRoot,'knowledge')}):null;
 let routing=null;
 function routingProgress(){
  if(!routing)return null;
  const requiredSources=routing.requiredSources.map(source=>{
   const total=source.total,intervals=reads.filter(r=>r.id===source.id).sort((a,b)=>a.offset-b.offset);let offset=0;
   for(const row of intervals){if(row.offset>offset)break;offset=Math.max(offset,row.end);}
   return Object.assign({},source,{sha256:resources.get(source.id).sha256,total,readTo:offset,complete:offset===total});
  });
  return Object.assign({},routing,{requiredSources,total:requiredSources.length,completed:requiredSources.filter(s=>s.complete).length,nextReads:requiredSources.filter(s=>!s.complete).slice(0,6).map(s=>({id:s.id,offset:s.readTo})),semanticCompleteness:'NOT_PROVEN'});
 }
 return {id:manifest.id,knowledgeVersion:manifest.knowledgeVersion,skill:{id:ID,version:descriptor.version,sha256:resources.get('skills/'+ID+'/manifest.json').sha256},documentRouting:ROUTING,customizationFacts,catalogues,instructions:descriptor.audit.hostInstructions,initial,read,assertCurrent(){assertCurrent();try{catalogues?.assertCurrent();}catch(error){if(error.code==='AUDIT_CATALOGUE_STALE'||error.code==='ENOENT')fail('AUDIT_DATA_STALE');throw error;}},
  evaluateLifecycle:lifecycle?(nodes,pageId)=>{assertCurrent();return Object.assign(lifecycle(nodes,pageId),{sources:INDEXES.map(id=>metadata.get(id))});}:null,
  prepareRouting(nodes){if(routing)fail('AUDIT_ROUTING_REPLAY');assertCurrent();routing=resolve(nodes);routing.candidateSources=routing.candidateSources.map(s=>s.id&&privateResource(s.id)?{subject:s.subject,reason:s.reason+' (identity metadata; not a readable norm)'}:s);routing.requiredSources=routing.requiredSources.map(s=>Object.assign({},s,{total:file(s.id).length}));let budget=SEED_BYTES;for(const source of routing.requiredSources){const row=fragment(source.id,0),bytes=Buffer.byteLength(row.text);if(bytes<=budget){initial.push(read(source.id));budget-=bytes;}}return routingProgress();},routingProgress,
  list(query='',offset=0){assertCurrent();if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');const words=query.split(/\s+/).map(searchText).filter(Boolean),found=query.trim()&&!words.length?[]:Array.from(resources.values()).filter(p=>!privateResource(p.file)&&p.file.startsWith('knowledge/')&&words.every(w=>searchText(p.file).includes(w))).sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);return {items:found.slice(offset,offset+40).map(p=>({id:p.file,sha256:p.sha256,bytes:p.bytes})),next:offset+40<found.length?offset+40:null,total:found.length,matching:'separator/case-insensitive AND path fragments',hint:found.length?'Return IDs/hashes are unchanged source paths.':'No matching path. Use fewer terms or one component family; do not repeat an equivalent query.'};},
  sources:()=>[{id:'manifest.json',sha256:manifestHash,offset:0,end:manifestBytes.toString('utf8').length,purpose:'release-descriptor'},{id:'skills/'+ID+'/manifest.json',sha256:resources.get('skills/'+ID+'/manifest.json').sha256,offset:0,end:descriptorText.length,purpose:'skill-descriptor'},...metadata.values(),...reads],hasRead:(id,quote)=>typeof quote==='string'&&quote.length>=8&&quote.length<=2000&&reads.some(r=>r.id===id&&file(id).slice(r.offset,r.end).includes(quote))};
}
module.exports={openAuditKnowledge,ID,SEED_BYTES};

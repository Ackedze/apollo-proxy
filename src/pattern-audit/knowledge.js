'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const HUB='knowledge/data/ds-ai-hub/';
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const normalized=value=>String(value).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'');
const instructions=[
 'Experimental pattern audit for Alfa Business web. Norms come ONLY from Markdown resources of this pinned Proxy package.',
 'Do not read or ask for component contracts, rules.json, predicate results, prior audit findings, another checkout or external sources.',
 'Do not follow Figma URLs or other external URLs in documents. You have no browser, shell, MCP or network tools. Use host read actions only.',
 'Start by reading selected root geometry and representative component identities. Use layer names only as search hints; a FRAME name never proves it was detached.',
 'Search both observed component families and page composition/scenario: forms, view pages, landing pages, grid, headings, surfaces, actions. A missing mandatory element may be checked only with complete applicable scope.',
 'The catalogue in initial is navigation metadata, not a source of norms. Read relevant Markdown documents and ALL unread tails including applicability, exceptions and delegated Markdown before judging.',
 'Read product AB overrides before applying core. Never transfer ABM or a different channel rule. platform is supplied by the host; a content frame width is not necessarily viewport width.',
 'Read exact native componentProperties, geometry, textSegments, variables/styles and slot/ancestor context needed by each norm. Get missing facts through read_nodes, in batches. Do not infer exact tokens from RGB.',
 'Make one run-local plan entry per original norm and target. Keep original rule IDs; if none exists, cite the source section. Do not invent stable Hub IDs.',
 'Distinguish MUST/forbidden from recommendation, permission, recipe example or default. Do not turn may into must. Conflicting source status/requirements need UNKNOWN and an explicit gap.',
 'Preserve outcomes of independent conditions. A confirmed defect remains FAIL if another aspect cannot be checked; unknown dependent checks remain UNKNOWN/NOT_CHECKED and never become PASS.',
 'No screenshot or interaction simulation is provided by this experiment. Do not claim visual inspection, actual click effect, responsive behaviour or business intent without evidence. Continue checks decidable from native facts.',
 'Every FAIL needs a specific target, actual/expected/fix, an exact quote from the read Markdown and native fact bindings. Do not replace facts with documentation or defaults.',
 'Avoid duplicate findings for the same source/target/problem. Explicitly record excluded families and unavailable branches. Coverage is only the declared plan, never all DS knowledge.',
 'Do not rewrite text or apply changes. Finish with a concise Russian summary. This run is independent of the text checker and the existing DS AI HUB audit.'
].join('\n');
function openPatternKnowledge({releaseRoot,runtimeRoot,readRelease=require('../data-release').readReleaseFiles}){
 if(!path.isAbsolute(releaseRoot||'')||!path.isAbsolute(runtimeRoot||''))fail('AUDIT_DATA_REQUIRED');
 const manifest=readRelease(releaseRoot,runtimeRoot),manifestPath=path.join(releaseRoot,'manifest.json'),manifestHash=sha(fs.readFileSync(manifestPath));
 const resources=new Map((manifest.files||[]).filter(pin=>pin.file.startsWith(HUB)&&/\.md$/.test(pin.file)&&/^(?:AGENTS\.md|README\.md|CONTRACT\.md|products\/ab\/.+|core\/web\/.+|core\/common\/.+)$/.test(pin.file.slice(HUB.length))).map(pin=>[pin.file,pin]));
 if(!resources.size)fail('AUDIT_KNOWLEDGE_MISSING');
 const used=new Map(),reads=[];
 function file(id){
  const pin=resources.get(id);if(!pin)fail('AUDIT_RESOURCE_UNKNOWN');
  const target=path.join(releaseRoot,id);let bytes;
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target)fail('AUDIT_DATA_STALE');bytes=fs.readFileSync(target);}catch{fail('AUDIT_DATA_STALE');}
  if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('AUDIT_DATA_STALE');
  used.set(id,pin);return bytes.toString('utf8');
 }
 function assertCurrent(){
  let current;try{current=sha(fs.readFileSync(manifestPath));}catch{fail('AUDIT_DATA_STALE');}
  if(current!==manifestHash)fail('AUDIT_DATA_STALE');
  for(const id of used.keys())file(id);
 }
 function read(id,offset=0){
  assertCurrent();if(!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');
  const body=file(id);if(offset>body.length)fail('AUDIT_RESOURCE_INVALID');
  let end=Math.min(body.length,offset+12000);
  if(/[\uD800-\uDBFF]/.test(body[end-1]||'')&&/[\uDC00-\uDFFF]/.test(body[end]||''))end--;
  const row={id,sha256:resources.get(id).sha256,offset,end,next:end<body.length?end:null,total:body.length,text:body.slice(offset,end)};
  reads.push({id,sha256:row.sha256,offset,end});return row;
 }
 const catalogue=Array.from(resources.keys()).filter(id=>id.startsWith(HUB+'products/ab/patterns/')).sort();
 const initial=[{purpose:'navigation-only-not-a-read-norm',product:'ab',platform:'web',documents:catalogue.map(id=>({id,sha256:resources.get(id).sha256,bytes:resources.get(id).bytes}))}];
 for(const id of [HUB+'AGENTS.md',HUB+'products/ab/instructions/differences.md'])if(resources.has(id)){
  let offset=0;do{const row=read(id,offset);initial.push(row);offset=row.next;}while(offset!==null);
 }
 return {id:manifest.id,knowledgeVersion:manifest.knowledgeVersion,skill:{id:'pattern-audit',version:'0.1.0',sha256:sha(instructions)},instructions,initial,customizationFacts:null,documentRouting:null,assertCurrent,read,
  list(query='',offset=0){
   assertCurrent();if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0)fail('AUDIT_RESOURCE_INVALID');
   const words=query.split(/\s+/).map(normalized).filter(Boolean);
   const found=query.trim()&&!words.length?[]:Array.from(resources.keys()).filter(id=>{
    const location=normalized(id);
    return words.every(word=>location.includes(word)||normalized(file(id)).includes(word));
   }).sort();
   return {items:found.slice(offset,offset+40).map(id=>({id,sha256:resources.get(id).sha256,bytes:resources.get(id).bytes})),total:found.length,next:offset+40<found.length?offset+40:null,matching:'case/separator-insensitive AND over Markdown path and content; matching is navigation, not source reading'};
  },
  sources:()=>[{id:'manifest.json',sha256:manifestHash,purpose:'release-descriptor'},...reads],
  hasRead:(id,quote)=>typeof quote==='string'&&quote.length>=8&&quote.length<=2000&&reads.some(row=>row.id===id&&file(id).slice(row.offset,row.end).includes(quote))
 };
}
module.exports={openPatternKnowledge,instructions,HUB};

'use strict';
const BASE='knowledge/data/ds-ai-hub/';
const sorted=values=>[...values].sort((a,b)=>a<b?-1:a>b?1:0);
function selectHubDocuments({units=[],graph={},availableIds=[],componentIds=[],patternIds=[],product='ab',platform='web',target='figma'}={}){
 const required=new Map(),candidates=new Map(),gaps=new Map();
 const gap=(code,subject,reason,id)=>{const row={code,subject,reason,...(id?{id}:{})};gaps.set(JSON.stringify(row),row);};
 const candidate=(id,reason,subject)=>{const row={...(id?{id}:{}),reason,subject};candidates.set(JSON.stringify(row),row);};
 if(!Array.isArray(units)||!Array.isArray(componentIds)||!Array.isArray(patternIds)||!Array.isArray(graph?.edges||[])||!Array.isArray(availableIds)&&!(availableIds instanceof Set)||![product,platform,target].every(v=>typeof v==='string'&&/^[a-z][a-z0-9-]*$/.test(v))){
  return {requiredSources:[],candidateSources:[],gaps:[{code:'HUB_ROUTING_METADATA_INVALID',reason:'Expected Hub units, graph edges and an explicit product/platform/target.'}]};
 }
 const available=new Set(availableIds);
 function resource(path){
  if(typeof path!=='string')return null;
  const relative=path.startsWith(BASE)?path.slice(BASE.length):path;
  if(!relative||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||!relative.match(/\.(md|json|yaml|yml|txt)$/))return null;
  if(![product&&'products/'+product+'/', 'core/'+platform+'/', 'core/common/'].some(p=>relative.startsWith(p)))return null;
  return BASE+relative;
 }
 const requested=new Set(componentIds.concat(patternIds).filter(v=>typeof v==='string'&&v));
 const index=new Map();
 for(const unit of units){
  if(typeof unit?.id!=='string'||!resource(unit.path))continue;
  if(!Array.isArray(unit.platforms)||!Array.isArray(unit.targets)){
   if([...requested].some(id=>unit.id===id||unit.id.startsWith(id+'.')))gap('HUB_APPLICABILITY_MISSING',unit.id,'Document applicability is absent from the supplied registry.');
   continue;
  }
  if(unit.platforms.length&&!unit.platforms.includes(platform)||unit.targets.length&&!unit.targets.includes(target))continue;
  const matches=index.get(unit.id)||[];matches.push(unit);index.set(unit.id,matches);
 }
 function entries(subject,exact=false){
  const found=[];
  for(const [id,matches] of index){
   if(id!==subject&&(exact||!id.startsWith(subject+'.')))continue;
   if(matches.length!==1){gap('HUB_UNIT_AMBIGUOUS',id,'More than one applicable registry entry has this identity.');continue;}
   found.push(matches[0]);
  }
  return found;
 }
 function add(unit,reason,mandatory,subject){
  const id=resource(unit.path);
  if(!available.has(id)){gap('HUB_SOURCE_NOT_PACKAGED',subject,'The declared Hub document is absent from this package.',id);return;}
  if(mandatory){const reasons=required.get(id)||new Set();reasons.add(reason);required.set(id,reasons);}
  else candidate(id,reason,subject);
 }
 for(const subject of new Set(componentIds)){
  if(typeof subject!=='string'||!subject){gap('HUB_COMPONENT_ID_INVALID',String(subject),'Use an observed canonical component identity.');continue;}
  const found=entries(subject),overview=found.filter(u=>u.id===subject||u.id===subject+'.instructions'),adapter=found.filter(u=>u.id===subject+'.adapter.'+target);
  if(!overview.length)gap('HUB_COMPONENT_OVERVIEW_MISSING',subject,'No unambiguous applicable overview or instructions were declared.');
  if(!adapter.length)gap('HUB_COMPONENT_ADAPTER_MISSING',subject,'No unambiguous applicable target adapter was declared.');
  for(const unit of found)add(unit,'component:'+subject,overview.includes(unit)||adapter.includes(unit),subject);
 }
 for(const subject of new Set(patternIds)){
  const found=typeof subject==='string'&&subject?entries(subject,true):[];
  if(!found.length)gap('HUB_PATTERN_UNRESOLVED',String(subject),'No unambiguous applicable pattern identity was declared.');
  for(const unit of found)add(unit,'pattern:'+subject,true,subject);
 }
 const selected=new Set(componentIds);
 for(const edge of graph?.edges||[]){
  if(!selected.has(edge?.from)||typeof edge.target!=='string'||!edge.target)continue;
  const reason='dependency:'+String(edge.kind||'related');
  if(edge.targetType==='source-internal'){candidate(null,'source-internal-owner-context',edge.target);continue;}
  const id=resource(edge.targetPath);
  if(id&&available.has(id))candidate(id,reason,edge.target);
  const found=entries(edge.target,edge.target.startsWith('ptrn:'));
  for(const unit of found)add(unit,reason,false,edge.target);
  if(!id&&!found.length)gap('HUB_DEPENDENCY_UNRESOLVED',edge.target,'The dependency has no applicable declared document path.');
  else if(id&&!available.has(id))gap('HUB_SOURCE_NOT_PACKAGED',edge.target,'The declared dependency is absent from this package.',id);
 }
 return {
  requiredSources:sorted(required.keys()).map(id=>({id,reasons:sorted(required.get(id))})),
  candidateSources:sorted(candidates.keys()).map(key=>candidates.get(key)).filter(row=>!row.id||!required.has(row.id)),
  gaps:sorted(gaps.keys()).map(key=>gaps.get(key))
 };
}
module.exports={selectHubDocuments};

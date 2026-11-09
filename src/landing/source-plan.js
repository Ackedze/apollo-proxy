'use strict';
const HUB='knowledge/data/ds-ai-hub/';
const PHASE_FILES={structure:['brief.md','composition.md','page-layout.md','component-selection.md'],content:['content-and-assets.md']};
const words=value=>String(value||'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu)||[];
const componentFolder=id=>id.match(/^(knowledge\/data\/ds-ai-hub\/(?:products\/ab|core\/web|core\/common)\/components\/[^/]+)\//)?.[1];
function readState(pin,ledger){
 const rows=ledger.filter(row=>row.id===pin.file&&row.sha256===pin.sha256&&Array.isArray(row.path)&&row.path.length===0);
 if(!rows.length)return 'unread';
 if(pin.file.endsWith('.json')&&rows.some(row=>Object.hasOwn(row,'total')&&row.total===null&&row.next===null))return 'read';
 const ranges=rows.filter(row=>Number.isSafeInteger(row.offset)&&row.offset>=0&&Number.isSafeInteger(row.returned)&&row.returned>=0&&Number.isSafeInteger(row.total)&&row.total>=0&&row.offset<=row.total&&row.returned<=row.total-row.offset).sort((a,b)=>a.offset-b.offset);
 const total=ranges[0]?.total;if(ranges.some(row=>row.total!==total))return 'partial';
 let end=0;for(const row of ranges){if(row.offset>end)break;end=Math.max(end,row.offset+row.returned);if(end===total)return 'read';}
 return 'partial';
}
function createSourcePlanner({resources,skill,sourcePin,releaseId,metadata,routing,assertCurrent}){
 let index;
 const allowed=id=>id.startsWith(HUB+'products/ab/')||id.startsWith(HUB+'core/web/')||id.startsWith(HUB+'core/common/');
 function build(){
  const gaps=[],meta=new Map(),rows=new Map(),declared=new Set();
  const load=id=>{if(!resources.has(id)){gaps.push({code:'SOURCE_PLAN_METADATA_MISSING',id});return null;}try{return metadata(id);}catch(error){if(!(error instanceof SyntaxError))throw error;gaps.push({code:'SOURCE_PLAN_METADATA_INVALID',id});return null;}};
  const registry=load(HUB+'registry/index.json');
  for(const pin of resources.values())if(allowed(pin.file)&&pin.file.endsWith('/meta.json')&&componentFolder(pin.file)){
   const value=load(pin.file);if(!value||typeof value.id!=='string')continue;
   meta.set(componentFolder(pin.file),{pin,value});
  }
  const units=Array.isArray(registry?.units)?registry.units:[];
  if(registry&&!Array.isArray(registry.units))gaps.push({code:'SOURCE_PLAN_METADATA_INVALID',id:HUB+'registry/index.json'});
  for(const unit of units){
   const id=typeof unit?.path==='string'?(unit.path.startsWith(HUB)?unit.path:HUB+unit.path):'';
   declared.add(id);
   if(!allowed(id)||!resources.has(id)||!Array.isArray(unit.platforms)||!Array.isArray(unit.targets)||unit.platforms.length&&!unit.platforms.includes('web')||unit.targets.length&&!unit.targets.includes('figma'))continue;
   if(componentFolder(id))continue;
   rows.set(id,{pin:resources.get(id),terms:words([unit.id,unit.path].join(' '))});
  }
  for(const [folder,{pin,value}] of meta)rows.set(pin.file,{pin,folder,terms:words([value.id,folder,...(Array.isArray(value.keywords)?value.keywords.filter(v=>typeof v==='string'):[])].join(' '))});
  // File names remain a fallback for packaged assets missing from the registry.
  for(const pin of resources.values())if(allowed(pin.file)&&!componentFolder(pin.file)&&!declared.has(pin.file)&&!rows.has(pin.file))rows.set(pin.file,{pin,terms:words(pin.file)});
  return {rows:[...rows.values()],gaps};
 }
 return function plan({phase,query='',ledger=[],resuming=false,providedIds=[]}={}){
  assertCurrent();if(!['structure','content'].includes(phase))throw Object.assign(Error('LANDING_SOURCE_PHASE_INVALID'),{code:'LANDING_SOURCE_PHASE_INVALID'});
  index ||= build();
  const describe=(id,reason)=>{const pin=resources.get(id);return pin?{id,sha256:pin.sha256,bytes:pin.bytes,reason,readState:providedIds.includes(id)?'provided-in-session':readState(pin,ledger)}:{id,reason,readState:'unavailable'};};
  const mandatory=new Set([HUB+'AGENTS.md',...(skill.generation?.requiredResources||[]),...(skill.generation?.initialFiles||['SKILL.md']).map(file=>'skills/'+skill.id+'/'+file),'workflow/figma-use/SKILL.md','workflow/figma-generate-design/SKILL.md']);
  // Adapt the existing landing skill's phase table, without inventing a new workflow.
  const phaseFiles=[...PHASE_FILES[phase],...(resuming?['changes.md']:[])].map(file=>'references/rules/'+file).concat(['references/proxy.md','references/run-contract.md']);
  for(const file of phaseFiles)if(skill.bodies?.['SKILL.md']?.includes('('+file+')')||skill.bodies?.['SKILL.md']?.includes('('+file+'#'))mandatory.add('skills/'+skill.id+'/'+file);
  const tokens=new Set(words(query)),ranked=[];
  for(const row of index.rows){
   const matches=[...tokens].filter(token=>row.terms.some(term=>term===token||token.length>=5&&term.startsWith(token)));
   if(!matches.length||mandatory.has(row.pin.file))continue;
   const phaseMatch=phase==='structure'?/\/components\/|\/patterns\//.test(row.pin.file):/\/assets\/|content|text|image/.test(row.pin.file);
   ranked.push({...row,score:matches.length*10+Number(phaseMatch)});
  }
  ranked.sort((a,b)=>b.score-a.score||a.pin.file.localeCompare(b.pin.file));
  const gaps=index.gaps.slice(),candidates=ranked.slice(0,6).map(row=>{
   const result={...describe(row.pin.file,'query-and-phase'),score:row.score};
   if(row.folder){const route=routing(row.folder);result.beforeUse=[...(route?.requiredSources||[]),...(route?.technicalSources||[])].map(p=>describe(p.id,'component-before-use'));gaps.push(...(route?.gaps||[]));}
   return result;
  });
  for(const id of mandatory)if(!resources.has(id))gaps.push({code:'SOURCE_PLAN_REQUIRED_NOT_PACKAGED',id});
  if(!candidates.length)gaps.push({code:'SOURCE_PLAN_NO_QUERY_MATCH',reason:'No confident shortlist; use the existing search and reader to expand discovery.'});
  return {sourcePin,releaseId,phase,required:[...mandatory].sort().map(id=>describe(id,'skill-or-workflow-required')),candidates,gaps,
   nextSearch:skill.generation?.initialQueries||[],instruction:'Navigation only, not evidence of reading. Read applicable original rules/ranges before dependent actions. Candidate beforeUse applies when choosing that component. Partial readState does not require dumping the whole document. Expand list_sources/read_source when uncertain; never omit mandatory rules because of ranking.'};
 };
}
module.exports={createSourcePlanner};

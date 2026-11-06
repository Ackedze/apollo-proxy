'use strict';
// Source bodies stay in the pinned ledger; the prompt exposes the current work unit.
function componentRequests(list){
 if(!/^(?:knowledge\/data\/ds-ai-hub\/)?(?:products\/ab|core\/web)\/components\/[a-z0-9-]+\/?$/.test(list.query)||list.offset!==0||list.next!==null)return [];
 const prefix=(list.query.startsWith('knowledge/')?list.query:'knowledge/data/ds-ai-hub/'+list.query).replace(/\/?$/,'/');
 const ids=list.resources.filter(row=>row.id.startsWith(prefix)&&/\/(?:meta\.json|instructions\.md|guidelines\.md|adapter\.figma\.md|figma-keys\.json|cookbook\/[^/]+\.md|figma\/(?:adapter\.md|cookbook\.md|snippets\.md|keys\.json|model\.json))$/.test(row.id)).map(row=>row.id);
 for(const row of [...(list.routing?.requiredSources||[]),...(list.routing?.technicalSources||[])])if(row.id.startsWith('knowledge/data/ds-ai-hub/'))ids.push(row.id);
 return [...new Set(ids)].map(id=>({id,mode:'read',path:[],offset:0,limit:16000}));
}
function isIndexPrefix(list,request){
 if(!/^(?:knowledge\/data\/ds-ai-hub\/)?(?:products\/ab|core\/web)\/components\/(?:[a-z0-9-]+\/?)?$/.test(list.query)||!Array.isArray(list.resources))return false;
 const prefix=list.query.startsWith('knowledge/')?list.query:'knowledge/data/ds-ai-hub/'+list.query;
 return request&&Object.keys(request).sort().join(',')==='id,limit,mode,offset,path'&&request.id===prefix&&['read','keys','summary'].includes(request.mode)&&Array.isArray(request.path)&&request.path.length===0&&request.offset===0&&Number.isSafeInteger(request.limit)&&request.limit>=1&&request.limit<=16000&&list.resources.every(row=>typeof row.id==='string'&&row.id.startsWith(prefix.replace(/\/?$/,'/'))&&row.id!==prefix);
}
function promptContext(record,job){
 if(!job.source.skill.generation)return {resources:job.context,indexes:job.indexes};
 const section=record.execution?.workflow==='staged-content-v1'&&!record.execution.activeSectionId?record.spec.foundation:record.spec.sections.find(row=>row.id===record.execution?.activeSectionId),selected=Array.isArray(section?.sourceIds)?new Set(section.sourceIds):null;
 const resources=job.context.filter(row=>job.phase==='plan'?!row.id.startsWith('workflow/'):!selected||selected.has(row.id)||row.id.startsWith('workflow/'));
 return {resources,indexes:job.indexes.map(row=>({query:row.query,offset:row.offset,total:row.total,next:row.next})),availableReads:job.context.filter(row=>!resources.includes(row)).map(({id,sha256,path,mode,offset,next,total})=>({id,sha256,path,mode,offset,next,total}))};
}
function promptReadback(record){
 const readback=record.readback;if(!readback?.native||Buffer.byteLength(JSON.stringify(readback))<=131072)return readback;
 const roots=new Set(readback.sections.map(s=>s.id)),active=record.execution?.activeSectionId,refs={},dictionary=new Map();
 const nodes=readback.native.nodes.filter(n=>n.sectionId===null||n.sectionId===active||roots.has(n.id)).map(node=>{
  const row={...node};for(const key of ['boundVariables','resolvedVariableModes','explicitVariableModes'])if(row[key]&&typeof row[key]==='object'){
   const text=JSON.stringify(row[key]);if(text.length<120)continue;let id=dictionary.get(text);if(!id){id='native-'+dictionary.size;dictionary.set(text,id);refs[id]=row[key];}row[key]={$ref:id};
  }return row;
 });
 return {...readback,native:{...readback.native,nodes},nativeRefs:refs,projection:{kind:'active-unit-and-section-roots',activeSectionId:active||null,retainedNativeNodeCount:readback.native.nodes.length,returnedNativeNodeCount:nodes.length,authority:'Proxy retains the complete snapshot. Expand nativeRefs for $ref fields; other section internals are omitted from this prompt only. Use narrow owned MCP reads if more detail is needed.'}};
}
module.exports={componentRequests,promptContext,promptReadback,isIndexPrefix};

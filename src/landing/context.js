'use strict';
// Source bodies stay in the pinned ledger; the prompt exposes the current work unit.
function componentRequests(list){
 if(!/^(?:knowledge\/data\/ds-ai-hub\/)?(?:products\/ab|core\/web)\/components\/[a-z0-9-]+\/$/.test(list.query)||list.offset!==0||list.next!==null)return [];
 return list.resources.filter(row=>row.id.startsWith('knowledge/data/ds-ai-hub/')&&/\/(?:instructions\.md|adapter\.figma\.md|figma-keys\.json|cookbook\/[^/]+\.md)$/.test(row.id)).map(row=>({id:row.id,mode:'read',path:[],offset:0,limit:16000}));
}
function isIndexPrefix(list,request){
 if(!/^(?:knowledge\/data\/ds-ai-hub\/)?(?:products\/ab|core\/web)\/components\/(?:[a-z0-9-]+\/)?$/.test(list.query)||!Array.isArray(list.resources))return false;
 const prefix=list.query.startsWith('knowledge/')?list.query:'knowledge/data/ds-ai-hub/'+list.query;
 return request&&Object.keys(request).sort().join(',')==='id,limit,mode,offset,path'&&request.id===prefix&&['read','keys','summary'].includes(request.mode)&&Array.isArray(request.path)&&request.path.length===0&&request.offset===0&&Number.isSafeInteger(request.limit)&&request.limit>=1&&request.limit<=16000&&list.resources.every(row=>typeof row.id==='string'&&row.id.startsWith(prefix)&&row.id!==prefix);
}
function promptContext(record,job){
 if(!job.source.skill.generation)return {resources:job.context,indexes:job.indexes};
 const section=record.spec.sections.find(row=>row.id===record.execution?.activeSectionId),selected=Array.isArray(section?.sourceIds)?new Set(section.sourceIds):null;
 const resources=job.context.filter(row=>job.phase==='plan'?!row.id.startsWith('workflow/'):!selected||selected.has(row.id)||row.id.startsWith('workflow/'));
 return {resources,indexes:job.indexes.map(row=>({query:row.query,offset:row.offset,total:row.total,next:row.next})),availableReads:job.context.filter(row=>!resources.includes(row)).map(({id,sha256,path,mode,offset,next,total})=>({id,sha256,path,mode,offset,next,total}))};
}
module.exports={componentRequests,promptContext,isIndexPrefix};

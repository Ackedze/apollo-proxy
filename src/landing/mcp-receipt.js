'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SCHEMA='apollo.mcp-write-result.v1';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function context(record){
 const state=record.execution;
 return {schemaVersion:SCHEMA,operationId:crypto.randomUUID(),sourcePin:state.sourcePin,stage:state.stage,sectionId:state.activeSectionId,target:JSON.parse(JSON.stringify(record.target))};
}
function recipeSources(){
 const functions=require('./figma-recipes'),artifact=JSON.parse(fs.readFileSync(path.join(__dirname,'figma-recipes.compact.json'),'utf8'));
 if(artifact.schemaVersion!=='apollo.mcp-recipe-source.v1'||Object.keys(functions).sort().join(',')!==Object.keys(artifact.recipes||{}).sort().join(','))throw Error('LANDING_MCP_RECIPE_SOURCE_INVALID');
 for(const[name,fn]of Object.entries(functions)){
  const row=artifact.recipes[name];if(row.sourceSha256!==sha(fn.toString())||typeof row.code!=='string'||row.codeSha256!==sha(row.code))throw Error('LANDING_MCP_RECIPE_SOURCE_INVALID');
 }
 return Object.values(artifact.recipes).map(row=>row.code).join('\n');
}
function decoded(observation,state,readback){
 if(observation.truncated||observation.sectionId!==state.activeSectionId||observation.sourcePin!==state.sourcePin||observation.tool!=='use_figma')return null;
 let value;try{value=JSON.parse(observation.text);}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const versioned=value.schemaVersion===SCHEMA;
 if(value.schemaVersion!==undefined&&!versioned)return null;
 if(versioned&&(typeof value.operationId!=='string'||!value.operationId||value.operationId!==observation.operationId||value.sourcePin!==state.sourcePin||value.stage!==state.stage||value.stage!==observation.executionStage||value.sectionId!==state.activeSectionId))return null;
 if(versioned){
  const ids=value=>Array.isArray(value)&&value.length<=256&&value.every(id=>typeof id==='string'&&id.length>0&&id.length<=512);
  if(!ids(value.createdNodeIds)||!ids(value.mutatedNodeIds))return null;
  if(value.section!==null){
   const section=value.section,field=name=>typeof section?.[name]==='string'&&section[name].length>0&&section[name].length<=512;
   if(!section||typeof section!=='object'||Array.isArray(section)||!field('id')||!field('parentId')||!field('type')||typeof value.sectionId!=='string'||section.sectionId!==value.sectionId)return null;
  }
  if(JSON.stringify(value).length>3072)return null;
 }
 const root=readback.native?.nodes.find(node=>node.id===state.rootNodeId),receipts=[];
 if(value.ownership!==undefined)receipts.push([value.ownership,'rootId']);
 if(value.root!==undefined)receipts.push([value.root,'id']);
 if(!receipts.length||versioned&&value.ownership===undefined)return null;
 for(const[row,key]of receipts){
  if(!row||typeof row!=='object'||Array.isArray(row)||row[key]!==state.rootNodeId||row.owner!==state.ownerNonce)return null;
  for(const[field,actual]of [['parentId',root?.parentId],['pageId',readback.pageId],['active',readback.leaseNonce]]){
   if(versioned&&(typeof row[field]!=='string'||!row[field]))return null;
   if((versioned||Object.hasOwn(row,field))&&row[field]!==actual)return null;
  }
 }
 if(value.createdNodeIds!==undefined&&(!Array.isArray(value.createdNodeIds)||value.createdNodeIds.length>256||value.createdNodeIds.some(id=>typeof id!=='string'||id.length>512)))return null;
 return {value,format:versioned?SCHEMA:value.root?'legacy-root':'legacy-ownership',operationId:versioned?value.operationId:null};
}
function created(observation,state,readback,nodeId){
 const result=decoded(observation,state,readback);if(!result||!result.value.createdNodeIds?.includes(nodeId)&&result.value.section?.id!==nodeId)return null;
 return {format:result.format,operationId:result.operationId};
}
function assertPending(state,readback){
 for(const row of state?.mcpObservations||[]){
  if(row.readbackHash||row.tool!=='use_figma')continue;
  let value;try{value=JSON.parse(row.text);}catch{continue;}
  if(typeof value?.schemaVersion==='string'&&value.schemaVersion.startsWith('apollo.mcp-write-result.')&&!decoded(row,state,readback))throw Object.assign(Error('LANDING_MCP_RECEIPT_INVALID'),{code:'LANDING_MCP_RECEIPT_INVALID',status:409,diagnostic:{stage:'mcp-write-result',operationId:row.operationId||null,sectionId:row.sectionId||null,reason:'Delivered operation/context/ownership conflicts with the independent readback.'}});
 }
}
module.exports={SCHEMA,context,recipeSources,created,assertPending};

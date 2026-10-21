'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const units=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function usageFromEvents(events){
 const turns=(events||[]).filter(e=>e.type==='turn.completed');
 const total=key=>turns.length&&turns.every(e=>units(e.usage?.[key])!==null)?turns.reduce((n,e)=>n+e.usage[key],0):null;
 return{actualUsageReason:turns.length?'Only emitted provider usage fields are actual; missing fields remain null.':'No turn.completed usage event emitted',effectiveModelReason:events.some(e=>typeof e.model==='string')?null:'Effective model not exposed by CLI events',toolCalls:new Set((events||[]).filter(e=>e.item?.type==='mcp_tool_call').map(e=>e.item.id)).size,actualInputTokens:total('input_tokens'),actualOutputTokens:total('output_tokens'),cachedInputSubsetTokens:total('cached_input_tokens'),reasoningOutputSubsetTokens:total('reasoning_output_tokens'),
  cliTurns:turns.length,providerModelAttempts:null,providerModelAttemptsReason:'CLI turn events do not establish the number of internal provider iterations.',effectiveModel:events.find(e=>typeof e.model==='string')?.model||null,actualCost:null,actualCostReason:'No verified effective-model tariff; cached/reasoning are subsets, not additive totals.'};
}
function measurement({prompt,schema,prefix='',events=[],durationMs=null,requestId=null,runId=null,stage,attempt=null,method=null}){
 const full=prefix+prompt,schemaJson=JSON.stringify(schema||{});
 return{schemaVersion:'apollo.request-usage.v1',measurementId:crypto.randomUUID(),atUtc:new Date().toISOString(),requestId,requestGroupId:typeof requestId==='string'&&/^prompt-plan:[a-f0-9]{16}:[1-9][0-9]*$/.test(requestId)?requestId.slice(0,requestId.lastIndexOf(':')):null,groupScope:'planner-client-session including refinements/retries; paired trials must isolate the same task',runId,stage,attempt,method,...usageFromEvents(events),promptUtf16Chars:full.length,promptUtf8Bytes:Buffer.byteLength(full),schemaUtf16Chars:schemaJson.length,schemaUtf8Bytes:Buffer.byteLength(schemaJson),estimatedInputTokens:Math.ceil((full.length+schemaJson.length)/4),estimateMethod:'UTF16 chars/4; heuristic only, tokenizer/capacity unverified',hardTokenAdmission:false,durationMs};
}
function budget({prompt,schema,prefix='',maxChars=900000,maxBytes=2097152,outputReserveChars=16384,deadline=Infinity,callbackCount=0,callbackMs=15000,controlReserveMs=30000,now=Date.now()}){
 const envelopeChars=prefix.length+prompt.length+JSON.stringify(schema||{}).length+outputReserveChars;
 if(envelopeChars>maxChars||Buffer.byteLength(prefix+prompt)+Buffer.byteLength(JSON.stringify(schema||{}))+outputReserveChars>maxBytes)throw Object.assign(Error('AGENT_CONTEXT_LIMIT'),{code:'AGENT_CONTEXT_LIMIT',status:413});
 if(deadline-now<callbackCount*callbackMs+controlReserveMs)throw Object.assign(Error('AGENT_EXECUTION_TIME_BUDGET'),{code:'AGENT_EXECUTION_TIME_BUDGET',status:504});
 return{envelopeChars,hardTokenAdmission:false,requiredExecutionMs:callbackCount*callbackMs+controlReserveMs};
}
function persistMeasurement(root,value,rawUsageEvents=[],traceInput=null){
 if(root===null)return null;
 if(!path.isAbsolute(root||'')||!/^[a-f0-9-]{36}$/.test(value?.measurementId||''))throw Object.assign(Error('AGENT_USAGE_SCOPE_INVALID'),{code:'AGENT_USAGE_SCOPE_INVALID'});
 fs.mkdirSync(root,{recursive:true});if(fs.realpathSync(root)!==root)throw Object.assign(Error('AGENT_USAGE_SCOPE_INVALID'),{code:'AGENT_USAGE_SCOPE_INVALID'});
 const group=crypto.createHash('sha256').update(value.requestGroupId||'uncorrelated').digest('hex'),directory=path.join(root,group);fs.mkdirSync(directory,{recursive:true});if(fs.realpathSync(directory)!==directory||fs.readdirSync(directory).length>=4096)throw Object.assign(Error('AGENT_USAGE_RECORD_LIMIT'),{code:'AGENT_USAGE_RECORD_LIMIT'});
 const file=path.join(directory,value.measurementId+'.json'),body=JSON.stringify({measurement:value,rawUsageEvents},null,2)+'\n';
 if(Buffer.byteLength(body)>4194304)throw Object.assign(Error('AGENT_USAGE_RECORD_LIMIT'),{code:'AGENT_USAGE_RECORD_LIMIT'});
 if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==body)throw Object.assign(Error('AGENT_USAGE_REPLAY'),{code:'AGENT_USAGE_REPLAY'});return file;}
 if(traceInput){const inputBody=JSON.stringify(traceInput,null,2)+'\n';if(Buffer.byteLength(inputBody)>4194304)throw Object.assign(Error('AGENT_USAGE_RECORD_LIMIT'),{code:'AGENT_USAGE_RECORD_LIMIT'});fs.writeFileSync(path.join(directory,value.measurementId+'.input.json'),inputBody,{flag:'wx',mode:0o600});}
 fs.writeFileSync(file,body,{flag:'wx',mode:0o600});return file;
}
function requestTotals(root,requestId){
 const group=typeof requestId==='string'?requestId.slice(0,requestId.lastIndexOf(':')):null;
 if(!group||!path.isAbsolute(root||''))return{status:'UNKNOWN',reason:'No correlated planner-client-session root',actualInputTokens:null,actualOutputTokens:null,actualCost:null};
 const directory=path.join(root,crypto.createHash('sha256').update(group).digest('hex'));
 if(!fs.existsSync(directory))return{status:'UNKNOWN',reason:'No durable usage records',actualInputTokens:null,actualOutputTokens:null,actualCost:null};
 const names=fs.readdirSync(directory);if(names.length>4096)throw Object.assign(Error('AGENT_USAGE_RECORD_LIMIT'),{code:'AGENT_USAGE_RECORD_LIMIT'});
 const records=names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8')).measurement).filter(m=>m.requestGroupId===group);
 const sum=key=>records.length&&records.every(m=>units(m[key])!==null)?records.reduce((n,m)=>n+m[key],0):null;
 return{status:records.length?'RECORDED_WITH_EXPLICIT_UNKNOWNS':'UNKNOWN',requestGroupId:group,groupScope:'planner-client-session; no universal whole-product cost claim',measurementIds:records.map(m=>m.measurementId),stages:records.map(m=>({requestId:m.requestId,runId:m.runId,stage:m.stage,attempt:m.attempt,method:m.method})),actualInputTokens:sum('actualInputTokens'),actualOutputTokens:sum('actualOutputTokens'),cachedInputSubsetTokens:sum('cachedInputSubsetTokens'),reasoningOutputSubsetTokens:sum('reasoningOutputSubsetTokens'),knownPartialInputTokens:records.reduce((n,m)=>n+(m.actualInputTokens||0),0),missingUsageStages:records.filter(m=>m.actualInputTokens===null||m.actualOutputTokens===null).map(m=>m.measurementId),cliTurns:sum('cliTurns'),toolCalls:sum('toolCalls'),providerModelAttempts:null,providerModelAttemptsReason:'CLI turns do not expose internal provider iterations',actualCost:null};
}
module.exports={usageFromEvents,measurement,budget,persistMeasurement,requestTotals};

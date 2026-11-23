'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const units=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const usageFields=['input_tokens','output_tokens','cached_input_tokens','reasoning_output_tokens'];
function createUsageTracker(){
 const sessions=new Map();
 return {clear:()=>sessions.clear(),start({cumulativeUsage=false,resumeSessionId=null}={}){
  let sessionId=null,identified=false,lastUsage=null,previous=resumeSessionId?sessions.get(resumeSessionId):Object.fromEntries(usageFields.map(key=>[key,0]));
  const state={events:[],done:false,event(event){
   if(state.done)return;
   if(cumulativeUsage&&event?.type==='thread.started'){
    if(sessionId===null){sessionId=event.thread_id;identified=typeof sessionId==='string'&&/^[a-f0-9-]{36}$/i.test(sessionId)&&(resumeSessionId?sessionId===resumeSessionId:!sessions.has(sessionId));}
    else if(sessionId!==event.thread_id)identified=false;
    return;
   }
   if(!['turn.started','turn.completed','turn.failed'].includes(event?.type))return;
   let usage;
   if(event.type==='turn.completed'){
    usage=Object.fromEntries(usageFields.map(key=>[key,event.usage?.[key]]));
    if(cumulativeUsage){
     const raw=usage;
     usage=Object.fromEntries(usageFields.map(key=>[key,identified&&units(raw[key])!==null&&units(previous?.[key])!==null&&raw[key]>=previous[key]?raw[key]-previous[key]:undefined]));
     lastUsage=raw;previous=raw;
    }
   }
   state.events.push({type:event.type,usage});
  },end(){
   if(state.done)return;state.done=true;
   if(cumulativeUsage){
    const key=resumeSessionId||sessionId;
    if(identified&&state.events.at(-1)?.type==='turn.completed'&&units(lastUsage?.input_tokens)!==null&&units(lastUsage?.output_tokens)!==null)sessions.set(sessionId,lastUsage);
    else if(key)sessions.delete(key);
   }
  }};return state;
 }};
}
function usageFromEvents(events,usageEvents=null){
 const observed=usageEvents||events||[],turns=observed.filter(e=>e.type==='turn.completed');
 const complete=!usageEvents||!observed.some(e=>e.type==='turn.failed')&&observed.filter(e=>e.type==='turn.started').length<=turns.length;
 const total=key=>{if(!complete||!turns.length||!turns.every(e=>units(e.usage?.[key])!==null&&(!['cached_input_tokens','reasoning_output_tokens'].includes(key)||e.usage[key]<=e.usage[key==='cached_input_tokens'?'input_tokens':'output_tokens'])))return null;return units(turns.reduce((n,e)=>n+e.usage[key],0));};
 return{actualUsageReason:usageEvents?'Per-run deltas of cumulative CLI counters; missing checkpoints or incomplete turns remain unknown.':turns.length?'Only emitted provider usage fields are actual; missing fields remain null.':'No turn.completed usage event emitted',effectiveModelReason:events.some(e=>typeof e.model==='string')?null:'Effective model not exposed by CLI events',toolCalls:new Set((events||[]).filter(e=>e.item?.type==='mcp_tool_call').map(e=>e.item.id)).size,actualInputTokens:total('input_tokens'),actualOutputTokens:total('output_tokens'),cachedInputSubsetTokens:total('cached_input_tokens'),reasoningOutputSubsetTokens:total('reasoning_output_tokens'),
  cliTurns:turns.length,providerModelAttempts:null,providerModelAttemptsReason:'CLI turn events do not establish the number of internal provider iterations.',effectiveModel:events.find(e=>typeof e.model==='string')?.model||null,actualCost:null,actualCostReason:'No verified effective-model tariff; cached/reasoning are subsets, not additive totals.'};
}
function measurement({prompt,schema,prefix='',events=[],usageEvents=null,durationMs=null,requestId=null,runId=null,stage,attempt=null,method=null}){
 const full=prefix+prompt,schemaJson=JSON.stringify(schema||{});
 const landing=typeof requestId==='string'&&/^landing-chat:[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(requestId);
 return{schemaVersion:'apollo.request-usage.v1',measurementId:crypto.randomUUID(),atUtc:new Date().toISOString(),requestId,requestGroupId:typeof requestId==='string'&&(/^prompt-plan:[a-f0-9]{16}:[1-9][0-9]*$/.test(requestId)||landing)?requestId.slice(0,requestId.lastIndexOf(':')):null,groupScope:landing?'landing-chat including structure/content and deliberate retries':'planner-client-session including refinements/retries; paired trials must isolate the same task',runId,stage,attempt,method,...usageFromEvents(events,usageEvents),promptUtf16Chars:full.length,promptUtf8Bytes:Buffer.byteLength(full),schemaUtf16Chars:schemaJson.length,schemaUtf8Bytes:Buffer.byteLength(schemaJson),estimatedInputTokens:Math.ceil((full.length+schemaJson.length)/4),estimateMethod:'UTF16 chars/4; heuristic only, tokenizer/capacity unverified',hardTokenAdmission:false,durationMs};
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
module.exports={createUsageTracker,usageFromEvents,measurement,budget,persistMeasurement,requestTotals};

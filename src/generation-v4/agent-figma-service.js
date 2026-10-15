'use strict';
const {failureDiagnostic,readFailure}=require('./failure-diagnostic');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {validInput} = require('./prompt-service');
const MUTATIONS = ['create_root','create_frame','create_instance','write_property','clear_slot','clone_template','append_child','set_layout','remove_owned'];
const NATIVE_BATCH_SIZE = 4;
const fail = (code, status = 409) => { throw Object.assign(Error(code), {code, status}); };

// Only the model view is deduplicated. Frozen packets and broker policy retain their complete inputs.
function nativePromptContext(authoring,targetMapping,ruleLinks,policy,spec) {
 const contracts=authoring?.contracts||[],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const links=value=>Array.isArray(value)?value.map(link=>{
  const contract=contracts.find(c=>c.pin.componentId===link.componentId),index=link.source?.pointer?.match(/^\/rules\/(\d+)$/),rule=index&&contract?.manual.rules[Number(index[1])];
  if(!rule||rule.id!==link.RuleID||!same(rule,link.rule))return link;
  const {rule:duplicate,...reference}=link;return reference;
 }):value;
 let view=authoring,native=policy;
 if(policy.genericMapping){
  const generic={...policy.genericMapping};
  if(Array.isArray(generic.manuals))generic.manuals=generic.manuals.map(record=>{const c=contracts.find(c=>same(c.manual,record.manual));if(!c)return record;const {manual,...reference}=record;return{...reference,componentId:c.pin.componentId};});
  if(generic.ruleLinks?.links)generic.ruleLinks={...generic.ruleLinks,links:links(generic.ruleLinks.links)};
  // The version is frozen: unused sibling profiles cannot be selected in this run.
  if(Array.isArray(spec?.nodes)&&Array.isArray(generic.semantic?.mappings)){
   const used=new Set(spec.nodes.filter(n=>n.kind==='component').map(n=>n.mappingId));
   const mappings=generic.semantic.mappings.filter(m=>used.has(m.mappingId));
   const choices=new Set(mappings.flatMap(m=>m.choices||[]));
   if(choices.size&&Array.isArray(generic.profiles?.choices)&&Array.isArray(generic.targets?.profiles)&&Array.isArray(generic.typed?.bindings)){
    generic.semantic={...generic.semantic,mappings};
    generic.typed={...generic.typed,bindings:generic.typed.bindings.filter(b=>used.has(b.mappingId))};
    generic.profiles={...generic.profiles,choices:generic.profiles.choices.filter(c=>choices.has(c.id)),profiles:generic.profiles.profiles?.filter(p=>choices.has(p.choiceId))};
    generic.targets={...generic.targets,profiles:generic.targets.profiles.filter(p=>choices.has(p.choiceId))};
   }
  }
  if(authoring?.figmaMappingRecords){const records={...authoring.figmaMappingRecords};for(const key of ['semantic','typed','manuals','denials'])if(same(records[key],policy.genericMapping[key]))delete records[key];view={...authoring,figmaMappingRecords:records};}
  native={...policy,genericMapping:generic};
 }
 return{authoring:view,targetMapping:targetMapping.semanticMapping||targetMapping,ruleLinks:links(ruleLinks),policy:native};
}

function nativePromptEvidence(receipts,verdicts){
 const counts=new Map(),table=[],indices=new Map();
 for(const entry of receipts.concat(verdicts))for(const check of entry.checks||[]){const key=JSON.stringify(check);counts.set(key,(counts.get(key)||0)+1);}
 const checks=values=>values.map(check=>{const key=JSON.stringify(check);if(counts.get(key)<2)return check;if(!indices.has(key)){indices.set(key,table.length);table.push(check);}return{id:check.id,status:check.status,checkRef:indices.get(key)};});
 const observations=receipts.map((o,i)=>{
  const view=i===receipts.length-1?{...o}:{evidenceHash:o.evidenceHash,callId:o.callId,sequence:o.sequence,status:o.status,rootNodeId:o.rootNodeId,operations:o.operations,checks:o.checks,gaps:o.gaps,rollback:o.rollback,writesPerformed:o.writesPerformed,readbackOmitted:true};
  view.checks=checks(o.checks);
  // Text-only CLI input cannot interpret PNG bytes. Keep the image in the original receipt.
  if(view.export?.base64){const {base64,...metadata}=view.export;view.export={...metadata,base64Omitted:true};}
  return view;
 });
 return{observations,postconditions:verdicts.map(v=>({...v,checks:checks(v.checks)})),checks:table};
}

function createAgentFigmaService({inputs, cli, protocol: p, nativeProtocol: n, hash, resolveNativePolicy, validatePostconditions,
 traceRoot, readonlyRoot, executionEnvironment = 'native-plugin-api', maxSteps = 8, operationTimeoutMs = 15000, runTimeoutMs = 900000} = {}) {
 if (!inputs || !cli || !p || !n || typeof hash !== 'function' || typeof resolveNativePolicy !== 'function' || typeof validatePostconditions !== 'function'
  || !['native-plugin-api','synthetic-plugin-api'].includes(executionEnvironment)
  || !Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 8
  || !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 15000
  || !Number.isSafeInteger(runTimeoutMs) || runTimeoutMs < 1 || runTimeoutMs > 900000) fail('AGENT_EXECUTION_UNAVAILABLE', 503);
 const runs = new Map(), seen = new Set(), terminal = ['completed','blocked','failed','cancelled'];
 const clone = p.clone, ids = ['runId','revision','specHash','contextHash','target'];
 // Codex strict output supports anyOf, not oneOf. Operation tags are disjoint; native request validation stays authoritative.
 const modelOperations = {...n.schemas.operation.properties.operations,minItems:0,items:{anyOf:Object.entries(n.operations).map(([operation,args]) => ({
  type:'object',properties:{operation:{type:'string',enum:[operation]},arguments:args},required:['operation','arguments'],additionalProperties:false}))}};
 // Only the CLI decision envelope is local. Every operation uses the reviewed native arguments.
 const stepSchema = {type:'object', properties:{kind:{type:'string',enum:['operation','finish','question','capabilityGap']},
  operations:modelOperations,
  message:n.schemas.rollback.properties.message,
  observationHashes:{type:'array', items:{type:'string',pattern:'^[a-f0-9]{64}$'}, minItems:0,
   maxItems:maxSteps*Math.ceil(n.schemas.operation.properties.operations.maxItems/NATIVE_BATCH_SIZE)}},
  required:['kind','operations','message','observationHashes'], additionalProperties:false};
 const addGap = (r, code, message) => {
  const d=readFailure(message);if(d&&d.modelStep===null&&Number.isSafeInteger(r.modelStep)){const value=JSON.parse(message.slice(message.indexOf('{')));value.modelStep=r.modelStep;const enriched=message.slice(0,message.indexOf('{'))+JSON.stringify(value);if(enriched.length<=2048)message=enriched;}
  const gap = {code, message:String(message).slice(0,2048) || code};
  if (!r.gaps.some(g => hash(g) === hash(gap))) r.gaps.length < 128 ? r.gaps.push(gap) : r.gaps[127] = gap;
 };
 const progress = (r, kind, message) => {
  r.progress.push({sequence:++r.sequence,kind,message:String(message).slice(0,2048)});
  if (r.progress.length > 256) r.progress.shift();
 };
 function snapshot(r) {
  const value = {schemaVersion:n.schemas.snapshot.properties.schemaVersion.const,identity:r.identity,sequence:r.sequence,status:r.status,
   capabilities:r.capabilities,progress:r.progress,pendingOperation:r.pendingOperation,result:r.result,gaps:r.gaps};
  value.snapshotHash = p.hashWithout(value,'snapshotHash');
  if (!n.validSnapshot(value,r.identity)) fail('AGENT_SNAPSHOT_INVALID',503);
  return clone(value);
 }
 function find(identity) {
  if (!p.validIdentity(identity) || identity.target !== 'figma') fail('AGENT_REQUEST_INVALID',400);
  const r = runs.get(identity.runId);
  if (!r) fail('AGENT_RUN_NOT_FOUND',404);
  if (!p.sameIdentity(identity,r.identity)) fail('AGENT_RUN_STALE');
  return r;
 }
 async function current(r) {
  if (r.controller.signal.aborted) fail('AGENT_CANCELLED');
  if (Date.now() >= r.deadline) fail('AGENT_RUN_TIMEOUT',504);
  try { await r.resolved.assertCurrent(); await r.policy.assertCurrent(); }
  catch { fail('AGENT_INPUTS_STALE'); }
  if (r.controller.signal.aborted) fail('AGENT_CANCELLED');
 }
 function finish(r,status,message,checks = [],artifact = null) {
  r.status = status; r.pendingOperation = null;
  progress(r,'check',message);
  r.result = {message,artifact,checks,writesPerformed:r.writesPerformed,
   acceptedWriteOperations:status === 'completed' ? [...r.observedMutations] : [],Ready:false};
 }
 function terminate(r,status,code) {
  if (terminal.includes(r.status)) return;
  if(!r.gaps.some(g=>g.code===code))addGap(r,code,JSON.stringify(failureDiagnostic(code,{...r.identity,phase:r.phase||'admission',modelStep:r.modelStep,callId:r.pendingOperation?.callId,nativeSequence:r.pendingOperation?.sequence},'err:'+crypto.randomUUID())));
  const pending = r.pendingOperation;
  if (pending) {
   r.lateTicket = {operation:clone(pending),expires:Date.now()+operationTimeoutMs};
   if (pending.operations.some(x => MUTATIONS.includes(x.operation))) r.writesPerformed = true;
  }
  if (r.writesPerformed || pending) addGap(r,'AGENT_CLEANUP_UNKNOWN','No independently correlated cleanup acknowledgement; pending mutation may have written. Owned-root rollback is unconfirmed.');
  r.controller.abort(); r.rejectObservation?.(Object.assign(Error(code),{code}));
  inputs.invalidate(r.identity);
  finish(r,status,code,[{id:'native-cleanup',status:'unknown',origin:'agent-report',message:'Independent native cleanup receipt has not yet been received.',evidenceHash:null}]);
 }
 async function admit(body) {
  if (!p.closed(body,['schemaVersion','input','version','target','parentIdentity']) || body.target !== 'figma'
   || body.schemaVersion !== 'apollo.agent-draft-request.v1' || !validInput(body.input) || !p.validScreenVersion(body.version)
   || body.parentIdentity !== null && !p.validIdentity(body.parentIdentity)
   || !p.bounded(body,2097152)) fail('AGENT_DRAFT_INVALID',400);
  const value = await inputs.admitDraft(clone(body));
  if (!p.validIdentity(value?.identity) || value.identity.target !== 'figma' || !p.validScreenVersion(value.version)
   || hash(value.version) !== hash(body.version) || value.identity.specHash !== value.version.specHash
   || value.identity.revision !== value.version.revision) fail('AGENT_ADMISSION_INVALID',503);
  if (body.parentIdentity) {
   const previous = runs.get(body.parentIdentity.runId);
   if (previous && p.sameIdentity(previous.identity,body.parentIdentity)) terminate(previous,'cancelled','AGENT_REFINEMENT_CANCELLED');
  }
  return {identity:clone(value.identity),version:clone(value.version)};
 }
 async function start(body) {
  if (!p.closed(body,['identity','lease','capabilities']) || !p.validIdentity(body.identity) || body.identity.target !== 'figma'
   || !n.valid(n.schemas.lease,body.lease) || !Array.isArray(body.capabilities)
   || body.capabilities.length > 14 || new Set(body.capabilities).size !== body.capabilities.length
   || body.capabilities.some(c => !Object.hasOwn(n.operations,c))) fail('AGENT_REQUEST_INVALID',400);
  const identity = clone(body.identity);
  const existing = runs.get(identity.runId);
  const sameStart = r => {
   if (!p.sameIdentity(identity,r.identity) || hash(body.lease) !== hash(r.lease)
    || hash(body.capabilities) !== hash(r.capabilities)) fail('AGENT_RUN_STALE');
   return snapshot(r);
  };
  if (existing) return sameStart(existing);
  if (seen.has(identity.runId)) fail('AGENT_RUN_REPLAY');
  const resolved = await inputs.resolveAgentRun(identity), packet = resolved?.packet;
  if (!packet || typeof resolved.assertCurrent !== 'function' || !p.sameIdentity({runId:packet.runId,revision:packet.revision,
   specHash:packet.specHash,contextHash:packet.contextHash,target:packet.target},identity)
   || hash(packet.spec) !== identity.specHash || hash(packet.context) !== identity.contextHash
   || !packet.context || typeof packet.context !== 'object' || Array.isArray(packet.context)
   || !p.validScreenVersion(packet.version) || packet.version.revision !== identity.revision || packet.version.specHash !== identity.specHash
   || packet.context.versionHash !== packet.version.versionHash || hash(packet.version.spec) !== hash(packet.spec)
   || !Array.isArray(packet.skills) || !packet.skills.length || packet.skills.length > 8 || new Set(packet.skills.map(s=>s?.id)).size !== packet.skills.length
   || !Array.isArray(packet.context.skills) || packet.context.skills.length !== packet.skills.length
   || packet.context.skills.some(pin=>!p.closed(pin,['id','sha256']))
   || packet.skills.some(s=>!p.closed(s,['id','text','sha256']) || typeof s.id !== 'string' || !s.id.length || s.id.length > 120
    || typeof s.text !== 'string' || !s.text.trim() || Buffer.byteLength(s.text) > 262144
    || typeof s.sha256 !== 'string' || crypto.createHash('sha256').update(s.text).digest('hex') !== s.sha256
    || !packet.context.skills.some(pin=>pin.id===s.id && pin.sha256===s.sha256))
   || !packet.context.targetMapping || typeof packet.context.targetMapping !== 'object'
   || !packet.context.ruleLinks || typeof packet.context.ruleLinks !== 'object'
   || !p.bounded(packet,2097152)) fail('AGENT_PACKET_INVALID',503);
  const policy = await resolveNativePolicy({identity:clone(identity),packet:clone(packet)});
  if (!policy || typeof policy.assertCurrent !== 'function' || typeof policy.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(policy.sourceHash)
   || policy.sourceHash !== body.lease.sourceHash
   || !Array.isArray(policy.capabilities) || !policy.capabilities.length
   || new Set(policy.capabilities).size !== policy.capabilities.length || policy.capabilities.some(c => !Object.hasOwn(n.operations,c))
   || body.capabilities.some(c => !policy.capabilities.includes(c)) || !body.capabilities.length
   || !policy.context || typeof policy.context !== 'object' || Array.isArray(policy.context)
   || !p.bounded(policy.context,1048576)) fail('AGENT_NATIVE_POLICY_UNAVAILABLE',503);
  await resolved.assertCurrent(); await policy.assertCurrent();
  if (runs.has(identity.runId)) return sameStart(runs.get(identity.runId));
  if (seen.has(identity.runId)) fail('AGENT_RUN_REPLAY');
  if (seen.size >= 4096) fail('AGENT_RUN_LIMIT',429);
  if (runs.size >= 16) {
   const old = [...runs].find(([,r]) => terminal.includes(r.status) && (!r.lateTicket || r.lateTicket.expires < Date.now()));
   if (!old) fail('AGENT_RUN_LIMIT',429);
   runs.delete(old[0]);
  }
  const frozenPolicy = {sourceHash:policy.sourceHash,capabilities:clone(policy.capabilities),context:clone(policy.context),assertCurrent:()=>policy.assertCurrent()};
  const r = {identity,lease:clone(body.lease),capabilities:clone(body.capabilities),resolved,packet:clone(packet),policy:frozenPolicy,
   controller:new AbortController(),deadline:Date.now()+runTimeoutMs,status:'queued',sequence:0,progress:[],gaps:[],
   pendingOperation:null,result:null,observations:[],postconditions:[],writesPerformed:false,actualWrites:false,observedMutations:new Set(),operationCount:0,nativeCalls:0,
   controlTickets:new Map(),controlReceipts:[]};
  runs.set(identity.runId,r); seen.add(identity.runId); progress(r,'context','Current server policy and host lease frozen; engineering Draft only.');
  const timer = setTimeout(() => terminate(r,'failed','AGENT_RUN_TIMEOUT'),runTimeoutMs); timer.unref?.();
  r.job = Promise.resolve().then(() => execute(r)).catch(error => {
   if (terminal.includes(r.status)) return;
   const code = /^AGENT_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AGENT_EXECUTION_FAILED';
   addGap(r,code,readFailure(error.diagnostic)?error.diagnostic:JSON.stringify(failureDiagnostic(code,{...r.identity,phase:r.phase||'admission',modelStep:r.modelStep,callId:r.pendingOperation?.callId,nativeSequence:r.pendingOperation?.sequence,sourceHash:r.policy.sourceHash},'err:'+crypto.randomUUID()))); terminate(r,code.includes('STALE') || code.includes('UNAVAILABLE') ? 'blocked' : 'failed',code);
  }).finally(() => clearTimeout(timer));
  return snapshot(r);
 }
 function consume(r,body,operation) {
  r.observations.push(clone(body)); r.actualWrites ||= body.writesPerformed; r.writesPerformed ||= body.writesPerformed;
  for (const item of body.operations) if (MUTATIONS.includes(item.operation) && item.status === 'passed') r.observedMutations.add(item.operation);
  for (const g of body.gaps) addGap(r,g.code,g.message);
  if (body.rollback.status === 'incomplete' || body.rollback.status === 'not-attempted') addGap(r,'AGENT_CLEANUP_INCOMPLETE',body.rollback.message);
  progress(r,'tool','Correlated broker readback received: '+body.status);
 }
 async function observation(body) {
  const r = find(body?.identity);
  if (r.lateTicket && terminal.includes(r.status)) {
   if (r.lateTicket.expires < Date.now() || r.lateTicket.consumed) fail('AGENT_OBSERVATION_REPLAY');
   if (!n.validObservation(body,r.identity,r.lateTicket.operation)) fail('AGENT_OBSERVATION_INVALID',400);
   r.lateTicket.consumed = true;
   consume(r,body,r.lateTicket.operation);
   r.result.writesPerformed = r.writesPerformed;
   r.result.checks = clone(body.checks);
   // This is the original operation's late receipt, never a new cleanup token or native acceptance.
   addGap(r,'AGENT_TERMINAL_LATE_RECEIPT','Late partial-operation facts preserved; no terminal promotion or independent cleanup admission.');
   return snapshot(r);
  }
  const operation = r.pendingOperation;
  if (r.status !== 'awaiting-operation' || !operation || r.observationInFlight) fail('AGENT_OBSERVATION_REPLAY');
  if (!n.validObservation(body,r.identity,operation)) fail('AGENT_OBSERVATION_INVALID',400);
  r.observationInFlight = true;
  // Keep mutation facts even if source freshness fails after the native action.
  consume(r,body,operation);
  r.pendingOperation = null; r.status = 'running';
  try {
   await current(r);
   if (r.lastAfterHash && body.beforeHash && body.beforeHash !== r.lastAfterHash) fail('AGENT_OBSERVATION_STALE');
   const verdict = validatePostconditions({version:clone(r.packet.version),observation:clone(body),
    request:{schemaVersion:'apollo.agent-figma-operation.v2',identity:clone(r.identity),...clone(operation)}});
   if (!p.closed(verdict,['schemaVersion','status','checks','Ready']) || verdict.schemaVersion !== 'apollo.agent-figma-postcondition-result.v1'
    || !['passed','failed','unknown'].includes(verdict.status) || verdict.Ready !== false
    || !Array.isArray(verdict.checks) || verdict.checks.length > 256 || !verdict.checks.every(p.validCheck)) fail('AGENT_POSTCONDITION_INVALID',503);
   r.postconditions.push({observationHash:body.evidenceHash,...clone(verdict)});
   progress(r,'check','Frozen ScreenVersion postconditions: '+verdict.status);
   await current(r);
   r.lastAfterHash = body.afterHash;
   // The broker cancels every unknown execute and rolls back; only passing
   // execution with failed postconditions can be repaired in the same run.
   if (body.status !== 'passed') {
    terminate(r,'blocked','AGENT_NATIVE_RUN_ENDED');
    const checks = [...new Map(body.checks.concat(verdict.checks).map(c=>[c.id,c])).values()].filter(c=>c.id!=='native-cleanup');
    const rank = c => c.status==='failed'?0:c.status==='unknown'?1:2;
    checks.sort((a,b)=>rank(a)-rank(b));
    // Full observations/postconditions are recorded; reserve the wire slot for
    // independent cleanup and expose any display limit without promoting the run.
    if (checks.length>255) addGap(r,'AGENT_NATIVE_CHECK_DISPLAY_LIMIT','The terminal summary shows at most 255 checks; full observations and postconditions remain recorded.');
    r.result.checks = clone(checks.slice(0,255).concat(r.result.checks));
    r.result.message = 'Сборка остановлена: '+(body.gaps[0]?.code||'AGENT_NATIVE_RUN_ENDED')+'. Native запуск завершён; повторная запись требует нового запуска.';
    return snapshot(r);
   }
   r.resolveObservation(clone(body));
  } catch (error) { if(error.diagnostic)addGap(r,error.code,error.diagnostic);r.rejectObservation?.(error); throw error; }
  finally { r.observationInFlight = false; }
  return snapshot(r);
 }
 async function controlTicket(body) {
  if (!n.valid(n.schemas.controlHttpRequest,body)) fail('AGENT_CONTROL_INVALID',400);
  const r = find(body.identity);
  if (hash(body.lease) !== hash(r.lease)) fail('AGENT_CONTROL_STALE');
  const ticket = {requestId:'control:'+crypto.randomBytes(16).toString('hex'),nonce:crypto.randomBytes(24).toString('hex'),
   identity:clone(r.identity),lease:clone(r.lease),kind:body.kind,reason:body.reason};
  if (!n.validTicket(ticket,r.identity,r.lease,body.kind)) fail('AGENT_CONTROL_INVALID',400);
  if (body.kind === 'retain') {
   if (r.status !== 'completed' || r.retained || r.unconfirmedRetain) fail('AGENT_CONTROL_STALE');
   await current(r);
   if (r.status !== 'completed' || r.retained || r.unconfirmedRetain) fail('AGENT_CONTROL_STALE');
  } else {
   if (r.retained || r.unconfirmedRetain) fail('AGENT_RUN_RETAINED');
   // A completed model result is provisional until the independent retain receipt.
   if (r.status === 'completed') r.status = 'running';
   terminate(r,'cancelled','AGENT_CANCELLED');
   r.controlTickets.delete('retain');
  }
  r.controlTickets.set(body.kind,{ticket,expires:Date.now()+30000});
  return clone(ticket);
 }
 async function controlObservation(body) {
  const r = find(body?.ticket?.identity),ticket = body.ticket,stored = r.controlTickets.get(ticket.kind);
  if (!stored || stored.inFlight || stored.expires < Date.now() || hash(stored.ticket) !== hash(ticket)) fail('AGENT_CONTROL_REPLAY');
  const cleanup = ticket.kind === 'cancel';
  if (!(cleanup ? n.validCleanup(body,ticket) : n.validRetain(body,ticket))) fail('AGENT_CONTROL_INVALID',400);
  if (cleanup && body.writesPerformed === false && r.actualWrites) fail('AGENT_CONTROL_INVALID',400);
  if (!cleanup && (r.status !== 'completed' || !r.result?.artifact || hash(body.artifact) !== hash(r.result.artifact))) fail('AGENT_CONTROL_STALE');
  stored.inFlight = true;
  try {
   if (cleanup) {
    r.controlReceipts.push(clone(body));
    r.actualWrites ||= body.writesPerformed === true;
    if (body.origin === 'native-broker' && body.status === 'complete') r.writesPerformed = r.actualWrites;
    else r.writesPerformed ||= body.writesPerformed === true;
    r.result.writesPerformed = r.writesPerformed;
    if (body.origin === 'native-broker' && body.status !== 'unknown') {
     r.gaps = r.gaps.filter(g => !['AGENT_CLEANUP_UNKNOWN','AGENT_CLEANUP_INCOMPLETE'].includes(g.code));
     if (body.status === 'incomplete') addGap(r,'AGENT_CLEANUP_INCOMPLETE',body.rollback.message);
    }
    const status = ['complete','preserved'].includes(body.status) ? 'passed' : body.status === 'incomplete' ? 'failed' : 'unknown';
    const check = {id:body.status==='preserved'?'native-preservation':'native-cleanup',status,origin:body.origin === 'native-broker' ? 'tool-observation' : 'agent-report',
     message:body.rollback.message,evidenceHash:body.evidenceHash};
    r.result.checks = r.result.checks.filter(c => !['native-cleanup','native-preservation'].includes(c.id)).concat(check);
    progress(r,'check',(body.status==='preserved'?'Independent preservation receipt: ':'Independent cleanup receipt: ')+body.status);
   } else {
    // Preserve actual retained-root evidence even if current source admission fails afterwards.
    r.unconfirmedRetain = clone(body);
    await current(r);
    if (r.status !== 'completed' || r.controlTickets.get('retain') !== stored) fail('AGENT_CONTROL_STALE');
    r.controlReceipts.push(clone(body)); r.retained = true; r.unconfirmedRetain = null;
    progress(r,'check','Independent actual artifact retain receipt accepted.');
   }
   r.controlTickets.delete(ticket.kind);
   const ack = {success:true,requestId:ticket.requestId,nonce:ticket.nonce,accepted:true};
   if (!n.valid(n.schemas.controlAck,ack)) fail('AGENT_CONTROL_INVALID',503);
   return ack;
  } finally { stored.inFlight = false; }
 }
 async function execute(r) {
  await current(r); const probe = await cli.probe(); await current(r);
  if (!probe.available || !probe.profiles?.includes('figma-engineering')) fail('AGENT_PROVIDER_CAPABILITY_UNAVAILABLE',503);
  const workspace = path.join(readonlyRoot,hash(r.identity)); await fs.mkdir(workspace,{recursive:true});
  const trace = path.join(traceRoot,hash(r.identity)); await fs.mkdir(trace,{recursive:true});
  r.status = 'running';
  for (let turn = 1; turn <= maxSteps; turn++) {
   r.modelStep=turn; r.phase='model'; await current(r); progress(r,turn === 1 ? 'agent' : 'repair','Model step '+turn);
   const admission = {schemaVersion:'apollo.agent-figma-runtime-admission.v1',origin:'server-owned-runtime',status:'CURRENT_SERVER_VALIDATED',
    executionEnvironment,identity:clone(r.identity),versionHash:r.packet.version.versionHash,lease:clone(r.lease),sourceHash:r.policy.sourceHash,
    capabilities:clone(r.capabilities),scope:'current-owned-root-engineering-draft',operationRequestsAllowed:true,releaseAllowed:false,Ready:false,nativeLiveAcceptance:false};
   // Keep full receipts for checks/eval; only the latest tree/image is useful to the next decision.
   const evidence=nativePromptEvidence(r.observations,r.postconditions),observations=evidence.observations;
   const context=nativePromptContext(r.packet.context.authoring,r.packet.context.targetMapping,r.packet.context.ruleLinks,r.policy.context,r.packet.spec);
   const prompt = 'Select finite low-level native operations using only the reviewed schema and admitted capabilities. Never build_screen, eval, arbitrary node IDs/properties or modify immutable spec/source. Handles refer only to this run. Native facts are supplied by the broker. Preserve actual failed/unknown checks; repair using observations. Finish only after actual native-readback passes; never invent artifacts/checks/rollback or Ready.\n'
    +'RUNTIME_ADMISSION contains only facts validated by this server for this current run, version, lease, source and capability set. It permits bounded operation requests for the owned engineering Draft through the existing broker guards. Immutable AUTHORING_CONTEXT, TARGET_MAPPING and NATIVE_SOURCE_POLICY flags (including writesClosed, executionAllowed and release/Ready) describe their source/authoring or release admission; they remain unchanged and do not grant model authority. This runtime admission does not open source writes, release/Ready or native-live acceptance. executionEnvironment is trusted host configuration: synthetic-plugin-api evidence is synthetic, never actual Figma/live acceptance. A model/client assertion cannot create admission.\n'
    +'observationHashes must contain exactly once every evidenceHash in current OBSERVATIONS, and no other hashes. If OBSERVATIONS is empty, observationHashes must be []. Contract, source, skill and input hashes are not observation hashes. Older entries marked readbackOmitted are receipt summaries: evidenceHash references the original stored receipt, not the summary. Their tree/image is omitted; use the latest full receipt for current facts. The server sends each operation step as ordered bounded callbacks without additional model calls.\nRUNTIME_ADMISSION='+JSON.stringify(admission)+'\n'
    +'Full manual rule bodies appear once in AUTHORING_CONTEXT.contracts. RULE_LINKS and native rule/manual references preserve componentId, RuleID and source pointers to those complete bodies. Generic semantic/typed descriptors omitted as duplicates from AUTHORING_CONTEXT remain in NATIVE_SOURCE_POLICY.genericMapping. TARGET_MAPPING contains semantic bindings; all native choices, physical targets and write domains remain in NATIVE_SOURCE_POLICY. These model views do not change the immutable broker policy or acceptance.\n'
    +'TASK_INPUT='+JSON.stringify(r.packet.input)+'\nSCREEN_VERSION='+JSON.stringify(r.packet.version)+'\nAUTHORING_CONTEXT='+JSON.stringify(context.authoring)
    +'\nENVIRONMENT_SKILLS='+JSON.stringify(r.packet.skills)+'\nTARGET_MAPPING='+JSON.stringify(context.targetMapping)
    +'\nRULE_LINKS='+JSON.stringify(context.ruleLinks)
    +'\nNATIVE_SOURCE_POLICY='+JSON.stringify(context.policy)+'\nCAPABILITIES='+JSON.stringify(r.capabilities)
    +'\nOnly generic choices belonging to mappings in the frozen ScreenSpec are included; all their ports, dependency definitions and full manuals remain available. Checks with checkRef retain their id/status and reference the exact full record in CHECKS[checkRef]. Expand that record when interpreting a check; failed and unknown statuses are never promoted. Image base64 is retained only in the stored native receipt; export metadata is not visual inspection evidence.\nCHECKS='+JSON.stringify(evidence.checks)
    +'\nPOSTCONDITIONS='+JSON.stringify(evidence.postconditions)+'\nOBSERVATIONS='+JSON.stringify(observations);
   const out = await cli.run({workspace,profile:'figma-engineering',prompt,schema:stepSchema,traceDirectory:trace,signal:r.controller.signal,diagnosticContext:{...r.identity,phase:'model',modelStep:turn,sourceHash:r.policy.sourceHash}});
   await current(r); const step = out.result;
   if (!n.valid(stepSchema,step) || step.observationHashes.length !== r.observations.length
    || new Set(step.observationHashes).size !== step.observationHashes.length
    || r.observations.some(o => !step.observationHashes.includes(o.evidenceHash))) fail('AGENT_STEP_INVALID',502);
   if (step.kind !== 'operation') {
    if (step.operations.length) fail('AGENT_STEP_INVALID',502);
    if (step.kind !== 'finish') { addGap(r,step.kind === 'question' ? 'AGENT_QUESTION' : 'AGENT_NATIVE_CAPABILITY_GAP',step.message); finish(r,step.kind === 'question' ? 'question' : 'blocked',step.message); return; }
    const last = r.observations.at(-1), verdict = r.postconditions.at(-1), check = last?.checks.find(c => c.id === 'native-readback' && c.origin === 'tool-observation' && c.status === 'passed');
    if (!verdict || verdict.observationHash !== last?.evidenceHash || verdict.status !== 'passed') fail('AGENT_VERSION_POSTCONDITIONS_REQUIRED',502);
    if (!last || last.status !== 'passed' || !last.rootNodeId || !r.writesPerformed || !check
     || last.checks.some(c => c.origin === 'tool-observation' && c.status === 'failed')
     || !last.facts.some(f => f.id === last.rootNodeId && f.parentId === r.lease.pageId)
     || !last.operations.some(o => ['read_tree','check_scope'].includes(o.operation) && o.status === 'passed')) fail('AGENT_NATIVE_READBACK_REQUIRED',502);
    const artifact = {rootNodeId:last.rootNodeId,pageId:r.lease.pageId,fileKey:r.lease.fileKey,
     url:r.lease.fileKey ? 'https://www.figma.com/design/'+r.lease.fileKey+'/Apollo?node-id='+encodeURIComponent(last.rootNodeId) : null,
     leaseNonce:r.lease.sessionNonce,evidenceHash:check.evidenceHash};
    if (!n.valid(n.schemas.artifact,artifact)) fail('AGENT_ARTIFACT_INVALID',502);
    finish(r,'completed',step.message,clone([...new Map(last.checks.concat(verdict.checks).map(c=>[c.id,c])).values()]),artifact); return;
   }
   if (!step.operations.length || step.operations.some(o => !r.capabilities.includes(o.operation))) fail('AGENT_OPERATION_UNAVAILABLE',503);
   if ((r.operationCount += step.operations.length) > 192) fail('AGENT_OPERATION_LIMIT',429);
   for(let offset=0;offset<step.operations.length;offset+=NATIVE_BATCH_SIZE){
   const sequence=++r.nativeCalls;
   const operation = {callId:'call:'+sequence,sequence,nonce:crypto.randomBytes(24).toString('hex'),lease:clone(r.lease),operations:clone(step.operations.slice(offset,offset+NATIVE_BATCH_SIZE))};
   if (!n.validRequest({schemaVersion:'apollo.agent-figma-operation.v2',identity:r.identity,...operation})) fail('AGENT_OPERATION_INVALID',502);
   await current(r);
   r.phase='native-callback'; r.pendingOperation = operation; r.status = 'awaiting-operation'; progress(r,'tool','Awaiting bounded native broker callback.');
   await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Object.assign(Error('AGENT_OBSERVATION_TIMEOUT'),{code:'AGENT_OBSERVATION_TIMEOUT'})),operationTimeoutMs);
    timer.unref?.();
    r.resolveObservation = value => { clearTimeout(timer); resolve(value); };
    r.rejectObservation = error => { clearTimeout(timer); reject(error); };
   });
   await current(r);
   }
  }
  fail('AGENT_STEP_LIMIT');
 }
 async function poll(body) {
  if (!p.closed(body,ids.concat('afterSequence')) || !Number.isSafeInteger(body.afterSequence) || body.afterSequence < 0) fail('AGENT_REQUEST_INVALID',400);
  const r = find(Object.fromEntries(ids.map(k => [k,body[k]])));
  if (body.afterSequence > r.sequence) fail('AGENT_SEQUENCE_STALE');
  if (!terminal.includes(r.status)) try { await current(r); } catch(error) { terminate(r,'blocked',error.code); }
  return snapshot(r);
 }
 async function cancel(body) { const r = find(body); terminate(r,'cancelled','AGENT_CANCELLED'); return snapshot(r); }
 return {admit,start,poll,observation,cancel,controlTicket,controlObservation,whenSettled:identity => find(identity).job};
}

function mountAgentFigmaRoutes(app,options) {
 const targetErrors = ['FIGMA_TARGET_PROP_UNSUPPORTED','FIGMA_TARGET_SLOT_UNSUPPORTED','FIGMA_TARGET_MAPPING_UNAVAILABLE','FIGMA_TARGET_VALUE_UNSUPPORTED','FIGMA_TARGET_ACTIONS_UNSUPPORTED','FIGMA_OVERFLOW_ACTIONS_CONFLICT'];
 const service = typeof options?.loadService === 'function'
  ? Object.fromEntries(['admit','start','poll','observation','cancel','controlTicket','controlObservation'].map(method => [method,async (...args) => (await options.loadService())[method](...args)]))
  : createAgentFigmaService(options);
 for (const [route,method] of [['drafts','admit'],['runs','start'],['runs/poll','poll'],['runs/observation','observation'],['runs/cancel','cancel']]) {
  app.post('/v4/agent/figma/'+route,async (req,res) => {
   try { const value = await service[method](req.body); res.setHeader('Cache-Control','no-store'); res.json(method === 'admit' ? {success:true,...value} : {success:true,run:value}); }
   catch(error) { const targetError = method === 'admit' && targetErrors.includes(error.code); const code = targetError || /^AGENT_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AGENT_EXECUTION_FAILED'; res.status(error.status || (targetError ? code === 'FIGMA_OVERFLOW_ACTIONS_CONFLICT' ? 409 : 422 : 503)).json({success:false,code}); }
  });
 }
 for (const [route,method] of [['runs/control-ticket','controlTicket'],['runs/control-observation','controlObservation']]) {
  app.post('/v4/agent/figma/'+route,async (req,res) => {
   try { const value = await service[method](req.body); res.setHeader('Cache-Control','no-store'); res.json(method === 'controlTicket' ? {success:true,ticket:value} : value); }
   catch(error) { const code = /^AGENT_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AGENT_EXECUTION_FAILED'; res.status(error.status || 503).json({success:false,code}); }
  });
 }
 return service;
}
module.exports = {createAgentFigmaService,mountAgentFigmaRoutes,nativePromptContext,nativePromptEvidence};

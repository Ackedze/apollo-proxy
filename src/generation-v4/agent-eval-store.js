'use strict';
const {failureDiagnostic,readFailure}=require('./failure-diagnostic');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const TYPES=['model-input','model-output','model-error','frontend-check','native-observation','postconditions','snapshot','control','agent-review'];
const CRITERIA=['fidelity','source/API','execution','checks','repair','history/cancel','honesty'];
function createAgentEvalStore({root,protocol:p,hash,skills}={}){
 if(!path.isAbsolute(root||'')||!p?.validIdentity||!p.validScreenVersion||typeof hash!=='function'||!skills)fail('AGENT_EVAL_CONFIGURATION_INVALID');
 root=path.resolve(root);
 for(const definition of Object.values(skills)){
  if(!definition||typeof definition.id!=='string'||typeof definition.version!=='string'||!Array.isArray(definition.sources)||!definition.sources.length||definition.sources.length>16)fail('AGENT_EVAL_CONFIGURATION_INVALID');
  for(const pin of definition.sources){
   if(!pin||!path.isAbsolute(pin.path||'')||!/^([a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(pin.name||'')||pin.name.split('/').some(x=>x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(pin.sha256||'')||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pin.bytes>262144)fail('AGENT_EVAL_CONFIGURATION_INVALID');
   const directory=path.dirname(pin.path);if(root===directory||root.startsWith(directory+path.sep)||pin.path.startsWith(root+path.sep))fail('AGENT_EVAL_SCOPE_INVALID');
  }
 }
 fs.mkdirSync(root,{recursive:true});if(fs.realpathSync(root)!==root)fail('AGENT_EVAL_SCOPE_INVALID');
 const runsRoot=path.join(root,'runs');fs.mkdirSync(runsRoot,{recursive:true});if(fs.realpathSync(runsRoot)!==runsRoot)fail('AGENT_EVAL_SCOPE_INVALID');
 const encode=value=>{let text;try{text=JSON.stringify(value,null,2)+'\n';}catch{fail('AGENT_EVAL_PAYLOAD_INVALID');}if(Buffer.byteLength(text)>4194304)fail('AGENT_EVAL_PAYLOAD_LIMIT');return text;};
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 const pin=file=>{const b=fs.readFileSync(file);return{path:file,sha256:sha(b),bytes:b.length};};
 const verify=record=>{const actual=pin(record.path);if(actual.sha256!==record.sha256||record.bytes!==undefined&&actual.bytes!==record.bytes)fail('AGENT_EVAL_INPUTS_STALE');};
 const atomic=(file,value)=>{const next=file+'.'+crypto.randomUUID()+'.next';let fd;try{fd=fs.openSync(next,'wx',0o600);fs.writeFileSync(fd,encode(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(next,file);}finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);if(fs.existsSync(next))fs.unlinkSync(next);}};
 // The configured Proxy process is the sole writer; synchronous writes cannot interleave in it. No stale lock survives a restart.
 function persist(action){try{return action();}catch(error){if(error.code?.startsWith('AGENT_'))throw error;fail('AGENT_EVAL_PERSISTENCE_FAILED');}}
 function location(identity){if(!p.validIdentity(identity)||!['frontend','figma'].includes(identity.target))fail('AGENT_EVAL_IDENTITY_INVALID');return path.join(runsRoot,hash(identity));}
 function load(identity){const directory=location(identity);if(fs.realpathSync(directory)!==directory)fail('AGENT_EVAL_SCOPE_INVALID');const input=read(path.join(directory,'input.json'));if(!p.sameIdentity(input.identity,identity)||hash(input.packet.spec)!==identity.specHash||hash(input.packet.context)!==identity.contextHash||!p.validScreenVersion(input.packet.version))fail('AGENT_EVAL_IDENTITY_INVALID');return{directory,input};}
 function sourceCurrent(input){try{for(const record of input.currentPins)verify(record);}catch{fail('AGENT_EVAL_INPUTS_STALE');}}
 function project(directory){
  if(fs.realpathSync(directory)!==directory||fs.realpathSync(path.join(directory,'events'))!==path.join(directory,'events'))fail('AGENT_EVAL_SCOPE_INVALID');
  const input=read(path.join(directory,'input.json')),events=[],attempts=[],channels={build:[],browser:[],native:[],synthetic:[]};let previous=pin(path.join(directory,'input.json')).sha256,attempt=0,firstFailure=null,runStatus='admitted',lastSnapshotHash=null;
  const names=fs.readdirSync(path.join(directory,'events')).sort();if(names.length>256)fail('AGENT_EVAL_EVENT_LIMIT');
  for(const [index,name]of names.entries()){
   if(name!==String(index+1).padStart(6,'0')+'.json')fail('AGENT_EVAL_HISTORY_INVALID');
   const file=path.join(directory,'events',name),record=read(file),physical=pin(file);
   if(record.sequence!==index+1||record.previousHash!==previous||record.identityHash!==hash(input.identity)||!TYPES.includes(record.type))fail('AGENT_EVAL_HISTORY_INVALID');
   previous=physical.sha256;if(record.type==='model-input'){attempt++;attempts.push({attempt,events:[]});}
   if(!Number.isSafeInteger(record.attempt)||record.attempt<0||record.attempt>attempt||record.type==='model-input'&&record.attempt!==attempt)fail('AGENT_EVAL_HISTORY_INVALID');
   const reference={...physical,path:path.relative(directory,file),type:record.type,attempt:record.attempt};events.push(reference);if(record.attempt)attempts[record.attempt-1].events.push(reference);
   const data=record.data;
   if(record.type==='frontend-check'){if(data.channels?.build?.length)channels.build.push(reference);if(data.channels?.browser)channels.browser.push(reference);}
   if(record.type==='native-observation'&&data.acceptance==='accepted'){channels.native.push(reference);if(['unit-fixture','synthetic-plugin-api'].includes(input.evidenceKind))channels.synthetic.push(reference);}
   if(record.type==='snapshot'){runStatus=data.status;lastSnapshotHash=data.snapshotHash;}
   const failedChecks=['frontend-check','postconditions'].includes(record.type)?data.checks||data.verdict?.checks||[]:record.type==='native-observation'&&data.acceptance==='accepted'?data.observation?.checks||[]:[];
   if(!firstFailure&&(failedChecks.some(c=>c.origin==='tool-observation'&&c.status==='failed')||record.type==='frontend-check'&&data.error||record.type==='model-error'||record.type==='snapshot'&&['failed','blocked'].includes(data.status)))firstFailure=reference;
  }
  const value={schemaVersion:'apollo.agent-run-eval.v1',runId:input.identity.runId,caseId:input.identity.runId,identity:input.identity,target:input.identity.target,
   skill:input.skill,inputs:{inputHash:input.packet.version.inputHash,versionHash:input.packet.version.versionHash,specHash:input.identity.specHash,contextHash:input.identity.contextHash,packetPin:pin(path.join(directory,'input.json')),contracts:input.packet.context.authoring?.contracts?.map(c=>c.pin)||[],mappingHash:hash(input.packet.context.targetMapping),currentPins:input.currentPins},
   traceDirectory:input.traceDirectory,evidenceKind:input.evidenceKind,author:'Proxy runtime recorder',reviewer:{independent:false,status:'NOT_RUN'},runStatus,lastSnapshotHash,attempts,events,firstFailure,
   agentReview:events.filter(e=>e.type==='agent-review'),criteria:Object.fromEntries(CRITERIA.map(name=>[name,{status:'NOT_RUN',evidence:[]}])),
   coverage:{fullManual:'UNKNOWN',checkerApplicability:'UNKNOWN'},execution:{...Object.fromEntries(Object.entries(channels).map(([name,evidence])=>[name,{status:evidence.length?input.evidenceKind==='unit-fixture'?'UNIT_FIXTURE_RECORDED':'RECORDED':'NOT_RUN',evidence}])),nativeLive:'NOT_RUN_USER_ONLY'},
   gaps:events.filter(e=>['frontend-check','native-observation','postconditions','snapshot','model-error'].includes(e.type)),eventHeadHash:previous,writesClosed:false,Ready:false};
  return value;
 }
 function files(directory,base=directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{if(entry.isSymbolicLink())fail('AGENT_EVAL_SCOPE_INVALID');const file=path.join(directory,entry.name);return entry.isDirectory()?files(file,base):[{...pin(file),path:path.relative(base,file)}];});}
 function closed(directory){const file=path.join(directory,'seal.json');if(!fs.existsSync(file))return false;const seal=read(file);if(seal.writesClosed!==true)fail('AGENT_EVAL_HISTORY_INVALID');for(const expected of seal.outputs)verify({...expected,path:path.join(directory,expected.path)});return true;}
 function writeProjection(directory){if(closed(directory))return read(path.join(directory,'eval.json'));const value=project(directory);atomic(path.join(directory,'eval.json'),value);
  atomic(path.join(directory,'lessons.json'),{schemaVersion:'apollo.generation-lessons.v1',items:value.firstFailure?[{fact:'First failed runtime evidence preserved; see immutable event',evidence:value.firstFailure,cause:'не установлена',consequence:'Generation attempt requires repair or remains blocked',correction:'See subsequent attempt evidence; not independently reviewed',protection:'First failure and frozen inputs cannot be overwritten',owner:'Proxy',verification:'NOT_RUN',classification:'unclassified',skillChanged:false}]:[]});return value;
 }
 function indexEntry(directory,value){return{identity:value.identity,eval:{...pin(path.join(directory,'eval.json')),path:path.relative(root,path.join(directory,'eval.json'))},runStatus:value.runStatus,writesClosed:value.writesClosed,seal:fs.existsSync(path.join(directory,'seal.json'))?{...pin(path.join(directory,'seal.json')),path:path.relative(root,path.join(directory,'seal.json'))}:null};}
 function updateIndex(directory,value){const file=path.join(root,'index.json'),index=fs.existsSync(file)?read(file):{schemaVersion:'apollo.agent-run-eval-index.v1',runs:[]};if(index.schemaVersion!=='apollo.agent-run-eval-index.v1'||!Array.isArray(index.runs))fail('AGENT_EVAL_HISTORY_INVALID');index.runs=index.runs.filter(e=>!p.sameIdentity(e.identity,value.identity));index.runs.push(indexEntry(directory,value));if(index.runs.length>4096)fail('AGENT_EVAL_RUN_LIMIT');atomic(file,index);}
 function begin({identity,packet,traceDirectory,evidenceKind}){return persist(()=>{
  if(!p.validIdentity(identity)||!packet||!p.validScreenVersion(packet.version)||!p.sameIdentity(Object.fromEntries(['runId','revision','specHash','contextHash','target'].map(k=>[k,packet[k]])),identity)||hash(packet.spec)!==identity.specHash||hash(packet.context)!==identity.contextHash||packet.version.specHash!==identity.specHash||packet.version.revision!==identity.revision||packet.context.versionHash!==packet.version.versionHash||hash(packet.input)!==packet.version.inputHash||!['frontend-tools','synthetic-plugin-api','native-reported','unit-fixture'].includes(evidenceKind)||!path.isAbsolute(traceDirectory||''))fail('AGENT_EVAL_PACKET_INVALID');
  const definition=skills[identity.target];if(!definition||!Array.isArray(packet.skills)||!packet.skills.length||packet.skills.some(s=>typeof s.text!=='string'||sha(Buffer.from(s.text))!==s.sha256))fail('AGENT_EVAL_SKILL_INVALID');
  const sources=definition.sources.map(record=>{verify(record);return{...record,text:fs.readFileSync(record.path,'utf8')};});
  const bindings=sources.filter(s=>s.prompt).map(source=>{const consumed=packet.skills.find(s=>s.text.includes(source.text));if(!consumed)fail('AGENT_EVAL_SKILL_TEXT_MISSING');return{source:source.name,packetSkillId:consumed.id,packetTextSha256:consumed.sha256,start:consumed.text.indexOf(source.text),length:source.text.length};});
  const main=sources.find(s=>s.name==='SKILL.md');if(!main||!main.prompt||!main.text.includes('version: "'+definition.version+'"'))fail('AGENT_EVAL_SKILL_INVALID');
  const contextPins=packet.context.readSources||[];if(!Array.isArray(contextPins)||contextPins.length>512||contextPins.some(x=>!path.isAbsolute(x.path||'')||!/^[a-f0-9]{64}$/.test(x.sha256||'')))fail('AGENT_EVAL_INPUT_PIN_INVALID');
  const currentPins=Array.from(new Map(sources.map(({text,...record})=>[record.path,{path:record.path,sha256:record.sha256,bytes:record.bytes}]).concat(contextPins.map(record=>[record.path,record]))).values());currentPins.forEach(verify);
  const directory=location(identity),value={schemaVersion:'apollo.agent-eval-input.v1',identity,packet,traceDirectory,evidenceKind,currentPins,skill:{id:definition.id,version:definition.version,sources:definition.sources,consumedTextPins:packet.skills.map(({id,sha256,text})=>({id,sha256,bytes:Buffer.byteLength(text)})),bindings}};
  if(fs.existsSync(directory)){const old=load(identity).input;if(encode(old)!==encode(value))fail('AGENT_EVAL_RUN_STALE');return writeProjection(directory);}
  fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'events'));fs.mkdirSync(path.join(directory,'skill-snapshot'));
  for(const source of sources){const file=path.join(directory,'skill-snapshot',source.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,fs.readFileSync(source.path),{flag:'wx',mode:0o600});}
  fs.writeFileSync(path.join(directory,'input.json'),encode(value),{flag:'wx',mode:0o600});const result=writeProjection(directory);updateIndex(directory,result);return result;
 });}
 function invalidEvent(directory,identity,type,check,values,data){
  const call=data?.request||data?.observation,detail={schemaVersion:'apollo.agent-eval-failure.v1',runId:identity.runId,eventType:typeof type==='string'?type.slice(0,80):typeof type,check,...values,
   callId:typeof call?.callId==='string'?call.callId.slice(0,120):null,nativeSequence:Number.isSafeInteger(call?.sequence)?call.sequence:null};
  const diagnostic=failureDiagnostic('AGENT_EVAL_EVENT_INVALID',{...identity,phase:'journal',stage:check,callId:detail.callId,nativeSequence:detail.nativeSequence},'err:'+crypto.randomUUID());detail.diagnostic=diagnostic;
  const file=path.join(directory,'recording-failure.json');if(!fs.existsSync(file))fs.writeFileSync(file,encode(detail),{flag:'wx',mode:0o600});
  throw Object.assign(Error('AGENT_EVAL_EVENT_INVALID'),{code:'AGENT_EVAL_EVENT_INVALID',status:503,diagnostic:'Запись события журнала отклонена. Диагностика: '+JSON.stringify({...detail,...diagnostic})});
 }
 function record(identity,type,data,{captures=[],attempt:linkedAttempt}={}){return persist(()=>{
  const {directory,input}=load(identity);if(closed(directory))fail('AGENT_EVAL_RUN_CLOSED');
  if(!TYPES.includes(type))invalidEvent(directory,identity,type,'event-type',{expected:TYPES},data);
  if(type==='model-input')sourceCurrent(input);if(type==='agent-review'&&(data.origin!=='agent-review'||data.independent!==false))fail('AGENT_EVAL_REVIEW_INVALID');
  const prior=project(directory),sequence=prior.events.length+1;if(sequence>256)fail('AGENT_EVAL_EVENT_LIMIT');
  const currentAttempt=prior.attempts.length+(type==='model-input'?1:0),attempt=linkedAttempt??currentAttempt;
  if(!Number.isSafeInteger(attempt)||attempt<0||attempt>currentAttempt||type==='model-input'&&attempt!==currentAttempt)invalidEvent(directory,identity,type,'model-attempt-link',{eventSequence:sequence,expected:{min:0,max:currentAttempt},actual:{attempt:Number.isSafeInteger(attempt)?attempt:typeof attempt}},data);
  const capturePins=[];let total=0;for(const [index,capture]of captures.entries()){
   if(typeof capture.name!=='string'||!Buffer.isBuffer(capture.bytes)||(total+=capture.bytes.length)>8388608||captures.length>256)fail('AGENT_EVAL_CAPTURE_LIMIT');
   const relative=path.join('captures',String(sequence).padStart(6,'0'),String(index).padStart(3,'0'));const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,capture.bytes,{flag:'wx',mode:0o600});capturePins.push({name:capture.name,...pin(file),path:relative});
  }
  const event={schemaVersion:'apollo.agent-eval-event.v1',identityHash:hash(identity),sequence,attempt,type,previousHash:prior.eventHeadHash,data,captures:capturePins,atUtc:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,'events',String(sequence).padStart(6,'0')+'.json'),encode(event),{flag:'wx',mode:0o600});const value=writeProjection(directory);updateIndex(directory,value);return value;
 });}
 function get(identity){return persist(()=>{const {directory}=load(identity),value=writeProjection(directory);updateIndex(directory,value);return value;});}
 function seal(identity){return persist(()=>{const {directory}=load(identity);if(closed(directory))return pin(path.join(directory,'seal.json'));const value=writeProjection(directory);if(!['completed','failed','blocked','cancelled','question'].includes(value.runStatus))fail('AGENT_EVAL_RUN_ACTIVE');value.writesClosed=true;atomic(path.join(directory,'eval.json'),value);
  fs.writeFileSync(path.join(directory,'seal.json'),encode({schemaVersion:'apollo.agent-eval-seal.v1',identity,writesClosed:true,outputs:files(directory),Ready:false}),{flag:'wx',mode:0o600});updateIndex(directory,value);return pin(path.join(directory,'seal.json'));});}
 function fromTrace(traceDirectory){const key=path.basename(traceDirectory);if(!/^[a-f0-9]{64}$/.test(key))fail('AGENT_EVAL_TRACE_INVALID');const input=read(path.join(runsRoot,key,'input.json'));if(input.traceDirectory!==traceDirectory||hash(input.identity)!==key)fail('AGENT_EVAL_TRACE_INVALID');return input.identity;}
 // Reopening rebuilds derived projections/index from immutable inputs and events; sealed runs remain byte-identical.
 persist(()=>{const index={schemaVersion:'apollo.agent-run-eval-index.v1',runs:[]};for(const name of fs.readdirSync(runsRoot)){if(!/^[a-f0-9]{64}$/.test(name))fail('AGENT_EVAL_HISTORY_INVALID');const directory=path.join(runsRoot,name),value=writeProjection(directory);index.runs.push(indexEntry(directory,value));}atomic(path.join(root,'index.json'),index);});
 return{begin,record,get,seal,fromTrace,has:identity=>p.validIdentity(identity)&&fs.existsSync(path.join(location(identity),'input.json'))};
}
module.exports={createAgentEvalStore};

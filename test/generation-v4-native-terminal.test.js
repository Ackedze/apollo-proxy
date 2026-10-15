'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module');
const proxy=process.env.APOLLO_PROXY_TEST_ROOT||path.resolve(__dirname,'..'),app=path.resolve(proxy,'../../projects/Apollo-v3/apps/apollo-v4');
const serviceFile=path.join(proxy,'src/generation-v4/agent-figma-service.js');
function service(){
 if(!process.env.APOLLO_FIGMA_SERVICE_CANDIDATE)return require(serviceFile);
 const m=new Module(serviceFile);m.filename=serviceFile;m.paths=Module._nodeModulePaths(path.dirname(serviceFile));m._compile(fs.readFileSync(process.env.APOLLO_FIGMA_SERVICE_CANDIDATE,'utf8'),serviceFile);return m.exports;
}
const p=require(path.join(app,'dist/agent-protocol.cjs')),n=require(path.join(app,'dist/agent-figma-protocol.cjs')),hash=v=>p.hashWithout(v,'__absent__');
const op={operation:'create_root',arguments:{handle:'screen',name:'Synthetic terminal test',width:1600,height:900,background:'#FFFFFF'}};
async function setup(t,verdictStatus='unknown'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-native-terminal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const spec=require(path.join(app,'tests/fixtures/reference-spec.cjs')),input={prompt:'Synthetic terminal lifecycle test',platform:'desktop',viewport:spec.viewport};
 const version=p.createScreenVersion(spec,hash(input),null),skill={id:'synthetic-terminal-fixture',text:'Synthetic lifecycle test only; no native acceptance.'};skill.sha256=crypto.createHash('sha256').update(skill.text).digest('hex');
 const context={versionHash:version.versionHash,skills:[{id:skill.id,sha256:skill.sha256}],targetMapping:{},ruleLinks:{}};
 const identity={runId:crypto.randomBytes(16).toString('hex'),revision:version.revision,specHash:version.specHash,contextHash:hash(context),target:'figma'};
 const packet={...identity,input,spec,version,context,skills:[skill]},lease={sessionNonce:'a'.repeat(32),documentId:'0:0',pageId:'1:1',fileKey:null,sourceHash:'b'.repeat(64)};
 let calls=0,invalidations=0,checkerCalls=0;
 const cli={async probe(){return{available:true,profiles:['figma-engineering']};},async run({prompt}){calls++;const observations=JSON.parse(prompt.split('\n').find(l=>l.startsWith('OBSERVATIONS=')).slice(13));return{result:calls===1?{kind:'operation',operations:[op],message:'Create own synthetic root',observationHashes:[]}:{kind:'capabilityGap',operations:[],message:'Synthetic next step',observationHashes:observations.map(o=>o.evidenceHash)}};}};
 const inputs={async resolveAgentRun(){return{packet,assertCurrent:async()=>{}};},invalidate(){invalidations++;}};
 const s=service().createAgentFigmaService({inputs,cli,protocol:p,nativeProtocol:n,hash,resolveNativePolicy:async()=>({sourceHash:lease.sourceHash,capabilities:['create_root'],context:{evidence:'synthetic'},assertCurrent:async()=>{}}),validatePostconditions:()=>{checkerCalls++;return{schemaVersion:'apollo.agent-figma-postcondition-result.v1',status:verdictStatus,checks:[{id:'synthetic-postcondition',status:verdictStatus,origin:'tool-observation',message:'Synthetic postcondition verdict',evidenceHash:hash(['synthetic-postcondition',verdictStatus])}],Ready:false};},executionEnvironment:'synthetic-plugin-api',traceRoot:path.join(root,'trace'),readonlyRoot:path.join(root,'readonly')});
 await s.start({identity,lease,capabilities:['create_root']});
 let state;for(let i=0;i<100;i++){state=await s.poll({...identity,afterSequence:0});if(state.status==='awaiting-operation')break;await new Promise(r=>setTimeout(r,5));}assert.equal(state.status,'awaiting-operation');
 return{s,identity,lease,state,calls:()=>calls,invalidations:()=>invalidations,checkerCalls:()=>checkerCalls};
}
function observation(x,status,rollback){
 const q=x.state.pendingOperation,o={schemaVersion:'apollo.agent-figma-observation.v3',identity:x.identity,callId:q.callId,sequence:q.sequence,nonce:q.nonce,lease:x.lease,status,beforeHash:'c'.repeat(64),afterHash:'d'.repeat(64),createdNodeIds:['2:1'],rootNodeId:'2:1',facts:[],checks:[],operations:[{index:0,operation:'create_root',status:status==='passed'?'passed':'unknown',affectedIds:status==='passed'?['2:1']:[],message:'Synthetic broker result'}],rollback,gaps:status==='passed'?[]:[{code:'FIGMA_SOURCE_TOPOLOGY_UNKNOWN',message:'Synthetic first native failure'}],writesPerformed:true,Ready:false,semantic:null,export:null};o.evidenceHash=p.hashWithout(o,'evidenceHash');assert(n.validObservation(o,x.identity,{schemaVersion:'apollo.agent-figma-operation.v2',identity:x.identity,...q}));return o;
}
for(const cleanup of ['complete','incomplete'])test('cancelled native execution stops model retry and keeps independent cleanup '+cleanup,async t=>{
 const x=await setup(t),rollback={status:cleanup,removedIds:cleanup==='complete'?['2:1']:[],preservedIds:cleanup==='incomplete'?['2:1']:[],message:'Synthetic rollback '+cleanup};
 await x.s.observation(observation(x,'unknown',rollback));await x.s.whenSettled(x.identity);const end=await x.s.poll({...x.identity,afterSequence:0});
 assert.equal(x.calls(),1,'No further model step can repair a cancelled broker');assert.equal(x.checkerCalls(),1);assert.equal(x.invalidations(),1);assert.equal(end.status,'blocked');assert.equal(end.pendingOperation,null);assert(end.gaps.some(g=>g.code==='FIGMA_SOURCE_TOPOLOGY_UNKNOWN'));assert.equal(end.result.Ready,false);assert.equal(end.result.artifact,null);assert.deepEqual(end.result.acceptedWriteOperations,[]);
 const ticket=await x.s.controlTicket({identity:x.identity,lease:x.lease,kind:'cancel',reason:'failure'}),receipt={schemaVersion:'apollo.agent-figma-cleanup.v5',ticket,origin:'native-broker',status:cleanup,createdNodeIds:['2:1'],rootNodeId:'2:1',writesPerformed:true,rollback,evidenceHash:''};receipt.evidenceHash=p.hashWithout(receipt,'evidenceHash');assert(n.validCleanup(receipt,ticket));
 const ack=await x.s.controlObservation(receipt);assert.equal(ack.accepted,true);const final=await x.s.poll({...x.identity,afterSequence:0});assert.equal(final.result.checks.find(c=>c.id==='native-cleanup').status,cleanup==='complete'?'passed':'failed');assert(final.gaps.some(g=>g.code==='FIGMA_SOURCE_TOPOLOGY_UNKNOWN'));assert(!final.gaps.some(g=>g.code==='AGENT_CLEANUP_UNKNOWN'));assert.equal(final.gaps.some(g=>g.code==='AGENT_CLEANUP_INCOMPLETE'),cleanup==='incomplete');
});
for(const verdict of ['unknown','failed'])test('passed native execution with '+verdict+' postconditions permits an agent follow-up',async t=>{
 const x=await setup(t,verdict);await x.s.observation(observation(x,'passed',{status:'not-needed',removedIds:[],preservedIds:[],message:'No rollback'}));await x.s.whenSettled(x.identity);assert.equal(x.calls(),2);assert.equal(x.invalidations(),0);assert.equal(x.checkerCalls(),1);
});
test('invalid correlated observation does not terminate the native run',async t=>{
 const x=await setup(t),o=observation(x,'unknown',{status:'complete',removedIds:['2:1'],preservedIds:[],message:'Synthetic rollback'});o.nonce='e'.repeat(32);o.evidenceHash=p.hashWithout(o,'evidenceHash');await assert.rejects(()=>x.s.observation(o),e=>e.code==='AGENT_OBSERVATION_INVALID');assert.equal(x.invalidations(),0);const state=await x.s.poll({...x.identity,afterSequence:0});assert.equal(state.status,'awaiting-operation');await x.s.cancel(x.identity);await x.s.whenSettled(x.identity);
});
test('terminal result stays within the wire bound while complete checks remain in recorded observations',async t=>{
 const x=await setup(t),o=observation(x,'unknown',{status:'complete',removedIds:['2:1'],preservedIds:[],message:'Synthetic rollback'});
 o.checks=Array.from({length:255},(_,i)=>({id:'native-check-'+i,status:'failed',origin:'tool-observation',message:'Synthetic failed native check',evidenceHash:hash(i)}));o.evidenceHash=p.hashWithout(o,'evidenceHash');assert(n.validObservation(o,x.identity,{schemaVersion:'apollo.agent-figma-operation.v2',identity:x.identity,...x.state.pendingOperation}));
 await x.s.observation(o);await x.s.whenSettled(x.identity);const end=await x.s.poll({...x.identity,afterSequence:0});assert.equal(end.status,'blocked');assert.equal(x.calls(),1);assert.equal(end.result.checks.length,256);assert(end.result.checks.some(c=>c.id==='native-cleanup'));assert(end.gaps.some(g=>g.code==='AGENT_NATIVE_CHECK_DISPLAY_LIMIT'));assert(end.gaps.some(g=>g.code==='FIGMA_SOURCE_TOPOLOGY_UNKNOWN'));
});

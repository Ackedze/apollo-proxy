'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createConfiguredAgentFigmaHostRuntime}=require('../src/generation-v4/agent-figma-runtime');
const {createPromptTargetReader}=require('../src/generation-v4/prompt-target-context');
const {mountPromptRoutes}=require('../src/generation-v4/prompt-service');
const {loadProvider}=require('../src/generation-v4/service');
const configFile=process.env.APOLLO_NATIVE_HOST_TEST_CONFIG,inputFile=process.env.APOLLO_NATIVE_HOST_TEST_INPUT,frontendConfigFile=process.env.APOLLO_NATIVE_HOST_TEST_FRONTEND_CONFIG;
const configured=!!(configFile&&inputFile&&frontendConfigFile);
function fixture(t){
 const original=JSON.parse(fs.readFileSync(configFile)),sdk=JSON.parse(fs.readFileSync(inputFile));
 const root=fs.mkdtempSync(path.join(process.env.APOLLO_NATIVE_HOST_TEST_OUTPUT_ROOT||os.tmpdir(),'apollo-native-host-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={...original,frontendRoot:path.join(root,'frontend-output'),hostRoot:path.join(root,'native-host')},file=path.join(root,'host-config.json');fs.writeFileSync(file,JSON.stringify(config));
 return{root,config,file,sdk};
}
test('configured native host reaches queued start with the real recorder; provider refusal has correlated cancel ticket', {skip:!configured},async t=>{
 const {file,config,sdk}=fixture(t);
 const service=await createConfiguredAgentFigmaHostRuntime({configFile:file,providerFactory:config=>loadProvider({apolloRoot:config.apolloRoot}),provider:'unavailable-test-provider'}).loadService();
 const admitted=await service.admit({schemaVersion:'apollo.agent-draft-request.v1',input:sdk.input,version:sdk.version,target:'figma',parentIdentity:null});
 const descriptor=JSON.parse(fs.readFileSync(config.descriptorFile)),n=require(descriptor.nativeProtocol.path);
 const lease={sessionNonce:'a'.repeat(32),documentId:'0:0',pageId:'1:1',fileKey:null,sourceHash:descriptor.sourceHash};assert(n.valid(n.schemas.lease,lease));
 const started=await service.start({identity:admitted.identity,lease,capabilities:Object.keys(n.operations)});assert.equal(started.status,'queued');
 await service.whenSettled(admitted.identity);const terminal=await service.poll({...admitted.identity,afterSequence:0});
 assert.equal(terminal.status,'blocked');assert(terminal.gaps.some(g=>g.code==='AGENT_PROVIDER_CAPABILITY_UNAVAILABLE'));
 const p=require(descriptor.protocol.path),hash=v=>p.hashWithout(v,'__absent__'),input=JSON.parse(fs.readFileSync(path.join(config.hostRoot,'run-evals/runs',hash(admitted.identity),'input.json')));
 assert.equal(input.evidenceKind,'native-reported');
 const evalRecord=JSON.parse(fs.readFileSync(path.join(config.hostRoot,'run-evals/runs',hash(admitted.identity),'eval.json')));
 assert.equal(evalRecord.attempts.length,0);assert.equal(evalRecord.execution.nativeLive,'NOT_RUN_USER_ONLY');
 const ticket=await service.controlTicket({identity:admitted.identity,lease,kind:'cancel',reason:'failure'});assert(n.validTicket(ticket,admitted.identity,lease,'cancel'));
});
test('real recorder still rejects changed packet hashes, identities, input and unknown evidence types', {skip:!configured},t=>{
 const {config,root,sdk}=fixture(t),d=JSON.parse(fs.readFileSync(config.descriptorFile)),p=require(d.protocol.path),hash=v=>p.hashWithout(v,'__absent__');
 const selected=require(path.join(config.apolloRoot,'apps/apollo-v4/scripts/agent-generation-skills.cjs')).createGenerationSkills().select('figma',{executionProfile:'figma-owned-root-v1',sourceHash:d.sourceHash});
 const skills={figma:{id:selected.metadata.name,version:selected.metadata.version,sources:selected.metadata.files.map(pin=>({...pin,name:path.relative(path.dirname(selected.metadata.files[0].path),pin.path),prompt:true}))}};
 const store=require('../src/generation-v4/agent-eval-store').createAgentEvalStore({root:path.join(root,'negative-evals'),protocol:p,hash,skills});
 const identity=Object.fromEntries(['runId','revision','specHash','contextHash','target'].map(k=>[k,sdk[k]]));
 for(const change of [v=>v.evidenceKind='native-plugin-api',v=>v.packet.spec.viewport.width=1500,v=>v.packet.context.mode='foreign',v=>v.packet.input.prompt+='changed',v=>v.identity.revision++]){
  const args={identity:structuredClone(identity),packet:structuredClone(sdk),traceDirectory:path.join(root,'trace'),evidenceKind:'native-reported'};change(args);
  assert.throws(()=>store.begin(args),e=>e.code==='AGENT_EVAL_PACKET_INVALID');
 }
 const bad=structuredClone(sdk);bad.skills[0].text+='changed';assert.throws(()=>store.begin({identity,packet:bad,traceDirectory:path.join(root,'trace'),evidenceKind:'native-reported'}),e=>e.code==='AGENT_EVAL_SKILL_INVALID');
 assert.equal(fs.readdirSync(path.join(root,'negative-evals/runs')).length,0);
});
test('configured mounted planner receives the current typed native profile, full skills and manuals without execution admission', {skip:!configured},async t=>{
 const {file,config,sdk}=fixture(t),reader=createPromptTargetReader({configFile:frontendConfigFile,nativeConfigFile:file,loadProvider});
 const actual=await reader(sdk.input,'figma'),source=JSON.parse(fs.readFileSync(config.currentConsumerFile)),owned=JSON.parse(fs.readFileSync(source.packet.path));
 assert.deepEqual(actual.packet.targetContext.targetMapping.typedNativeBindings,owned.typedNativeBindings);assert.equal(owned.typedNativeBindings.portCount,19);
 assert.equal(actual.packet.targetContext.targetMapping.semanticMapping.overflowRecipe.contentLabel.type,'TEXT');
 assert.equal(actual.packet.targetContext.executionAllowed,false);assert.equal(actual.packet.targetContext.nativeExecutionAdmission,'NOT_GRANTED');assert.equal(actual.packet.targetContext.Ready,false);
 assert(actual.packet.contracts.every(c=>c.manual.rules.length));
 let handler,modelCalls=0;const provider=loadProvider({apolloRoot:config.apolloRoot});
 mountPromptRoutes({post(route,fn){assert.equal(route,'/v4/generation/plan');handler=fn;}},{provider,readTargetContext:reader,plan:async prompt=>{
  modelCalls++;const target=JSON.parse(prompt.split('\n').find(s=>s.startsWith('TARGET_CONTEXT=')).slice('TARGET_CONTEXT='.length));
  assert.deepEqual(target.targetMapping.typedNativeBindings,owned.typedNativeBindings);assert.deepEqual(target.skills,actual.packet.targetContext.skills);
  assert(prompt.includes('create_root'));return{specJson:JSON.stringify(sdk.spec)};
 }},loadProvider);
 let status=200,result;await handler({body:{schemaVersion:'apollo.v4-prompt-plan-request.v1-experimental',requestId:'prompt-plan:0123456789abcdef:1',input:sdk.input,target:'figma'}},{setHeader(){},status(v){status=v;return this;},json(v){result=v;}});
 assert.equal(status,200);assert.equal(modelCalls,1);assert.equal(result.result.executionAllowed,false);assert.deepEqual(result.result.spec,sdk.spec);
 const frontend=await reader(sdk.input,'frontend');assert.equal(frontend.packet.targetContext.targetMapping.target,'frontend');assert.equal(frontend.packet.targetContext.targetMapping.typedNativeBindings,undefined);
 fs.appendFileSync(file,' ');assert.throws(()=>actual.assertCurrent(),e=>e.code==='PROMPT_TARGET_INPUTS_STALE');
});
test('native planner rejects a foreign consumer before invoking a planner or creating a workspace', {skip:!configured},async t=>{
 const {file,sdk,root,config}=fixture(t);const consumer=JSON.parse(fs.readFileSync(config.currentConsumerFile));consumer.sourceHash='0'.repeat(64);const foreign=path.join(root,'foreign-consumer.json');fs.writeFileSync(foreign,JSON.stringify(consumer));
 config.currentConsumerFile=foreign;fs.writeFileSync(file,JSON.stringify(config));
 const reader=createPromptTargetReader({configFile:frontendConfigFile,nativeConfigFile:file,loadProvider});await assert.rejects(()=>reader(sdk.input,'figma'),e=>e.code==='PROMPT_TARGET_CONTEXT_UNAVAILABLE');
 assert.equal(fs.existsSync(config.hostRoot),false);assert.equal(fs.existsSync(config.frontendRoot),false);
});

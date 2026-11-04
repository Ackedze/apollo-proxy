'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{createAgentCli,mcpObservation}=require('../src/generation-agent/agent-cli');
function fixture(t,{final=true,nextCall=false}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-response-'))),timers=[],events=[];t.after(()=>{timers.forEach(clearTimeout);fs.rmSync(root,{recursive:true,force:true});});for(const d of ['agent','trace'])fs.mkdirSync(path.join(root,d));let stopped=false,completed=false;
 const cli=createAgentCli({generatedRoot:root,maxRuntimeMs:1000,mcpConnection:{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',tools:['use_figma','get_screenshot'],fileKey:'FixtureFile'},spawnProcess:(_binary,args)=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{if(stopped)return;stopped=true;queueMicrotask(()=>child.emit('close',143));};
  const item={id:'api-read',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',arguments:{fileKey:'FixtureFile',code:'return {api:true};'}},send=event=>child.stdout.write(JSON.stringify(event)+'\n');
  timers.push(setTimeout(()=>send({type:'item.started',item}),5),setTimeout(()=>{completed=true;send({type:'item.completed',item:{...item,status:'completed',result:{content:[{type:'text',text:'{"api":"observed"}'}]}}});},35));
  if(nextCall)timers.push(setTimeout(()=>send({type:'item.started',item:{...item,id:'unexpected-next'}}),40));
  if(final)timers.push(setTimeout(()=>{if(stopped)return;fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({kind:'continue'}));child.emit('close',0);},45));
  return child;
 }});
 return {run:()=>cli.run({workspace:path.join(root,'agent'),traceDirectory:path.join(root,'trace'),profile:'landing-figma',prompt:'Synthetic response grace',schema:{type:'object'},checkpointBudget:{maxCompletedCalls:3,softRuntimeMs:20,responseGraceMs:100},onEvent:event=>events.push(event)}),events,completed:()=>completed,stopped:()=>stopped};
}
test('a successful tool after the soft deadline can return its structured checkpoint during the bounded grace',async t=>{
 const h=fixture(t),out=await h.run();assert.equal(out.result.kind,'continue');assert.equal(h.completed(),true);assert.equal(h.stopped(),false);assert.equal(out.receipt.mcp.toolCalls,1);
});
test('missing final response still yields and retains the completed API result',async t=>{
 const h=fixture(t,{final:false});await assert.rejects(h.run(),{code:'AGENT_CHECKPOINT_REQUIRED'});assert(h.completed());assert(h.stopped());assert.equal(mcpObservation(h.events.find(e=>e.type==='item.completed')).text,'{"api":"observed"}');
});
test('a new MCP call during response grace yields for independent readback',async t=>{
 const h=fixture(t,{nextCall:true});await assert.rejects(h.run(),{code:'AGENT_CHECKPOINT_REQUIRED'});assert(h.completed());assert(h.stopped());
});
test('bounded API text is data, deduplicates debug UUIDs, and never admits failed tools or images',()=>{
 const event=text=>({type:'item.completed',item:{id:'api',type:'mcp_tool_call',tool:'use_figma',status:'completed',result:{content:[{type:'text',text}]}}});
 const a=mcpObservation(event('API\nFigma Debug UUID: aaa')),b=mcpObservation(event('API\nFigma Debug UUID: bbb'));assert.equal(a.resultHash,b.resultHash);assert.equal(a.origin,'mcp-delivery');assert.equal(a.text,'API');
 const huge=mcpObservation(event('x'.repeat(10000)));assert.equal(huge.text.length,3072);assert.equal(huge.truncated,true);assert.equal(huge.resultBytes,10000);
 const failed=event('Error');failed.item.result.structured_content={error:{message:'Native failure'}};assert.equal(mcpObservation(failed),null);assert.equal(mcpObservation({type:'item.completed',item:{type:'mcp_tool_call',tool:'get_screenshot',status:'completed',result:{content:[{type:'image',data:'secret-image'}]}}}),null);
});

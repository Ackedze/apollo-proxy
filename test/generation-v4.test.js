const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {mountGenerationV4Routes}=require('../src/generation-v4/service');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function service(provider) {
 let handler;mountGenerationV4Routes({get(){},post(route,value){if(route==='/v4/generation/context')handler=value;}},{provider});
 return async body=>{let status=200,result;await handler({body},{status(s){status=s;return this;},json(r){result=r;}});return{status,result};};
}
test('context service accepts only ScreenSpec and hashes actual provider output',async()=>{
 const spec={synthetic:'screen'},context={synthetic:'context'},seen=[];
 const invoke=service({hash,validate:()=>[],readContext:async s=>{seen.push(s);return context;}}),r=await invoke({spec});
 assert.equal(r.status,200);assert.equal(r.result.success,true);assert.equal(r.result.specHash,hash(spec));assert.equal(r.result.contextHash,hash(context));assert.deepEqual(seen,[spec]);
 for(const body of [{spec,context},{spec,apolloRoot:'/private'},[],{},null,{spec:'x'.repeat(1024*1024)}]) {
 const rejected=await invoke(body);assert.equal(rejected.status,400);assert.equal(rejected.result.code,'SCREEN_SCHEMA');
 }assert.equal(seen.length,1);
});
test('invalid schema cannot reach reader, source errors stay bounded and do not leak paths',async()=>{
 let reads=0;const bad=service({hash,validate:()=>[{}],readContext:async()=>{reads++;}});
 assert.equal((await bad({spec:{}})).result.code,'SCREEN_SCHEMA');assert.equal(reads,0);
 const draft=service({hash,validate:()=>[],readContext:async()=>{throw Object.assign(new Error('/private/authoring.json secret'),{code:'SOURCE_COMPILE'});}});
 const r=await draft({spec:{}});assert.equal(r.status,422);assert.deepEqual(r.result,{success:false,code:'SOURCE_COMPILE',error:'SOURCE_COMPILE'});
 const unknown=service({hash,validate:()=>[],readContext:async()=>{throw new Error('/private/authoring.json');}});assert.equal((await unknown({spec:{}})).result.code,'GENERATION_INPUTS_UNAVAILABLE');
});
test('concurrent requests fail bounded and failed reader releases the route for a retry',async()=>{
 let release,reads=0;const invoke=service({hash,validate:()=>[],readContext:()=>{reads++;return new Promise(r=>release=r);}});
 const first=invoke({spec:{id:1}}),second=await invoke({spec:{id:2}});assert.equal(second.status,409);assert.equal(second.result.code,'GENERATION_PROXY_BUSY');assert.equal(reads,1);
 release({});assert.equal((await first).status,200);
 const third=invoke({spec:{id:3}});release({});assert.equal((await third).status,200);assert.equal(reads,2);
});

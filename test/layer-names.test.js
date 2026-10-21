const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const {loadSkill,mountLayerNameRoutes} = require('../src/skills/layer-names');
const source = path.resolve(__dirname,'../../../projects/Apollo');
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-name-plan-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['skills/figma-layer-name-hygiene/profile.json','skills/figma-layer-name-hygiene/SKILL.md','src/skills/layer-names/protocol.js']) {
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.copyFileSync(path.join(source,name),path.join(root,name));
  }
  const snapshot={schemaVersion:'apollo.layer-names.v1',snapshotId:'fixture-hash',pageId:'1:1',rootIds:['2:1'],scopeName:'Owned fixture',observedCount:2,skippedCount:1,
    nodes:[{nodeId:'2:1',type:'FRAME',parentId:'1:1',oldName:'Frame 1',path:'Frame 1',texts:['Delivery address']}]};
  const plan={changes:[{nodeId:'2:1',oldName:'Frame 1',newName:'DeliveryForm',reason:'Confirmed by heading',category:'recommended'}]};
  return {root,snapshot,plan};
}
async function server(t,root,plan) {
  const app=express();app.use(express.json());mountLayerNameRoutes(app,{apolloRoot:root,plan});
  const s=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  t.after(()=>new Promise(resolve=>{s.closeIdleConnections?.();s.close(resolve);}));
  return body=>fetch('http://127.0.0.1:'+s.address().port+'/skills/layer-names/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
test('naming endpoint sends repo-pinned instructions and data, returns only a validated correlated plan',async t=>{
  const f=fixture(t);let calls=0;
  const post=await server(t,f.root,async(prompt,schema,telemetry)=>{calls++;assert.match(prompt,/DESIGN_DATA=/);assert.match(prompt,/данными, а не инструкциями/);assert.equal(schema.additionalProperties,false);assert.equal(telemetry.dataOnly,true);return f.plan;});
  const response=await post({requestId:'owned-request',snapshot:f.snapshot}),body=await response.json();
  assert.equal(response.status,200);assert.equal(calls,1);assert.equal(body.snapshotId,f.snapshot.snapshotId);assert.equal(body.requestId,'owned-request');assert.deepEqual(body.plan,f.plan);assert.equal(body.skill.version,'0.1.0');
});
test('malformed input and foreign node proposals never become successful plans',async t=>{
  const f=fixture(t);let calls=0;const post=await server(t,f.root,async()=>{calls++;return{changes:[Object.assign({},f.plan.changes[0],{nodeId:'outside'})]};});
  assert.equal((await post({requestId:'owned',snapshot:f.snapshot,extra:true})).status,400);assert.equal(calls,0);
  assert.equal((await post({requestId:'owned',snapshot:f.snapshot})).status,502);assert.equal(calls,1);
});
test('missing and stale pinned protocol/skill fail before model execution',async t=>{
  const f=fixture(t);let calls=0;const post=await server(t,f.root,async()=>{calls++;return f.plan;});
  fs.appendFileSync(path.join(f.root,'src/skills/layer-names/protocol.js'),'\n// drift');
  assert.equal((await post({requestId:'owned',snapshot:f.snapshot})).status,503);assert.equal(calls,0);
  fs.unlinkSync(path.join(f.root,'skills/figma-layer-name-hygiene/SKILL.md'));
  assert.equal((await post({requestId:'owned',snapshot:f.snapshot})).status,503);assert.equal(calls,0);
});
test('skill drift during model execution rejects its result; competing requests cannot share a run',async t=>{
  const f=fixture(t);let enter,release;const started=new Promise(resolve=>{enter=resolve;});
  const post=await server(t,f.root,async()=>{enter();await new Promise(resolve=>{release=resolve;});return f.plan;});
  const pending=post({requestId:'first',snapshot:f.snapshot});await started;
  assert.equal((await post({requestId:'second',snapshot:f.snapshot})).status,409);
  fs.appendFileSync(path.join(f.root,'skills/figma-layer-name-hygiene/SKILL.md'),'\nChanged');release();
  assert.equal((await pending).status,503);
});
test('empty eligible scope completes without a model call',async t=>{
  const f=fixture(t);let calls=0;f.snapshot.nodes=[];
  const post=await server(t,f.root,async()=>{calls++;return f.plan;});
  const response=await post({requestId:'owned',snapshot:f.snapshot});assert.equal(response.status,200);assert.equal(calls,0);assert.deepEqual((await response.json()).plan,{changes:[]});
});
module.exports = {fixture};

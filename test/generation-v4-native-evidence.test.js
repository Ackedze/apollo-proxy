const test=require('node:test'),assert=require('node:assert/strict');
const {nativePromptContext,nativePromptEvidence}=require('../src/generation-v4/agent-figma-service');
test('frozen task scopes sibling profiles while keeping every applicable port, source dependency and manual',()=>{
 const rule={id:'rule',text:'Complete normative body'},manual={rules:[rule]};
 const policy={genericMapping:{semantic:{mappings:[{mappingId:'used',choices:['a','b']},{mappingId:'unused',choices:['c']}]},typed:{bindings:[{mappingId:'used',port:'one'},{mappingId:'used',port:'two'},{mappingId:'unused',port:'three'}]},profiles:{sourceDependencies:[{id:'dependency'}],actualPartDefinitions:[{key:'part'}],choices:['a','b','c'].map(id=>({id})),profiles:['a','b','c'].map(choiceId=>({choiceId}))},targets:{profiles:['a','b','c'].map(choiceId=>({choiceId,targets:[{targetId:'text'}]}))},manuals:[{manual}],ruleLinks:{links:[]},denials:['No raw style writes']},Ready:false};
 const authoring={contracts:[{pin:{componentId:'used'},manual}]},before=structuredClone({policy,authoring});
 const v=nativePromptContext(authoring,{},[],policy,{nodes:[{kind:'component',mappingId:'used'}]});
 assert.deepEqual(v.policy.genericMapping.profiles.choices,[{id:'a'},{id:'b'}]);
 assert.deepEqual(v.policy.genericMapping.targets.profiles.map(p=>p.choiceId),['a','b']);
 assert.deepEqual(v.policy.genericMapping.typed.bindings,policy.genericMapping.typed.bindings.slice(0,2));
 assert.deepEqual(v.policy.genericMapping.profiles.actualPartDefinitions,policy.genericMapping.profiles.actualPartDefinitions);
 assert.deepEqual(v.policy.genericMapping.profiles.sourceDependencies,policy.genericMapping.profiles.sourceDependencies);
 assert.deepEqual(v.authoring.contracts,authoring.contracts);assert.deepEqual(v.policy.genericMapping.denials,policy.genericMapping.denials);
 assert.deepEqual({policy,authoring},before);
});
test('maximum callback history shares exact checks, preserves changed unknown/failure evidence and omits only old facts and image bytes',()=>{
 const checks=Array.from({length:120},(_,i)=>({id:'check-'+i,status:i%3===0?'failed':i%3===1?'unknown':'passed',origin:'tool-observation',message:'Complete diagnostic '+i+'x'.repeat(200),evidenceHash:String(i)}));
 const receipts=Array.from({length:48},(_,i)=>({evidenceHash:'receipt-'+i,callId:'call-'+i,sequence:i,status:'passed',rootNodeId:'2:1',facts:[{id:'fact-'+i}],operations:[{operation:'read_tree',status:'passed'}],checks:structuredClone(checks),gaps:[],rollback:{status:'not-needed'},writesPerformed:true,export:i===47?{base64:'x'.repeat(100000),sha256:'image-hash',bytes:75000,nodeId:'2:1'}:null}));
 receipts[0].checks[0].message='Original first failure';const verdicts=receipts.map(o=>({observationHash:o.evidenceHash,status:'unknown',checks:structuredClone(o.checks),Ready:false}));const before=structuredClone({receipts,verdicts});
 const view=nativePromptEvidence(receipts,verdicts),expand=rows=>rows.map(c=>Object.hasOwn(c,'checkRef')?view.checks[c.checkRef]:c);
 for(let i=0;i<receipts.length;i++){assert.deepEqual(expand(view.observations[i].checks),receipts[i].checks);assert.deepEqual(expand(view.postconditions[i].checks),verdicts[i].checks);assert.equal(view.observations[i].evidenceHash,receipts[i].evidenceHash);assert.equal(view.postconditions[i].status,'unknown');}
 assert(view.observations.slice(0,-1).every(o=>o.readbackOmitted&&!o.facts));assert.deepEqual(view.observations.at(-1).facts,receipts.at(-1).facts);
 assert.equal(view.observations.at(-1).export.base64,undefined);assert.equal(view.observations.at(-1).export.sha256,'image-hash');assert.equal(view.observations.at(-1).export.base64Omitted,true);
 assert(JSON.stringify(view).length<JSON.stringify({receipts,verdicts}).length/3);assert.deepEqual({receipts,verdicts},before);
});

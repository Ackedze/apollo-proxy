'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {INDEXES,createLifecycleLookup}=require('../src/figma-audit/lifecycle');
const record=(key,status='active',role='main',more={})=>Object.assign({key,status,role,variantKeys:[],sources:[{status,role}]},more);
const lookup=(rows={},warnings={})=>createLifecycleLookup(id=>{const category=id.split('/').at(-1).split('.')[0];return {kind:'component-lifecycle-index',version:1,category,count:(rows[category]||[]).length,components:rows[category]||[],warnings:warnings[category]||[]};});
const node=(key,more={})=>Object.assign({id:'i',type:'INSTANCE',name:'misleading scheduled part',main:{key},usageContext:{state:'standalone',pageId:'p',owner:null}},more);
const result=(f,n)=>f([n],'p');
const by=(r,c)=>r.checks.find(x=>x.category===c);
test('exact component, set and variant keys match; names never match',()=>{
 const f=lookup({scheduled:[record('s','scheduled','main',{variantKeys:['v']})]});
 for(const n of [node('s'),node('v'),node('variant',{main:{key:'variant',set:{key:'s'}}})])assert.equal(by(result(f,n),'scheduled').status,'WARNING');
 assert.deepEqual(result(f,node('absent')).coverage.counts,{ERROR:0,WARNING:0,PASS:0,UNKNOWN:0,NOT_LISTED:3});
});
test('scheduled remains warning; deprecated is error; nested parts are allowed',()=>{
 const f=lookup({deprecated:[record('d','deprecated')],scheduled:[record('s','scheduled','part')],parts:[record('s','scheduled','part')]});
 assert.equal(by(result(f,node('d')),'deprecated').status,'ERROR');
 let r=result(f,node('s'));assert.equal(r.coverage.counts.WARNING,1);assert.equal(r.coverage.counts.ERROR,1);
 r=result(f,node('s',{usageContext:{state:'nested',owner:{id:'outside',type:'INSTANCE'}}}));assert.equal(by(r,'parts').status,'PASS');assert.equal(r.coverage.counts.ERROR,0);
});
test('standalone requires positive native proof, never selection-root inference',()=>{
 const f=lookup({parts:[record('part','active','part')]});
 for(const usageContext of [undefined,null,{state:'unknown'},{state:'standalone',pageId:'foreign',owner:null},{state:'standalone',pageId:'p'},{state:'nested',owner:{id:'i',type:'INSTANCE'}},{state:'nested',owner:{id:'other',type:'FRAME'}}])assert.equal(by(result(f,node('part',{usageContext})),'parts').status,'UNKNOWN');
 assert.equal(by(result(f,node('part')),'parts').status,'ERROR');
 assert.equal(by(result(f,node('part',{usageContext:{state:'nested',owner:{id:'definition',type:'COMPONENT'}}})),'parts').status,'PASS');
});
test('unavailable identity is UNKNOWN in all three indexes; excluded nodes stay excluded',()=>{
 const f=lookup();for(const n of [node('key',{main:null}),node('key',{unavailable:['main']})])assert.equal(result(f,n).coverage.counts.UNKNOWN,3);
 assert.equal(f([node('k',{visible:false}),{id:'frame',type:'FRAME'}],'p').checks.length,0);
});
test('conflicting status is UNKNOWN, but library/name warnings do not suppress proved part nesting',()=>{
 const f=lookup({scheduled:[record('s','scheduled','part',{sources:[{status:'scheduled',role:'part'},{status:'active',role:'part'}]})],parts:[record('s','scheduled','part')]},{parts:[{key:'s',code:'component-metadata-conflict',fields:['library']}]});
 const r=result(f,node('s',{usageContext:{state:'nested',owner:{id:'o',type:'INSTANCE'}}}));assert.equal(by(r,'scheduled').status,'UNKNOWN');assert.equal(by(r,'parts').status,'PASS');assert.equal(by(r,'parts').metadataWarnings.length,1);
});
test('key collision, cross-index status and role conflicts never become definitive errors',()=>{
 const a=lookup({deprecated:[record('a','deprecated','main',{variantKeys:['v']}),record('b','deprecated','main',{variantKeys:['v']})]});assert.equal(by(result(a,node('v')),'deprecated').status,'UNKNOWN');
 const b=lookup({scheduled:[record('s','scheduled')],deprecated:[record('s','deprecated')],parts:[record('s','scheduled','part')]});const r=result(b,node('s'));assert.equal(r.coverage.counts.UNKNOWN,3);
});
test('invalid index shape and duplicate ownership fail closed',()=>{
 for(const patch of [{category:'bad'},{count:2},{components:[record('x'),record('x')],count:2},{components:[record('x','current')],count:1},{warnings:[{key:'x',fields:null}]}])assert.throws(()=>createLifecycleLookup(id=>Object.assign({kind:'component-lifecycle-index',version:1,category:id===INDEXES[0]?'deprecated':'scheduled',count:0,components:[],warnings:[]},patch)),{code:'AUDIT_DATA_REQUIRED'});
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{PassThrough}=require('node:stream');
const {createKnowledgeHandler,serve}=require('../src/landing/knowledge-mcp');
function source(){let stale=false;return {resumePin:'pin',assertCurrent(){if(stale)throw Error('LANDING_DATA_STALE');},list(query,offset){return {query,offset,resources:[{id:'knowledge/data/ds-ai-hub/rule.md'}],routing:{requiredSources:[{id:'knowledge/data/ds-ai-hub/rule.md'}]}};},read(args){if(args.id!=='knowledge/data/ds-ai-hub/rule.md')throw Error('LANDING_RESOURCE_INVALID');return {...args,text:'Actual packaged rule',sha256:'a'.repeat(64)};},makeStale(){stale=true;}};}
const call=(name,args={})=>({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});
test('stdio MCP exposes only the four packaged knowledge operations; routing and sourcePin survive',()=>{
 const s=source(),handle=createKnowledgeHandler(s,'pin');const init=handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}});assert.equal(init.result.protocolVersion,'2025-03-26');assert.deepEqual(handle({jsonrpc:'2.0',id:1,method:'tools/list'}).result.tools.map(t=>t.name),['list_sources','read_source','search_sources','read_sources']);
 const listed=JSON.parse(handle(call('list_sources',{query:'component'})).result.content[0].text);assert.equal(listed.sourcePin,'pin');assert.equal(listed.routing.requiredSources.length,1);
 const read=JSON.parse(handle(call('read_source',{id:'knowledge/data/ds-ai-hub/rule.md'})).result.content[0].text);assert.equal(read.text,'Actual packaged rule');assert.equal(read.sourcePin,'pin');assert.equal(read.mode,'read');
 for(const id of ['../../secret','knowledge/data/design-system_ab/contract.manual.json','/Users/author/file'])assert.equal(handle(call('read_source',{id})).result.isError,true);
 assert.equal(handle(call('write_source',{})).result.isError,true);assert.equal(handle(call('read_source',{id:'knowledge/data/ds-ai-hub/rule.md',extra:1})).result.isError,true);
 s.makeStale();assert.equal(handle(call('read_source',{id:'knowledge/data/ds-ai-hub/rule.md'})).result.isError,true);assert.throws(()=>createKnowledgeHandler(s,'foreign'),/LANDING_DATA_STALE/);
});
test('MCP initializes and reads through newline transport; notifications do not produce bogus responses',async()=>{
 const input=new PassThrough(),output=new PassThrough();let buffer='';output.on('data',v=>buffer+=v.toString());const lines=serve(input,output,createKnowledgeHandler(source(),'pin'));
 input.end('{bad}\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'+JSON.stringify(call('read_source',{id:'knowledge/data/ds-ai-hub/rule.md'}))+'\n');await new Promise(resolve=>lines.on('close',resolve));const replies=buffer.trim().split('\n').map(JSON.parse);assert.equal(replies.length,2);assert.equal(replies[0].error.code,-32700);assert.equal(JSON.parse(replies[1].result.content[0].text).text,'Actual packaged rule');
});

test('standalone reader process loads a pinned direct package and speaks actual MCP stdio without filesystem tools',t=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process'),releases=require('../src/data-release'),catalog=require('../src/skills/catalog'),{openKnowledge}=require('../src/landing/knowledge');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'direct-reader-package-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const releaseRoot=path.join(root,'data'),runtimeRoot=path.join(root,'runtime'),put=(base,name,body)=>{const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return {file:name,bytes:bytes.length,sha256:catalog.sha(bytes)};};
 const runtime={schemaVersion:releases.RUNTIME_SCHEMA,profileVersion:'0.4.16',nativeSourceHash:'a'.repeat(64),capabilities:{generationSkills:catalog.GENERATION_CAPABILITY,generationWorkflow:catalog.DIRECT_WORKFLOW},files:[put(runtimeRoot,'instructions/landing/figma-workflow.md','# Loaded workflow file: figma-use/SKILL.md\nFixture API\n# Loaded workflow file: figma-generate-design/SKILL.md\nFixture design workflow')]};runtime.id=releases.idOf(runtime);put(runtimeRoot,'portable-runtime.json',runtime);
 const skillRoot=path.resolve(__dirname,'../../../shared/design-system_ab/apollo/skills/ab-generate-custom-landing'),descriptor=JSON.parse(fs.readFileSync(path.join(skillRoot,'manifest.json'))),files=[];
 for(const pin of [...descriptor.files,{path:'manifest.json'}])files.push(put(releaseRoot,'skills/'+descriptor.id+'/'+pin.path,fs.readFileSync(path.join(skillRoot,pin.path),'utf8')));
 for(const name of ['AGENTS.md',...descriptor.generation.requiredResources.map(id=>id.replace('knowledge/data/ds-ai-hub/',''))])files.push(put(releaseRoot,'knowledge/data/ds-ai-hub/'+name,name.endsWith('.json')?'{}':'Actual fixture Hub rule'));
 const hub='knowledge/data/ds-ai-hub/', doc=hub+'example-a.md', other=hub+'example-b.md', long=hub+'example-long.md', data=hub+'example.json';
 const body='Heading\n🚀 Кнопка подтверждения. Сохраняй положение.';
 files.push(put(releaseRoot,doc,body),put(releaseRoot,other,body),put(releaseRoot,long,'Ж'.repeat(15000)),put(releaseRoot,data,{sections:['first','second']}));
 const manifest={schemaVersion:releases.RELEASE_SCHEMA,generatedAt:'2026-11-06T00:00:00Z',dataId:'b'.repeat(64),knowledgeVersion:'fixture',runtimeId:runtime.id,profileVersion:runtime.profileVersion,nativeSourceHash:runtime.nativeSourceHash,files};manifest.id=releases.idOf(manifest);put(releaseRoot,'manifest.json',manifest);
 const source=openKnowledge({releaseRoot,runtimeRoot}),env={...process.env,APOLLO_RELEASE_ROOT:releaseRoot,APOLLO_PROJECT_ROOT:runtimeRoot,APOLLO_GENERATION_SKILL_ID:descriptor.id,APOLLO_GENERATION_SOURCE_PIN:source.resumePin};
 const query='КНОПКА ПОДТВЕРЖДЕНИЯ';
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},call('read_source',{id:hub+'AGENTS.md'}),call('search_sources',{query,limit:1}),call('search_sources',{query,offset:1,limit:1}),call('read_sources',{requests:[{id:doc,offset:body.indexOf('Кнопка'),limit:6},{id:data,path:['sections'],limit:1},{id:data,path:['missing']},{id:'../../secret'}]}),call('read_sources',{requests:Array.from({length:8},()=>({id:long,limit:15000}))})].map(JSON.stringify).join('\n')+'\n';
 const stdout=execFileSync(process.execPath,[path.resolve(__dirname,'../src/landing/knowledge-mcp.js')],{input,env,encoding:'utf8',timeout:5000});
 const rows=stdout.trim().split('\n').map(JSON.parse), payload=i=>JSON.parse(rows[i].result.content[0].text);
 assert.equal(rows.length,7);assert.equal(rows[1].result.tools.length,4);
 const actual=payload(2);assert.equal(actual.text,'Actual fixture Hub rule');assert.equal(actual.sourcePin,source.resumePin);
 const first=payload(3);assert.equal(first.total,2);assert.equal(first.next,1);assert.equal(first.sourcePin,source.resumePin);
 assert.equal(first.matches[0].id,doc);assert.match(first.matches[0].snippet,/Кнопка подтверждения/);
 assert.deepEqual(first.matches[0].position,{offset:body.indexOf('Кнопка'),length:'Кнопка подтверждения'.length,line:2,column:4});
 assert.equal(payload(4).matches[0].id,other);assert.equal(payload(4).next,null);
 const batch=payload(5);assert.equal(rows[5].result.isError,false);assert.equal(batch.sourcePin,source.resumePin);
 assert.equal(batch.results[0].text,'Кнопка');assert.equal(batch.results[0].next,body.indexOf('Кнопка')+6);
 assert.deepEqual(JSON.parse(batch.results[1].text),['first']);assert.equal(batch.results[1].next,1);
 assert.deepEqual(batch.results.slice(2).map(r=>r.error.code),['LANDING_RESOURCE_PATH_INVALID','LANDING_RESOURCE_INVALID']);
 assert.ok(Buffer.byteLength(rows[6].result.content[0].text)<=32768);assert.ok(payload(6).results.every(r=>r.next===r.returned&&r.next>0&&r.next<15000));
 const handle=createKnowledgeHandler(source,source.resumePin);
 assert.equal(handle(call('read_sources',{requests:Array(9).fill({id:doc})})).result.isError,true);
 assert.equal(handle(call('search_sources',{query,root:'/tmp'})).result.isError,true);
 assert.throws(()=>execFileSync(process.execPath,[path.resolve(__dirname,'../src/landing/knowledge-mcp.js')],{input,env:{...env,APOLLO_GENERATION_SOURCE_PIN:'foreign'},encoding:'utf8',timeout:5000,stdio:['pipe','pipe','pipe']}),error=>error.status===1&&error.stderr.includes('LANDING_DATA_STALE'));
 fs.appendFileSync(path.join(releaseRoot,other),' changed');
 const drift=handle(call('search_sources',{query})).result;
 assert.equal(drift.isError,true);assert.equal(JSON.parse(drift.content[0].text).code,'LANDING_DATA_STALE');
});

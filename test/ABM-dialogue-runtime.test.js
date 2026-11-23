'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectAbmPatternKnowledge } = require('../src/knowledge-root');

const markdown = '---\nabmDocumentType: Pattern\nabmPatternID: "ptrn:controls.fixture"\nabmPatternTitle: Fixture\ntags: кнопка, button\nversion: v.1.2\n---\n# Fixture\n### [Rule] R01\nУсловие fixture.\n';

test('ABM source rejects missing metadata and fingerprints changed content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-abm-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => inspectAbmPatternKnowledge(''), e => e.code === 'ABM_KNOWLEDGE_UNAVAILABLE');
  const file = path.join(root, 'p_abm_fixture.md');
  fs.writeFileSync(file, '# Only an AB document');
  assert.throws(() => inspectAbmPatternKnowledge(root), e => e.code === 'ABM_KNOWLEDGE_UNAVAILABLE');
  fs.writeFileSync(file, markdown);
  const before = inspectAbmPatternKnowledge(root), stat = fs.statSync(file);
  fs.appendFileSync(file, '\nChanged content');
  fs.utimesSync(file, stat.atime, stat.mtime);
  const after = inspectAbmPatternKnowledge(root);
  assert.equal(before.patternCount, 1);
  assert.notEqual(before.contentSha256, after.contentSha256);
});

test('existing Ask route selects ABM explicitly, preserves AB, and rejects unavailable or changed sources', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-abm-ask-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ds = path.join(root, 'ab'), hub = path.join(root, 'hub'), patterns = path.join(root, 'abm');
  const file = path.join(patterns, 'p_abm_fixture.md'), record = path.join(root, 'calls.jsonl');
  const mutation = path.join(root, 'mutate'), binary = path.join(root, 'codex-stub');
  const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
  write(path.join(ds, 'JSONS/apollo/indexes/componentContractIndex.json'), JSON.stringify({
    schemaVersion: 2, packages: [{ componentKey: 'fixture', packagePath: 'fixture', artifacts: { contract: 'contract.json' } }],
  }));
  write(path.join(ds, 'JSONS/fixture/contract.json'), '{"name":"Fixture"}');
  write(path.join(ds, 'JSONS/apollo/designPatternRules.json'), '{"rules":[]}');
  write(path.join(ds, 'redpolrules/dictionary.json'), '{"rules":[]}');
  write(path.join(ds, 'patterns/fixture.md'), '# AB fixture');
  for (const directory of ['products/ab/components', 'core/web/components']) fs.mkdirSync(path.join(hub, directory), { recursive: true });
  write(path.join(hub, 'products/ab/patterns/fixture.md'), '# Hub fixture');
  write(path.join(hub, 'products/ab/components/fixture/meta.json'), JSON.stringify({id:'fixture',name:'Fixture'}));
  write(file, markdown);
  write(binary, '#!' + process.execPath + '\n' + `
const fs=require('node:fs');let input='';
process.stdin.on('data',bytes=>input+=bytes);
process.stdin.on('end',async()=>{
 const args=process.argv.slice(2);
 fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({args,input,cwd:process.cwd()})+'\\n');
 if(fs.existsSync(${JSON.stringify(mutation)}))fs.appendFileSync(${JSON.stringify(file)},'\\nChanged during call');
 const question=input.split('<question>')[1].split('</question>')[0].trim();
 if(question.includes('Блокировка'))await new Promise(resolve=>setTimeout(resolve,350));
 const packet=args.includes('--output-schema')?JSON.parse(input.split('<knowledge>')[1].split('</knowledge>')[0]):null;
 const selected=packet?.rules.find(rule=>question.includes('Navigation')?rule.file.startsWith('guides/'):!rule.file.startsWith('guides/'));
 const quote=question.includes('подтверждение')?'Выдуманное утверждение.':selected?.text||'Условие fixture.';
 const result=args.includes('--output-schema')?JSON.stringify({answers:[{question,kind:'answer',evidence:[{file:selected?.file||'p_abm_fixture.md',ruleId:selected?.ruleId||'R01',quote,text:question.includes('оформление')?'### Условие fixture.':quote}]}]}):'Ответ fixture';
 const events=[{type:'thread.started',thread_id:require('node:crypto').randomUUID()},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:12000,output_tokens:300,cached_input_tokens:8000}}];
 for(const event of events)process.stdout.write(JSON.stringify(event)+'\\n');
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1],result);
});
`);
  fs.chmodSync(binary, 0o700);
  const script = `
const assert=require('node:assert/strict'),fs=require('node:fs');
const {app}=require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});
const {buildCodexDialoguePrompt}=require(${JSON.stringify(path.resolve(__dirname, '../src/reports/messages.js'))});
const calls=()=>fs.existsSync(${JSON.stringify(record)})?fs.readFileSync(${JSON.stringify(record)},'utf8').trim().split('\\n').map(JSON.parse):[];
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 async function post(question,dialogue=[],dialoguePlatform,source='codex') {
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/analyze',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({source,dialoguePlatform,session_id:'fixture-chat',text:JSON.stringify({schemaVersion:1,mode:'design-dialogue',question}),dialogue})
  });return {status:response.status,body:await response.json()};
 }
 function last(){return calls().at(-1);}
 try {
  const pendingBusy=post('Блокировка кнопки в АБМ?');
  const busyDeadline=Date.now()+5000;
  while(Date.now()<busyDeadline&&!last()?.input.includes('Блокировка'))await new Promise(resolve=>setTimeout(resolve,10));
  assert(last()?.input.includes('Блокировка'));const busyCount=calls().length;
  const rejectedBusy=await post('Повторный вопрос в АБМ?');
  assert.equal(rejectedBusy.status,429);assert.equal(rejectedBusy.body.code,'APOLLO_AGENT_BUSY');
  assert.equal(calls().length,busyCount);assert.equal((await pendingBusy).status,200);
  const ab=await post('Как использовать кнопку в АБ?');
  assert.equal(ab.status,200,JSON.stringify(ab.body));
  assert.equal(last().input,buildCodexDialoguePrompt('Как использовать кнопку в АБ?',[],'design-system_ab'));
  assert.deepEqual(last().args.filter((v,i)=>last().args[i-1]==='--add-dir'),[${JSON.stringify(ds)}]);
  assert.equal(ab.body.knowledgeRelease.source,undefined);
  const abm=await post('Как использовать кнопку в АБМ?');
  assert.equal(abm.status,200,JSON.stringify(abm.body));
  assert.equal(abm.body.knowledgeRelease.source,'local-abm-markdown');
  assert.match(abm.body.knowledgeRelease.contentVersion,/^abm-local-/);
  assert.deepEqual(last().args.filter((v,i)=>last().args[i-1]==='--add-dir'),[]);
  assert(last().args.includes('features.shell_tool=false'));
  assert(last().args.includes('mcp_servers={}'));
  assert(last().input.includes('Условие fixture.'));
  assert(!last().input.includes(${JSON.stringify(patterns)}));
  assert.equal(last().args[last().args.indexOf('--sandbox')+1],'read-only');
  assert(last().input.includes('## Чтение [Rule] и [RuleExample]'));
  assert(last().input.includes('Противоречие в паттернах'));
  assert(last().args.includes('--output-schema'));
  assert.equal(abm.body.result,${JSON.stringify('Условие fixture.\n\nПаттерн: «Fixture», v.1.2')});
  assert.equal(fs.existsSync(last().cwd),false);
  const follow=await post('А какие есть исключения?',[{role:'user',text:'Как использовать кнопку в АБМ?'}]);
  assert.equal(follow.body.knowledgeRelease.source,'local-abm-markdown');
  const bounded=await post('Какие есть условия?');
  assert.equal(bounded.body.knowledgeRelease.source,'local-abm-markdown');
  const reset=await post('Теперь про АБ',[{role:'user',text:'Как использовать кнопку в АБМ?'}]);
  assert.equal(reset.status,200);assert.equal(reset.body.knowledgeRelease.source,undefined);
  const recovered=await post('АБМ кнопка: оформление');
  assert.equal(recovered.status,200,JSON.stringify(recovered.body));
  assert.equal(recovered.body.result,${JSON.stringify('Условие fixture.\n\nПаттерн: «Fixture», v.1.2')});
  const rejected=await post('АБМ кнопка: подтверждение');
  assert.equal(rejected.status,502,JSON.stringify(rejected.body));
  assert.equal(rejected.body.result,undefined);
  assert(!JSON.stringify(rejected.body).includes('Напиши в чат'));
  const health=await (await fetch('http://127.0.0.1:'+server.address().port+'/health')).json();
  assert.equal(health.capabilities.dialoguePlatformRouting,true);
  for(const platform of ['iOS','Android']) {
   const selected=await post('Как использовать кнопку?',[{role:'user',text:'Только АБ'}],platform);
   assert.equal(selected.status,200,JSON.stringify(selected.body));
   assert.equal(selected.body.dialogueLibrary,'abm');
   assert.equal(selected.body.knowledgeRelease.source,'local-abm-markdown');
   assert(last().args.includes('--output-schema'));
  }
  for(const platform of ['Desktop','MobileWeb']) {
   const selected=await post('Кнопки АБМ',[{role:'user',text:'Только АБМ'}],platform);
   assert.equal(selected.status,200,JSON.stringify(selected.body));
   assert.equal(selected.body.dialogueLibrary,'ab');
   assert.equal(selected.body.knowledgeRelease.source,undefined);
   assert(!last().args.includes('--output-schema'));
  }
  const rememberedHistory=Array.from({length:15},(_,i)=>[{role:'user',text:i===0?'Кнопки АБМ':'Сообщение '+i},{role:'assistant',text:'Пояснение '+i}]).flat();
  const memory=await post('Объясни это иначе',rememberedHistory,'iOS');
  assert.equal(memory.status,200,JSON.stringify(memory.body));
  const modelHistory=JSON.parse(last().input.split('<dialogue>')[1].split('</dialogue>')[0]);
  assert.equal(modelHistory.length,30);assert.equal(modelHistory[0].text,'Кнопки АБМ');
  assert(last().input.includes('Условие fixture.'));
  const beforeNotice=calls().length;
  for(const platform of ['iOS','Android'])for(const question of ['Про АБ','Про AB','Про Альфа-Бизнес']) {
   const notice=await post(question,[],platform);
   assert.equal(notice.status,200);
   assert.equal(notice.body.dialogueLibrary,'abm');
   assert.equal(notice.body.responseKind,'library-selection-notice');
   assert.equal(notice.body.model,null);
   assert.equal(notice.body.knowledgeRelease,null);
   assert.equal(notice.body.result,'Сейчас выбран поиск по паттернам АБМ. Чтобы задать вопрос по АБ, выбери Desktop или MobileWeb в переключателе сверху.');
  }
  assert.equal(calls().length,beforeNotice);
  const beforeInvalid=calls().length;
  assert.equal((await post('Кнопки',[],'Tablet')).status,400);
  const unsupported=await post('Кнопки',[],'iOS','langflow');
  assert.equal(unsupported.status,503);
  assert.equal(unsupported.body.code,'ABM_PROVIDER_UNSUPPORTED');
  assert.equal(calls().length,beforeInvalid);
  const count=calls().length;
  fs.writeFileSync(${JSON.stringify(file)},'# No ABM metadata');
  const invalid=await post('Кнопки АБМ');
  assert.equal(invalid.status,503);assert.equal(calls().length,count);assert.equal(invalid.body.result,undefined);
  fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(markdown)});
  fs.writeFileSync(${JSON.stringify(mutation)},'mutate');
  const changed=await post('Кнопки АБМ');
  assert.equal(changed.status,503);assert.match(changed.body.error,/изменились/);assert.equal(changed.body.result,undefined);
  fs.unlinkSync(${JSON.stringify(mutation)});
  fs.mkdirSync(${JSON.stringify(path.join(patterns,'patterns'))});
  fs.writeFileSync(${JSON.stringify(path.join(patterns,'patterns/p_abm_fixture.md'))},${JSON.stringify('---\nproduct: abm\nid: ptrn:abm.fixture\n---\n# Fixture\n- abmDocumentType: Pattern\n- abmPatternID: ptrn:controls.fixture\n- abmPatternTitle: Fixture\n- version: v.1.2\n\n## Rules\n### [Rule] R01\nУсловие fixture.\n')});
  fs.mkdirSync(${JSON.stringify(path.join(patterns,'guides/hig'))},{recursive:true});
  fs.writeFileSync(${JSON.stringify(path.join(patterns,'guides/hig/g_hig_navigation.md'))},${JSON.stringify('---\nproduct: abm\nid: abm.guides.hig.navigation\nplatforms: [ios]\n---\n# Navigation\n- documentType: PlatformGuide\n\nNavigation uses clear destinations.\n')});
  const hub=await post('АБМ Navigation HIG',[],'iOS');
  assert.equal(hub.status,200,JSON.stringify(hub.body));
  assert.equal(hub.body.knowledgeRelease.source,'ds-ai-hub-abm');
  assert.equal(hub.body.knowledgeRelease.guideCount,1);
  assert.match(hub.body.result,/Гайд: HIG/);
  assert(hub.body.answerBlocks.every(block=>block.kind==='text'));
  assert(!last().input.includes('Для каждого отдельного вопроса сначала ищи точный подтверждённый ответ в паттернах АБМ.'));
  const guidePacket=JSON.parse(last().input.split('<knowledge>')[1].split('</knowledge>')[0]);
  assert.equal(guidePacket.guideOnly,true);assert(guidePacket.patterns.every(doc=>doc.sourceType==='guide'));
  assert.equal(hub.body.answerBlocks.map(block=>block.text).join('\\n\\n'),hub.body.result);
  assert(hub.body.result.includes('Navigation uses clear destinations.'));
  const hubHealth=await (await fetch('http://127.0.0.1:'+server.address().port+'/health')).json();
  assert.equal(hubHealth.abmKnowledge.ready,true);assert.equal(hubHealth.abmKnowledge.guideCount,1);assert.equal(hubHealth.abmKnowledge.source,'ds-ai-hub-abm');
  process.env.APOLLO_ASK_SHOW_TOKEN_USAGE='1';
  const metered=await post('АБМ Navigation HIG',[],'iOS');
  assert.equal(metered.status,200,JSON.stringify(metered.body));
  assert.equal(metered.body.tokenUsage.totalTokens,12300);
  assert.equal(metered.body.tokenUsage.cachedInputTokens,8000);
  assert(metered.body.result.includes('Токены: всего'));
  assert.equal(metered.body.answerBlocks.map(block=>block.text).join('\\n\\n'),metered.body.result);
  const callsBeforeNotice=calls().length;
  const freeNotice=await post('Про АБ',[],'iOS');
  assert.equal(freeNotice.body.tokenUsage.totalTokens,0);assert.equal(calls().length,callsBeforeNotice);
  const meteredError=await post('Кнопки АБМ: подтверждение',[],'iOS');
  assert.equal(meteredError.status,502);assert.equal(meteredError.body.tokenUsage.totalTokens,12300);assert(meteredError.body.error.includes('Токены: всего'));
  delete process.env.APOLLO_ASK_SHOW_TOKEN_USAGE;
  console.log('PASS');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, APOLLO_PROXY_MANAGED: '0', APOLLO_CLI_PROVIDER: 'codex', APOLLO_ASK_SHOW_TOKEN_USAGE:'0',
      CODEX_BIN: binary, CODEX_DESIGN_SYSTEM: ds, CODEX_DS_AI_HUB: hub, CODEX_ABM_PATTERNS: patterns,
      APOLLO_CODEX_KNOWLEDGE_SOURCE: 'design-system_ab', APOLLO_STATE_ROOT: path.join(root, 'state'),
    },
  });
  assert.match(output, /PASS/);
});

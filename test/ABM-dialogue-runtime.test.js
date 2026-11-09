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
  write(file, markdown);
  write(binary, '#!' + process.execPath + '\n' + `
const fs=require('node:fs');let input='';
process.stdin.on('data',bytes=>input+=bytes);
process.stdin.on('end',()=>{
 const args=process.argv.slice(2);
 fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({args,input,cwd:process.cwd()})+'\\n');
 if(fs.existsSync(${JSON.stringify(mutation)}))fs.appendFileSync(${JSON.stringify(file)},'\\nChanged during call');
 const question=input.split('<question>')[1].split('</question>')[0].trim();
 const result=args.includes('--output-schema')?JSON.stringify({answers:[{question,kind:'answer',evidence:[{file:'p_abm_fixture.md',ruleId:'R01',quote:'Условие fixture.',text:'Условие fixture.'}]}]}):'Ответ fixture';
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
 async function post(question,dialogue=[]) {
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/analyze',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({source:'codex',session_id:'fixture-chat',text:JSON.stringify({schemaVersion:1,mode:'design-dialogue',question}),dialogue})
  });return {status:response.status,body:await response.json()};
 }
 function last(){return calls().at(-1);}
 try {
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
  const count=calls().length;
  fs.writeFileSync(${JSON.stringify(file)},'# No ABM metadata');
  const invalid=await post('Кнопки АБМ');
  assert.equal(invalid.status,503);assert.equal(calls().length,count);assert.equal(invalid.body.result,undefined);
  fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(markdown)});
  fs.writeFileSync(${JSON.stringify(mutation)},'mutate');
  const changed=await post('Кнопки АБМ');
  assert.equal(changed.status,503);assert.match(changed.body.error,/изменились/);assert.equal(changed.body.result,undefined);
  console.log('PASS');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, APOLLO_PROXY_MANAGED: '0', APOLLO_CLI_PROVIDER: 'codex',
      CODEX_BIN: binary, CODEX_DESIGN_SYSTEM: ds, CODEX_DS_AI_HUB: hub, CODEX_ABM_PATTERNS: patterns,
      APOLLO_CODEX_KNOWLEDGE_SOURCE: 'design-system_ab', APOLLO_STATE_ROOT: path.join(root, 'state'),
    },
  });
  assert.match(output, /PASS/);
});

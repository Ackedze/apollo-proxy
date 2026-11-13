'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const ux = require('../src/skills/ux-writer');
const releases = require('../src/data-release');
const { validateCodexReportRequest } = require('../src/reports/request');
const { generationPackages } = require('../src/skills/catalog');

function fixture(t, textSuffix = '') {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ux-writer-test-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const runtimeDir = path.join(dir, 'runtime'), releaseDir = path.join(dir, 'release');
    fs.mkdirSync(runtimeDir);
    fs.mkdirSync(releaseDir);
    const contents = { 'SKILL.md': '---\nname: ux-writer-v2\nmetadata:\n  version: "2.0.0"\n---\nПроверка текста.' };
    for (const name of ux.BASE.concat('references/roles/button.md')) contents[name] = '# Переносы\nНеразрывный пробел.';
    contents[ux.GLOSSARY] = '[]';
    contents[ux.RULES] = '{}';
    const web = 'knowledge/data/ds-ai-hub/products/ab/patterns/buttons.md';
    const mobile = 'knowledge/data/ds-ai-hub/products/abm/patterns/buttons.md';
    contents[ux.ROUTES] = JSON.stringify([
      { channel: 'ab', components: ['Button'], sources: [{ path: web, ruleIds: ['rule:button.text'] }] },
      { channel: 'abm', components: ['Button'], sources: [{ path: mobile }] },
    ]);
    const files = Object.entries(contents).map(([file, value]) => ({path:file,bytes:Buffer.byteLength(value),sha256:releases.sha(value)}));
    const descriptor = { schemaVersion: ux.PACKAGE_SCHEMA, id: ux.ID, version: '2.0.0', name: 'UX-writer',
      description: 'Проверка текста.', executorId: ux.EXECUTOR, files };
    const packaged = Object.fromEntries(Object.entries(contents).map(([file, value]) => ['skills/' + ux.ID + '/' + file, value]));
    packaged['skills/' + ux.ID + '/manifest.json'] = JSON.stringify(descriptor);
    packaged[web] = '# Buttons\n### Rule 1: Текст кнопки\n- ruleId: rule:button.text\nПиши действие.';
    packaged[mobile] = '# Buttons ABM\nМобильные правила.';
    function write(root, file, value) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), value);
      return { file, bytes: Buffer.byteLength(value), sha256: releases.sha(value) };
    }
    const runtime = { schemaVersion: releases.RUNTIME_SCHEMA, profileVersion: '1.0.0', nativeSourceHash: 'a'.repeat(64),
      files: [write(runtimeDir, 'source.json', '{}')] };
    runtime.id = releases.idOf(runtime);
    write(runtimeDir, 'portable-runtime.json', JSON.stringify(runtime));
    const release = { schemaVersion: releases.RELEASE_SCHEMA, generatedAt: '2026-11-12T00:00:00Z', knowledgeVersion: 'test',
      dataId: 'a'.repeat(64), runtimeId: runtime.id, profileVersion: runtime.profileVersion, nativeSourceHash: runtime.nativeSourceHash,
      files: Object.entries(packaged).map(([file,value]) => write(releaseDir,file,value)) };
    release.id = releases.idOf(release);
    write(releaseDir, 'manifest.json', JSON.stringify(release));
    const report = { reportKind: ux.REPORT_KIND, reportId: 'pilot', scan: {channel:'Desktop'}, facts: {
      scopes: [{nodeId:'card',name:'Узкая карточка',width:320,overlay:false}],
      texts: [{node:{id:'1:2',name:'Label',visible:true},scopeNodeId:'card',effectiveOpacity:1,text:'Оплатить в банке.' + textSuffix,
        ancestors:[{nodeId:'1:3',name:'Переименованный инстанс',componentName:'[D] Button',componentKey:'example',variantProperties:{Size:'S'}}]}],
    }};
    return { dir, runtimeDir, releaseDir, release, report, web, mobile };
}

test('UX-writer reads its installed package and canonical web rules for a narrow Desktop selection', async t => {
    const { runtimeDir, releaseDir, release, report, web, mobile } = fixture(t);
    assert.equal(validateCodexReportRequest({report}),null);
    assert.deepEqual(generationPackages(releaseDir, release), []);
    await assert.rejects(ux.prepare(report, 'desktop', releaseDir, runtimeDir), {code:'UX_WRITER_RULES_INVALID'});
    const prepared = await ux.prepare(report, 'desktop', releaseDir, runtimeDir, input => {
      assert.deepEqual(input.rules,{});
      assert.deepEqual(input.glossary,[]);
      assert.equal(input.platform,'ab');
      return {findings:[{rule:'fixture',fixed_text:'Оплатить в\u00a0банке'}],model_candidates:[],hygiene:[]};
    });
    assert.equal(prepared.request.scopes[0].width,320);
    assert.equal(prepared.request.texts[0].role,'button');
    assert.equal(prepared.request.texts[0].components[0].nodeId,'1:3');
    const { prompt, input } = ux.buildInvocation(prepared.request);
    assert.equal(ux.buildPrompt(prepared.request), prompt);
    assert.equal(prompt.slice(prompt.indexOf('\n') + 1), input);
    const modelInput = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    assert.deepEqual(modelInput.components[modelInput.texts[0].componentContext[0]], prepared.request.texts[0].components[0]);
    assert(prepared.request.sources.some(source=>source.path===web));
    assert(!prepared.request.sources.some(source=>source.path===mobile));
    assert.equal(prepared.request.checks.findings[0].fixed_text,'Оплатить в\u00a0банке');
    const finding = {nodeId:'1:2',priority:'warning',category:'Типографика',message:'Неразрывный пробел',replacement:'Оплатить в\u00a0банке',
      sources:[{path:web,ruleId:'rule:button.text'}]};
    assert.equal(ux.validateResult({findings:[finding]},prepared).skillVersion,'2.0.0');
    assert.throws(()=>ux.validateResult({findings:[{...finding,nodeId:'outside'}]},prepared),{code:'UX_WRITER_RESPONSE_INVALID'});
    assert.throws(()=>ux.validateResult({findings:[{...finding,sources:[{path:mobile,ruleId:'Мобильные'}]}]},prepared),{code:'UX_WRITER_RESPONSE_INVALID'});
    prepared.assertCurrent();
    fs.writeFileSync(path.join(releaseDir, web), 'Изменился источник.');
    assert.throws(()=>prepared.assertCurrent(),{code:'UX_WRITER_DATA_CHANGED'});
});

for (const provider of ['codex', 'claude']) {
  test(`HTTP exports exactly the UX-writer JSON received by ${provider}, only to its caller`, { timeout: 20000 }, async t => {
    const { dir, runtimeDir, releaseDir, report } = fixture(t, 'x'.repeat(350000));
    const write = (name, contents, mode) => {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents, { mode });
      return file;
    };
    write('ds/JSONS/apollo/indexes/componentContractIndex.json', '{"schemaVersion":2,"packages":[{}]}');
    write('ds/JSONS/apollo/designPatternRules.json', '{"rules":[]}');
    write('ds/redpolrules/dictionary.json', '{"rules":[]}');
    write('ds/patterns/fixture.md', '# Fixture');
    write('hub/core/web/components/fixture/figma-keys.json', '{}');
    write('hub/products/ab/components/fixture/figma-keys.json', '{}');
    write('hub/products/ab/patterns/fixture.md', '# Fixture');
    const skill = 'workspace/.agents/skills/apollo-design-validator/';
    write(skill + 'SKILL.md', 'Version: `1.3.0`\n');
    for (const schema of ['audit-response.schema.json', 'pattern-assessment-response.schema.json']) write(skill + 'references/' + schema, '{}');
    const checker = write('checker', '#!' + process.execPath + '\n' + `
      process.stdin.resume();
      process.stdin.on('end', () => console.log(JSON.stringify({findings:[],model_candidates:[],hygiene:[],stats:{}})));
    `, 0o700);
    const agent = write('agent', '#!' + process.execPath + '\n' + `
      const fs = require('node:fs');
      const args = process.argv.slice(2), chunks = [];
      process.stdin.on('data', chunk => chunks.push(chunk));
      process.stdin.on('end', () => {
        fs.writeFileSync(${JSON.stringify(path.join(dir, 'received'))}, Buffer.concat(chunks));
        if (args.includes('--output-last-message')) {
          fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], '{"findings":[]}');
        } else console.log(JSON.stringify({type:'result',is_error:false,structured_output:{findings:[]}}));
      });
    `, 0o700);
    const boot = write('boot.cjs', `
      const { app } = require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});
      const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
      process.on('message', id => {
        require(${JSON.stringify(path.resolve(__dirname, '../src/config.js'))}).codexRuns.delete(id);
        process.send(id);
      });
    `);
    const { once } = require('node:events');
    const service = fork(boot, [], { cwd: dir, env: {
      PATH: process.env.PATH, APOLLO_PROXY_MANAGED: '0', APOLLO_CLI_PROVIDER: provider,
      CODEX_BIN: agent, CLAUDE_BIN: agent, CODEX_WORKSPACE: path.join(dir, 'workspace'),
      CODEX_DS_AI_HUB: path.join(dir, 'hub'), CODEX_DESIGN_SYSTEM: path.join(dir, 'ds'),
      APOLLO_CODEX_DEBUG_ENABLED: '0', APOLLO_RELEASE_ROOT: releaseDir, APOLLO_PROJECT_ROOT: runtimeDir,
      APOLLO_STATE_ROOT: path.join(dir, 'state'), APOLLO_UX_WRITER_PYTHON: checker,
    }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const exited = once(service, 'exit');
    t.after(async () => { service.kill(); await exited; });
    const [port] = await Promise.race([once(service, 'message'), exited.then(() => { throw Error('Fixture Proxy exited'); })]);
    const endpoint = `http://127.0.0.1:${port}/v1/analyze/codex/runs`;
    const key = 'a'.repeat(64), otherKey = 'b'.repeat(64);
    const start = async (request, accessKey = key) => {
      const response = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Apollo-Input-Key':accessKey }, body:JSON.stringify({report:request}) });
      assert.equal(response.status, 202);
      let { run } = await response.json();
      while (run.status === 'queued' || run.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 20));
        ({ run } = await (await fetch(endpoint + '/' + run.id)).json());
      }
      return run;
    };
    const input = (id, accessKey) => fetch(endpoint + '/' + id + '/input', { headers: accessKey ? { 'X-Apollo-Input-Key':accessKey } : {} });
    const run = await start(report);
    assert.equal(run.status, 'completed', JSON.stringify(run.error));
    assert.equal(run.agentInputAvailable, true);
    assert.equal(Object.hasOwn(run, 'agentInput'), false);
    assert.equal(Object.hasOwn(run, 'inputKey'), false);
    for (const wrongKey of [undefined, otherKey, 'x']) assert.equal((await input(run.id, wrongKey)).status, 404);
    const downloaded = await input(run.id, key);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('cache-control'), 'no-store');
    const received = fs.readFileSync(path.join(dir, 'received'));
    const startOfJson = received.indexOf('\n') + 1;
    const endOfJson = received.indexOf('\n', startOfJson);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), received.subarray(startOfJson, endOfJson < 0 ? undefined : endOfJson));

    const empty = await start({ ...report, facts:{ ...report.facts, texts:[] } }, otherKey);
    assert.equal(empty.status, 'completed');
    assert.equal(empty.agentInputAvailable, false);
    assert.equal((await input(empty.id, otherKey)).status, 404);
    assert.equal((await input(run.id, otherKey)).status, 404);
    const expired = once(service, 'message');
    service.send(run.id);
    assert.equal((await expired)[0], run.id);
    assert.equal((await input(run.id, key)).status, 404);

    fs.writeFileSync(agent, '#!/path/to/nonexistent/interpreter\n');
    const noSpawn = await start(report);
    assert.equal(noSpawn.status, 'failed');
    assert.equal(noSpawn.agentInputAvailable, false);
    assert.equal((await input(noSpawn.id, key)).status, 404);

    fs.writeFileSync(agent, '#!/bin/sh\nexec 0<&-\nexit 1\n');
    const closedInput = await start(report);
    assert.equal(closedInput.status, 'failed');
    assert.equal(closedInput.agentInputAvailable, false);
    assert.equal((await input(closedInput.id, key)).status, 404);

    fs.writeFileSync(agent, '#!/bin/sh\ncat > /dev/null\nexit 1\n');
    const failedAfterInput = await start(report);
    assert.equal(failedAfterInput.status, 'failed');
    assert.equal(failedAfterInput.agentInputAvailable, true);
    assert.equal((await input(failedAfterInput.id, key)).status, 200);
  });
}

test('UX-writer resolves a numbered section only within the cited document and only when unambiguous', () => {
  const path = 'references/fixture.md';
  const heading = '12. Название раздела — пояснение';
  const request = {
    texts: [{ node: '1:2' }],
    sources: [{ path, text: `## ${heading}\nОбразец текста.` }],
    coverageGaps: [],
  };
  const row = { nodeId: '1:2', priority: 'warning', category: 'Пример', message: 'Замечание', replacement: null };
  const cite = (ruleId, sourcePath = path) => ux.validateResult({
    findings: [{ ...row, sources: [{ path: sourcePath, ruleId }] }],
  }, { request, version: '2.0.0' });

  assert.deepEqual(cite('§12 Название раздела').findings[0].sources, [{ path, ruleId: heading }]);
  assert.throws(() => cite('§13 Название раздела'), { code: 'UX_WRITER_RESPONSE_INVALID' });
  assert.throws(() => cite('§12 Другое название'), { code: 'UX_WRITER_RESPONSE_INVALID' });
  assert.throws(() => cite('§12 Название раздела', 'references/other.md'), { code: 'UX_WRITER_RESPONSE_INVALID' });
  request.sources[0].text += '\n## 12. Название раздела — второе пояснение';
  assert.throws(() => cite('§12 Название раздела'), { code: 'UX_WRITER_RESPONSE_INVALID' });
});

test('UX-writer retains independently verified findings and flags omitted citations', () => {
  const path = 'references/fixture.md';
  const request = {
    texts: [{ node: '1:2' }, { node: '1:3' }],
    sources: [{ path, text: '## Подтверждённое правило' }],
    coverageGaps: ['Уже известное ограничение'],
  };
  const row = { priority: 'warning', category: 'Пример', message: 'Замечание', replacement: null };
  const accepted = { ...row, nodeId: '1:2', sources: [{ path, ruleId: 'Подтверждённое правило' }] };
  const unsupported = { ...row, nodeId: '1:3', sources: [{ path, ruleId: 'Придуманный заголовок' }] };
  const prepared = { request };
  const result = ux.validateResult({ findings: [unsupported, accepted] }, prepared);
  assert.deepEqual(result.findings, [accepted]);
  assert.deepEqual(result.coverageGaps, ['Уже известное ограничение', 'Замечаний без подтверждённой ссылки на правило: 1.']);
  assert.deepEqual(request.coverageGaps, ['Уже известное ограничение']);
  assert.throws(() => ux.validateResult({ findings: [unsupported] }, prepared), { code: 'UX_WRITER_RESPONSE_INVALID' });
  assert.throws(() => ux.validateResult({ findings: [accepted, { ...accepted, nodeId: 'outside' }] }, prepared),
    { code: 'UX_WRITER_RESPONSE_INVALID' });
});

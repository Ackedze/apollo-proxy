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

function fixture(t, textSuffix = '', roleMapping, exclusions) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ux-writer-test-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const runtimeDir = path.join(dir, 'runtime'), releaseDir = path.join(dir, 'release');
    fs.mkdirSync(runtimeDir);
    fs.mkdirSync(releaseDir);
    const version = roleMapping?.schemaVersion === 2 ? '2.0.7'
      : exclusions !== undefined ? '2.0.3' : roleMapping === undefined ? '2.0.0' : '2.0.1';
    const contents = { 'SKILL.md': `---\nname: ux-writer-v2\nmetadata:\n  version: "${version}"\n---\nПроверка текста.` };
    for (const name of ux.BASE.concat('references/roles/button.md', 'references/roles/input.md')) contents[name] = '# Переносы\nНеразрывный пробел.';
    if (roleMapping !== undefined) contents[ux.ROLE_MAPPING] = JSON.stringify(roleMapping);
    if (exclusions !== undefined) {
      contents[ux.ROLE_MAPPING] ??= JSON.stringify({schemaVersion:1, componentRules:[], layerRoles:{label:'button'}});
      if (exclusions !== null) contents[ux.EXCLUSIONS] = JSON.stringify(exclusions);
    }
    contents[ux.GLOSSARY] = '[]';
    contents[ux.RULES] = '{}';
    const web = 'knowledge/data/ds-ai-hub/products/ab/patterns/buttons.md';
    const mobile = 'knowledge/data/ds-ai-hub/products/abm/patterns/buttons.md';
    contents[ux.ROUTES] = JSON.stringify([
      { channel: 'ab', components: ['Button'], sources: [{ path: web, ruleIds: ['rule:button.text'] }] },
      { channel: 'abm', components: ['Button'], sources: [{ path: mobile }] },
    ]);
    const files = Object.entries(contents).map(([file, value]) => ({path:file,bytes:Buffer.byteLength(value),sha256:releases.sha(value)}));
    const descriptor = { schemaVersion: ux.PACKAGE_SCHEMA, id: ux.ID, version, name: 'UX-writer',
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

test('updating only the packaged layer mapping changes the role used by the checker and model', async t => {
  const reportFor = profile => fixture(t, '', profile);
  const base = {schemaVersion:1, componentRules:[], layerRoles:{label:'caption'}};
  const updated = { ...base, componentRules:[{components:['button'],layers:['label'],role:'label'}] };
  for (const [profile, role] of [[base, 'caption'], [updated, 'label']]) {
    const {report, releaseDir, runtimeDir} = reportFor(profile);
    const prepared = await ux.prepare(report, 'desktop', releaseDir, runtimeDir, ({texts}) => {
      assert.equal(texts[0].role, role);
      return {findings:[],model_candidates:[],hygiene:[]};
    });
    assert.equal(JSON.parse(ux.buildInvocation(prepared.request).input).texts[0].role, role);
    prepared.assertCurrent();
    fs.appendFileSync(path.join(releaseDir, 'skills', ux.ID, ux.ROLE_MAPPING), '\n');
    assert.throws(() => prepared.assertCurrent(), {code:'UX_WRITER_DATA_CHANGED'});
  }
  const invalid = reportFor({ ...base, layerRoles:{label:'invented-role'} });
  await assert.rejects(ux.prepare(invalid.report, 'desktop', invalid.releaseDir, invalid.runtimeDir, () => assert.fail('checker called')), {
    code:'UX_WRITER_ROLE_MAPPING_INVALID',
  });
});

test('UX-writer specializes nested roles inside the matching component only', async t => {
  const variants = [
    ['[D] TableView :: Horizontal', 'fc30a28cc1077ced1817c3076a9941955262bc08', true],
    ['TableView :: Vertical', 'd169f155db12c66f5198dd597d260bbacccd5bf5', true],
    ['[D] TableView :: Horizontal', '6e9a72189d150779165acb1dde3a800b92daa2f9', false],
    ['TableView :: Vertical', 'f2a12fda7bf715932a6f640334825b120cf5b51b', false],
    ['[D] TableView :: Horizontal SidePanel', '46fdafb593b319e287d29eb6bc875a951b812a5e', false],
  ];
  const compactKeys = variants.filter(([, , compact]) => compact).map(([, key]) => key);
  const profile = {schemaVersion:1, componentRules:[
    {components:['compacttag'], within:['filtercompanyselectsingle'], layers:['value'], role:'select_value'},
    {components:['caption'], withinKeys:compactKeys, layers:['value'], role:'table_header'},
    {components:['title'], withinKeys:compactKeys, layers:['value'], role:'table_value'},
    {components:['caption'], role:'caption'},
    {components:['amount'], role:'amount'},
  ], layerRoles:{title:'title'}};
  const {report, releaseDir, runtimeDir} = fixture(t, '', profile);
  const base = report.facts.texts[0];
  const cases = [
    [['[D] FilterCompanySelect_Single', '[D] CompactTag'], 'Value', 'select_value'],
    [['[D] CompactTag'], 'Value', ''],
    ...variants.flatMap(([name, key, compact]) => [
      [[name, 'Row', 'Caption'], 'value', compact ? 'table_header' : 'caption', key],
      [[name, 'Row', 'Column', 'Title'], 'value', compact ? 'table_value' : '', key],
    ]),
    [['TableView :: Vertical', 'Row', 'Column', 'Title', 'Amount'], 'value', 'amount', compactKeys[1]],
    [['Other', 'Caption'], 'value', 'caption'],
    [['Other', 'Title'], 'value', ''],
    [['Title', 'TableView'], 'value', ''],
    [['TableView :: Vertical', 'Caption'], 'value', 'caption'],
  ];
  report.facts.texts = cases.map(([ancestors, layer, , key], i) => ({
    ...base, node:{...base.node, id:'text-'+i, name:layer},
    ancestors:ancestors.map((componentName,j)=>({
      nodeId:'parent-'+i+'-'+j, name:'Renamed instance', componentName, componentKey:j===0 ? key : undefined,
    })),
  }));
  const expected = cases.map(([, , role])=>role);
  const prepared = await ux.prepare(report, 'desktop', releaseDir, runtimeDir, ({texts}) => {
    assert.deepEqual(texts.map(row=>row.role),expected);
    return {findings:[],model_candidates:[],hygiene:[]};
  });
  assert.deepEqual(JSON.parse(ux.buildInvocation(prepared.request).input).texts.map(row=>row.role),expected);
  for (const rule of [{...profile.componentRules[0], within:[]}, {...profile.componentRules[1], withinKeys:['not-a-key']}]) {
    const invalid = fixture(t, '', {...profile, componentRules:[rule]});
    await assert.rejects(ux.prepare(invalid.report, 'desktop', invalid.releaseDir, invalid.runtimeDir, () => assert.fail('checker called')), {
      code:'UX_WRITER_ROLE_MAPPING_INVALID',
    });
  }
});

test('UX-writer takes new role IDs from the pinned package for the checker and model', async t => {
  const base = {schemaVersion:2, roles:['caption'], componentRules:[], layerRoles:{label:'caption'}};
  const newRole = 'invoice_summary';
  const updated = {
    ...base,
    roles:[...base.roles, newRole],
    componentRules:[{components:['button'], layers:['label'], role:newRole}],
  };
  const exclusions = {schemaVersion:2, components:[], layers:[]};
  for (const [profile, expected] of [[base, 'caption'], [updated, newRole]]) {
    const {report, releaseDir, runtimeDir} = fixture(t, '', profile, exclusions);
    const prepared = await ux.prepare(report, 'desktop', releaseDir, runtimeDir, ({texts, roles}) => {
      assert.deepEqual(roles, profile.roles);
      assert.equal(texts[0].role, expected);
      return {findings:[],model_candidates:[],hygiene:[]};
    });
    assert.equal(JSON.parse(ux.buildInvocation(prepared.request).input).texts[0].role, expected);
  }
  const invalidProfiles = [
    { ...updated, roles:base.roles },
    { ...base, layerRoles:{label:'button'} },
    { ...base, roles:['caption', 'caption'] },
    { ...base, roles:['caption', 'another role'] },
    { ...base, roles:undefined },
  ];
  for (const profile of invalidProfiles) {
    const {report, releaseDir, runtimeDir} = fixture(t, '', profile, exclusions);
    await assert.rejects(ux.prepare(report, 'desktop', releaseDir, runtimeDir, () => assert.fail('checker called')), {
      code:'UX_WRITER_ROLE_MAPPING_INVALID',
    });
  }
});

test('pinned exclusions skip a component subtree or a uniquely matched layer before both checks', async t => {
  const entire = 'a'.repeat(40), variant = 'b'.repeat(40), otherVariant = 'c'.repeat(40);
  const profile = {schemaVersion:2, components:[{componentKeys:[entire],reason:'Технический компонент'}],
    layers:[{componentKeys:[variant],layerPath:['Content','Inner','Label'],reason:'Техническая подпись'}]};
  const {report, releaseDir, runtimeDir, web} = fixture(t, '', undefined, profile);
  const template = report.facts.texts[0];
  const instance = (nodeId, name, componentKey) => ({ ...template.ancestors[0], nodeId, name, componentKey });
  function fact(id, parents, segments, uniqueName = true) {
    const path = ['Card', ...parents.map(parent => parent.name), ...(segments ?? ['Content','Inner','Label'])].join(' / ');
    const componentPath = segments && parents.map(({nodeId,name}) => ({nodeId,name,uniqueName:true})).concat(
      segments.map((name,i) => ({nodeId:i===segments.length-1?id:id+'-'+i,name,uniqueName})));
    return { ...template, node:{ ...template.node, id, path }, ancestors:parents, componentPath };
  }
  const whole = instance('2:1', 'Placeholder', entire);
  const renamed = instance('2:2', 'Главное / действие', variant);
  const other = instance('2:3', 'Главное действие', otherVariant);
  const duplicate = instance('2:4', 'Repeated', variant);
  const actualPath = ['Content','Inner','Label'];
  const eligible = ['1:12','1:13','1:14','1:15','1:16','1:17','1:18'];
  report.facts.texts = [
    fact('1:10', [whole, instance('2:5','Nested',otherVariant)], actualPath),
    fact('1:11', [renamed], actualPath),
    fact('1:12', [renamed], ['Content / Inner','Label']),
    fact('1:13', [other], actualPath),
    fact('1:14', [duplicate], actualPath),
    fact('1:15', [duplicate], actualPath),
    fact('1:16', [renamed], undefined),
    fact('1:17', [instance('2:6','Another',variant)], actualPath, false),
    fact('1:18', [renamed], ['Other','Label']),
  ];
  assert.equal(report.facts.texts[1].node.path, report.facts.texts[2].node.path);
  assert.equal(report.facts.texts[1].node.path, report.facts.texts[6].node.path);
  const prepared = await ux.prepare(report, 'desktop', releaseDir, runtimeDir, ({texts}) => {
    assert.deepEqual(texts.map(text => text.node), eligible);
    return {findings:[],model_candidates:[],hygiene:[]};
  });
  assert.deepEqual(JSON.parse(ux.buildInvocation(prepared.request).input).texts.map(text => text.node), eligible);
  const result = ux.validateResult({findings:[]}, prepared);
  assert.equal(result.excludedTextCount, 2);
  assert.equal(result.unresolvedExclusionCount, 4);
  assert.throws(() => ux.validateResult({findings:[{nodeId:'1:11', priority:'warning', category:'Пример',
    message:'Замечание', replacement:null, sources:[{path:web, ruleId:'rule:button.text'}]}]}, prepared),
  {code:'UX_WRITER_RESPONSE_INVALID'});
  prepared.assertCurrent();
  fs.appendFileSync(path.join(releaseDir, 'skills', ux.ID, ux.EXCLUSIONS), '\n');
  assert.throws(() => prepared.assertCurrent(), {code:'UX_WRITER_DATA_CHANGED'});
});

test('new packages require an exact, valid exclusion profile before the checker', async t => {
  for (const [profile, code] of [
    [null, 'UX_WRITER_SOURCE_UNAVAILABLE'],
    [{schemaVersion:1, components:[], layers:[]}, 'UX_WRITER_EXCLUSIONS_INVALID'],
    [{schemaVersion:2, components:[{componentKeys:['Button'], reason:'Заглушка'}], layers:[]}, 'UX_WRITER_EXCLUSIONS_INVALID'],
    [{schemaVersion:2, components:[], layers:[{componentKeys:['a'.repeat(40)], layerPath:'Label',reason:'Заглушка'}]}, 'UX_WRITER_EXCLUSIONS_INVALID'],
  ]) {
    const { report, releaseDir, runtimeDir } = fixture(t, '', undefined, profile);
    await assert.rejects(ux.prepare(report, 'desktop', releaseDir, runtimeDir, () => assert.fail('checker called')), {code});
  }
});

for (const provider of ['codex', 'claude', 'openrouter']) {
  test(`HTTP exports exactly the UX-writer JSON received by ${provider}, only to its caller`, { timeout: 20000 }, async t => {
    const excludedKey = 'e'.repeat(40);
    const { dir, runtimeDir, releaseDir, report } = fixture(t, 'x'.repeat(350000), undefined, {
      schemaVersion:2, components:[{componentKeys:[excludedKey], reason:'Технический компонент'}], layers:[],
    });
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
      if (process.env.APOLLO_UX_WRITER_OPENROUTER_KEY) process.exit(65);
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
      const fs = require('node:fs'), assert = require('node:assert/strict');
      if (${provider === 'openrouter'}) {
        globalThis.fetch = async (url, request) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(request.headers.Authorization, 'Bearer openrouter-fixture-key');
          const body = JSON.parse(request.body);
          fs.writeFileSync(${JSON.stringify(path.join(dir, 'received'))}, body.messages[0].content);
          if (fs.existsSync(${JSON.stringify(path.join(dir, 'upstream-failure'))})) return new Response(null, {status: 401});
          return Response.json({
            choices: [{finish_reason:'stop',message:{content:'{"findings":[]}'}}],
            usage: {prompt_tokens:30,completion_tokens:5,prompt_tokens_details:{cached_tokens:12}},
          });
        };
      }
      const { app } = require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});
      assert.equal(process.env.APOLLO_UX_WRITER_OPENROUTER_KEY, undefined);
      const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
      process.on('message', id => {
        require(${JSON.stringify(path.resolve(__dirname, '../src/config.js'))}).codexRuns.delete(id);
        process.send(id);
      });
    `);
    const { once } = require('node:events');
    const service = fork(boot, [], { cwd: dir, env: {
      PATH: process.env.PATH, APOLLO_PROXY_MANAGED: '0', APOLLO_CLI_PROVIDER: provider === 'openrouter' ? 'alfagen' : provider,
      APOLLO_UX_WRITER_OPENROUTER: provider === 'openrouter' ? '1' : '0', APOLLO_CODE_UPDATE_KEY: 'c'.repeat(64),
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
    const start = async (request, accessKey = key, approve = true) => {
      const headers = { 'Content-Type':'application/json', 'X-Apollo-Input-Key':accessKey };
      if (provider === 'openrouter') headers.Origin = 'null';
      const response = await fetch(endpoint, { method:'POST', headers, body:JSON.stringify({report:request}) });
      assert.equal(response.status, 202);
      let { run } = await response.json();
      let replied = false;
      while (run.status === 'queued' || run.status === 'running') {
        if (provider === 'openrouter' && !replied && run.stage === 'awaiting_openrouter_approval') {
          replied = true;
          const target = `http://127.0.0.1:${port}/ux-writer/openrouter/approval`;
          const send = (token, body, origin) => fetch(target, {
            method:'POST', headers:{ 'Content-Type':'application/json', ...(token && {'X-Apollo-Code-Key':token}), ...(origin && {Origin:origin}) },
            body:JSON.stringify(body),
          });
          const before = fs.existsSync(path.join(dir, 'received')) ? fs.statSync(path.join(dir, 'received')).mtimeMs : null;
          const approval = {runId:run.id,key:'openrouter-fixture-key'};
          assert.equal((await send(null, approval)).status, 403);
          assert.equal((await send(key, approval, 'null')).status, 403);
          assert.equal((await send('c'.repeat(64), approval, 'null')).status, 403);
          assert.equal((await send('c'.repeat(64), {...approval,runId:'wrong'})).status, 409);
          assert.equal(fs.existsSync(path.join(dir, 'received')) ? fs.statSync(path.join(dir, 'received')).mtimeMs : null, before);
          assert.equal((await send('c'.repeat(64), {...approval,key:approve ? approval.key : null})).status, 200);
          assert.equal((await send('c'.repeat(64), approval)).status, 409);
        }
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
    const excluded = await start({ ...report, facts:{ ...report.facts, texts:report.facts.texts.map(fact => ({
      ...fact, ancestors:fact.ancestors.map(ancestor => ({ ...ancestor, componentKey:excludedKey })),
    })) } }, otherKey);
    assert.equal(excluded.status, 'completed');
    assert.equal(excluded.agentInputAvailable, false);
    assert.equal(excluded.validation.excludedTextCount, 1);
    assert.equal((await input(excluded.id, otherKey)).status, 404);
    assert.equal((await input(run.id, otherKey)).status, 404);
    const expired = once(service, 'message');
    service.send(run.id);
    assert.equal((await expired)[0], run.id);
    assert.equal((await input(run.id, key)).status, 404);

    if (provider === 'openrouter') {
      const denied = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', Origin:'https://other.example' },
        body:JSON.stringify({report}) });
      assert.equal(denied.status, 403);
      const journalRoot = path.join(dir, 'state/token-journal');
      const usage = fs.readdirSync(journalRoot).map(file => JSON.parse(fs.readFileSync(path.join(journalRoot, file))))
        .find(entry => entry.provider === 'openrouter');
      assert.equal(usage.totalTokens, 35);
      assert.equal(usage.cachedInputTokens, 12);
      const declined = await start(report, key, false);
      assert.equal(declined.error.code, 'OPENROUTER_APPROVAL_REQUIRED');
      const oversized = await start({...report, facts:{...report.facts,
        texts:report.facts.texts.map(fact => ({...fact,text:'x'.repeat(950000)})) }});
      assert.equal(oversized.error.code, 'CODEX_INPUT_BUDGET_EXCEEDED');
      assert.equal(oversized.events.some(event => event.stage === 'awaiting_openrouter_approval'), false);
      write('upstream-failure', '');
      const failed = await start(report);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error.code, 'OPENROUTER_KEY_REJECTED');
      return;
    }

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

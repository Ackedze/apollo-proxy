'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ux = require('../src/skills/ux-writer');
const releases = require('../src/data-release');
const { validateCodexReportRequest } = require('../src/reports/request');
const { generationPackages } = require('../src/skills/catalog');

test('UX-writer reads its installed package and canonical web rules for a narrow Desktop selection', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ux-writer-test-')));
  try {
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
      texts: [{node:{id:'1:2',name:'Label',visible:true},scopeNodeId:'card',effectiveOpacity:1,text:'Оплатить в банке.',
        ancestors:[{nodeId:'1:3',name:'Переименованный инстанс',componentName:'[D] Button',componentKey:'example'}]}],
    }};
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
    assert(prepared.request.sources.some(source=>source.path===web));
    assert(!prepared.request.sources.some(source=>source.path===mobile));
    assert.equal(prepared.request.checks.findings[0].fixed_text,'Оплатить в\u00a0банке');
    const finding = {nodeId:'1:2',priority:'warning',category:'Типографика',message:'Неразрывный пробел',replacement:'Оплатить в\u00a0банке',
      sources:[{path:web,ruleId:'rule:button.text'}]};
    assert.equal(ux.validateResult({findings:[finding]},prepared).skillVersion,'2.0.0');
    assert.throws(()=>ux.validateResult({findings:[{...finding,nodeId:'outside'}]},prepared),{code:'UX_WRITER_RESPONSE_INVALID'});
    assert.throws(()=>ux.validateResult({findings:[{...finding,sources:[{path:mobile,ruleId:'Мобильные'}]}]},prepared),{code:'UX_WRITER_RESPONSE_INVALID'});
    prepared.assertCurrent();
    write(releaseDir,web,'Изменился источник.');
    assert.throws(()=>prepared.assertCurrent(),{code:'UX_WRITER_DATA_CHANGED'});
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

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

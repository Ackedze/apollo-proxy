'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {auditAbmPatterns}=require('../src/reports/ABM-audit');
test('the read-only audit distinguishes containers from empty rules and reports malformed links and orphan examples',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-abm-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'p_abm_fixture.md');
 const text='---\nabmDocumentType: Pattern\nabmPatternID: "ptrn:ux.audit"\nabmPatternTitle: Audit\nversion: v.1.0\n---\n'+
 '### [Rule] R01_group\n### [Rule] R01.1_child\nУсловие дочернего правила.\n'+
 '### [Rule] R02_empty\n### [Rule] R03_duplicate\nПервое условие.\n### [Rule] R03_duplicate\nВторое условие.\n'+
 '#### [RuleExample] R99_unknown\nСсылка на [RuleExample] R99_unknown: https://example.test/a\n'+
 'Ссылка на [RuleExample] R99_unknown: https://example.test/b\nПримечание после примера требует контекста.\n';
 fs.writeFileSync(file,text);
 const report=auditAbmPatterns(root);
 assert.equal(fs.readFileSync(file,'utf8'),text);
 assert(report.findings.some(f=>f.code==='EMPTY_RULE_GROUP'&&f.ruleId==='R01_group'&&f.severity==='info'));
 assert(report.findings.some(f=>f.code==='EMPTY_RULE'&&f.ruleId==='R02_empty'&&f.severity==='error'));
 assert(report.findings.some(f=>f.code==='DUPLICATE_RULE_ID'));
 assert(report.findings.some(f=>f.code==='ORPHAN_EXAMPLE'));
 assert(report.findings.some(f=>f.code==='UNLABELED_EXAMPLE_PLATFORM'&&f.occurrences===2));
 assert(report.findings.some(f=>f.code==='PROSE_AFTER_EXAMPLE'));
 assert(!JSON.stringify(report).includes('Примечание после'));
});


test('audit reads Hub metadata from its product root or patterns folder and detects real rule errors',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-abm-hub-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const folder=path.join(root,'patterns');fs.mkdirSync(folder);
 const file=path.join(folder,'p_abm_fixture.md');
 const text='---\nproduct: abm\nid: ptrn:abm.fixture\n---\n# Buttons\n- abmDocumentType: Pattern\n- abmPatternID: ptrn:ux.fixture\n- abmPatternTitle: Buttons\n- version: v.1.0\n\n## Rules\n### [Rule] R01\nПодтверждённое правило.\n### [Rule] R02\n';
 fs.writeFileSync(file,text);
 const report=auditAbmPatterns(root);
 assert.equal(report.patternCount,1);assert.equal(report.ruleCount,2);
 assert(report.findings.some(f=>f.file==='patterns/p_abm_fixture.md'&&f.code==='EMPTY_RULE'&&f.ruleId==='R02'));
 assert(!report.findings.some(f=>f.code==='INVALID_PATTERN_METADATA'));
 assert.deepEqual(auditAbmPatterns(folder),report);
 assert.equal(fs.readFileSync(file,'utf8'),text);
});

test('an empty source cannot pass the structure audit',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-abm-empty-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const report=auditAbmPatterns(root);
 assert.equal(report.patternCount,0);assert.equal(report.errors,1);
 assert(report.findings.some(f=>f.code==='NO_PATTERNS'));
});

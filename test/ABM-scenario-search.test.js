'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {scenarioIndex,scenarioCandidates}=require('../src/reports/ABM-scenario-search');
function row(id,text,title='Компоненты',context='') {
 return {record:{file:id+'.md',ruleId:id,text,pattern:title,context},sectionHeadings:[]};
}
test('independent scenario conditions survive a long repeated first topic',()=>{
 const rows=[row('archive','Карточку архивируем после подтверждения.'),row('offline','В офлайне сохраняем черновик локально.'),
 ...Array.from({length:30},(_,i)=>row('noise'+i,'Карточку карточку карточку. '+('Другая информация. '.repeat(20))))];
 const hits=scenarioCandidates(scenarioIndex(rows),'Карточку нужно архивировать после подтверждения, но в офлайне сохраняем черновик.');
 assert(hits.some(hit=>hit.record.ruleId==='archive'));
 assert(hits.some(hit=>hit.record.ruleId==='offline'));
 assert(hits.length<=24);
});
test('source body corroboration beats titles and repetition without matching conditions',()=>{
 const index=scenarioIndex([row('actual','На плитке загрузка отменяется свайпом.'),
 row('metadata','Ничего об этом действии.','На плитке загрузка отменяется свайпом'),
 row('repeat','Загрузка '.repeat(200))]);
 const hits=scenarioCandidates(index,'На плитке загрузка отменяется свайпом, когда пользователь передумал?');
 assert.equal(hits[0].record.ruleId,'actual');
 assert(!hits.some(hit=>hit.record.ruleId==='metadata'||hit.record.ruleId==='repeat'));
});
test('platform conditions, Russian inflections and quantities survive colloquial phrasing',()=>{
 const index=scenarioIndex([row('stack','На Android две шторы подряд запрещены.'),row('radio','В шторке кнопка подтверждения не нужна.'),row('caption','На Android подпись размещается снизу.')]);
 const hits=scenarioCandidates(index,'На андроиде хочу открыть вторую штору, а в шторе кнопка подтверждения нужна?');
 assert(hits.some(hit=>hit.record.ruleId==='stack'));
 assert(hits.some(hit=>hit.record.ruleId==='radio'));
 assert.deepEqual(scenarioCandidates(index,'QuantumButton UnknownAction'),[]);
});
test('all matching rule texts remain untouched including negation and exceptions',()=>{
 const source=row('gate','Не архивируй карточку до подтверждения. Исключение: тестовые карточки.');
 const hits=scenarioCandidates(scenarioIndex([source]),'Мне надо архивировать карточку, но подтверждения пока нет.');
 assert.equal(hits[0],source);
 assert.equal(hits[0].record.text,source.record.text);
});

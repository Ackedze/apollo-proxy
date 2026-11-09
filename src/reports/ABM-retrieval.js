'use strict';
const fs = require('node:fs');
const {loadPattern,parentsFor,ruleText} = require('./ABM-source');
const MAX_PACKET_CHARS = 64000;
const MAX_RULES = 128;
const STOP = new Set('как какой какая какие какое когда где это для или при про что есть нужно надо можно нельзя должен должна должны будет быть использовать использует используем писать показывать делает делать направлять абм abm вопрос ответ паттерн правило расскажи пожалуйста мне мы он она они его ее ли и в на с из по к у а не то'.split(' '));
function tokens(value) {
  return [...new Set((String(value).toLowerCase().replace(/ё/g,'е').match(/[\p{L}\p{N}]+/gu)||[])
    .filter(word=>word.length>1&&!STOP.has(word))
    .map(word=>/^[а-я]+$/u.test(word)&&word.length>3
      ?word.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ией|иям|иях|ов|ев|ей|ий|ый|ой|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ах|ях|ы|и|а|я|у|ю|е|о)$/u,''):word))];
}
function clean(value) {
  return value.replace(/^\s*\*\*(?:Ключ правила|Раздел):?\*\*[^\n]*$/gm,'')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1')
    .replace(/https?:\/\/\S+/g,'').trim();
}
let cached;
function indexFor(source) {
  if(cached?.root===source.root&&cached.sha===source.contentSha256)return cached.rows;
  const patterns=fs.readdirSync(source.root).filter(file=>/^p_abm_.+\.md$/.test(file)).sort()
    .map(file=>loadPattern(source.root,file)).filter(Boolean);
  const rows=patterns.flatMap(pattern=>pattern.rules.map(rule=>{
    const parents=parentsFor(pattern,rule);
    const record={file:pattern.file,ruleId:rule.key,pattern:pattern.title,version:pattern.version,
      context:clean(rule.context),
      parents:parents.map(parent=>({ruleId:parent.key,text:clean(parent.body)})),text:clean(rule.body)};
    return {record, section:pattern.file+'\n'+rule.context, meta:tokens(pattern.title+' '+pattern.metadata), heading:tokens(rule.key),
      body:tokens(ruleText(rule.body)+' '+rule.context+' '+parents.map(parent=>parent.body).join(' '))};
  }));
  const df=new Map();
  for(const row of rows)for(const term of new Set([...row.meta,...row.heading,...row.body]))df.set(term,(df.get(term)||0)+1);
  for(const row of rows)row.weights=new Map([...new Set([...row.meta,...row.heading,...row.body])].map(term=>[
    term,Math.log(1+rows.length/(df.get(term)||1))*(Number(row.body.includes(term))+2*Number(row.heading.includes(term))+0.7*Number(row.meta.includes(term)))
  ]));
  cached={root:source.root,sha:source.contentSha256,rows};
  return rows;
}
function buildAbmKnowledgePacket(source,question,dialogue=[]) {
  const rows=indexFor(source);
  const parts=String(question).split(/[?\n;]+/u).map(text=>text.trim()).filter(Boolean).slice(0,12);
  const prior=dialogue.filter(item=>item.role==='user').slice(-2).map(item=>item.text).join(' ').slice(-2000);
  const queries=(parts.length?parts:[question]).map(part=>tokens(part));
  const aliases={клавиатур:['keyboard'],шеврон:['chevron'],поиск:['search'],
    очистк:['clear','крестик'],крестик:['clear','очистк'],копейк:['kopecks'],шрифт:['font'],таблиц:['tables']};
  for(const query of queries) {
    for(const term of [...query])if(aliases[term])query.push(...aliases[term]);
    if(query.some(term=>/^копе/.test(term)))query.push('копейк');
    if(query.includes('очистк'))query.push('крестик','clear');
    if(query.includes('крестик'))query.push('очистк','clear');
  }
  const historyTokens=tokens(prior);
  const followup=/^(?:а\s+)?(?:какие\s+)?(?:есть\s+)?(?:исключен|ограничен|услов|пример|подроб|почему|для\s+(?:ios|android|андроид))/iu.test(String(question).trim());
  if(followup&&historyTokens.length)for(const query of queries)query.push(...historyTokens);
  // Alias expansion affects retrieval only; it cannot introduce normative content.
  for(const query of queries) {
    if(/\binfo\b|иконк[а-я]*\s+[«"'“]?i\b/iu.test(question))query.push('инфо','info');
  }
  const score=(row,query)=>query.reduce((sum,term)=>sum+(row.weights.get(term)||0),0);
  const ranked=queries.map(query=>rows.map(row=>({row,score:score(row,query)}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.row.record.file.localeCompare(b.row.record.file)||a.row.record.ruleId.localeCompare(b.row.record.ruleId)));
  // History can recover a topic for a follow-up, but cannot crowd out explicit new subjects.
  if(ranked.every(list=>!list.length)&&historyTokens.length)ranked.push(rows.map(row=>({row,score:score(row,historyTokens)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score));
  const selected=[],seen=new Set(); let omitted=0;
  const lookup=new Map(rows.map(row=>[row.record.file+':'+row.record.ruleId,row]));
  const add=item=>{
    const required=[...item.row.record.parents.map(parent=>lookup.get(item.row.record.file+':'+parent.ruleId)).filter(Boolean),item.row];
    const pending=required.filter(row=>!seen.has(row.record.file+':'+row.record.ruleId));
    if(!pending.length)return;
    const next=[...selected,...pending.map(row=>row.record)];
    if(next.length>MAX_RULES||JSON.stringify({rules:next}).length>MAX_PACKET_CHARS){omitted++;return;}
    for(const row of pending){seen.add(row.record.file+':'+row.record.ruleId);selected.push(row.record);}
  };
  // First reserve seeds for every subject, then include whole relevant sections.
  // This preserves neighboring exceptions and competing rules instead of taking
  // only individually high-scoring sentences.
  const seeds=[];
  for(let depth=0;depth<8;depth++)for(const list of ranked)if(list[depth]&&list[depth].score>=list[0].score*0.4)seeds.push(list[depth]);
  for(const list of ranked) {
    const patterns=new Set();
    for(const item of list) {
      if(patterns.has(item.row.record.file)||item.score<list[0].score*0.4)continue;
      patterns.add(item.row.record.file); seeds.push(item);
      if(patterns.size>=3)break;
    }
  }
  const frequency=new Map();
  for(const row of rows)for(const term of row.body)frequency.set(term,(frequency.get(term)||0)+1);
  // Expand the most distinctive matched terms of each subject across patterns.
  for(const query of queries) {
    const distinctive=[...new Set(query)].filter(term=>(frequency.get(term)||Infinity)<=Math.max(12,rows.length*0.08))
      .sort((a,b)=>frequency.get(a)-frequency.get(b)).slice(0,2);
    for(const term of distinctive)for(const row of rows)if(row.body.includes(term))seeds.push({row});
  }
  // Broad topic requests and explicit pattern IDs need a whole matching pattern.
  const broad=/(?:все|общие|какие|расскажи)[^?]*(?:правил|требован|паттерн)/iu.test(question);
  if(broad||/ptrn:/i.test(question)) {
    const query=tokens(question);
    const byPattern=new Map();
    for(const row of rows) {
      const matched=row.meta.filter(term=>query.includes(term)).length;
      if(matched>(byPattern.get(row.record.file)?.matched||0))byPattern.set(row.record.file,{row,matched});
    }
    const patterns=[...byPattern.values()].sort((a,b)=>b.matched-a.matched);
    const best=patterns[0]?.matched||0;
    for(const {row,matched} of patterns)if(best>0&&matched===best) {
      for(const other of rows)if(other.record.file===row.record.file)add({row:other});
    }
  }
  for(const seed of seeds)add(seed);
  const sections=new Set(seeds.map(seed=>seed.row.section));
  for(const row of rows)if(sections.has(row.section))add({row});
  const rules=selected;
  return {rules,chars:JSON.stringify({rules}).length,indexedRules:rows.length,
    omittedCandidates:omitted,coverageLimited:omitted>0,sourceSha:source.contentSha256};
}
module.exports={buildAbmKnowledgePacket,MAX_PACKET_CHARS,MAX_RULES,tokens};

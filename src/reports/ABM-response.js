'use strict';
const fs=require('node:fs');
const {normalize,loadPattern,ruleText,examplesFor}=require('./ABM-source');
const CHAT_URL='https://xlink.achat.best/join/chat/ODA3MzVlZmEtYzlkZC01NmY5LTlhZDQtZjJiNWFkOWUzNDk4OjI1MjE3Yzk1LTY3YTYtNTcxYS1hMzM0LWViMDFiZDExY2M2ODpiOTNmZDI4OS05ZmNmLTUxZWUtYjU4Mi0yNDc0YTZjYjNlOGE6OWMzMmUzMTctZWUxNi01ZDI1LTlmZGYtODkzNTUxMGM3NmEy';
const NOT_FOUND='Не нашёл ответа в паттернах АБМ. Напиши в чат [«DS ABM :: Скорая помощь по дизайну»]('+CHAT_URL+') — мы ответим на твой вопрос';
const evidenceSchema={
 type:'object',additionalProperties:false,
 properties:{file:{type:'string'},ruleId:{type:'string'},quote:{type:'string'},text:{type:'string'}},
 required:['file','ruleId','quote','text'],
};
const ABM_RESPONSE_SCHEMA={
 type:'object',additionalProperties:false,
 properties:{answers:{type:'array',minItems:1,maxItems:12,items:{
  type:'object',additionalProperties:false,
  properties:{question:{type:'string'},kind:{type:'string',enum:['answer','not_found']},evidence:{type:'array',maxItems:16,items:evidenceSchema}},
  required:['question','kind','evidence'],
 }}},required:['answers'],
};
const plain=value=>normalize(value).replace(/[\\`*_[\]<>#|]/g,'\\$&').replace(/^([-+])\s/u,'\\$1 ').replace(/^(\d+)([.)])\s/u,'$1\\$2 ');
function fail(code,emit,details={}) {
 emit({outcome:'rejected',reason:code,...details});
 const source=code==='ABM_SOURCE_UNAVAILABLE';
 throw Object.assign(new Error(source?'Не удалось прочитать паттерны АБМ. Повтори запрос.':'Не удалось проверить подтверждение ответа по паттернам АБМ. Повтори запрос.'),{code,status:source?503:502});
}
function answerText(value,sourceQuote,emit,details) {
 const original=typeof value==='string'?value.trim():'';
 // Remove presentation wrappers only. Never repair or invent normative wording.
 const repaired=original.replace(/`([^`\n]+)`/g,'$1').replace(/^#{1,6}[ \t]+/gm,'');
 const invalid=!repaired||repaired.length>6000||/https?:|www\.|<|>|\||`|\[[^\]]*\]\s*(?:\(|\[)|(?:^|\n)\s*\[[^\]]+\]:|!\[/iu.test(repaired)
   ||/Паттерн\s*:|Источник\s*:|\[Rule|R\d+[._]|Не наш[её]л ответа|Правило есть, но примера/iu.test(repaired);
 if(invalid) {
  // The quote was validated against the source before reaching this branch.
  // Use it verbatim rather than silently treating a formatting failure as no rule.
  emit({outcome:'recovered',reason:'SOURCE_QUOTE_USED',...details});
  return sourceQuote;
 }
 if(repaired!==original)emit({outcome:'recovered',reason:'MARKDOWN_REPAIRED',...details});
 return repaired;
}
function renderAnswer(answer,root,packet,emit,questionIndex) {
 if(answer.kind==='not_found') {
  if(!Array.isArray(answer.evidence)||answer.evidence.length)fail('ABM_RESPONSE_INVALID',emit,{questionIndex});
  emit({outcome:'not_found',reason:packet?.rules.length===0?'NO_SEARCH_CANDIDATES':'NO_CONFIRMED_ANSWER',questionIndex});
  return null;
 }
 if(answer.kind!=='answer'||!Array.isArray(answer.evidence)||!answer.evidence.length||answer.evidence.length>16)
  fail('ABM_RESPONSE_INVALID',emit,{questionIndex});
 const evidence=answer.evidence.map((item,evidenceIndex)=>{
  const details={questionIndex,evidenceIndex};
  if(!item||typeof item!=='object')fail('ABM_RESPONSE_INVALID',emit,details);
  if(packet&&!packet.rules.some(rule=>rule.file===item.file&&rule.ruleId===item.ruleId))
   fail('ABM_EVIDENCE_OUTSIDE_PACKET',emit,details);
  let pattern;
  try {pattern=loadPattern(root,item.file);} catch {fail('ABM_SOURCE_UNAVAILABLE',emit,details);}
  const rule=pattern?.rules.find(rule=>rule.key===item.ruleId);
  const rawQuote=typeof item.quote==='string'?item.quote:'';
  if(!rule||!rawQuote||/https?:|\[Rule|R\d+[._]|(?:Ключ правила|Раздел)\s*:/i.test(rawQuote))
   fail('ABM_EVIDENCE_REJECTED',emit,details);
  const quote=ruleText(rawQuote);
  if((quote.match(/[\p{L}\p{N}]+/gu)||[]).length<2||!ruleText(rule.body).includes(quote))
   fail('ABM_QUOTE_MISMATCH',emit,details);
  return {pattern,ruleId:item.ruleId,text:answerText(item.text,quote,emit,details)};
 });
 const paragraphs=[];
 for(const file of [...new Set(evidence.map(item=>item.pattern.file))]) {
  const items=evidence.filter(item=>item.pattern.file===file),seen=new Set();
  for(const item of items) {
   if(seen.has(item.ruleId))continue;
   seen.add(item.ruleId);paragraphs.push(item.text);
   const links=examplesFor(item.pattern,item.ruleId);
   if(links.length)paragraphs.push(links.map(link=>(link.platform==='iOS'?'🍏':'🤖')+' [Пример]('+link.url+')').join(' · '));
  }
  const pattern=items[0].pattern;
  paragraphs.push('Паттерн: «'+plain(pattern.title)+'», '+plain(pattern.version));
 }
 emit({outcome:'answered',questionIndex,evidenceCount:evidence.length});
 return paragraphs.join('\n\n');
}
function renderAbmResponse(value,patternsRoot,originalQuestion,packet,{onDiagnostic=()=>{}}={}) {
 // Diagnostics contain fixed reason codes and indexes, never questions or quotes.
 const emit=event=>onDiagnostic(event);
 let root;
 try {root=fs.realpathSync(patternsRoot);} catch {fail('ABM_SOURCE_UNAVAILABLE',emit);}
 if(!Array.isArray(value?.answers)||!value.answers.length||value.answers.length>12)fail('ABM_RESPONSE_INVALID',emit);
 const original=normalize(originalQuestion);
 const answers=value.answers.map((answer,questionIndex)=>{
  if(!answer||typeof answer.question!=='string')fail('ABM_QUESTION_MISMATCH',emit,{questionIndex});
  const label=normalize(answer.question),anchor=label.replace(/[?!.]+$/u,'');
  const position=original.indexOf(anchor);
  if(!anchor||position<0)fail('ABM_QUESTION_MISMATCH',emit,{questionIndex});
  let question=original.slice(position,position+anchor.length);
  if(/[?!.]/u.test(original[position+anchor.length]||' '))question+=original[position+anchor.length];
  if(question!==label)emit({outcome:'recovered',reason:'QUESTION_PUNCTUATION_REPAIRED',questionIndex});
  return {...answer,question};
 });
 const found=[],missing=[];
 answers.forEach((answer,index)=>{
  const text=renderAnswer(answer,root,packet,emit,index);
  if(text)found.push((answers.length>1?'**'+plain(answer.question)+'**\n\n':'')+text);
  else if(!missing.includes(answer.question))missing.push(answer.question);
 });
 if(missing.length)found.push(answers.length>1?'**'+NOT_FOUND+'**\n\n'+missing.map(question=>'- '+plain(question)).join('\n'):NOT_FOUND);
 return found.join('\n\n');
}
module.exports={CHAT_URL,NOT_FOUND,ABM_RESPONSE_SCHEMA,renderAbmResponse};

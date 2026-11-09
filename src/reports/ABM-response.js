'use strict';
const fs = require('node:fs');
const {normalize,loadPattern,ruleText,examplesFor} = require('./ABM-source');
const CHAT_URL = 'https://xlink.achat.best/join/chat/ODA3MzVlZmEtYzlkZC01NmY5LTlhZDQtZjJiNWFkOWUzNDk4OjI1MjE3Yzk1LTY3YTYtNTcxYS1hMzM0LWViMDFiZDExY2M2ODpiOTNmZDI4OS05ZmNmLTUxZWUtYjU4Mi0yNDc0YTZjYjNlOGE6OWMzMmUzMTctZWUxNi01ZDI1LTlmZGYtODkzNTUxMGM3NmEy';
const NOT_FOUND = 'Не нашёл ответа в паттернах АБМ. Напиши в чат [«DS ABM :: Скорая помощь по дизайну»](' + CHAT_URL + ') — мы ответим на твой вопрос';
const NO_EXAMPLE = 'Правило есть, но примера к нему не нашёл.';
const evidenceSchema = {
  type:'object',additionalProperties:false,
  properties:{file:{type:'string'},ruleId:{type:'string'},quote:{type:'string'},text:{type:'string'}},
  required:['file','ruleId','quote','text'],
};
const ABM_RESPONSE_SCHEMA = {
  type:'object',additionalProperties:false,
  properties:{answers:{type:'array',minItems:1,maxItems:12,items:{
    type:'object',additionalProperties:false,
    properties:{question:{type:'string'},kind:{type:'string',enum:['answer','not_found']},
      evidence:{type:'array',maxItems:16,items:evidenceSchema}},
    required:['question','kind','evidence'],
  }}},required:['answers'],
};
const plain = value => normalize(value).replace(/[\\`*_[\]<>#|]/g,'\\$&')
  .replace(/^([-+])\s/u,'\\$1 ').replace(/^(\d+)([.)])\s/u,'$1\\$2 ');

// Model-written text may use emphasis and lists, but cannot inject links,
// source captions, HTML, code, tables or fallback copy into a rule block.
function answerText(value) {
  if(typeof value!=='string')throw Error('Missing answer text');
  const text=value.trim();
  if(!text||text.length>6000||/https?:|www\.|<|>|\||`|\[[^\]]*\]|!\[|(?:^|\n)\s*(?:#{1,6}\s|\|)|(?:^|\n)\s*[-: ]+\|/iu.test(text)
      ||/Паттерн\s*:|Источник\s*:|\[Rule|R\d+[._]|Не наш[её]л ответа|Правило есть, но примера/iu.test(text))throw Error('Invalid answer format');
  return text;
}
function renderAnswer(answer,root,packet) {
  if(answer?.kind!=='answer'||!Array.isArray(answer.evidence)||!answer.evidence.length||answer.evidence.length>16)return null;
  try {
    const evidence=answer.evidence.map(item=>{
      if(packet&&!packet.rules.some(rule=>rule.file===item.file&&rule.ruleId===item.ruleId))throw Error('Evidence outside retrieved source');
      const pattern=loadPattern(root,item.file),rule=pattern?.rules.find(rule=>rule.key===item.ruleId);
      const quote=typeof item.quote==='string'?normalize(item.quote):'';
      if(!rule||!quote||(quote.match(/[\p{L}\p{N}]+/gu)||[]).length<2||
          !ruleText(rule.body).includes(quote)||/https?:|\[Rule|R\d+[._]|(?:Ключ правила|Раздел)\s*:/i.test(quote))throw Error('Unconfirmed evidence');
      return {pattern,ruleId:item.ruleId,text:answerText(item.text)};
    });
    const paragraphs=[];
    for(const file of [...new Set(evidence.map(item=>item.pattern.file))]) {
      const items=evidence.filter(item=>item.pattern.file===file);
      const seen=new Set();
      for(const item of items) {
        if(seen.has(item.ruleId))continue;
        seen.add(item.ruleId);
        paragraphs.push(item.text);
        const links=examplesFor(item.pattern,item.ruleId);
        paragraphs.push(links.length?links.map(link=>(link.platform==='iOS'?'🍏':'🤖')+' [Пример]('+link.url+')').join(' · '):NO_EXAMPLE);
      }
      const pattern=items[0].pattern;
      paragraphs.push('Паттерн: «'+plain(pattern.title)+'», '+plain(pattern.version));
    }
    return paragraphs.join('\n\n');
  } catch { return null; }
}
function renderAbmResponse(value,patternsRoot,originalQuestion,packet) {
  const root=fs.realpathSync(patternsRoot);
  if(!Array.isArray(value?.answers)||!value.answers.length||value.answers.length>12)return NOT_FOUND;
  const question=normalize(originalQuestion);
  if(value.answers.some(answer=>typeof answer.question!=='string'||!normalize(answer.question)||
      !question.includes(normalize(answer.question))))return NOT_FOUND;
  const found=[],missing=[];
  for(const answer of value.answers) {
    const text=renderAnswer(answer,root,packet);
    if(text)found.push((value.answers.length>1?'**'+plain(answer.question)+'**\n\n':'')+text);
    else if(!missing.includes(answer.question))missing.push(answer.question);
  }
  if(missing.length)found.push(value.answers.length>1
    ?'**'+NOT_FOUND+'**\n\n'+missing.map(question=>'- '+plain(question)).join('\n'):NOT_FOUND);
  return found.join('\n\n');
}
module.exports={CHAT_URL,NOT_FOUND,NO_EXAMPLE,ABM_RESPONSE_SCHEMA,renderAbmResponse};

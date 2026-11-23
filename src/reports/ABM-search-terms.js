'use strict';
const STOP_WORDS='как какой какая какие какое когда где куда это для или при про что есть нужно надо можно нельзя должен должна должны будет быть использовать использует используем писать показывать делает делать направлять абм abm вопрос ответ паттерн правило правила правил общие общий расскажи пожалуйста мне мы он она они его ее ли и в на с из по к у а не то теперь ios android андроид андроиде айос'.split(' ');
function stem(word) {
  const value=word.toLowerCase().normalize('NFKC').replace(/ё/g,'е');
  if(value==='кнопок')return 'кнопк';
  if(value==='радиокнопок')return 'радиокнопк';
  if(value==='копеек')return 'копейк';
  return /^[а-я]+$/u.test(value)&&value.length>3
    ?value.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ией|иям|иях|ов|ев|ей|ий|ый|ой|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ах|ях|ы|и|а|я|у|ю|е|о|ь)$/u,''):value;
}
const STOP=new Set(STOP_WORDS.map(stem));
function tokens(value) {
  const text=String(value),separated=text.replace(/([a-z])([A-Z])/g,'$1 $2');
  return [...new Set(((text+' '+separated).match(/[\p{L}\p{N}]+/gu)||[]).map(stem)
    .filter(word=>word.length>1&&!STOP.has(word)))];
}
const GROUPS=[
 ['доступность','accessibility'],['навигация','navigation'],['типографика','typography'],['цвет','color','colors'],['анимация','animation','motion'],['размер','size','sizing'],['отступ','spacing','padding'],
 ['хаптик','haptic','haptics'],['клавиатура','keyboard'],['шеврон','chevron'],['поиск','search'],
 ['очистка','крестик','clear'],['копейки','kopecks'],['шрифт','font'],['таблица','table','tables'],
 ['радиокнопка','radio'],['чекбокс','checkbox','checkboxes'],['переключатель','switch','тумблер'],
 ['чипсы','chips','chip'],['нейминг','naming'],['инфо','info'],['иконка','icon'],['кнопка','button','buttons'],
].map(group=>[...new Set(group.flatMap(tokens))]);
function oneEdit(a,b) {
  if(Math.abs(a.length-b.length)>1||a===b)return false;
  if(a.length===b.length) {
    const differences=[];
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences.push(i);
    return differences.length===1||differences.length===2&&differences[1]===differences[0]+1
      &&a[differences[0]]===b[differences[1]]&&a[differences[1]]===b[differences[0]];
  }
  const short=a.length<b.length?a:b,long=a.length<b.length?b:a;
  let i=0,j=0;
  while(i<short.length&&j<long.length) {
    if(short[i]===long[j]){i++;j++;}
    else if(i===j)j++;
    else return false;
  }
  return true;
}
function canonicalTerms(terms) {
 return [...new Set(terms.map(term=>GROUPS.find(group=>group.includes(term))?.[0]||term))];
}

function numberContext(value) {
 const text=String(value);
 const amount=/сумм|копе[йе]|рубл|денеж|денег|деньг|валют|стоимост|₽|\bamount\b|\bkopecks?\b|\bcurrency\b/iu.test(text);
 const punctuation=/(?:кон(?:ец|це)|завершени[ея])[^?\n]*(?:предложени|абзац)|(?:предложени|абзац)[^?\n]*(?:кон(?:ец|це)|завершени[ея])/iu.test(text);
 const date=/(?:^|[^\p{L}])дат[аыуе](?:[^\p{L}]|$)|дат[а-я]*\s+рождени|календар|\bdate\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/iu.test(text);
 const identifier=/(?:^|[^\p{L}])(?:код[а-я]*|идентификатор[а-я]*|номер[а-я]*|верси[а-я]*|артикул[а-я]*)(?:[^\p{L}]|$)|\b(?:code|identifier|version)\b/iu.test(text);
 const phone=/телефон|\bphone\b/iu.test(text);
 const other=punctuation?'punctuation':date?'date':phone?'phone':identifier?'identifier':null;
 return amount&&other?'mixed':amount?'amount':other;
}

const FRACTION_WORDS=/(?<![\p{L}])(?:копе[йе][а-я]*|дробн[а-я]*|десятичн[а-я]*)|\b(?:decimal|fraction\w*|kopecks?|cents?)\b/iu;
function numberSeparatorIntent(value,context='') {
 const text=String(value),scope=numberContext(text)||numberContext(context);
 if(scope&&scope!=='amount')return false;
 const fraction=FRACTION_WORDS.test(text),literal=/\d+[.,]\d+/u.test(text);
 const numeric=fraction||/числ|цифр|сумм|рубл|значени|\b(?:number|amount)\b/iu.test(text)||literal||scope==='amount';
 const choice=/точк|\bdot\b|\bperiod\b/iu.test(text)&&/запят|\bcomma\b/iu.test(text);
 const separator=/раздел|отдел(?:ить|ять|я[а-я]*|ен[а-я]*)|через|между|знак|точк|запят|\b(?:separat\w*|comma|dot|period)\b/iu.test(text);
 const contextual=scope==='amount'&&/разделител|точк|запят/iu.test(text);
 const insideNumber=/(?:^|\s)в\s+(?:числ[ае]|сумм[еы]|значени[ие])/iu.test(text)&&/точк|запят/iu.test(text);
 return numeric&&(choice||fraction&&separator||contextual||insideNumber);
}
function isNumberSeparatorRule(value) {
 return /запят|точк|\b(?:comma|dot|period)\b/iu.test(value)&&FRACTION_WORDS.test(value);
}

function expandTerms(value,vocabulary=new Set()) {
  const result=new Set(tokens(value));
  let typoCorrections=0;
  for(const term of [...result]) {
    if(term.length<5||vocabulary.has(term)||GROUPS.some(group=>group.includes(term)))continue;
    const candidates=[...vocabulary].filter(word=>oneEdit(term,word));
    if(candidates.length===1){result.delete(term);result.add(candidates[0]);typoCorrections++;}
  }
  if(numberSeparatorIntent(value))for(const term of tokens('десятичный дробный разделитель decimal separator fraction'))result.add(term);
  // These aliases only retrieve documents; they never create normative claims.
  for(const group of GROUPS)if(group.some(term=>result.has(term)))for(const term of group)result.add(term);
  if((result.has('кнопк')||result.has('button'))&&
      ['нейминг','naming','назван','назват','подпис','подписат','имен','label','labels','name','names','текст','называт','подписыват','надпис','формулировк','лейбл'].some(term=>result.has(term))) {
    for(const term of ['назван','назват','подпис','подписат','имен','label','labels','name','names','текст','называт','подписыват','надпис','формулировк','лейбл'])result.delete(term);
    result.add('нейминг');result.add('naming');
  }
  if(/\binfo\b|иконк[а-я]*\s+[«"'“]?i\b/iu.test(String(value))) {
    result.add('инфо');result.add('info');
  }
  return {terms:[...result],intentTerms:canonicalTerms([...result]),typoCorrections};
}
function isMoreRequest(value) {
  return /^(?:(?:а|и|что)\s+)?(?:ещ[её]|дальше|продолжи(?:ть)?|продолжай)(?:\s+(?:что|есть|можно|расскажешь|подробнее))?[?!.…\s]*$/iu.test(String(value).trim());
}
function isFollowup(value) {
  return isMoreRequest(value)||/^(?:а\s+)?(?:(?:покажи|приведи|дай)\s+(?:пример|исключен|подроб)|(?:какие\s+)?(?:есть\s+)?(?:исключен|ограничен|услов|пример|подроб|почему)|(?:на|для)\s+(?:ios|android|андроиде?|айос)\b|если\b)/iu.test(String(value).trim());
}
function recentTopic(dialogue,continuation=isFollowup) {
  return [...dialogue].reverse().find(entry=>entry?.role==='user'&&typeof entry.text==='string'
    &&!continuation(entry.text)&&tokens(entry.text).length)?.text.slice(-2000)||'';
}
module.exports={tokens,expandTerms,canonicalTerms,isMoreRequest,isFollowup,recentTopic,numberContext,numberSeparatorIntent,isNumberSeparatorRule};

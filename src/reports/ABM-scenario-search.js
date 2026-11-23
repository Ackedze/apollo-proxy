'use strict';
const {tokens,canonicalTerms}=require('./ABM-search-terms');

// Lexical matching only: this score selects sources, never decides applicability.
function related(a,b) {
 if(a===b)return 1;
 if(!/^[а-я]+$/u.test(a)||!/^[а-я]+$/u.test(b))return 0;
 const short=a.length<b.length?a:b,long=a.length<b.length?b:a;
 return short.length>=4&&long.length-short.length<=3&&long.startsWith(short)?0.55:0;
}
const QUANTITIES=[
 /од(?:ин|на|но|ну|ного|ному|ним|ном)|одиночн[а-я]*|перв[а-я]*/,
 /два|две|двух|двум|двумя|втор[а-я]*/,/три|трех|трёх|трем|трём|трет[а-я]*/,
 /четыр[а-яё]*/,/пять|пяти|пят[а-я]*/,/шесть|шести|шест[а-я]*/,
 /семь|семи|седьм[а-я]*/,/восемь|восьм[а-я]*/,/девять|девяти|девят[а-я]*/,/десять|десяти|десят[а-я]*/,
].map(pattern=>new RegExp(String.raw`(?<![\p{L}])(?:${pattern.source})(?![\p{L}])`,'iu'));
const FILLER=new Set(tokens('меня ещё уже там тогда вообще пока тоже всё равно'));
function terms(value) {
 const result=canonicalTerms(tokens(value)).filter(term=>!FILLER.has(term));
 if(/android|андроид/iu.test(value))result.push('android');
 if(/ios|айос/iu.test(value))result.push('ios');
 for(const digit of String(value).match(/(?<![\p{L}\p{N}])\d+(?=(?:px|dp|pt|sp)\b|[^\p{L}\p{N}]|$)/giu)||[])result.push('quantity:'+digit);
 QUANTITIES.forEach((pattern,i)=>{if(pattern.test(value))result.push('quantity:'+(i+1));});
 return [...new Set(result)];
}
function scenarioIndex(rows) {
 const entries=rows.map(row=>({row,body:terms(row.record.text),
  context:terms(row.record.context),heading:terms(row.sectionHeadings.join(' ')),title:terms(row.record.pattern)}));
 const frequency=new Map();
 for(const entry of entries)for(const term of new Set([...entry.body,...entry.context,...entry.heading,...entry.title]))
  frequency.set(term,(frequency.get(term)||0)+1);
 return {entries,frequency};
}
function scenarioCandidates(index,question) {
 const query=terms(question);
 // Clause lanes keep a secondary condition from losing to the longest sentence.
 const clauses=String(question).split(/[.!?;\n]+|[,—–]\s*|\s+(?:но|зато|потому что|а если)\s+/iu)
  .map(terms).filter(part=>part.length>=2);
 const lanes=[query,...clauses];
 const weight=term=>Math.log(1+index.entries.length/(index.frequency.get(term)||1));
 const ranked=lanes.map(lane=>index.entries.map(entry=>{
  let sum=0,bodyMatches=0;
  for(const term of lane) {
   const body=Math.max(0,...entry.body.map(word=>related(term,word)));
   const context=Math.max(0,...entry.context.map(word=>related(term,word)));
   const heading=Math.max(0,...entry.heading.map(word=>related(term,word)));
   const title=Math.max(0,...entry.title.map(word=>related(term,word)));
   if(body)bodyMatches+=body;
   sum+=weight(term)*Math.max(body,0.45*context,0.6*heading,0.25*title);
  }
  // Repeated words and long examples do not count as extra corroboration.
  const coverage=bodyMatches/Math.max(1,lane.length);
  return {row:entry.row,score:sum*(0.5+coverage)/Math.sqrt(1+entry.body.length/80),bodyMatches};
 }).filter(hit=>hit.bodyMatches>=1.5).sort((a,b)=>b.score-a.score||a.row.record.file.localeCompare(b.row.record.file)||a.row.record.ruleId.localeCompare(b.row.record.ruleId)));
 const selected=[],seen=new Set();
 const add=hit=>{
  const key=hit.row.record.file+':'+hit.row.record.ruleId;
  if(!seen.has(key)){seen.add(key);selected.push(hit.row);}
 };
 // Reserve one corroborated hit per clause before filling the overall ranking.
 for(const lane of ranked.slice(1))if(lane[0])add(lane[0]);
 for(const hit of ranked[0].slice(0,12))if(hit.score>=ranked[0][0].score*0.35)add(hit);
 return selected.slice(0,24);
}
module.exports={scenarioIndex,scenarioCandidates};

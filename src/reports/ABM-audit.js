'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadPattern,numericKey,ruleText}=require('./ABM-source');
function auditAbmPatterns(patternsRoot) {
 const root=fs.realpathSync(patternsRoot),findings=[],patterns=[];
 const add=(code,file,ruleId,severity='warning')=>{
  const existing=findings.find(item=>item.code===code&&item.file===file&&item.ruleId===ruleId);
  if(existing){existing.occurrences=(existing.occurrences||1)+1;return;}
  findings.push({code,severity,file,...(ruleId?{ruleId}:{})});
 };
 for(const entry of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
  if(!/^p_abm_.+\.md$/.test(entry.name))continue;
  if(!entry.isFile()){add('NON_REGULAR_PATTERN',entry.name,null,'error');continue;}
  let text,pattern;
  try {text=fs.readFileSync(path.join(root,entry.name),'utf8');pattern=loadPattern(root,entry.name);} catch {add('PATTERN_UNREADABLE',entry.name,null,'error');continue;}
  if(!pattern){add('INVALID_PATTERN_METADATA',entry.name,null,'error');continue;}
  patterns.push(pattern);
  const rawRules=[...text.matchAll(/^#{1,6}\s+\[Rule\]\s+(\S+)/gm)];
  if(rawRules.length!==pattern.rules.length)add('RULE_PARSE_MISMATCH',entry.name,null,'error');
  const ids=new Set(),numbers=new Map();
  for(const rule of pattern.rules) {
   if(ids.has(rule.key))add('DUPLICATE_RULE_ID',entry.name,rule.key,'error');
   ids.add(rule.key);
   const number=numericKey(rule.key);
   if(number)numbers.set(number,(numbers.get(number)||0)+1);
   if(!ruleText(rule.body)) {
    const container=number&&pattern.rules.some(child=>numericKey(child.key)?.startsWith(number+'.'));
    add(container?'EMPTY_RULE_GROUP':'EMPTY_RULE',entry.name,rule.key,container?'info':'error');
   }
  }
  for(const [number,count]of numbers)if(count>1)add('AMBIGUOUS_NUMERIC_ID',entry.name,number);
  for(const rule of pattern.rules) {
   const number=numericKey(rule.key);
   if(number?.includes('.')&&!numbers.has(number.slice(0,number.lastIndexOf('.'))))add('MISSING_PARENT_RULE',entry.name,rule.key);
  }
  for(const example of pattern.examples) {
   if(!ids.has(example.key)&&!numbers.has(numericKey(example.key)))add('ORPHAN_EXAMPLE',entry.name,example.key);
   const lines=example.body.split(/\r?\n/).filter(line=>/^Ссылка на/.test(line));
   for(const line of lines) {
    if(!/https?:\/\/\S+/.test(line))add('MISSING_EXAMPLE_URL',entry.name,example.key);
    else if(!/\((?:iOS|Android)\)\s*:/.test(line))add('UNLABELED_EXAMPLE_PLATFORM',entry.name,example.key);
   }
   const prose=example.body.split(/\r?\n/).filter(line=>!/^Ссылка на|^https?:|^#{1,6}\s/.test(line))
    .some(line=>(line.match(/[\p{L}\p{N}]+/gu)||[]).length>=3);
   if(prose)add('PROSE_AFTER_EXAMPLE',entry.name,example.key,'info');
  }
 }
 const patternIds=new Set();
 for(const pattern of patterns) {
  if(patternIds.has(pattern.patternId))add('DUPLICATE_PATTERN_ID',pattern.file,null,'error');
  patternIds.add(pattern.patternId);
 }
 return {schemaVersion:1,patternCount:patterns.length,ruleCount:patterns.reduce((sum,p)=>sum+p.rules.length,0),
  exampleCount:patterns.reduce((sum,p)=>sum+p.examples.length,0),
  errors:findings.filter(item=>item.severity==='error').length,
  warnings:findings.filter(item=>item.severity==='warning').length,findings};
}
module.exports={auditAbmPatterns};

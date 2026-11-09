'use strict';
const fs = require('node:fs');
const path = require('node:path');
const normalize = value => String(value).replace(/\s+/gu, ' ').trim();
const numericKey = key => /^R\d+(?:\.\d+)*/i.exec(key)?.[0].toUpperCase();
function scalar(metadata, key) {
  const value = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(metadata)?.[1]?.trim() || '';
  return value.replace(/^(["'])(.*)\1$/, '$2');
}
function sections(text, type) {
  const headings = [...text.matchAll(/^(#{1,6})[ \t]+([^\r\n]+)/gm)];
  const context = [];
  const result = [];
  headings.forEach((heading, index) => {
    const level = heading[1].length;
    const special = /^\[(Rule|RuleExample)\][ \t]+(\S+)/.exec(heading[2]);
    if (!special) {
      while (context.length && context.at(-1).level >= level) context.pop();
      context.push({level, text: heading[2] + '\n' + text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim()});
      return;
    }
    if (special[1] !== type) return;
    const end = headings.slice(index + 1).find(next =>
      (type === 'Rule' ? /^\[Rule\]\s/ : /^\[(Rule|RuleExample)\]\s/).test(next[2]) || (!/^\[RuleExample\]/.test(next[2]) && next[1].length <= level))?.index ?? text.length;
    const rawBody=text.slice(heading.index + heading[0].length,end);
    const body=type==='Rule'?rawBody.replace(/^#{1,6}[ \t]+\[RuleExample\][^\n]*$/gm,'').replace(/^Ссылка на[^\n]*$/gm,''):rawBody;
    result.push({key:special[2], body,
      context:context.filter(item => item.level < level).map(item => item.text).join('\n\n')});
  });
  return result;
}
function loadPattern(root, file) {
  if (typeof file !== 'string' || !/^p_abm_[\p{L}\p{N}_-]+\.md$/u.test(file)) return null;
  const full = path.join(root, file);
  if (fs.realpathSync(full) !== full) return null;
  const text = fs.readFileSync(full, 'utf8');
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] || '';
  if (scalar(metadata, 'abmDocumentType') !== 'Pattern') return null;
  const rawTitle = scalar(metadata, 'titlePage') || scalar(metadata, 'abmPatternTitle');
  const title = rawTitle.split('::')[0].replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const version = scalar(metadata, 'version');
  if (!title || !/^(?:v\.?\s*)?\d+(?:\.\d+)*(?:[-+][\w.-]+)?$/i.test(version)) return null;
  return {file, title, version, patternId:scalar(metadata,'abmPatternID'),
    metadata:['abmPatternID','abmPatternTitle','abmPatternType','tags','platform'].map(key=>scalar(metadata,key)).join(' '),
    rules:sections(text,'Rule'), examples:sections(text,'RuleExample')};
}
function ruleText(body) {
  return normalize(body.split(/\r?\n/).filter(line =>
    !/^\s*(?:#{1,6}\s|\*\*(?:Ключ правила|Раздел):?\*\*|Ссылка на|https?:\/\/)/i.test(line)
  ).join('\n'));
}
function examplesFor(pattern, ruleId) {
  let found = pattern.examples.filter(example => example.key === ruleId);
  let parent = numericKey(ruleId);
  while (!found.length && parent?.includes('.')) {
    parent = parent.slice(0,parent.lastIndexOf('.'));
    const parentRule = pattern.rules.find(rule=>numericKey(rule.key)===parent);
    if (parentRule) found = pattern.examples.filter(example=>numericKey(example.key)===parent);
  }
  const links = [];
  for (const example of found) {
    for (const match of example.body.matchAll(/\((iOS|Android)\)\s*:\s*(https?:\/\/[^\s<>)\]]+)/gi)) {
      const platform = match[1].toLowerCase()==='ios'?'iOS':'Android';
      try {
        const url = new URL(match[2]);
        if (!['http:','https:'].includes(url.protocol)||url.username||url.password) continue;
        if (!links.some(link=>link.platform===platform&&link.url===match[2])) links.push({platform,url:match[2]});
      } catch { /* Malformed source links are never emitted. */ }
    }
  }
  return links.sort((a,b)=>Number(a.platform==='Android')-Number(b.platform==='Android'));
}
function parentsFor(pattern, rule) {
  const parents=[];
  let key=numericKey(rule.key);
  while(key?.includes('.')) {
    key=key.slice(0,key.lastIndexOf('.'));
    const parent=pattern.rules.find(item=>numericKey(item.key)===key);
    if(parent)parents.unshift(parent);
  }
  return parents;
}
module.exports={normalize,numericKey,loadPattern,ruleText,examplesFor,parentsFor};

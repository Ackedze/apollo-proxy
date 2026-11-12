'use strict';
const fs = require('node:fs');
const path = require('node:path');
const hub = require('./ABM-hub-source');
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
      context.push({level, title:heading[2], text: heading[2] + '\n' + text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim()});
      return;
    }
    if (special[1] !== type) return;
    const end = headings.slice(index + 1).find(next =>
      (type === 'Rule' ? /^\[Rule\]\s/ : /^\[(Rule|RuleExample)\]\s/).test(next[2]) || (!/^\[RuleExample\]/.test(next[2]) && next[1].length <= level))?.index ?? text.length;
    const rawBody=text.slice(heading.index + heading[0].length,end);
    const body=type==='Rule'?rawBody.replace(/^#{1,6}[ \t]+\[RuleExample\][^\n]*$/gm,'').replace(/^Ссылка на[^\n]*$/gm,''):rawBody;
    const scope=context.filter(item => item.level <= level);
    result.push({key:special[2], body,
      headings:scope.map(item=>item.title),
      context:scope.map(item=>item.text).join('\n\n')});
  });
  return result;
}
function loadPattern(root, file) {
  if (typeof file === 'string' && file.startsWith('guides/')) return hub.loadGuide(root,file,cleanRuleContent);
  const doc=hub.read(root,file);if(!doc)return null;
  const text=doc.text;
  const metadata=file.startsWith('patterns/')?hub.hubPatternMetadata(doc):doc.front;
  if(!metadata||!/^ptrn:/.test(scalar(metadata,'abmPatternID')))return null;
  if (scalar(metadata, 'abmDocumentType') !== 'Pattern') return null;
  const rawTitle = scalar(metadata, 'titlePage') || scalar(metadata, 'abmPatternTitle');
  const title = rawTitle.split('::')[0].replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const version = scalar(metadata, 'version');
  if (!title || !/^(?:v\.?\s*)?\d+(?:\.\d+)*(?:[-+][\w.-]+)?$/i.test(version)) return null;
  let content=text;
  if(file.startsWith('patterns/')) {
    const boundary=doc.body.search(/^##\s/m),end=boundary<0?doc.body.length:boundary;
    content=doc.body.slice(0,end).replace(/^- (?:abmDocumentType|abmPatternType|abmPatternID|abmPatternTitle|platform|version|updatedAt|editor|tags|titlePage|figma_url):[^\n]*$/gm,'')+doc.body.slice(end);
  }
  return {file, title, version, patternId:scalar(metadata,'abmPatternID'),
    metadata:['abmPatternID','abmPatternTitle','abmPatternType','tags','platform'].map(key=>scalar(metadata,key)).join(' '),
    rules:sections(content,'Rule'), examples:sections(content,'RuleExample')};
}
// The packet and evidence validator must see the same source representation.
// Strip link destinations, preserving their exact visible labels and all prose.
function cleanRuleContent(value) {
  return value.replace(/^\s*\*\*(?:Ключ правила|Раздел):?\*\*[^\n]*$/gm,'')
    .replace(/^#{1,6}[ \t]+/gm,'')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/\*\*([^*\n]+)\*\*/g,'$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'$1')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1')
    .replace(/https?:\/\/\S+/g,'').trim();
}
function ruleText(body) {
  return normalize(cleanRuleContent(body));
}
function examplesFor(pattern, ruleId) {
  let found = pattern.examples.filter(example => example.key === ruleId);
  let parent = numericKey(ruleId);
  if(!found.length&&parent&&pattern.rules.filter(rule=>numericKey(rule.key)===parent).length===1)
    found=pattern.examples.filter(example=>numericKey(example.key)===parent);
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
module.exports={normalize,numericKey,loadPattern,ruleText,cleanRuleContent,examplesFor,parentsFor};

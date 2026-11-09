'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NOT_FOUND = 'Не нашёл ответа в паттернах АБМ. Напиши в чат «DS ABM :: Скорая помощь по дизайну» — мы ответим на твой вопрос';
const NO_EXAMPLE = 'Правило есть, но примера к нему не нашёл.';
const evidenceSchema = {
  type: 'object', additionalProperties: false,
  properties: { file: { type: 'string' }, ruleId: { type: 'string' }, quote: { type: 'string' } },
  required: ['file', 'ruleId', 'quote'],
};
const ABM_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    answers: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          question: { type: 'string' },
          kind: { type: 'string', enum: ['answer', 'not_found'] },
          evidence: { type: 'array', maxItems: 8, items: evidenceSchema },
        },
        required: ['question', 'kind', 'evidence'],
      },
    },
  },
  required: ['answers'],
};

const normalize = value => String(value).replace(/\s+/gu, ' ').trim();
function plain(value) {
  const text = normalize(value).replace(/[\\`*_[\]<>#]/g, '\\$&');
  return text.replace(/^([-+])\s/u, '\\$1 ').replace(/^(\d+)([.)])\s/u, '$1\\$2 ');
}
const numericKey = key => /^R\d+(?:\.\d+)*/i.exec(key)?.[0].toUpperCase();

function scalar(metadata, key) {
  const value = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(metadata)?.[1]?.trim() || '';
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

function sections(text, type) {
  const regex = new RegExp('^#{1,6}[ \\t]+\\[' + type + '\\][ \\t]+(\\S+)[^\\r\\n]*', 'gm');
  const headings = [...text.matchAll(regex)];
  return headings.map((match, index) => ({
    key: match[1], body: text.slice(match.index + match[0].length, headings[index + 1]?.index ?? text.length),
  }));
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
  return { file, title, version, rules: sections(text, 'Rule'), examples: sections(text, 'RuleExample') };
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
    parent = parent.slice(0, parent.lastIndexOf('.'));
    const parentRule = pattern.rules.find(rule => numericKey(rule.key) === parent);
    if (parentRule) found = pattern.examples.filter(example => numericKey(example.key) === parent);
  }
  const links = [];
  for (const example of found) {
    // A following Rule starts a new context even if there is no next RuleExample yet.
    const body = example.body.split(/^#{1,6}\s+\[Rule\]\s+/m)[0];
    for (const match of body.matchAll(/\((iOS|Android)\)\s*:\s*(https?:\/\/[^\s<>)\]]+)/gi)) {
      const platform = match[1].toLowerCase() === 'ios' ? 'iOS' : 'Android';
      const url = new URL(match[2]);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      if (!links.some(link => link.platform === platform && link.url === match[2])) links.push({ platform, url: match[2] });
    }
  }
  return links;
}

function renderAnswer(answer, root) {
  if (answer?.kind !== 'answer' || !Array.isArray(answer.evidence) ||
      !answer.evidence.length || answer.evidence.length > 8) return NOT_FOUND;
  try {
    const evidence = answer.evidence.map(item => {
      const pattern = loadPattern(root, item.file);
      const rule = pattern?.rules.find(rule => rule.key === item.ruleId);
      const quote = typeof item.quote === 'string' ? normalize(item.quote) : '';
      if (!rule || !quote || (quote.match(/[\p{L}\p{N}]+/gu) || []).length < 2 ||
          !ruleText(rule.body).includes(quote) ||
          /https?:|\[Rule|R\d+[._]|(?:Ключ правила|Раздел)\s*:/i.test(quote)) throw Error('Unconfirmed quote');
      return { pattern, ruleId: item.ruleId, quote };
    });
    const paragraphs = [...new Set(evidence.map(item => plain(item.quote)))];
    const files = [...new Set(evidence.map(item => item.pattern.file))];
    for (const file of files) {
      const items = evidence.filter(item => item.pattern.file === file);
      const links = [], missing = [];
      for (const item of items) {
        const examples = examplesFor(item.pattern, item.ruleId);
        if (!examples.length) missing.push(item.ruleId);
        for (const link of examples) if (!links.some(other => other.platform === link.platform && other.url === link.url)) links.push(link);
      }
      links.sort((a, b) => Number(a.platform === 'Android') - Number(b.platform === 'Android'));
      if (links.length) paragraphs.push(links.map(link => '[Пример ' + link.platform + '](' + link.url + ')').join(' · '));
      if (missing.length) paragraphs.push(NO_EXAMPLE);
      const pattern = items[0].pattern;
      paragraphs.push('Паттерн: «' + plain(pattern.title) + '», ' + plain(pattern.version));
    }
    return paragraphs.join('\n\n');
  } catch {
    return NOT_FOUND;
  }
}

function renderAbmResponse(value, patternsRoot, originalQuestion) {
  const root = fs.realpathSync(patternsRoot);
  if (!Array.isArray(value?.answers) || !value.answers.length || value.answers.length > 12) return NOT_FOUND;
  const question = normalize(originalQuestion);
  // Never allow the agent to append questions that the user did not ask.
  if (value.answers.some(answer => typeof answer.question !== 'string' || !normalize(answer.question) ||
      !question.includes(normalize(answer.question)))) return NOT_FOUND;
  return value.answers.map(answer => {
    const text = renderAnswer(answer, root);
    return value.answers.length > 1 ? '**' + plain(answer.question) + '**\n\n' + text : text;
  }).join('\n\n');
}

module.exports = { NOT_FOUND, NO_EXAMPLE, ABM_RESPONSE_SCHEMA, renderAbmResponse };

'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { resolveKnowledgeRoot } = require('./knowledge-root');
const { selectedCliProvider, resolveClaudeBinary } = require('./cli-agent');
const proxyRoot = path.resolve(__dirname, '..');

const HOST = process.env.HOST || '127.0.0.1';

const PORT = process.env.PORT || 3001;

const APOLLO_AGENT_URL =
  process.env.APOLLO_AGENT_URL || process.env.LANGFLOW_URL ||
  'https://aiflowteam3.aiflow-test.moscow.alfaintra.net/api/v1/run/673dae00-0e9e-439f-ba4c-106f176af74d';

const APOLLO_AGENT_KEY =
  process.env.APOLLO_AGENT_KEY || process.env.LANGFLOW_KEY;

const APOLLO_AGENT_INSECURE_TLS =
  process.env.APOLLO_AGENT_INSECURE_TLS === '1' ||
  process.env.LANGFLOW_INSECURE_TLS === '1';

const APOLLO_AGENT_MAX_ATTEMPTS = Math.max(
  Number.parseInt(process.env.APOLLO_AGENT_MAX_ATTEMPTS || '2', 10) || 2,
  1
);

const CODEX_BIN = resolveCodexBinary(process.env.CODEX_BIN);

const CODEX_MODEL = process.env.CODEX_MODEL || '';

const CLI_PROVIDER = selectedCliProvider();

const CLI_AGENT_BIN =
  CLI_PROVIDER === 'alfagen' ? '' : CLI_PROVIDER === 'claude'
    ? resolveClaudeBinary(process.env.CLAUDE_BIN)
    : CODEX_BIN;

const CODEX_IDLE_TIMEOUT_MS = Math.max(
  Number.parseInt(
    process.env.CODEX_IDLE_TIMEOUT_MS ||
      process.env.CODEX_TIMEOUT_MS ||
      '300000',
    10
  ) || 300000,
  1000
);

const CODEX_MAX_RUNTIME_MS = Math.max(
  Number.parseInt(process.env.CODEX_MAX_RUNTIME_MS || '900000', 10) || 900000,
  CODEX_IDLE_TIMEOUT_MS + 1000
);

const CODEX_WORKSPACE = path.resolve(
  process.env.CODEX_WORKSPACE || path.join(proxyRoot, 'codex-workspace')
);

const APOLLO_CODEX_DEBUG_ENABLED =
  process.env.APOLLO_CODEX_DEBUG_ENABLED !== '0';

const APOLLO_CODEX_DEBUG_ROOT = path.resolve(
  process.env.APOLLO_CODEX_DEBUG_ROOT ||
    path.join(CODEX_WORKSPACE, 'debug-runs')
);

const APOLLO_CODEX_INPUT_WARN_CHARS = Math.max(
  Number.parseInt(process.env.APOLLO_CODEX_INPUT_WARN_CHARS || '700000', 10) ||
    700000,
  10000
);

const APOLLO_CODEX_INPUT_BUDGET_CHARS = Math.max(
  Math.min(
    Number.parseInt(
      process.env.APOLLO_CODEX_INPUT_BUDGET_CHARS || '900000',
      10
    ) || 900000,
    1048576
  ),
  APOLLO_CODEX_INPUT_WARN_CHARS + 1
);

const CODEX_DS_AI_HUB = resolveKnowledgeRoot({
  kind: 'ds-ai-hub',
  configuredRoot: process.env.CODEX_DS_AI_HUB || process.env.DS_AI_HUB_ROOT,
  bundledRoot: path.join(proxyRoot, 'knowledge', 'ds-ai-hub'),
  checkoutRoot: path.join(proxyRoot, '..', '..', 'ds-ai-hub'),
});

const CODEX_DESIGN_SYSTEM = resolveKnowledgeRoot({
  kind: 'design-system_ab',
  configuredRoot:
    process.env.CODEX_DESIGN_SYSTEM || process.env.DESIGN_SYSTEM_AB_ROOT,
  bundledRoot: path.join(proxyRoot, 'knowledge', 'design-system_ab'),
  checkoutRoot: path.join(proxyRoot, '..', '..', 'shared', 'design-system_ab'),
});

const APOLLO_CODEX_SKILL_NAME = 'apollo-design-validator';

// This is a build compatibility gate, not a user preference. Keeping it out of
// .env prevents an app update from being pinned to an obsolete skill version by
// a per-user config copied from an older ApolloProxyControl bundle.
const APOLLO_CODEX_SKILL_REQUIRED_VERSION = '1.3.0';

const APOLLO_CODEX_REPORT_STRATEGY = ['skill', 'prompt'].includes(
  process.env.APOLLO_CODEX_REPORT_STRATEGY
)
  ? process.env.APOLLO_CODEX_REPORT_STRATEGY
  : 'packet';

const APOLLO_CODEX_PATTERN_PACKET_MODE =
  process.env.APOLLO_CODEX_PATTERN_PACKET_MODE === 'legacy'
    ? 'legacy'
    : 'semantic';

const APOLLO_CODEX_PATTERN_REASONING_EFFORT = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
].includes(process.env.APOLLO_CODEX_PATTERN_REASONING_EFFORT)
  ? process.env.APOLLO_CODEX_PATTERN_REASONING_EFFORT
  : 'low';

const APOLLO_CODEX_PATTERN_AUDIT_MODE =
  process.env.APOLLO_CODEX_PATTERN_AUDIT_MODE === 'single'
    ? 'single'
    : 'faceted';

const APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS = Math.max(
  Math.min(
    Number.parseInt(
      process.env.APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS || '420000',
      10
    ) || 420000,
    APOLLO_CODEX_INPUT_BUDGET_CHARS - 50000
  ),
  100000
);

const APOLLO_CODEX_KNOWLEDGE_SOURCE =
  process.env.APOLLO_CODEX_KNOWLEDGE_SOURCE === 'design-system_ab'
    ? 'design-system_ab'
    : 'ds-ai-hub';

const APOLLO_KNOWLEDGE_RELEASE = Object.freeze({
  contentVersion:
    process.env.APOLLO_KNOWLEDGE_CONTENT_VERSION || 'embedded-seed',
  sourceCommits: {
    'design-system_ab':
      process.env.APOLLO_KNOWLEDGE_DESIGN_SYSTEM_COMMIT || null,
    'ds-ai-hub': process.env.APOLLO_KNOWLEDGE_DS_AI_HUB_COMMIT || null,
  },
});

const APOLLO_CODEX_SKILL_ROOT = path.join(
  CODEX_WORKSPACE,
  '.agents',
  'skills',
  APOLLO_CODEX_SKILL_NAME
);

const APOLLO_CODEX_SKILL_DOCUMENT = path.join(
  APOLLO_CODEX_SKILL_ROOT,
  'SKILL.md'
);

const CODEX_OUTPUT_SCHEMA = path.join(
  APOLLO_CODEX_SKILL_ROOT,
  'references',
  'audit-response.schema.json'
);

const CODEX_PATTERN_OUTPUT_SCHEMA = path.join(
  APOLLO_CODEX_SKILL_ROOT,
  'references',
  'pattern-assessment-response.schema.json'
);

const CODEX_GENERATION_OUTPUT_SCHEMA = path.join(
  proxyRoot,
  'schemas',
  'apollo-generation-semantic-plan.schema.json'
);

const CODEX_RUN_TTL_MS = Math.max(
  Number.parseInt(process.env.CODEX_RUN_TTL_MS || '600000', 10) || 600000,
  60000
);

const APOLLO_DIALOGUE_MAX_QUESTION_CHARS = 12000;

const APOLLO_DIALOGUE_MAX_HISTORY_ITEMS = 12;

const APOLLO_DIALOGUE_MAX_HISTORY_CHARS = 48000;

const codexRuns = new Map();

const CODEX_PROGRESS_STAGES = {
  queued: { progress: 30, message: 'Проверка поставлена в очередь' },
  checking_skill: { progress: 32, message: 'Проверяем версию навыка Apollo' },
  preparing_request: { progress: 35, message: 'Подготавливаем снапшот' },
  preparing_report: {
    progress: 35,
    message: 'Подготавливаем отчёт кастомизаций',
  },
  preparing_patterns: {
    progress: 35,
    message: 'Подготавливаем отчёт по паттернам',
  },
  preparing_texts: { progress: 35, message: 'Подготавливаем отчёт по текстам' },
  resolving_contracts: {
    progress: 40,
    message: 'Подбираем применимые контракты',
  },
  resolving_patterns: {
    progress: 40,
    message: 'Подбираем применимые правила паттернов',
  },
  resolving_texts: { progress: 40, message: 'Подбираем правила редполитики' },
  saving_screenshots: { progress: 40, message: 'Подготавливаем превью макета' },
  starting_agent: { progress: 45, message: 'Запускаем агента' },
  analyzing_layout: { progress: 55, message: 'Анализируем структуру макета' },
  analyzing_report: {
    progress: 55,
    message: 'Разбираем отклонения от baseline',
  },
  analyzing_patterns: {
    progress: 55,
    message: 'Проверяем проектировочные паттерны',
  },
  analyzing_component_contracts: {
    progress: 52,
    message: 'Проверяем контракты и композицию',
  },
  analyzing_visual_bindings: {
    progress: 66,
    message: 'Проверяем стили и привязки',
  },
  analyzing_page_patterns: {
    progress: 80,
    message: 'Проверяем layout и паттерны страницы',
  },
  analyzing_texts: { progress: 55, message: 'Проверяем тексты' },
  reading_design_system: {
    progress: 70,
    message: 'Сверяемся с документацией дизайн-системы',
  },
  finalizing: { progress: 90, message: 'Формируем таблицу результатов' },
  completed: { progress: 100, message: 'Проверка завершена' },
};

const PATTERN_AUDIT_PASS_DEFINITIONS = [
  {
    id: 'component-contract',
    title: 'Контракты и композиция',
    progressStage: 'analyzing_component_contracts',
  },
  {
    id: 'visual-bindings',
    title: 'Визуальные свойства и привязки',
    progressStage: 'analyzing_visual_bindings',
  },
  {
    id: 'layout-patterns',
    title: 'Layout и паттерны страницы',
    progressStage: 'analyzing_page_patterns',
  },
];

function resolveCodexBinary(configured = '') {
  const candidates = [];
  if (configured.includes('/')) {
    candidates.push(configured);
  }
  for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    candidates.push(
      `${root}/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`,
      `${root}/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
      `${root}/ChatGPT.app/Contents/Resources/codex`,
      `${root}/Codex.app/Contents/Resources/codex`
    );
  }
  candidates.push(
    path.join(os.homedir(), '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex'
  );
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return configured && !configured.includes('/') ? configured : 'codex';
}

module.exports = {
  HOST,
  PORT,
  APOLLO_AGENT_URL,
  APOLLO_AGENT_KEY,
  APOLLO_AGENT_INSECURE_TLS,
  APOLLO_AGENT_MAX_ATTEMPTS,
  CODEX_BIN,
  CODEX_MODEL,
  CLI_PROVIDER,
  CLI_AGENT_BIN,
  CODEX_IDLE_TIMEOUT_MS,
  CODEX_MAX_RUNTIME_MS,
  CODEX_WORKSPACE,
  APOLLO_CODEX_DEBUG_ENABLED,
  APOLLO_CODEX_DEBUG_ROOT,
  APOLLO_CODEX_INPUT_WARN_CHARS,
  APOLLO_CODEX_INPUT_BUDGET_CHARS,
  CODEX_DS_AI_HUB,
  CODEX_DESIGN_SYSTEM,
  APOLLO_CODEX_SKILL_NAME,
  APOLLO_CODEX_SKILL_REQUIRED_VERSION,
  APOLLO_CODEX_REPORT_STRATEGY,
  APOLLO_CODEX_PATTERN_PACKET_MODE,
  APOLLO_CODEX_PATTERN_REASONING_EFFORT,
  APOLLO_CODEX_PATTERN_AUDIT_MODE,
  APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS,
  APOLLO_CODEX_KNOWLEDGE_SOURCE,
  APOLLO_KNOWLEDGE_RELEASE,
  APOLLO_CODEX_SKILL_ROOT,
  APOLLO_CODEX_SKILL_DOCUMENT,
  CODEX_OUTPUT_SCHEMA,
  CODEX_PATTERN_OUTPUT_SCHEMA,
  CODEX_GENERATION_OUTPUT_SCHEMA,
  CODEX_RUN_TTL_MS,
  APOLLO_DIALOGUE_MAX_QUESTION_CHARS,
  APOLLO_DIALOGUE_MAX_HISTORY_ITEMS,
  APOLLO_DIALOGUE_MAX_HISTORY_CHARS,
  codexRuns,
  CODEX_PROGRESS_STAGES,
  PATTERN_AUDIT_PASS_DEFINITIONS,
};

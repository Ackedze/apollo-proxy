require('dotenv').config();
// Code-download credentials belong to the launcher, never to agent subprocesses.
delete process.env.APOLLO_CODE_TOKEN;
require('./src/portable-runtime').configureInstalledEnvironment({ proxyRoot: process.env.APOLLO_PROXY_HOME || __dirname });
const {
  HOST,
  PORT,
  APOLLO_AGENT_URL,
  APOLLO_AGENT_KEY,
  APOLLO_AGENT_INSECURE_TLS,
  APOLLO_AGENT_MAX_ATTEMPTS,
  CODEX_BIN,
  AGENT_MODEL,
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
} = require('./src/config');
const {
  validateCodexRequest,
  validateCodexReportRequest,
  validateApolloEvidenceBundle,
  isCodexReportPayload,
  isCustomizationReportPayload,
  isPatternReportPayload,
  isTextReportPayload,
  getCodexPayloadNodeIds,
  getCodexPayloadAuditId,
  getCodexPayloadCheckedNodes,
  normalizeApolloPlatform,
  normalizeApolloScreenType,
  inferApolloSelectionScope,
  buildFigmaSelectionUrl,
} = require('./src/reports/request');
const {
  compactApolloTextReport,
  compactApolloPatternReport,
  compactApolloEvidenceBundle,
  createSemanticModelId,
  decodeCompactSemanticRows,
  normalizeSemanticFactValue,
  decodeCompactEvidenceComponent,
  decodeCompactEvidenceOwner,
  decodeCompactEvidenceBounds,
  decodeCompactEvidenceLayout,
  decodeCompactEvidenceStyles,
  decodeCompactEvidenceVariableBindings,
  decodeSemanticEvidenceNode,
  incrementSemanticCount,
  buildSemanticComponentAggregate,
  compactSemanticObject,
  buildSemanticSubject,
  collectSemanticComponentOccurrences,
  readSemanticSlotName,
  inferSemanticRuleEffect,
  inferSemanticRuleScope,
  inferSemanticConstraintOperator,
  buildSemanticRuleConstraintModel,
  normalizeSemanticRule,
  inferSemanticRuleFactKinds,
  semanticRuleRequiredEvidence,
  semanticFactMatchesEvidencePath,
  semanticRuleSpecificMissingEvidence,
  semanticRuleMatchesContext,
  buildSemanticRuleCoverage,
  validateApolloSemanticModel,
  buildApolloSemanticModel,
  hydrateReportComponentRuleAuthority,
  buildSemanticArchitecture,
  inspectPrimaryActionGroup,
  collectSemanticDescendants,
  isSemanticButton,
  isSemanticComponent,
  readSemanticComponentSize,
  normalizeSemanticName,
  trimTrailingNulls,
  compactEvidenceBounds,
  compactEvidenceLayout,
  compactEvidenceComponent,
  compactEvidenceOwner,
  compactEvidenceText,
  compactEvidenceStyles,
  compactEvidenceVariableBindings,
  compactEvidenceRecord,
  compactApolloCustomizationReport,
  collectApolloReportComponentKeys,
  readApolloPacketArtifact,
  normalizeSemanticComponentHint,
  isActiveComponentDesignRule,
  isSafeRelativePath,
} = require('./src/reports/semantic');
const {
  buildApolloSkillResponseError,
  getApolloReportAtomicChanges,
  findRuleByIdInDocument,
  resolveSnapshotComponentRuleEvidence,
  findReportComponentRule,
  findCanonicalReportChange,
  normalizeReportResponseFactPaths,
  removePageSpecificPatternClassifications,
  normalizeReportFindingAuthority,
  getApolloReportValue,
  isCompactPatternAssessmentResponse,
  formatCompactPatternFactValue,
  resolveCompactPatternFact,
  expandCompactPatternAssessmentResponse,
  getResolvedAuthorityRules,
  normalizeTextFindingAuthority,
  validateApolloSkillResponse,
  adaptApolloSkillResponse,
  normalizeCodexValidation,
  getEvidenceSourceRoot,
  resolveVerifiedSourcePath,
  verifySourceFile,
  normalizeEvidenceNeedle,
  verifyCodexEvidence,
  escapeMarkdownTableCell,
  buildVerifiedFindingTable,
  buildAllowedCustomizationTable,
  getPatternPageTypeLabel,
  buildPatternScopeSection,
  buildVerifiedValidationMarkdown,
} = require('./src/reports/response');
const {
  readApolloPacketTextArtifact,
  collectComponentKeysFromDocument,
  collectNamedValuesFromDocument,
  normalizeDsAiHubAlias,
  collectApolloReportKeyHints,
  collectApolloReportRootKeyFallbacks,
  scoreDsAiHubPackageHints,
  getMarkdownDocumentStatus,
  collectLinkedMarkdownPaths,
  listDsAiHubComponentPackages,
  buildDesignSystemResolvedAuditPacket,
  buildDsAiHubResolvedAuditPacket,
  buildResolvedAuditPacket,
  matchesPatternVariantProperties,
  isActivePatternRule,
  buildPatternRuleObservations,
  extractMarkdownRuleNarrative,
  parseSemanticPatternRules,
  parseComponentRulesFromMarkdownDocument,
  collectResolvedComponentRules,
  buildResolvedPatternAuditPacket,
  compactResolvedPatternAuditPacket,
  compactPatternSemanticSubject,
  sameSemanticValue,
  compactPatternSemanticFact,
  classifySemanticFact,
  classifySemanticRuleRequirements,
  semanticFactReference,
  buildSemanticCoverageSnapshot,
  semanticRuleHasMachinePredicate,
  isNarrativeOnlySemanticRule,
  semanticPropertyHasAssessmentRule,
  collectSemanticRuleComponentHints,
  semanticRuleMatchesComponentNames,
  semanticRelevantAggregateNodeIds,
  isSemanticPassTarget,
  semanticRuleMatchesPass,
  semanticRuleMatchesLocalFacts,
  semanticContextNodeIds,
  semanticContextFactsForPass,
  summarizeSemanticFacts,
  buildPatternAuditPassPackets,
  buildPatternAuditPassChunk,
  splitPatternAuditPassPacket,
  normalizeDeterministicCompositionAssessments,
  mergeCompactPatternAssessmentResponses,
  extractTextRulesFromDocument,
  isTextApplicableComponentRule,
  parsePatternTextRules,
  selectRelevantPatternTextRules,
  buildResolvedTextAuditPacket,
  prepareCodexRequest,
  buildCodexPrompt,
  buildApolloSkillRequest,
  buildApolloCustomizationReportSkillRequest,
  buildApolloPatternReportSkillRequest,
  buildApolloTextReportSkillRequest,
} = require('./src/reports/packets');
const {
  sanitizeSessionId,
  normalizeInput,
  normalizeAgentSource,
  normalizeDialogueHistory,
  extractDialogueQuestion,
  buildCodexDialoguePrompt,
  extractLangflowText,
  collectTextCandidates,
  isUsableAgentText,
  looksLikeToolCallOnly,
  stripToolCallBlocks,
  buildToolCallRetryPayload,
  buildToolCallResponseError,
  looksLikeHtml,
  buildHtmlResponseError,
} = require('./src/reports/messages');
const {
  runCodexProcess,
  isCodexAuthenticationFailure,
  buildCodexProcessExitError,
  parseCodexJsonEvent,
  mapCodexEventToProgressStage,
  emitCodexProgress,
  buildCodexEnvironment,
} = require('./src/reports/process');

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { bindManagedProxyLifetime } = require('./src/proxy-lifecycle');
const {
  resolveKnowledgeRoot,
  assertCompleteKnowledgeRoot,
} = require('./src/knowledge-root');
const {
  selectedCliProvider,
  assertLocalAgent,
  resolveClaudeBinary,
  runClaudeProcess,
} = require('./src/cli-agent');
const { version: APOLLO_PROXY_VERSION } = require('./package.json');
const { mountContractRoutes } = require('./src/contracts/service');
const {
  mountStyleTokenCatalogRoutes,
  installStyleTokenCatalogParser,
} = require('./src/style-token-catalog/service');
const {
  evaluatePredicateReleaseRequest,
} = require('./src/predicate-engine/release-service');
const {
  buildSemanticIndex,
  inspectSemanticIndex,
} = require('./src/generation/semantic-index');
let dispatcher;
let activeCodexRuns = 0;
let namingRuns = null;
let activeGenerationCodexRuns = 0;
let contractKnowledgeCache = null;
let dsAiHubKnowledgeCache = null;

if (APOLLO_AGENT_INSECURE_TLS) {
  try {
    const { Agent } = require('undici');
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  } catch (error) {
    console.warn(
      'undici not available, fallback to NODE_TLS_REJECT_UNAUTHORIZED=0'
    );
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

const app = express();
let activeApiRequests = 0;
const tokenJournalApi = require('./src/token-journal');
const progressBarPilot = require('./src/reports/progressbar-pilot');
// An explicit portable state root wins; dev/test journals stay in their own cwd.
const tokenJournal = tokenJournalApi.createTokenJournal(path.join(process.env.APOLLO_STATE_ROOT || path.join(process.cwd(), '.local'), 'token-journal'));
tokenJournalApi.configure(tokenJournal);
process.once('exit', () => tokenJournal.close());
app.use(cors());
// Keep installed clients compatible while new Apollo uses the canonical routes.
app.use((req, res, next) => {
  if (req.url.startsWith('/v4/')) req.url = req.url.slice(3);
  next();
});
app.use((req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/code-update/')) return next();
  activeApiRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeApiRequests = Math.max(0, activeApiRequests - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
});
require('./src/code-release/maintenance').createMaintenance({key:process.env.APOLLO_CODE_UPDATE_KEY,
  launchId:process.env.APOLLO_CODE_RELEASE_ID,
  busy:async()=>{
    const generationBusy=(await Promise.all([landingRuntime].map(r=>r?.isBusy() || false))).some(Boolean);
    return activeApiRequests>0 || activeCodexRuns>0 || activeGenerationCodexRuns>0 || generationBusy || Boolean(namingRuns?.busy());
  }}).mount(app);
delete process.env.APOLLO_CODE_UPDATE_KEY;
installStyleTokenCatalogParser(app);
app.use(express.json({ limit: '30mb', strict: false }));
app.use(tokenJournal.middleware);
tokenJournalApi.mountJournalRoutes(app, tokenJournal);
const auditStatistics=require('./src/audit-statistics/delivery').createStatisticsDelivery(path.join(process.env.APOLLO_STATE_ROOT || path.join(process.cwd(), '.local'),'audit-statistics'));
auditStatistics.mount(app);
process.once('exit',()=>auditStatistics.close());

function assertSelectedKnowledgeRoots() {
  assertCompleteKnowledgeRoot(CODEX_DESIGN_SYSTEM, 'design-system_ab');
  assertCompleteKnowledgeRoot(CODEX_DS_AI_HUB, 'ds-ai-hub');
}

function listFilesRecursively(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath));
    }
  }
  return files.sort();
}

function inspectApolloCodexSkill() {
  if (!fs.existsSync(APOLLO_CODEX_SKILL_DOCUMENT)) {
    const err = new Error(
      `Apollo Codex skill is missing: ${APOLLO_CODEX_SKILL_DOCUMENT}`
    );
    err.status = 503;
    err.code = 'CODEX_SKILL_MISSING';
    throw err;
  }

  const skillDocument = fs.readFileSync(APOLLO_CODEX_SKILL_DOCUMENT, 'utf8');
  const versionMatch = skillDocument.match(/^Version:\s*`([^`]+)`\s*$/m);
  const version = versionMatch ? versionMatch[1] : null;
  if (version !== APOLLO_CODEX_SKILL_REQUIRED_VERSION) {
    const err = new Error(
      `Apollo Codex skill version mismatch: expected ${APOLLO_CODEX_SKILL_REQUIRED_VERSION}, received ${
        version || 'unknown'
      }.`
    );
    err.status = 503;
    err.code = 'CODEX_SKILL_VERSION_MISMATCH';
    throw err;
  }

  const hash = crypto.createHash('sha256');
  for (const relativePath of listFilesRecursively(APOLLO_CODEX_SKILL_ROOT)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(
      fs.readFileSync(path.join(APOLLO_CODEX_SKILL_ROOT, relativePath))
    );
    hash.update('\0');
  }

  return {
    name: APOLLO_CODEX_SKILL_NAME,
    version,
    checksum: hash.digest('hex'),
    root: APOLLO_CODEX_SKILL_ROOT,
  };
}

function inspectApolloContractKnowledge() {
  const jsonRoot = path.join(CODEX_DESIGN_SYSTEM, 'JSONS');
  const indexPath = path.join(
    jsonRoot,
    'apollo',
    'indexes',
    'componentContractIndex.json'
  );
  const indexStat = fs.statSync(indexPath, { throwIfNoEntry: false });
  if (!indexStat?.isFile()) {
    const err = new Error(`Component contract index is missing: ${indexPath}`);
    err.status = 503;
    err.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
    throw err;
  }
  if (
    contractKnowledgeCache &&
    contractKnowledgeCache.indexPath === indexPath &&
    contractKnowledgeCache.indexMtimeMs === indexStat.mtimeMs
  ) {
    return contractKnowledgeCache.result;
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (index.schemaVersion !== 2 || !Array.isArray(index.packages)) {
    const err = new Error('Unsupported component contract index.');
    err.status = 503;
    err.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
    throw err;
  }
  const missing = [];
  let artifactCount = 0;
  for (const packageEntry of index.packages) {
    const packagePath = packageEntry?.packagePath;
    const artifacts = packageEntry?.artifacts;
    if (
      !isSafeRelativePath(packagePath) ||
      !artifacts ||
      typeof artifacts !== 'object' ||
      Array.isArray(artifacts)
    ) {
      missing.push(
        `${packageEntry?.componentKey || 'unknown'}:invalid-package`
      );
      continue;
    }
    for (const artifactName of Object.values(artifacts)) {
      artifactCount += 1;
      if (!isSafeRelativePath(artifactName)) {
        missing.push(`${packagePath}/${artifactName}`);
        continue;
      }
      const artifactPath = path.resolve(jsonRoot, packagePath, artifactName);
      const artifactStat = fs.statSync(artifactPath, { throwIfNoEntry: false });
      if (
        !artifactPath.startsWith(`${path.resolve(jsonRoot)}${path.sep}`) ||
        !artifactStat?.isFile()
      ) {
        missing.push(path.join(packagePath, artifactName));
      }
    }
  }
  if (missing.length) {
    const err = new Error(
      `Apollo knowledge package is missing ${missing.length} contract artifacts.`
    );
    err.status = 503;
    err.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
    err.details = { missing: missing.slice(0, 20) };
    throw err;
  }

  const packageManifestPath = path.join(
    jsonRoot,
    'apollo',
    'contract-knowledge-manifest.json'
  );
  const packageManifest = fs.existsSync(packageManifestPath)
    ? JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'))
    : null;
  const result = {
    ready: true,
    schemaVersion: index.schemaVersion,
    packageCount: index.packages.length,
    artifactCount,
    checksum:
      typeof packageManifest?.checksum === 'string'
        ? packageManifest.checksum
        : null,
  };
  contractKnowledgeCache = {
    indexPath,
    indexMtimeMs: indexStat.mtimeMs,
    result,
  };
  return result;
}

function inspectDsAiHubKnowledge() {
  const rootStat = fs.statSync(CODEX_DS_AI_HUB, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory()) {
    const err = new Error(
      `ds-ai-hub knowledge root is missing: ${CODEX_DS_AI_HUB}`
    );
    err.status = 503;
    err.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
    throw err;
  }
  if (
    dsAiHubKnowledgeCache &&
    dsAiHubKnowledgeCache.componentsRoot === CODEX_DS_AI_HUB &&
    dsAiHubKnowledgeCache.rootMtimeMs === rootStat.mtimeMs
  ) {
    return dsAiHubKnowledgeCache.result;
  }

  const packages = listDsAiHubComponentPackages(CODEX_DS_AI_HUB);
  let artifactCount = 0;
  for (const packageEntry of packages) {
    const packageRoot = path.join(CODEX_DS_AI_HUB, packageEntry.packagePath);
    artifactCount += fs
      .readdirSync(packageRoot, { withFileTypes: true })
      .filter((item) => item.isFile()).length;
  }
  if (!packages.length) {
    const err = new Error(
      'ds-ai-hub knowledge package contains no Figma key indexes.'
    );
    err.status = 503;
    err.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
    throw err;
  }

  const result = {
    ready: true,
    schemaVersion: 1,
    packageCount: packages.length,
    artifactCount,
    checksum: null,
  };
  dsAiHubKnowledgeCache = {
    componentsRoot: CODEX_DS_AI_HUB,
    rootMtimeMs: rootStat.mtimeMs,
    result,
  };
  return result;
}

function inspectActiveApolloKnowledge() {
  assertSelectedKnowledgeRoots();
  const inspected =
    APOLLO_CODEX_KNOWLEDGE_SOURCE === 'ds-ai-hub'
      ? inspectDsAiHubKnowledge()
      : inspectApolloContractKnowledge();
  return {
    ...inspected,
    contentVersion: APOLLO_KNOWLEDGE_RELEASE.contentVersion,
    sourceCommits: APOLLO_KNOWLEDGE_RELEASE.sourceCommits,
  };
}

function assertCodexRuntimeReady() {
  assertLocalAgent(CLI_PROVIDER);
  assertSelectedKnowledgeRoots();
  const requiredDirectories = [
    ['CODEX_WORKSPACE', CODEX_WORKSPACE],
    ['CODEX_DS_AI_HUB', CODEX_DS_AI_HUB],
    ['CODEX_DESIGN_SYSTEM', CODEX_DESIGN_SYSTEM],
  ];
  for (const [name, directory] of requiredDirectories) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      const err = new Error(`${name} directory does not exist: ${directory}`);
      err.status = 503;
      throw err;
    }
  }
  for (const outputSchema of [
    CODEX_OUTPUT_SCHEMA,
    CODEX_PATTERN_OUTPUT_SCHEMA,
  ]) {
    if (!fs.existsSync(outputSchema)) {
      const err = new Error(`Codex output schema is missing: ${outputSchema}`);
      err.status = 503;
      throw err;
    }
  }
  if (path.isAbsolute(CLI_AGENT_BIN) && !fs.existsSync(CLI_AGENT_BIN)) {
    const err = new Error(
      `${CLI_PROVIDER} CLI does not exist: ${CLI_AGENT_BIN}`
    );
    err.status = 503;
    throw err;
  }
  return {
    skill: inspectApolloCodexSkill(),
    knowledge: inspectActiveApolloKnowledge(),
  };
}

async function callApolloAgent(payload, signal) {
  if (!APOLLO_AGENT_URL) {
    const err = new Error(
      'APOLLO_AGENT_URL is not configured. Use /v1/validate/codex or set the Langflow endpoint.'
    );
    err.status = 503;
    throw err;
  }

  const inputValuePayload =
    typeof payload === 'string' ? payload : payload.text;
  const inputValue =
    typeof inputValuePayload === 'string'
      ? inputValuePayload
      : JSON.stringify(inputValuePayload);
  const sessionId =
    payload && typeof payload.session_id === 'string' && payload.session_id
      ? payload.session_id
      : crypto.randomUUID();
  const body = {
    input_value: inputValue,
    input_type: 'chat',
    output_type: 'chat',
    session_id: sessionId,
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  if (APOLLO_AGENT_KEY) {
    headers.Authorization = `Bearer ${APOLLO_AGENT_KEY}`;
    headers['x-api-key'] = APOLLO_AGENT_KEY;
  }

  let response;
  try {
    response = await fetch(APOLLO_AGENT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Запрос AlfaGen отменён или превышено время ожидания.'), {status: signal.reason?.name === 'TimeoutError' ? 504 : 499});
    const err = new Error('Не удалось подключиться к AlfaGen. Проверьте адрес и доступ к корпоративной сети.');
    err.details = {
      message: error?.message || null,
      cause: error?.cause?.message || null,
      code: error?.cause?.code || null,
    };
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    let details;
    try {
      details = text ? JSON.parse(text) : null;
    } catch {
      details = { raw: text };
    }

    const err = new Error(`AlfaGen HTTP ${response.status}`);
    err.status = response.status;
    err.details = details;
    throw err;
  }

  if (looksLikeHtml(text) || /\btext\/html\b/i.test(contentType)) {
    throw buildHtmlResponseError(contentType, text);
  }

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error(
      'Apollo agent returned non-JSON response. Check APOLLO_AGENT_URL and API compatibility.'
    );
    err.details = {
      contentType: contentType || null,
      preview: text.slice(0, 240),
    };
    throw err;
  }

  return json;
}

async function callApolloAgentForFinalText(payload, signal) {
  let currentPayload = payload;
  let lastResult = '';

  for (let attempt = 1; attempt <= APOLLO_AGENT_MAX_ATTEMPTS; attempt += 1) {
    const data = await callApolloAgent(currentPayload, signal);
    if (!collectTextCandidates(data).some(value => value.trim())) {
      throw Object.assign(new Error('AlfaGen вернул пустой ответ.'), {status: 502});
    }
    const result = extractLangflowText(data);

    if (!looksLikeToolCallOnly(result)) {
      return result;
    }

    lastResult = result;
    if (attempt < APOLLO_AGENT_MAX_ATTEMPTS) {
      currentPayload = buildToolCallRetryPayload(payload, result);
    }
  }

  throw buildToolCallResponseError(lastResult, APOLLO_AGENT_MAX_ATTEMPTS);
}

async function callCodexContractExplanation(
  prompt,
  schema,
  requestTelemetry = {}
) {
  assertLocalAgent(CLI_PROVIDER);
  if (activeCodexRuns >= 1) {
    const error = new Error('AI-агент уже обрабатывает другой запрос Apollo.');
    error.status = 429;
    throw error;
  }
  if (path.isAbsolute(CLI_AGENT_BIN) && !fs.existsSync(CLI_AGENT_BIN)) {
    const error = new Error(`${CLI_PROVIDER} недоступен в ApolloProxyControl.`);
    error.status = 503;
    throw error;
  }
  activeCodexRuns++;
  let directory,
    originalFailure = null;
  const usageEvents = [],
    usageStartedAt = Date.now();
  const agentSession=CLI_PROVIDER==='codex'?requestTelemetry.agentSession:null;
  try {
    directory = agentSession?.directory || await fsp.mkdtemp(
      path.join(os.tmpdir(), 'apollo-contract-v4-')
    );
    if(agentSession)agentSession.directory=directory;
    const output = path.join(directory, 'explanation.json'),
      schemaPath = path.join(directory, 'schema.json');
    if(agentSession)await fsp.rm(output,{force:true});
    await fsp.writeFile(schemaPath, JSON.stringify(schema));
    requestTelemetry.onProgress?.({kind:'request-prepared',provider:CLI_PROVIDER,requestedModel:AGENT_MODEL||null,cliRunId:path.basename(directory)});
    const args = [
      'exec',
      '--sandbox',
      'read-only',
      '--cd',
      directory,
    ];
    if(agentSession?.threadId)args.push('resume',agentSession.threadId);
    else if(!agentSession)args.push('--ephemeral');
    args.push(
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--json',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      output,
    );
    if (requestTelemetry.dataOnly) for (const setting of ['features.shell_tool=false','features.apps=false','features.plugins=false','features.remote_plugin=false','features.multi_agent=false','web_search="disabled"','mcp_servers={}']) args.push('-c',setting);
    if (AGENT_MODEL) args.push('--model', AGENT_MODEL);
    args.push('-');
    let threadId=agentSession?.threadId;
    const result=await runCodexProcess(
      args,
      prompt,
      output,
      () => requestTelemetry.onProgress?.({kind:'agent-output'}),
      'analyzing_layout',
      {
        mode: 'contract-v4-explanation',
        model: AGENT_MODEL || null,
        workingDirectory: directory,
        runtimeBudgetMs: requestTelemetry.runtimeBudgetMs,
        signal: requestTelemetry.signal,
        onEvent: (event) => {
          if(event.type==='thread.started' && typeof event.thread_id==='string' && /^[a-f0-9-]{36}$/i.test(event.thread_id))threadId=event.thread_id;
          if (event.type === 'turn.completed') usageEvents.push(event);
          const kind={'thread.started':'thread-started','turn.started':'turn-started','item.completed':'agent-output'}[event.type];
          if(kind)requestTelemetry.onProgress?.({kind});
          const message=typeof event.message==='string'?event.message:typeof event.error?.message==='string'?event.error.message:'';
          if(/workspace routing discovery timed out/i.test(message))requestTelemetry.onProgress?.({kind:'retry',code:'WORKSPACE_ROUTING_TIMEOUT'});
          if(/falling back to HTTPS/i.test(message))requestTelemetry.onProgress?.({kind:'transport-fallback',code:'TRANSPORT_FALLBACK'});
        },
      }
    );
    if(agentSession){
      if(!threadId || agentSession.threadId && agentSession.threadId!==threadId)throw Object.assign(Error('LAYER_NAMES_SESSION_UNAVAILABLE'),{code:'LAYER_NAMES_SESSION_UNAVAILABLE',status:502});
      agentSession.threadId=threadId;
    }
    return result;
  } catch (error) {
    originalFailure = error;
    if (directory)
      await writeCodexDebugArtifact(
        path.basename(directory),
        'process-error.json',
        {
          mode: 'contract-v4-explanation',
          code: error.code || null,
          status: error.status || null,
          message: error.message || String(error),
          details: error.details || null,
        }
      );
    throw error;
  } finally {
    activeCodexRuns = Math.max(0, activeCodexRuns - 1);
    if (directory && !agentSession) await fsp.rm(directory, { recursive: true, force: true });
    if (requestTelemetry.requestId) {
      const usageApi = require('./src/generation-agent/usage'),
        usage = usageApi.measurement({
          prompt,
          schema,
          events: usageEvents,
          durationMs: Date.now() - usageStartedAt,
          requestId: requestTelemetry.requestId,
          runId: null,
          stage: 'planner',
          attempt: requestTelemetry.attempt || 1,
          method: requestTelemetry.generationMethod || null,
        });
      usage.requestedModel = AGENT_MODEL || null;
      usage.provider = CLI_PROVIDER;
      usage.promptSha256 = crypto
        .createHash('sha256')
        .update(prompt)
        .digest('hex');
      usage.schemaSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify(schema))
        .digest('hex');
      usage.outcome = originalFailure ? 'cli-failed' : 'cli-returned';
      usage.failureCode = originalFailure?.code || null;
      try {
        const configFile =
            requestTelemetry.target === 'frontend'
              ? process.env.APOLLO_AGENT_MVP_CONFIG
              : process.env.APOLLO_AGENT_FIGMA_CONFIG,
          config = configFile
            ? JSON.parse(await fsp.readFile(configFile, 'utf8'))
            : null;
        usageApi.persistMeasurement(
          config?.hostRoot ? path.join(config.hostRoot, 'request-usage') : null,
          usage,
          usageEvents,
          { prompt, schema, requestId: requestTelemetry.requestId }
        );
      } catch (error) {
        if (originalFailure)
          originalFailure.telemetryFailure = 'AGENT_USAGE_PERSISTENCE_FAILED';
        else
          throw Object.assign(Error('AGENT_USAGE_PERSISTENCE_FAILED'), {
            code: 'AGENT_USAGE_PERSISTENCE_FAILED',
          });
      }
    }
  }
}

async function callCodexDialogue(inputValue) {
  const question = extractDialogueQuestion(inputValue);
  if (!question) {
    const err = new Error('Codex dialogue requires a non-empty question.');
    err.status = 400;
    throw err;
  }
  if (activeCodexRuns >= 1) {
    const err = new Error('AI-агент уже обрабатывает другой запрос Apollo.');
    err.status = 429;
    throw err;
  }

  // Dialogue reads Proxy-owned knowledge in its disposable request directory.
  // Validator workspace, skills and output schemas are not used by this route.
  inspectActiveApolloKnowledge();
  if (path.isAbsolute(CLI_AGENT_BIN) && !fs.existsSync(CLI_AGENT_BIN)) {
    const error = new Error(
      `${CLI_PROVIDER} CLI does not exist: ${CLI_AGENT_BIN}`
    );
    error.status = 503;
    throw error;
  }
  const runDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'apollo-codex-dialogue-')
  );
  const outputPath = path.join(runDirectory, 'response.md');
  const knowledgeRoot =
    APOLLO_CODEX_KNOWLEDGE_SOURCE === 'design-system_ab'
      ? CODEX_DESIGN_SYSTEM
      : CODEX_DS_AI_HUB;
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--cd',
    runDirectory,
    '--add-dir',
    knowledgeRoot,
    '--output-last-message',
    outputPath,
  ];
  if (AGENT_MODEL) args.push('--model', AGENT_MODEL);
  args.push('-');
  const prompt = buildCodexDialoguePrompt(
    question,
    inputValue.dialogue,
    APOLLO_CODEX_KNOWLEDGE_SOURCE
  );

  activeCodexRuns += 1;
  try {
    const result = await runCodexProcess(
      args,
      prompt,
      outputPath,
      null,
      'reading_design_system',
      {
        mode: 'dialogue',
        model: AGENT_MODEL || null,
        workingDirectory: runDirectory,
      },
      'text'
    );
    console.info('[Apollo][codex] dialogue completed', {
      knowledgeSource: APOLLO_CODEX_KNOWLEDGE_SOURCE,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
      responseChars: result.length,
    });
    return result;
  } finally {
    activeCodexRuns = Math.max(0, activeCodexRuns - 1);
    await fsp.rm(runDirectory, { recursive: true, force: true });
  }
}

async function writeCodexDebugArtifact(
  runId,
  fileName,
  value,
  debugRoot = APOLLO_CODEX_DEBUG_ROOT
) {
  if (!APOLLO_CODEX_DEBUG_ENABLED) return null;
  if (typeof runId !== 'string' || !runId.trim()) return null;
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const safeFileName = path.basename(fileName);
  const directory = path.join(debugRoot, safeRunId);
  const filePath = path.join(directory, safeFileName);
  try {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return filePath;
  } catch (error) {
    console.warn('[Apollo][codex] failed to persist debug artifact', {
      runId,
      fileName: safeFileName,
      message: error?.message || String(error),
    });
    return null;
  }
}

function shouldPersistCodexDebugArtifacts(mode) {
  return (
    APOLLO_CODEX_DEBUG_ENABLED &&
    ['pattern-report', 'text-report'].includes(mode)
  );
}

function buildCodexInputMetrics(prompt, requestDocument) {
  const sectionChars = {};
  if (requestDocument && typeof requestDocument === 'object') {
    for (const [key, value] of Object.entries(requestDocument)) {
      sectionChars[key] = JSON.stringify(value).length;
    }
    const evidenceBundle = requestDocument?.architectureAudit?.evidenceBundle;
    if (evidenceBundle && typeof evidenceBundle === 'object') {
      sectionChars['architectureAudit.evidenceBundle'] =
        JSON.stringify(evidenceBundle).length;
      sectionChars['architectureAudit.evidenceBundle.graph'] = JSON.stringify(
        evidenceBundle.graph || null
      ).length;
    }
  }
  return {
    promptChars: prompt.length,
    promptBytes: Buffer.byteLength(prompt, 'utf8'),
    warningThresholdChars: APOLLO_CODEX_INPUT_WARN_CHARS,
    budgetChars: APOLLO_CODEX_INPUT_BUDGET_CHARS,
    warning: prompt.length >= APOLLO_CODEX_INPUT_WARN_CHARS,
    withinBudget: prompt.length <= APOLLO_CODEX_INPUT_BUDGET_CHARS,
    sectionChars,
  };
}

function assertCodexInputWithinBudget(metrics) {
  if (metrics.withinBudget) return;
  const error = new Error(
    `Apollo Codex input requires ${metrics.promptChars} characters, exceeding the safe budget of ${metrics.budgetChars}.`
  );
  error.status = 413;
  error.code = 'CODEX_INPUT_BUDGET_EXCEEDED';
  error.details = metrics;
  throw error;
}

async function callCodexValidator(payload, onProgress, options = {}) {
  const pilot = progressBarPilot.isProgressBarPilot(payload), pilotUsageEvents = [], pilotStarted = Date.now();
  emitCodexProgress(onProgress, 'checking_skill');
  const runtimeManifest = assertCodexRuntimeReady();
  const skillManifest = runtimeManifest.skill;
  const mode = isTextReportPayload(payload)
    ? 'text-report'
    : isPatternReportPayload(payload)
    ? 'pattern-report'
    : isCustomizationReportPayload(payload)
    ? 'customization-report'
    : payload.mode === 'question'
    ? 'question'
    : 'validation';
  const debugRunId =
    typeof options.runId === 'string' && options.runId
      ? options.runId
      : `direct_${crypto.randomUUID()}`;
  const persistDebug = shouldPersistCodexDebugArtifacts(mode);
  console.info('[Apollo][audit] knowledge release pinned', {
    auditId: debugRunId,
    mode,
    knowledgeSource: APOLLO_CODEX_KNOWLEDGE_SOURCE,
    knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
  });
  const runDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'apollo-codex-')
  );
  try {
    if (persistDebug) {
      await writeCodexDebugArtifact(debugRunId, '00-run.json', {
        runId: debugRunId,
        createdAt: new Date().toISOString(),
        mode,
        reportStrategy: APOLLO_CODEX_REPORT_STRATEGY,
        patternPacketMode: APOLLO_CODEX_PATTERN_PACKET_MODE,
        patternAuditMode: APOLLO_CODEX_PATTERN_AUDIT_MODE,
        patternPassBudgetChars: APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS,
        patternReasoningEffort: APOLLO_CODEX_PATTERN_REASONING_EFFORT,
        knowledgeSource: APOLLO_CODEX_KNOWLEDGE_SOURCE,
        knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
        sourceReportId: payload?.report?.reportId || null,
      });
      await writeCodexDebugArtifact(
        debugRunId,
        '01-input-report.json',
        payload?.report || null
      );
    }
    const prepared = await prepareCodexRequest(
      payload,
      runDirectory,
      runtimeManifest,
      onProgress
    );
    const pilotKnowledge = { designSystemRoot: CODEX_DESIGN_SYSTEM, hubRoot: CODEX_DS_AI_HUB, knowledgeRelease: runtimeManifest.knowledge };
    if (pilot && !prepared.requestDocument.subjects.length) {
      await progressBarPilot.assertSourceCurrent(prepared.requestDocument, pilotKnowledge);
      return progressBarPilot.validatePilotResponse({ schemaVersion: progressBarPilot.resultSchemaFor(prepared.requestDocument), reportId: payload.report.reportId,
        captureId: payload.report.capture.captureId, sourcePin: prepared.requestDocument.sourcePin, assessments: [] }, prepared.requestDocument);
    }
    if (persistDebug) {
      await writeCodexDebugArtifact(
        debugRunId,
        '02-resolved-packet.json',
        prepared.requestDocument
      );
      if (prepared.debugRequestDocument) {
        await writeCodexDebugArtifact(
          debugRunId,
          '02-resolved-packet.full.json',
          prepared.debugRequestDocument
        );
      }
    }
    const packetMode = pilot || (
      ['customization-report', 'pattern-report', 'text-report'].includes(
        mode
      ) && APOLLO_CODEX_REPORT_STRATEGY === 'packet');
    const requestDocuments =
      mode === 'pattern-report'
        ? buildPatternAuditPassPackets(prepared.requestDocument)
        : [prepared.requestDocument];
    const passResults = [];
    emitCodexProgress(onProgress, 'starting_agent');

    for (
      let passIndex = 0;
      passIndex < requestDocuments.length;
      passIndex += 1
    ) {
      const requestDocument = requestDocuments[passIndex];
      const passId = requestDocument?.auditPass?.id || 'single';
      const outputPath = path.join(
        runDirectory,
        `result-${passIndex + 1}.json`
      );
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--cd',
        pilot ? runDirectory : CODEX_WORKSPACE,
      ];
      if (pilot && CLI_PROVIDER === 'codex') args.push('--config', 'features.shell_tool=false');
      if (mode === 'pattern-report') {
        args.push(
          '--config',
          `model_reasoning_effort="${APOLLO_CODEX_PATTERN_REASONING_EFFORT}"`
        );
      }
      if (!packetMode) {
        args.push(
          '--add-dir',
          CODEX_DS_AI_HUB,
          '--add-dir',
          CODEX_DESIGN_SYSTEM
        );
      }
      const outputSchema =
        pilot ? path.join(__dirname, 'src/reports', progressBarPilot.schemaFileFor(requestDocument)) : mode === 'pattern-report' &&
        requestDocument?.transport?.mode === 'semantic-v1'
          ? CODEX_PATTERN_OUTPUT_SCHEMA
          : CODEX_OUTPUT_SCHEMA;
      args.push(
        '--output-schema',
        outputSchema,
        '--output-last-message',
        outputPath
      );
      if (AGENT_MODEL) args.push('--model', AGENT_MODEL);
      for (const imagePath of prepared.imagePaths) {
        args.push('--image', imagePath);
      }
      args.push('-');

      const prompt = buildCodexPrompt(
        prepared.requestPath,
        mode,
        skillManifest,
        runtimeManifest.knowledge,
        ['customization-report', 'pattern-report', 'text-report'].includes(mode)
          ? APOLLO_CODEX_REPORT_STRATEGY
          : 'skill',
        requestDocument
      );
      const inputMetrics = buildCodexInputMetrics(prompt, requestDocument);
      console.info('[Apollo][codex] input budget', {
        runId: debugRunId,
        mode,
        passId,
        passIndex: passIndex + 1,
        passCount: requestDocuments.length,
        targetCount: requestDocument?.auditPass?.targets?.length || null,
        promptChars: inputMetrics.promptChars,
        promptBytes: inputMetrics.promptBytes,
        budgetChars: inputMetrics.budgetChars,
        warning: inputMetrics.warning,
        patternPacketMode:
          mode === 'pattern-report' ? APOLLO_CODEX_PATTERN_PACKET_MODE : null,
        patternAuditMode:
          mode === 'pattern-report' ? APOLLO_CODEX_PATTERN_AUDIT_MODE : null,
        reasoningEffort:
          mode === 'pattern-report'
            ? APOLLO_CODEX_PATTERN_REASONING_EFFORT
            : null,
        responseProtocol:
          mode === 'pattern-report' &&
          requestDocument?.transport?.mode === 'semantic-v1'
            ? 'compact-assessment-v1'
            : 'full-audit-v1',
        evidenceChars:
          inputMetrics.sectionChars['architectureAudit.evidenceBundle'] || 0,
        semanticModelChars: inputMetrics.sectionChars.semanticModel || 0,
      });
      if (persistDebug) {
        await writeCodexDebugArtifact(
          debugRunId,
          `02-pass-${passIndex + 1}-${passId}.json`,
          requestDocument
        );
        await writeCodexDebugArtifact(
          debugRunId,
          `02-pass-${passIndex + 1}-${passId}.metrics.json`,
          inputMetrics
        );
      }
      assertCodexInputWithinBudget(inputMetrics);
      const analysisStage = requestDocument?.auditPass
        ? PATTERN_AUDIT_PASS_DEFINITIONS.find(
            (definition) => definition.id === passId
          )?.progressStage || 'analyzing_patterns'
        : mode === 'pattern-report'
        ? 'analyzing_patterns'
        : mode === 'text-report'
        ? 'analyzing_texts'
        : mode === 'customization-report'
        ? 'analyzing_report'
        : 'analyzing_layout';
      const passResult = await runCodexProcess(
        args,
        prompt,
        outputPath,
        onProgress,
        analysisStage,
        {
          runId: debugRunId,
          mode,
          passId,
          model: AGENT_MODEL || null,
          reasoningEffort:
            mode === 'pattern-report'
              ? APOLLO_CODEX_PATTERN_REASONING_EFFORT
              : null,
          runtimeBudgetMs: pilot ? 120000 : undefined,
          workingDirectory: pilot ? runDirectory : undefined,
          onEvent: pilot ? event => { if (pilotUsageEvents.length < 2000) pilotUsageEvents.push(event); } : undefined,
        }
      );
      passResults.push({ pass: requestDocument, result: passResult });
      if (persistDebug) {
        await writeCodexDebugArtifact(
          debugRunId,
          `03-pass-${passIndex + 1}-${passId}.response.json`,
          passResult
        );
      }
    }
    const result =
      mode === 'pattern-report' && requestDocuments.length > 1
        ? mergeCompactPatternAssessmentResponses(
            passResults,
            prepared.requestDocument
          )
        : passResults[0].result;
    console.info('[Apollo][codex] response size', {
      runId: debugRunId,
      mode,
      protocol: isCompactPatternAssessmentResponse(result)
        ? 'compact-assessment-v1'
        : 'full-audit-v1',
      chars: JSON.stringify(result).length,
      itemCount: Array.isArray(result?.assessments)
        ? result.assessments.length
        : Array.isArray(result?.findings)
        ? result.findings.length
        : 0,
    });
    if (persistDebug) {
      await writeCodexDebugArtifact(
        debugRunId,
        '03-agent-response.raw.json',
        result
      );
    }
    emitCodexProgress(onProgress, 'finalizing');
    if (pilot) {
      await progressBarPilot.assertSourceCurrent(prepared.requestDocument, pilotKnowledge);
      const validated = progressBarPilot.validatePilotResponse(result, prepared.requestDocument);
      const usage = require('./src/generation-agent/usage').usageFromEvents(pilotUsageEvents);
      if (CLI_PROVIDER === 'codex' && usage.cliTurns > 1) {
        for (const key of ['actualInputTokens','actualOutputTokens','cachedInputSubsetTokens','reasoningOutputSubsetTokens']) usage[key] = null;
        usage.actualUsageReason = 'Multiple Codex usage events may be cumulative; raw events retained, totals unknown.';
      }
      validated.usage = Object.assign({}, usage, { provider: CLI_PROVIDER, requestedModel: AGENT_MODEL || null,
        durationMs: Date.now() - pilotStarted, calls: requestDocuments.length });
      if (persistDebug) await writeCodexDebugArtifact(debugRunId, '04-agent-response.normalized.json', validated);
      return validated;
    }
    const normalized = normalizeCodexValidation(
      result,
      payload,
      skillManifest,
      prepared.requestDocument
    );
    const verified = await verifyCodexEvidence(normalized);
    if (persistDebug) {
      await writeCodexDebugArtifact(
        debugRunId,
        '04-agent-response.normalized.json',
        verified
      );
    }
    return {
      ...verified,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    };
  } catch (error) {
    if (persistDebug) {
      await writeCodexDebugArtifact(debugRunId, '99-error.json', {
        runId: debugRunId,
        at: new Date().toISOString(),
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || String(error),
        details: error?.details || null,
      });
    }
    throw error;
  } finally {
    await fsp.rm(runDirectory, { recursive: true, force: true });
  }
}

function createCodexRun(payload) {
  const id = `run_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const run = {
    id,
    status: 'queued',
    stage: 'queued',
    progress: CODEX_PROGRESS_STAGES.queued.progress,
    message: CODEX_PROGRESS_STAGES.queued.message,
    createdAt: now,
    updatedAt: now,
    events: [],
    validation: null,
    error: null,
    knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
  };
  codexRuns.set(id, run);
  appendCodexRunProgress(run, CODEX_PROGRESS_STAGES.queued);
  activeCodexRuns += 1;

  Promise.resolve()
    .then(() => tokenJournal.operation('Проверить · AI', async () => {
      run.status = 'running';
      const validation = await callCodexValidator(
        payload,
        (progressEvent) => {
          appendCodexRunProgress(run, progressEvent);
        },
        { runId: id }
      );
      run.status = 'completed';
      run.validation = validation;
      appendCodexRunProgress(run, {
        stage: 'completed',
        progress: CODEX_PROGRESS_STAGES.completed.progress,
        message: CODEX_PROGRESS_STAGES.completed.message,
      });
    }))
    .catch((error) => {
      run.status = 'failed';
      run.error = {
        message: error?.message || 'Codex validation error',
        status: error?.status || 500,
        code: error?.code || null,
        details: error?.details || null,
      };
      run.updatedAt = new Date().toISOString();
      console.error('[Apollo][codex] run failed', {
        runId: id,
        code: run.error.code,
        status: run.error.status,
        message: run.error.message,
        details: run.error.details,
      });
    })
    .finally(() => {
      activeCodexRuns = Math.max(0, activeCodexRuns - 1);
      const cleanupTimer = setTimeout(
        () => codexRuns.delete(id),
        CODEX_RUN_TTL_MS
      );
      cleanupTimer.unref?.();
    });

  return publicCodexRun(run);
}

function appendCodexRunProgress(run, event) {
  if (!run || !event) return;
  if (run.stage === event.stage && run.message === event.message) return;
  const at = new Date().toISOString();
  run.stage = event.stage || run.stage;
  run.progress = Number.isFinite(event.progress)
    ? Math.max(run.progress, event.progress)
    : run.progress;
  run.message = event.message || run.message;
  run.updatedAt = at;
  run.events.push({
    sequence: run.events.length + 1,
    stage: run.stage,
    progress: run.progress,
    message: run.message,
    at,
  });
  const elapsedMs = Math.max(
    0,
    Date.parse(at) - Date.parse(run.createdAt || at)
  );
  console.info('[Apollo][codex] run progress', {
    runId: run.id,
    stage: run.stage,
    progress: run.progress,
    elapsedMs,
    message: run.message,
  });
  if (run.events.length > 50) run.events.splice(0, run.events.length - 50);
}

function publicCodexRun(run) {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    progress: run.progress,
    message: run.message,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    events: run.events,
    validation: run.status === 'completed' ? run.validation : null,
    error: run.status === 'failed' ? run.error : null,
    knowledgeRelease: run.knowledgeRelease,
  };
}

app.get('/health', async (req, res) => {
  const asyncGenerationBusy = (await Promise.all([landingRuntime].map(runtime => runtime?.isBusy() || false))).some(Boolean);
  let skill;
  let knowledge;
  try {
    const manifest = inspectApolloCodexSkill();
    skill = {
      ready: true,
      name: manifest.name,
      version: manifest.version,
      checksum: manifest.checksum,
    };
  } catch (error) {
    skill = {
      ready: false,
      name: APOLLO_CODEX_SKILL_NAME,
      version: null,
      checksum: null,
      error: error?.code || 'CODEX_SKILL_INVALID',
    };
  }
  try {
    knowledge = inspectActiveApolloKnowledge();
  } catch (error) {
    knowledge = {
      ready: false,
      schemaVersion: null,
      packageCount: 0,
      artifactCount: 0,
      checksum: null,
      error: error?.code || 'CODEX_KNOWLEDGE_INCOMPLETE',
    };
  }
  res.json({
    ok: true,
    activeRequests: activeApiRequests,
    knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    proxy: {
      name: 'apollo-proxy',
      version: APOLLO_PROXY_VERSION,
      codeVersion: process.env.APOLLO_CODE_VERSION || null,
      codeId: process.env.APOLLO_CODE_RELEASE_ID || null,
      codeSupervisorPid: Number(process.env.APOLLO_CODE_SUPERVISOR_PID) || null,
    },
    agent: {
      provider: CLI_PROVIDER,
      model: AGENT_MODEL || null,
      configured: Boolean(CLI_PROVIDER === 'alfagen' ? APOLLO_AGENT_URL : CLI_AGENT_BIN),
      busy: activeCodexRuns > 0 || activeGenerationCodexRuns > 0 || asyncGenerationBusy || Boolean(namingRuns?.busy()),
    },
    codex: {
      provider: CLI_PROVIDER,
      model: AGENT_MODEL || null,
      configured: Boolean(CLI_AGENT_BIN),
      busy: activeCodexRuns > 0 || Boolean(namingRuns?.busy()),
      reportStrategy: APOLLO_CODEX_REPORT_STRATEGY,
      knowledgeSource: APOLLO_CODEX_KNOWLEDGE_SOURCE,
      skill,
      knowledge,
    },
    generation: {
      provider: CLI_PROVIDER,
      model: AGENT_MODEL || null,
      configured: Boolean(CLI_AGENT_BIN),
      busy: activeGenerationCodexRuns > 0 || asyncGenerationBusy,
      semanticSource: 'ds-ai-hub',
      technicalSource: 'design-system_ab',
      context: inspectSemanticIndex(CODEX_DS_AI_HUB),
    },
  });
});

mountContractRoutes(app, { explain: callCodexContractExplanation });
namingRuns=require('./src/skills/layer-names').mountLayerNameRoutes(app,{
  assertCapability:()=>assertLocalAgent(CLI_PROVIDER),
  disposeSession:session=>{
    if(session?.directory){const directory=session.directory;session.directory=null;void fsp.rm(directory,{recursive:true,force:true}).catch(()=>{});}
  },
  plan:(prompt,schema,meta)=>tokenJournal.withinNamed('skill:'+meta.requestId,()=>callCodexContractExplanation(prompt,schema,meta)),
  maxRuntimeMs:Math.min(CODEX_MAX_RUNTIME_MS,900000),onTrace:event=>{
    console.info('[Apollo][skills]',event);
    const key='skill:'+event.requestId;
    if(event.event==='started')tokenJournal.startNamed(key,'Навык · Переименовать слои');
    if(['completed','failed','cancelled'].includes(event.event))tokenJournal.finishNamed(key,event.event);
  },
});
require('./src/landing/retired').mountRetiredGenerationRoutes(app);
const landingRuntime=require('./src/landing/runtime').mountConfiguredLandingRoutes(app,{provider:CLI_PROVIDER,binary:CLI_AGENT_BIN,model:AGENT_MODEL,environment:buildCodexEnvironment(),releaseRoot:process.env.APOLLO_RELEASE_ROOT,runtimeRoot:process.env.APOLLO_PROJECT_ROOT});
const styleTokenCatalogProvider=mountStyleTokenCatalogRoutes(app, {
  designSystemRoot: CODEX_DESIGN_SYSTEM,
  knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
});
require('./src/style-token-catalog/deprecated-styles').mountDeprecatedStyleRoutes(app, {
  designSystemRoot: CODEX_DESIGN_SYSTEM,
  getSnapshot: () => styleTokenCatalogProvider().snapshot,
});

app.post('/v1/validate/predicates', (req, res) => {
  try {
    const validation = evaluatePredicateReleaseRequest(req.body ?? {}, {
      designSystemRoot: CODEX_DESIGN_SYSTEM,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    });
    const evaluations = Array.isArray(validation?.result?.evaluations)
      ? validation.result.evaluations
      : [];
    console.log('[Apollo][predicate] validation completed', {
      auditId: validation?.snapshot?.auditId || null,
      nodeCount: validation?.snapshot?.nodeCount || 0,
      ruleCount: Array.isArray(validation?.rules) ? validation.rules.length : 0,
      evaluationCount: evaluations.length,
      findingCount: evaluations.filter(
        (item) => item?.classification === 'violation'
      ).length,
      repeatability: validation?.repeatability || null,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    });
    res.json({
      success: true,
      validation,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Predicate validation error',
      code: error.code || 'PREDICATE_VALIDATION_FAILED',
      details: error.details || null,
    });
  }
});

app.post('/v1/validate/codex', async (req, res) => {
  const payload = req.body ?? {};
  const validationError = validateCodexRequest(payload);
  if (validationError) {
    res.status(400).json({ success: false, error: validationError });
    return;
  }

  if (activeCodexRuns >= 1) {
    res.status(429).json({
      success: false,
      error: 'Codex is already processing another Apollo request.',
    });
    return;
  }

  activeCodexRuns += 1;
  try {
    const validation = await callCodexValidator(payload);
    res.json({
      success: true,
      validation,
      knowledgeRelease: APOLLO_KNOWLEDGE_RELEASE,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Codex validation error',
      code: err.code || null,
      details: err.details || null,
      status: err.status || null,
    });
  } finally {
    activeCodexRuns -= 1;
  }
});

app.post('/v1/validate/codex/runs', (req, res) => {
  const payload = req.body ?? {};
  const validationError = validateCodexRequest(payload);
  if (validationError) {
    res.status(400).json({ success: false, error: validationError });
    return;
  }

  if (activeCodexRuns >= 1) {
    res.status(429).json({
      success: false,
      error: 'Codex is already processing another Apollo request.',
    });
    return;
  }

  const run = createCodexRun(payload);
  res.status(202).json({ success: true, run });
});

app.post('/v1/analyze/codex/runs', (req, res) => {
  const payload = req.body ?? {};
  const validationError = validateCodexReportRequest(payload);
  if (validationError) {
    res.status(400).json({ success: false, error: validationError });
    return;
  }
  function begin() {
    if (activeCodexRuns >= 1) { res.status(429).json({ success: false, error: 'Codex is already processing another Apollo request.' }); return; }
    const run = createCodexRun(payload); res.status(202).json({ success: true, run });
  }
  if (progressBarPilot.isProgressBarPilot(payload)) {
    void Promise.resolve().then(async () => {
      const runtime = assertCodexRuntimeReady();
      const prepared = await progressBarPilot.preparePilot(payload, { designSystemRoot: CODEX_DESIGN_SYSTEM, hubRoot: CODEX_DS_AI_HUB, knowledgeRelease: runtime.knowledge });
      if (payload.report.phase === 'prepare') {
        res.json({ success: true, preparation: { pilot: prepared.transport.mode, reportId: prepared.reportId, captureId: prepared.captureId, sourcePin: prepared.sourcePin,
          requestedRuleIds: prepared.requestedRuleIds,
          knowledge: prepared.knowledge, subjects: prepared.subjects, sources: prepared.sources.map(({ sourceId, path, sha256 }) => ({ sourceId, path, sha256 })) } }); return;
      }
      begin();
    }).catch(error => res.status(error.status || 503).json({ success: false, error: error.message, code: error.code || 'PROGRESSBAR_PREPARATION_FAILED' }));
    return;
  }
  begin();
});

function respondWithCodexRun(req, res) {
  const run = codexRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ success: false, error: 'Codex run not found.' });
    return;
  }
  res.json({ success: true, run: publicCodexRun(run) });
}

app.get('/v1/validate/codex/runs/:runId', respondWithCodexRun);
app.get('/v1/analyze/codex/runs/:runId', respondWithCodexRun);

app.post('/analyze', async (req, res) => {
  try {
    const payload = req.body ?? {};
    const inputValue = normalizeInput(payload);

    if (!inputValue || !inputValue.text) {
      res.status(400).json({
        success: false,
        error:
          'Empty input. Send a string, { text: "..." }, or { report: {...} }.',
      });
      return;
    }

    // The historical codex wire alias follows the desktop agent selection.
    const provider = inputValue.source === 'codex' ? CLI_PROVIDER : 'alfagen';
    let result;
    if (provider === 'alfagen') {
      if (activeCodexRuns > 0) throw Object.assign(new Error('AI-агент уже обрабатывает другой запрос Apollo.'), {status: 429});
      activeCodexRuns++;
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', onClose);
      const tracked = tokenJournal.call({ provider: 'alfagen' });
      let failure;
      try { result = await callApolloAgentForFinalText(inputValue, AbortSignal.any([controller.signal, AbortSignal.timeout(CODEX_MAX_RUNTIME_MS)])); }
      catch (error) { failure = error; throw error; }
      finally { tracked.end(failure); activeCodexRuns--; res.removeListener('close', onClose); }
    } else {
      result = await callCodexDialogue(inputValue);
    }
    if (typeof result !== 'string' || !result.trim()) {
      throw Object.assign(new Error('AlfaGen вернул пустой ответ.'), {status: 502});
    }

    if (looksLikeHtml(result)) {
      throw buildHtmlResponseError('text/html', result);
    }

    res.json({
      success: true,
      result,
      source: inputValue.source,
      provider,
      model: provider === 'alfagen' ? null : AGENT_MODEL || null,
      knowledgeRelease: provider === 'alfagen' ? null : APOLLO_KNOWLEDGE_RELEASE,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Apollo agent error',
      details: err.details || null,
      status: err.status || null,
    });
  }
});

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    if(process.send && process.env.APOLLO_CODE_RELEASE_ID)process.send({type:'apollo-proxy-ready',id:process.env.APOLLO_CODE_RELEASE_ID,port:server.address().port},()=>{});
    console.log(`Apollo proxy running on http://${HOST}:${PORT}`);
    console.log(
      `Apollo Codex knowledge source: ${APOLLO_CODEX_KNOWLEDGE_SOURCE}`
    );
    console.log(
      `Apollo knowledge release: ${APOLLO_KNOWLEDGE_RELEASE.contentVersion} ` +
        `(design-system_ab=${
          APOLLO_KNOWLEDGE_RELEASE.sourceCommits['design-system_ab'] ||
          'unknown'
        }, ` +
        `ds-ai-hub=${
          APOLLO_KNOWLEDGE_RELEASE.sourceCommits['ds-ai-hub'] || 'unknown'
        })`
    );
    console.log(
      `Apollo Codex pattern packet: ${APOLLO_CODEX_PATTERN_PACKET_MODE}`
    );
    console.log(
      `Apollo Codex pattern reasoning: ${APOLLO_CODEX_PATTERN_REASONING_EFFORT}`
    );
    console.log(
      `Apollo Codex pattern audit: ${APOLLO_CODEX_PATTERN_AUDIT_MODE} (${APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS} chars/pass)`
    );
  });

  server.on('error', (error) => {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use on ${HOST}`);
        process.exit(1);
      }

      if (error.code === 'EPERM') {
        console.error(`Cannot listen on ${HOST}:${PORT} (${error.code})`);
        process.exit(1);
      }
    }

    console.error('Failed to start Apollo proxy:', error);
    process.exit(1);
  });
  return server;
}

if (require.main === module) {
  require('./src/data-release').retainRelease(process.env.APOLLO_RELEASE_ROOT).then(() => {
    const server = startServer();
    if (process.env.APOLLO_PROXY_MANAGED === '1') bindManagedProxyLifetime(server);
  }).catch(error => {
    console.error('[Apollo data] ' + (error.code || error.message));
    process.exit(1);
  });
}

module.exports = {
  APOLLO_CODEX_SKILL_REQUIRED_VERSION,
  app,
  adaptApolloSkillResponse,
  buildApolloPatternReportSkillRequest,
  buildApolloTextReportSkillRequest,
  buildApolloSkillRequest,
  buildApolloCustomizationReportSkillRequest,
  buildResolvedPatternAuditPacket,
  compactResolvedPatternAuditPacket,
  buildPatternAuditPassPackets,
  mergeCompactPatternAssessmentResponses,
  classifySemanticFact,
  classifySemanticRuleRequirements,
  buildSemanticRuleCoverage,
  semanticRelevantAggregateNodeIds,
  collectSemanticRuleComponentHints,
  semanticRuleMatchesComponentNames,
  buildResolvedTextAuditPacket,
  buildResolvedAuditPacket,
  buildApolloSemanticModel,
  hydrateReportComponentRuleAuthority,
  compactApolloPatternReport,
  compactApolloEvidenceBundle,
  compactApolloTextReport,
  compactApolloCustomizationReport,
  collectApolloReportComponentKeys,
  evaluatePredicateReleaseRequest,
  callCodexContractExplanation,
  buildCodexPrompt,
  buildCodexInputMetrics,
  assertCodexInputWithinBudget,
  buildCodexProcessExitError,
  buildCodexEnvironment,
  inspectApolloCodexSkill,
  inspectApolloContractKnowledge,
  isCodexAuthenticationFailure,
  mapCodexEventToProgressStage,
  normalizeAgentSource,
  normalizeDialogueHistory,
  extractDialogueQuestion,
  buildCodexDialoguePrompt,
  normalizeInput,
  normalizeCodexValidation,
  expandCompactPatternAssessmentResponse,
  parseCodexJsonEvent,
  validateApolloSkillResponse,
  verifyCodexEvidence,
  validateCodexRequest,
  validateCodexReportRequest,
  validateApolloEvidenceBundle,
  validateApolloSemanticModel,
  writeCodexDebugArtifact,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  adaptApolloSkillResponse,
  buildApolloSkillRequest,
  buildApolloPatternReportSkillRequest,
  buildApolloTextReportSkillRequest,
  buildApolloCustomizationReportSkillRequest,
  buildResolvedPatternAuditPacket,
  compactResolvedPatternAuditPacket,
  buildPatternAuditPassPackets,
  mergeCompactPatternAssessmentResponses,
  classifySemanticFact,
  classifySemanticRuleRequirements,
  buildSemanticRuleCoverage,
  buildResolvedTextAuditPacket,
  buildResolvedAuditPacket,
  buildApolloSemanticModel,
  hydrateReportComponentRuleAuthority,
  compactApolloPatternReport,
  compactApolloEvidenceBundle,
  compactApolloTextReport,
  compactApolloCustomizationReport,
  collectApolloReportComponentKeys,
  buildCodexPrompt,
  buildCodexInputMetrics,
  assertCodexInputWithinBudget,
  buildCodexProcessExitError,
  buildCodexEnvironment,
  inspectApolloCodexSkill,
  isCodexAuthenticationFailure,
  mapCodexEventToProgressStage,
  normalizeCodexValidation,
  expandCompactPatternAssessmentResponse,
  parseCodexJsonEvent,
  validateApolloSkillResponse,
  verifyCodexEvidence,
  validateCodexRequest,
  validateCodexReportRequest,
  validateApolloSemanticModel,
  writeCodexDebugArtifact,
} = require('../server');

// Integration cases read the canonical existing sources, independently of any
// local component-only projection or the developer's selected desktop release.
const packetSourceRoots = {
  designSystemRoot: path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT || path.join(__dirname, '../../../shared/design-system_ab')),
  dsAiHubRoot: path.resolve(process.env.DS_AI_HUB_ROOT || path.join(__dirname, '../../../ds-ai-hub')),
};

function skillManifest() {
  return inspectApolloCodexSkill();
}

function snapshotPayload() {
  return {
    mode: 'validation',
    snapshot: {
      schemaVersion: 2,
      runId: 'apollo-skill-test',
      generatedAt: '2026-08-13T00:00:00.000Z',
      figma: { fileKey: 'file-key', pageId: '0:1' },
      user: { id: 'user-1', name: 'Test Designer' },
      settings: { platform: 'Desktop' },
      selection: [{ nodeId: '1:2', name: 'Form', nodeType: 'FRAME' }],
      nodes: [{
        nodeId: '1:2',
        path: 'Form',
        type: 'FRAME',
        name: 'Form',
        visible: true,
      }],
      screenshots: [{
        nodeId: '1:2',
        mimeType: 'image/png',
        localPath: '/tmp/selection.png',
        dataBase64: null,
        pixelWidth: 100,
        pixelHeight: 100,
      }],
    },
    question: null,
    previousValidation: null,
    dialogue: [],
  };
}

function reportPayload() {
  return {
    report: {
      schemaVersion: 1,
      reportKind: 'apollo-customizations-wip-report',
      reportId: 'apollo-v3-report-test:customizations-wip',
      generatedAt: '2026-08-14T00:00:00.000Z',
      user: { id: 'user-1', name: 'Test Designer' },
      figma: { fileKey: 'file-key', fileName: 'Test', editorType: 'figma' },
      scan: {
        channel: 'Desktop',
        selection: [{ nodeId: '1:2', name: 'Group', nodeType: 'SECTION' }],
      },
      summary: { scannedComponents: 43, componentCount: 1, changeCount: 1 },
      category: {
        id: 'customizationsWip',
        title: 'Кастомизации [WIP]',
        items: [{
          node: { id: '1:2', name: 'ButtonGroup', visible: true },
          component: { key: 'component-key', name: 'ButtonGroup' },
          variant: { key: 'variant-key', name: 'Size=56' },
          changes: [{
            node: { id: '1:3', name: 'Button', visible: true },
            property: 'variant.View',
            reference: { value: 'Primary' },
            actual: { value: 'Secondary' },
          }],
        }],
      },
    },
  };
}

function patternReportPayload() {
  return {
    report: {
      schemaVersion: 1,
      reportKind: 'apollo-pattern-audit-report',
      reportId: 'apollo-v3-report-test:patterns',
      sourceReportId: 'apollo-v3-report-test',
      generatedAt: '2026-08-17T00:00:00.000Z',
      user: { id: 'user-1', name: 'Test Designer' },
      figma: { fileKey: 'file-key', fileName: 'Test', editorType: 'figma' },
      scan: {
        channel: 'Desktop',
        pageType: 'form',
        selection: [{ nodeId: '1:1', name: 'Form', nodeType: 'SECTION' }],
      },
      summary: {
        scannedComponents: 3,
        occurrenceCount: 3,
        generalChangeCount: 0,
        requestedRuleCount: 1,
      },
      requestedRuleIds: [
        'rule:forms.construction-rules.title-medium-one-per-plate',
      ],
      category: {
        id: 'customizationsWip',
        title: 'Кастомизации [WIP]',
        count: 0,
        changeCount: 0,
        items: [],
      },
      facts: {
        occurrences: [
          {
            node: {
              id: '1:2',
              name: '[D] BackgroundPlateSlot',
              type: 'INSTANCE',
              path: 'Form / [D] BackgroundPlateSlot',
              visible: true,
            },
            component: {
              name: '[D] BackgroundPlateSlot',
              key: 'plate-key',
              library: 'Web _ Corp Components',
              sourceFile: null,
            },
            variant: null,
            ancestors: [],
          },
          ...['1:3', '1:4'].map((nodeId) => ({
            node: {
              id: nodeId,
              name: '[D] TitleView',
              type: 'INSTANCE',
              path: `Form / [D] BackgroundPlateSlot / ${nodeId}`,
              visible: true,
            },
            component: {
              name: '[D] TitleView',
              key: `title-${nodeId}`,
              library: 'Web _ Corp Components',
              sourceFile: null,
            },
            variant: {
              name: 'View=Medium',
              key: null,
              properties: { View: 'Medium' },
            },
            ancestors: [{
              nodeId: '1:2',
              name: '[D] BackgroundPlateSlot',
              componentName: '[D] BackgroundPlateSlot',
              componentKey: 'plate-key',
              variantProperties: {},
            }],
          })),
        ],
      },
      evidenceBundle: {
        schemaVersion: 2,
        documentType: 'apollo-audit-evidence-bundle',
        reportId: 'apollo-v3-report-test:evidence',
        sourceReportId: 'apollo-v3-report-test',
        generatedAt: '2026-08-17T00:00:00.000Z',
        context: {
          channel: 'Desktop',
          pageType: 'form',
          selectionNodeIds: ['1:1'],
        },
        graph: {
          nodes: [{
            nodeId: '1:1',
            parentNodeId: null,
            childNodeIds: ['1:2'],
            childOrder: 0,
            depth: 0,
            path: 'Form',
            type: 'SECTION',
            name: 'Form',
            visible: true,
            bounds: { x: 0, y: 0, width: 400, height: 600 },
            layout: { mode: 'VERTICAL', itemSpacing: 32 },
            component: null,
            componentOwner: null,
            text: null,
            styles: {},
            variableBindings: [],
          }],
          relations: [{
            id: 'relation:child:1_1:1_2',
            kind: 'direct-child',
            fromNodeId: '1:1',
            toNodeId: '1:2',
            containerNodeId: '1:1',
            axis: null,
            edge: null,
            measurement: null,
          }],
        },
        baselines: [],
        changes: [],
        ruleCandidates: [],
        coverage: {
          visibleNodeCount: 1,
          excludedHiddenNodeCount: 0,
        },
      },
    },
  };
}

function textReportPayload() {
  return {
    report: {
      schemaVersion: 1,
      reportKind: 'apollo-text-audit-report',
      reportId: 'apollo-v3-report-test:texts',
      sourceReportId: 'apollo-v3-report-test',
      generatedAt: '2026-08-18T00:00:00.000Z',
      user: { id: 'user-1', name: 'Test Designer' },
      figma: { fileKey: 'file-key', fileName: 'Test', editorType: 'figma' },
      scan: {
        channel: 'Desktop',
        pageType: 'form',
        selection: [{ nodeId: '1:1', name: 'Form', nodeType: 'SECTION' }],
      },
      summary: { scannedTextNodes: 1 },
      facts: {
        texts: [{
          node: {
            id: '1:5',
            name: 'Label',
            type: 'TEXT',
            path: 'Form / Button / Label',
            visible: true,
          },
          text: 'Сохранение',
          owner: {
            nodeId: '1:4',
            name: '[D] Button',
            componentName: '[D] Button',
            componentKey: null,
            variantProperties: { View: 'Primary' },
          },
          ancestors: [],
          documentOrder: 0,
        }],
      },
    },
  };
}

function activeComponentRule(ruleId, overrides = {}) {
  return {
    ruleId,
    severity: 'error',
    source: 'component-contract',
    ruleKind: 'design-rule',
    matchKind: 'exact_component_rule',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 1,
    },
    ...overrides,
  };
}

function validSkillResponse(manifest = skillManifest()) {
  return {
    schemaVersion: 1,
    documentType: 'apollo-design-audit-response',
    auditId: 'apollo-skill-test',
    skill: {
      name: manifest.name,
      version: manifest.version,
      checksum: manifest.checksum,
    },
    runStatus: 'completed',
    coverage: 'base-only',
    summary: {
      checkedNodes: 1,
      errors: 1,
      warnings: 0,
      humanReview: 0,
      allowed: 0,
      contextHints: 0,
      skippedRuleGroups: ['screen-type-patterns'],
    },
    findings: [{
      id: 'finding-1',
      dedupeKey: '1:2|test.rule|fill.token',
      nodeId: '1:2',
      ruleId: 'test.rule',
      factPath: 'fill.token',
      priority: 'error',
      category: 'component-contract',
      title: 'Wrong fill',
      object: { name: 'Form', path: 'Form', figmaUrl: null },
      fact: 'actual.token',
      expectation: 'expected.token',
      rationale: 'Contract baseline',
      fix: 'Use expected.token',
      evidenceStatus: 'verified',
      verifiedEvidence: [
        {
          kind: 'snapshot_fact',
          source: 'figma_snapshot',
          path: null,
          ruleId: 'test.rule',
          quote: null,
          factPath: 'fill.token',
          actual: 'actual.token',
          expected: 'expected.token',
          verified: true,
          verificationReason: 'Snapshot fact',
        },
        {
          kind: 'approved_rule',
          source: 'ds-ai-hub',
          path: 'patterns/form.md',
          ruleId: 'test.rule',
          quote: null,
          factPath: null,
          actual: null,
          expected: 'expected.token',
          verified: true,
          verificationReason: 'Approved rule',
        },
      ],
      actions: [{
        type: 'focus_node',
        label: 'Показать',
        userDecisionRequired: true,
        payload: [{ key: 'nodeId', value: '1:2' }],
      }],
    }],
    classifications: [],
    contextHints: [],
    clarificationQuestions: [],
    sourceTrace: {
      usedSources: [{
        source: 'ds-ai-hub',
        path: 'patterns/form.md',
        revision: null,
        checksum: null,
        role: 'normative-rule',
        purpose: 'Validate fill',
        ruleIds: ['test.rule'],
        findingIds: ['finding-1'],
      }],
      consultedSources: [],
    },
    responseMarkdown: 'One error',
  };
}

test('Codex authentication failures use a stable public error code', () => {
  assert.equal(
    isCodexAuthenticationFailure('Not logged in. Run codex login.'),
    true
  );
  assert.equal(isCodexAuthenticationFailure('model overloaded'), false);

  const authError = buildCodexProcessExitError(
    1,
    'Not logged in. Run codex login.'
  );
  assert.equal(authError.status, 401);
  assert.equal(authError.code, 'CODEX_AUTH_REQUIRED');
  assert.equal(authError.details, null);

  const processError = buildCodexProcessExitError(2, 'model overloaded');
  assert.equal(processError.status, 502);
  assert.equal(processError.code, 'CODEX_PROCESS_FAILED');
  assert.match(processError.details.stderr, /model overloaded/);

  const schemaError = buildCodexProcessExitError(
    1,
    '',
    '{"type":"error","message":"invalid_json_schema"}'
  );
  assert.equal(schemaError.code, 'CODEX_OUTPUT_SCHEMA_INVALID');
  assert.match(schemaError.message, /output schema/);
});

test('Codex child environment excludes proxy and agent secrets', () => {
  const original = process.env.APOLLO_AGENT_KEY;
  process.env.APOLLO_AGENT_KEY = 'must-not-leak';
  try {
    const environment = buildCodexEnvironment();
    assert.equal(environment.APOLLO_AGENT_KEY, undefined);
    assert.equal(environment.LANGFLOW_KEY, undefined);
  } finally {
    if (original === undefined) delete process.env.APOLLO_AGENT_KEY;
    else process.env.APOLLO_AGENT_KEY = original;
  }
});

test('Codex validation requires a snapshot with nodes', () => {
  assert.equal(
    validateCodexRequest({ mode: 'validation' }),
    'Validation mode requires snapshot.'
  );
  assert.equal(
    validateCodexRequest({ mode: 'validation', snapshot: { nodes: [] } }),
    'Apollo skill requires exactly one selected root.'
  );
  assert.equal(validateCodexRequest(snapshotPayload()), null);
});

test('Codex question requires non-empty user text', () => {
  assert.equal(
    validateCodexRequest({ mode: 'question', question: '   ' }),
    'Question mode requires the audited snapshot.'
  );
  const payload = snapshotPayload();
  payload.mode = 'question';
  payload.question = '   ';
  assert.equal(
    validateCodexRequest(payload),
    'Question mode requires a non-empty question.'
  );
  payload.question = 'Почему?';
  assert.equal(
    validateCodexRequest(payload),
    null
  );
});

test('Apollo skill preflight and prompt pin version and checksum', () => {
  const manifest = skillManifest();
  assert.equal(manifest.name, 'apollo-design-validator');
  assert.equal(manifest.version, '1.3.0');
  assert.match(manifest.checksum, /^[a-f0-9]{64}$/);

  const prompt = buildCodexPrompt('/tmp/request.json', 'validation', manifest);
  assert.match(prompt, /\$apollo-design-validator/);
  assert.match(prompt, new RegExp(manifest.checksum));
});

test('Apollo skill compatibility version cannot be pinned by stale user env', async () => {
  const proxyRoot = path.resolve(__dirname, '..');
  const printedVersion = execFileSync(
    process.execPath,
    ['-e', [
      "process.env.APOLLO_CODEX_SKILL_REQUIRED_VERSION = '1.1.0';",
      "process.stdout.write(require('./server').APOLLO_CODEX_SKILL_REQUIRED_VERSION);",
    ].join('')],
    { cwd: proxyRoot, encoding: 'utf8' }
  );
  assert.equal(printedVersion, skillManifest().version);

  const envExample = await fsp.readFile(
    path.join(proxyRoot, '.env.example'),
    'utf8'
  );
  assert.doesNotMatch(envExample, /^APOLLO_CODEX_SKILL_REQUIRED_VERSION=/m);
});

test('Apollo v3 prompt strategy is bounded and does not invoke the skill', () => {
  const manifest = skillManifest();
  const prompt = buildCodexPrompt(
    '/tmp/report-request.json',
    'customization-report',
    manifest,
    { checksum: 'knowledge-checksum' },
    'prompt'
  );

  assert.doesNotMatch(prompt, /Используй \$apollo-design-validator/);
  assert.match(prompt, /Не вызывай skill и не читай SKILL\.md/);
  assert.match(prompt, /Классифицируй только report\.category\.items\[\]\.changes\[\]/);
  assert.match(prompt, /обе обязательные записи/);
  assert.match(prompt, /snapshot_fact с source=figma_snapshot/);
  assert.match(prompt, /component_contract или approved_rule/);
  assert.match(prompt, /screen-patterns и full-snapshot-audit/);
  assert.match(prompt, /classifications/);
  assert.match(prompt, /assessment\.verdict=violation/);
  assert.match(prompt, /authority\.status=active/);
  assert.match(prompt, new RegExp(manifest.checksum));
});

test('Apollo v3 can explicitly fall back to the full skill strategy', () => {
  const manifest = skillManifest();
  const prompt = buildCodexPrompt(
    '/tmp/report-request.json',
    'customization-report',
    manifest,
    { checksum: 'knowledge-checksum' },
    'skill'
  );

  assert.match(prompt, /Используй \$apollo-design-validator/);
});

test('Apollo proxy accepts and builds a compact v3 customization report request', () => {
  const payload = reportPayload();
  assert.equal(validateCodexReportRequest(payload), null);
  assert.equal(
    validateCodexReportRequest({ report: { reportKind: 'other' } }),
    'Unsupported Apollo report kind.'
  );

  const request = buildApolloCustomizationReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  assert.equal(request.documentType, 'apollo-customization-audit-request');
  assert.equal(request.mode, 'customization-report');
  assert.equal(request.auditId, payload.report.reportId);
  assert.equal(request.context.platform, 'desktop');
  assert.equal(request.context.figma.rootNodeId, '1:2');
  assert.equal(request.report.category.items[0].changes[0].property, 'variant.View');
});

test('Apollo proxy resolves the first form pattern into a bounded packet', async () => {
  const payload = patternReportPayload();
  assert.equal(validateCodexReportRequest(payload), null);

  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  assert.equal(request.documentType, 'apollo-pattern-audit-request');
  assert.equal(request.mode, 'pattern-report');
  assert.equal(request.context.pageType, 'form');
  assert.equal(request.context.platform, 'desktop');
  assert.equal(compactApolloPatternReport(payload.report).facts.occurrences.length, 3);
  assert.deepEqual(compactApolloPatternReport(payload.report).facts.layoutRelations, []);
  const compactEvidence = compactApolloEvidenceBundle(
    payload.report.evidenceBundle
  );
  assert.equal(compactEvidence.schemaVersion, 3);
  assert.equal(
    compactEvidence.documentType,
    'apollo-audit-evidence-transport'
  );
  assert.equal(compactEvidence.graph.nodes[0][0], '1:1');
  assert.equal(compactEvidence.graph.encoding.nodeColumns[0], 'id');
  assert.equal(compactEvidence.graph.paddings.length, 0);
  assert.equal(compactEvidence.graph.siblingGaps.length, 0);

  const packet = await buildResolvedPatternAuditPacket(request, {
    knowledgeSource: 'ds-ai-hub',
    designSystemRoot: packetSourceRoots.designSystemRoot,
    dsAiHubRoot: packetSourceRoots.dsAiHubRoot,
  });
  assert.equal(packet.documentType, 'apollo-resolved-pattern-audit-packet');
  assert.deepEqual(packet.resolution.unresolvedRuleIds, []);
  assert.equal(packet.resolution.rules[0].evidence.source, 'ds-ai-hub');
  assert.equal(
    packet.resolution.rules[0].evidence.path,
    'products/ab/patterns/form-construction-rules.md'
  );
  assert.equal(packet.observations[0].containers.length, 1);
  assert.equal(packet.observations[0].containers[0].actualCount, 2);
  assert.equal(packet.generalAudit.category.changeCount, 0);
  assert.equal(packet.architectureAudit.evidenceBundle.schemaVersion, 3);
  assert.equal(validateApolloSemanticModel(packet.semanticModel), null);
  assert.equal(packet.semanticModel.documentType, 'apollo-semantic-audit-model');
  const componentOccurrences = packet.semanticModel.facts.filter(
    (fact) => fact.kind === 'component_occurrence'
  );
  assert.equal(componentOccurrences.length, 3);
  assert.equal(
    componentOccurrences.find((fact) => fact.subject.nodeId === '1:3')
      ?.component?.variantProperties?.View,
    'Medium'
  );
  assert.equal(packet.semanticModel.coverage.componentOccurrenceCount, 3);
  assert.equal(
    packet.semanticModel.rules.find(
      (rule) => rule.id === 'rule:forms.construction-rules.block-spacing'
    )?.authoritative,
    true
  );
  assert.equal(packet.resolution.pagePatternDocuments.length, 1);
  assert.match(
    packet.resolution.pagePatternDocuments[0].content,
    /rule:forms\.construction-rules\.title-medium-one-per-plate/
  );

  const semanticPacket = compactResolvedPatternAuditPacket(packet);
  assert.equal(semanticPacket.transport.mode, 'semantic-v1');
  assert.equal('generalAudit' in semanticPacket, false);
  assert.equal('evidenceBundle' in semanticPacket.architectureAudit, false);
  assert.equal('pagePatternDocuments' in semanticPacket.resolution, false);
  assert.ok(
    semanticPacket.semanticModel.facts.length <=
      packet.semanticModel.facts.length
  );
  assert.equal(
    semanticPacket.transport.fullFactCount,
    packet.semanticModel.facts.length
  );
  assert.equal(
    semanticPacket.transport.transmittedFactCount,
    semanticPacket.semanticModel.facts.length
  );
  assert.ok(
    semanticPacket.semanticModel.rules.length <= packet.semanticModel.rules.length
  );
  assert.ok(
    semanticPacket.semanticModel.rules.some(
      (rule) => rule.id ===
        'rule:forms.construction-rules.block-spacing'
    )
  );
  assert.ok(
    JSON.stringify(semanticPacket).length < JSON.stringify(packet).length
  );

  const prompt = buildCodexPrompt(
    '/tmp/pattern-request.json',
    'pattern-report',
    skillManifest(),
    { checksum: 'knowledge-checksum' },
    'packet',
    semanticPacket
  );
  assert.match(prompt, /read-only аудитор проектировочных паттернов/);
  assert.match(prompt, /единственным каноническим представлением/);
  assert.match(prompt, /max-descendant-count-per-container/);
  assert.match(prompt, /Semantic Fact Model v1/);
  assert.match(prompt, /component_occurrence/);
  assert.match(prompt, /rule\.constraintModel/);
  assert.match(prompt, /ruleReadiness/);
  assert.match(prompt, /Не придумывай новые или более узкие правила/);
  assert.match(prompt, /одинаковым effect.*НЕ являются конфликтом/);
  assert.match(prompt, /Верни компактный assessment/);
  assert.doesNotMatch(prompt, /architectureAudit\.evidenceBundle/);
  assert.doesNotMatch(prompt, /resolution\.pagePatternDocuments/);
  assert.doesNotMatch(prompt, /Используй \$apollo-design-validator/);
});

test('Apollo proxy expands compact pattern assessments into the verified UI contract', async () => {
  const payload = patternReportPayload();
  const manifest = skillManifest();
  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const fullPacket = await buildResolvedPatternAuditPacket(request, {
    knowledgeSource: 'design-system_ab',
    designSystemRoot: packetSourceRoots.designSystemRoot,
    dsAiHubRoot: packetSourceRoots.dsAiHubRoot,
  });
  const packet = compactResolvedPatternAuditPacket(fullPacket);
  const observation = packet.observations[0];
  const container = observation.containers[0];
  const compactResponse = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: payload.report.reportId,
    runStatus: 'completed',
    coverage: 'partial',
    assessments: [{
      id: 'PAT-001',
      nodeId: container.nodeId,
      factPath: container.factPath,
      disposition: 'error',
      ruleId: observation.ruleId,
      title: 'Слишком много заголовков',
      rationale: 'Фактическое количество превышает максимум.',
      expectation: 'Не более одного TitleView Medium.',
      fix: 'Оставить один главный заголовок.',
    }],
    summaryText: 'Найдено одно нарушение.',
    clarificationQuestions: [],
  };

  const expanded = expandCompactPatternAssessmentResponse(
    compactResponse,
    payload,
    manifest,
    packet
  );
  assert.equal(expanded.documentType, 'apollo-design-audit-response');
  assert.equal(expanded.findings.length, 1);
  assert.equal(expanded.findings[0].verifiedEvidence.length, 2);
  assert.equal(expanded.sourceTrace.usedSources.length, 1);

  const normalized = normalizeCodexValidation(
    compactResponse,
    payload,
    manifest,
    packet
  );
  assert.equal(normalized.mode, 'pattern-report');
  assert.equal(normalized.summary.errors, 1);
  assert.equal(normalized.findings[0].title, 'Слишком много заголовков');
});

test('Apollo keeps component composition findings in Base and renders readable parent evidence', () => {
  const payload = patternReportPayload();
  const nodeId = 'I1:0;2:0';
  const ruleId =
    'component:web-corp.background-plate.level-2-requires-level-1';
  const factPath = `architecture.aggregate.${nodeId}.directChildren`;
  const packet = {
    auditId: payload.report.reportId,
    context: { figma: { rootNodeId: '1:0' } },
    report: payload.report,
    resolution: { requestedRuleIds: [] },
    semanticModel: {
      facts: [{
        id: 'occurrence',
        kind: 'component_occurrence',
        subject: { nodeId, name: '[D] BackgroundPlate' },
        factPath: `architecture.component.${nodeId}.occurrence`,
        component: {
          variantProperties: { Position: 'Level 2 (inner)' },
          parentNodeId: '1:0',
          owner: { nodeId: '1:0', name: '[D] ContentCardWrapper' },
        },
      }, {
        id: 'aggregate',
        kind: 'group_aggregate',
        subject: { nodeId, name: '[D] BackgroundPlate' },
        factPath,
        aggregate: {
          scope: 'direct-children',
          directComponentCount: 1,
          componentNameCounts: { '[D] Style Level 2': 1 },
        },
      }],
      rules: [{
        id: ruleId,
        effect: 'violation',
        scope: 'composition',
        authoritative: true,
        authority: { status: 'active' },
        conditions: {
          components: ['[D] BackgroundPlate'],
          variant: { Position: 'Level 2 (inner)' },
        },
        constraintModel: {
          predicates: [{
            field: 'requiredComposition',
            operator: 'require',
            value: {
              requiredParent: {
                component: 'BackgroundPlate',
                variant: { Position: 'Level 1 (outer)' },
              },
              directParentRequired: true,
              allowStandalone: false,
            },
          }],
        },
        text: 'Level 2 должен находиться внутри BackgroundPlate Level 1.',
        source: {
          source: 'design-system_ab',
          path: 'JSONS/web/components/web-corp/BackgroundPlate/rules.json',
        },
      }],
    },
  };
  const compactResponse = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: packet.auditId,
    runStatus: 'completed',
    coverage: 'full',
    assessments: [{
      id: 'composition-error',
      nodeId,
      factPath,
      disposition: 'ok',
      ruleId: null,
      title: 'Композиция допустима',
      rationale: 'Агент не заметил нарушение обязательного родителя.',
      expectation: 'Сохранить текущую композицию.',
      fix: ':',
    }],
    summaryText: 'Найдено нарушение композиции.',
    clarificationQuestions: [],
  };

  const merged = mergeCompactPatternAssessmentResponses([{
    pass: {
      auditPass: {
        id: 'component-contract',
        runKey: 'component-contract.1',
        targets: [{ id: 'aggregate', nodeId, factPath }],
      },
    },
    result: compactResponse,
  }], packet);
  assert.equal(merged.assessments[0].disposition, 'error');
  assert.equal(merged.assessments[0].ruleId, ruleId);

  const expanded = expandCompactPatternAssessmentResponse(
    merged,
    payload,
    skillManifest(),
    packet
  );
  assert.equal(
    expanded.findings[0].fact,
    'Position=Level 2 (inner); прямой родитель — [D] ContentCardWrapper.'
  );
  const adapted = adaptApolloSkillResponse(expanded, payload);
  assert.equal(adapted.findings[0].patternScope, 'general');
});

test('Apollo compact pattern response preserves deterministic component verdicts', async () => {
  const payload = patternReportPayload();
  const manifest = skillManifest();
  const deterministicRule = activeComponentRule(
    'component:test.padding-uses-spacing-tokens',
    {
      severity: 'error',
      appliesTo: 'layout.padding.*',
      ruleText: 'Каждый padding должен быть привязан к токену Spacing.',
      remediation: 'Привязать значение к соответствующему токену Spacing.',
    }
  );
  payload.report.category.items = [{
    node: { id: '1:2', name: 'BackgroundPlate', visible: true },
    component: { key: 'plate-key', name: 'BackgroundPlate' },
    variant: { key: 'plate-variant', name: 'Type=Primary' },
    changes: [{
      node: { id: '1:2', name: 'BackgroundPlate', visible: true },
      property: 'layout.padding.right',
      reference: { value: 24 },
      actual: { value: 16 },
      assessment: {
        verdict: 'violation',
        ruleId: deterministicRule.ruleId,
        message: deterministicRule.ruleText,
      },
      componentRules: [deterministicRule],
    }],
  }];
  payload.report.category.count = 1;
  payload.report.category.changeCount = 1;
  payload.report.summary.generalChangeCount = 1;

  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const fullPacket = await buildResolvedPatternAuditPacket(request, {
    knowledgeSource: 'design-system_ab',
    designSystemRoot: packetSourceRoots.designSystemRoot,
    dsAiHubRoot: packetSourceRoots.dsAiHubRoot,
  });
  const packet = compactResolvedPatternAuditPacket(fullPacket);
  packet.semanticModel.rules.push({
    id: deterministicRule.ruleId,
    effect: 'violation',
    scope: 'component',
    severity: 'error',
    appliesTo: 'layout.padding.*',
    conditions: null,
    assertion: null,
    constraintModel: null,
    text: deterministicRule.ruleText,
    authority: deterministicRule.authority,
    authoritative: true,
    source: {
      source: 'design-system_ab',
      path: 'JSONS/web/components/test/rules.json',
      quote: deterministicRule.ruleText,
    },
    semantics: ['authority'],
  });
  const compactResponse = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: payload.report.reportId,
    runStatus: 'completed',
    coverage: 'partial',
    assessments: [{
      id: 'PAT-DET-001',
      nodeId: '1:2',
      factPath: 'layout.padding.right',
      disposition: 'human_review',
      ruleId: deterministicRule.ruleId,
      title: 'Правила могут конфликтовать',
      rationale: 'Нужно уточнение.',
      expectation: 'Уточнить правило.',
      fix: 'Проверить вручную.',
    }],
    summaryText: 'Один спорный факт.',
    clarificationQuestions: [],
  };

  const normalized = normalizeCodexValidation(
    compactResponse,
    payload,
    manifest,
    packet
  );
  assert.equal(normalized.summary.errors, 1);
  assert.equal(normalized.findings[0].priority, 'error');
  assert.equal(
    normalized.findings[0].title,
    'Нарушено обязательное правило компонента'
  );
  assert.equal(
    normalized.findings[0].suggestedFix,
    deterministicRule.remediation
  );
  assert.equal(normalized.classifications[0].disposition, 'error');
});

test('Apollo semantic model preserves direct composition and component ownership', () => {
  const payload = patternReportPayload();
  payload.report.evidenceBundle.graph.nodes.push({
    nodeId: '1:2',
    parentNodeId: '1:1',
    childNodeIds: ['1:3'],
    childOrder: 0,
    depth: 1,
    path: 'Form / [D] BackgroundPlateSlot',
    type: 'INSTANCE',
    name: '[D] BackgroundPlateSlot',
    visible: true,
    bounds: { x: 0, y: 0, width: 400, height: 600 },
    layout: { mode: 'VERTICAL', itemSpacing: 32 },
    component: {
      key: 'plate-key',
      name: '[D] BackgroundPlateSlot',
      variantProperties: {},
      componentProperties: {},
      directOverrides: [],
    },
    componentOwner: null,
    text: null,
    styles: {},
    variableBindings: [],
  }, {
    nodeId: '1:3',
    parentNodeId: '1:2',
    childNodeIds: [],
    childOrder: 1,
    depth: 2,
    path: 'Form / [D] BackgroundPlateSlot / [D] TitleView',
    type: 'INSTANCE',
    name: '[D] TitleView',
    visible: true,
    bounds: { x: 32, y: 32, width: 336, height: 48 },
    layout: { mode: 'HORIZONTAL', itemSpacing: 0 },
    component: {
      key: 'title-1:3',
      name: '[D] TitleView',
      variantProperties: { View: 'Medium' },
      componentProperties: {},
      directOverrides: [],
    },
    componentOwner: {
      nodeId: '1:2',
      componentKey: 'plate-key',
      name: '[D] BackgroundPlateSlot',
      path: 'Form / [D] BackgroundPlateSlot',
      relativePath: 'Content/Title',
    },
    text: null,
    styles: {},
    variableBindings: [{
      property: 'paddingLeft',
      variableIds: ['VariableID:spacing-32'],
    }],
  });
  payload.report.evidenceBundle.graph.relations.push({
    id: 'relation:child:1_2:1_3',
    kind: 'direct-child',
    fromNodeId: '1:2',
    toNodeId: '1:3',
    containerNodeId: '1:2',
    axis: null,
    edge: null,
    measurement: null,
  });

  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const model = buildApolloSemanticModel(request);
  assert.equal(validateApolloSemanticModel(model), null);
  const compositionFacts = model.facts.filter((fact) => (
    fact.kind === 'relation' &&
    fact.semantics.includes('composition') &&
    !fact.semantics.includes('page_relation')
  ));
  assert.equal(compositionFacts.length, 1);
  assert.equal(
    compositionFacts.find((fact) => (
      fact.relation?.structuralKind === 'component-owner' &&
      fact.target?.nodeId === '1:3'
    ))?.relation?.ownerRelativePath,
    'Content/Title'
  );
  assert.equal(model.coverage.compositionRelationCount, 1);
  const aggregates = model.facts.filter(
    (fact) => fact.kind === 'group_aggregate'
  );
  assert.equal(aggregates.length, 2);
  const plateAggregate = aggregates.find(
    (fact) => fact.subject.nodeId === '1:2'
  );
  assert.equal(plateAggregate.aggregate.directChildCount, 1);
  assert.equal(plateAggregate.aggregate.directComponentCount, 1);
  assert.deepEqual(plateAggregate.aggregate.memberNodeIds, ['1:3']);
  assert.deepEqual(
    plateAggregate.aggregate.propertyValueCounts.View,
    { Medium: 1 }
  );
  assert.equal(model.coverage.groupAggregateCount, 2);
  const titleLayout = model.facts.find((fact) => (
    fact.kind === 'layout_state' && fact.subject.nodeId === '1:3'
  ));
  assert.equal(titleLayout.layout.bounds.width, 336);
  assert.equal(titleLayout.layout.layout.mode, 'HORIZONTAL');
  assert.deepEqual(titleLayout.binding.variables, [{
    property: 'paddingLeft',
    variableIds: ['VariableID:spacing-32'],
  }]);
  assert.ok(titleLayout.semantics.includes('token_binding'));
  assert.equal(model.coverage.layoutStateCount, 3);
});

test('Apollo proxy aggregates architecture relations without losing measurements', () => {
  const payload = patternReportPayload();
  payload.report.evidenceBundle.graph.relations.push(
    {
      id: 'relation:padding-top:1_1:none',
      kind: 'container-padding',
      fromNodeId: '1:1',
      toNodeId: null,
      containerNodeId: '1:1',
      axis: 'vertical',
      edge: 'top',
      measurement: {
        actualPx: 32,
        source: 'child-envelope',
        quality: 'exact',
      },
    },
    {
      id: 'relation:padding-right:1_1:none',
      kind: 'container-padding',
      fromNodeId: '1:1',
      toNodeId: null,
      containerNodeId: '1:1',
      axis: 'horizontal',
      edge: 'right',
      measurement: {
        actualPx: 24,
        source: 'child-envelope',
        quality: 'exact',
      },
    },
    {
      id: 'relation:gap-vertical:1_2:1_3',
      kind: 'sibling-gap',
      fromNodeId: '1:2',
      toNodeId: '1:3',
      containerNodeId: '1:1',
      axis: 'vertical',
      edge: null,
      measurement: {
        actualPx: 16,
        source: 'bounding-box-gap',
        quality: 'exact',
      },
    }
  );

  const compact = compactApolloEvidenceBundle(payload.report.evidenceBundle);
  assert.deepEqual(compact.graph.paddings[0], [
    '1:1',
    32,
    24,
    null,
    null,
    'child-envelope',
    'exact',
  ]);
  assert.deepEqual(compact.graph.siblingGaps[0], [
    '1:2',
    '1:3',
    '1:1',
    'vertical',
    16,
    'bounding-box-gap',
    'exact',
  ]);
  assert.equal('relations' in compact.graph, false);
});

test('Apollo proxy derives form content and primary action roles from structure', () => {
  const payload = patternReportPayload();
  payload.report.evidenceBundle.context.pageType = 'form';
  payload.report.evidenceBundle.graph.nodes = [
    {
      nodeId: 'form-zones',
      parentNodeId: null,
      childOrder: 0,
      type: 'FRAME',
      name: 'Form zones',
      visible: true,
      layout: { mode: 'HORIZONTAL' },
      component: null,
    },
    {
      nodeId: 'form-column',
      parentNodeId: 'form-zones',
      childOrder: 0,
      type: 'FRAME',
      name: '8 Cols',
      visible: true,
      layout: { mode: 'VERTICAL' },
      component: null,
    },
    {
      nodeId: 'aside',
      parentNodeId: 'form-zones',
      childOrder: 1,
      type: 'INSTANCE',
      name: '[D] IsleBlock',
      visible: true,
      layout: { mode: 'VERTICAL' },
      component: {
        key: 'isle-key',
        name: '[D] IsleBlock',
        variantProperties: {},
        componentProperties: {},
      },
    },
    {
      nodeId: 'form-content',
      parentNodeId: 'form-column',
      childOrder: 0,
      type: 'FRAME',
      name: 'Frame',
      visible: true,
      layout: { mode: 'VERTICAL' },
      component: null,
    },
    {
      nodeId: 'plate',
      parentNodeId: 'form-content',
      childOrder: 0,
      type: 'INSTANCE',
      name: '[D] BackgroundPlateSlot',
      visible: true,
      layout: { mode: 'VERTICAL' },
      component: {
        key: 'plate-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: {},
        componentProperties: {},
      },
    },
    {
      nodeId: 'plate-2',
      parentNodeId: 'form-content',
      childOrder: 1,
      type: 'INSTANCE',
      name: '[D] BackgroundPlateSlot',
      visible: true,
      layout: { mode: 'VERTICAL' },
      component: {
        key: 'plate-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: {},
        componentProperties: {},
      },
    },
    {
      nodeId: 'actions',
      parentNodeId: 'form-column',
      childOrder: 1,
      type: 'FRAME',
      name: 'Actions',
      visible: true,
      layout: { mode: 'HORIZONTAL' },
      component: null,
    },
    ...['primary', 'secondary'].map((nodeId, childOrder) => ({
      nodeId,
      parentNodeId: 'actions',
      childOrder,
      type: 'INSTANCE',
      name: '[D] Button',
      visible: true,
      layout: { mode: 'HORIZONTAL' },
      component: {
        key: `${nodeId}-key`,
        name: '[D] Button',
        variantProperties: { Size: '56' },
        componentProperties: { Size: '56' },
      },
    })),
  ];
  payload.report.evidenceBundle.graph.relations = [
    {
      id: 'relation:gap-vertical:form-content:actions',
      kind: 'sibling-gap',
      fromNodeId: 'form-content',
      toNodeId: 'actions',
      containerNodeId: 'form-column',
      axis: 'vertical',
      edge: null,
      measurement: {
        actualPx: 48,
        source: 'bounding-box-gap',
        quality: 'exact',
      },
    },
    {
      id: 'relation:gap-vertical:plate:plate-2',
      kind: 'sibling-gap',
      fromNodeId: 'plate',
      toNodeId: 'plate-2',
      containerNodeId: 'form-content',
      axis: 'vertical',
      edge: null,
      measurement: {
        actualPx: 12,
        source: 'bounding-box-gap',
        quality: 'exact',
      },
    },
    {
      id: 'relation:gap-horizontal:form-column:aside',
      kind: 'sibling-gap',
      fromNodeId: 'form-column',
      toNodeId: 'aside',
      containerNodeId: 'form-zones',
      axis: 'horizontal',
      edge: null,
      measurement: {
        actualPx: 12,
        source: 'bounding-box-gap',
        quality: 'exact',
      },
    },
  ];

  const compact = compactApolloEvidenceBundle(
    payload.report.evidenceBundle
  );
  assert.deepEqual(compact.graph.semantic.roles, [
    [
      'actions',
      'form-primary-actions',
      'exact',
      [
        'button-size:56',
        'children:buttons-only',
        'descendants:button=2',
        'layout:horizontal',
        'position:last-in-form-main-column',
      ],
    ],
    [
      'aside',
      'form-aside-zone',
      'exact',
      ['contains:isle-block', 'sibling:form-main-column'],
    ],
    [
      'form-column',
      'form-main-column',
      'exact',
      ['contains:form-primary-actions', 'layout:vertical'],
    ],
    [
      'form-content',
      'form-content',
      'exact',
      ['precedes:form-primary-actions', 'same-parent:form-main-column'],
    ],
    [
      'form-zones',
      'form-zones',
      'exact',
      [
        'contains:form-aside-zone',
        'contains:form-main-column',
        'layout:horizontal',
      ],
    ],
    [
      'plate',
      'first-level-block',
      'exact',
      ['component:background-plate-slot'],
    ],
    [
      'plate-2',
      'first-level-block',
      'exact',
      ['component:background-plate-slot'],
    ],
  ]);
  assert.deepEqual(compact.graph.semantic.siblingGaps, [
    [
      'semantic-gap:form-column:aside',
      'form-column',
      'aside',
      'form-zones',
      'horizontal',
      12,
      'form-main-column',
      'form-aside-zone',
      'form-zone-boundary',
      'page-zone',
      ['main-before-aside', 'same-parent:horizontal-container'],
      'exact',
      'relation:gap-horizontal:form-column:aside',
    ],
    [
      'semantic-gap:form-content:actions',
      'form-content',
      'actions',
      'form-column',
      'vertical',
      48,
      'form-content',
      'form-primary-actions',
      'form-section-boundary',
      'second-level',
      [
        'content:first-level-blocks=2',
        'sequence:content-before-primary-actions',
        'same-parent:form-main-column',
      ],
      'exact',
      'relation:gap-vertical:form-content:actions',
    ],
    [
      'semantic-gap:plate:plate-2',
      'plate',
      'plate-2',
      'form-content',
      'vertical',
      12,
      'first-level-block',
      'first-level-block',
      'first-level-block-boundary',
      'first-level',
      [
        'adjacent:first-level-blocks',
        'same-parent:vertical-container',
      ],
      'exact',
      'relation:gap-vertical:plate:plate-2',
    ],
  ]);
  assert.deepEqual(
    compact.graph.semantic.encoding.gapColumns.slice(8, 11),
    ['structuralKind', 'hierarchyLevel', 'structuralSignals']
  );

  const model = buildApolloSemanticModel({
    auditId: 'semantic-form-test',
    context: { platform: 'desktop', pageType: 'form' },
    report: {
      category: { items: [] },
      evidenceBundle: compact,
    },
  });
  assert.equal(validateApolloSemanticModel(model), null);
  const relationFact = model.facts.find((fact) => (
    fact.kind === 'relation' && fact.relation.hierarchyLevel === 'second-level'
  ));
  assert.deepEqual(relationFact.semantics, ['composition', 'page_relation']);
  assert.equal(relationFact.relation.measurement.actualPx, 48);
  assert.equal(relationFact.relation.hierarchyLevel, 'second-level');
  assert.equal(relationFact.relation.structuralKind, 'form-section-boundary');
  const firstLevelRelation = model.facts.find((fact) => (
    fact.kind === 'relation' && fact.relation.hierarchyLevel === 'first-level'
  ));
  assert.equal(firstLevelRelation.relation.measurement.actualPx, 12);
  assert.equal(
    firstLevelRelation.relation.structuralKind,
    'first-level-block-boundary'
  );
  const pageZoneRelation = model.facts.find((fact) => (
    fact.kind === 'relation' && fact.relation.hierarchyLevel === 'page-zone'
  ));
  assert.equal(pageZoneRelation.relation.measurement.actualPx, 12);
  assert.equal(pageZoneRelation.relation.axis, 'horizontal');
  assert.equal(pageZoneRelation.relation.structuralKind, 'form-zone-boundary');
});

test('Apollo semantic model keeps slot exceptions separate from snapshot facts', () => {
  const payload = reportPayload();
  const change = payload.report.category.items[0].changes[0];
  change.property = 'component.identity';
  change.context = {
    actualComponentKey: 'chevron-key',
    referenceComponentKey: 'diamonds-key',
    nestedOwnerComponentRole: 'RightAddon',
  };
  change.reference = { value: 'diamonds' };
  change.actual = { value: 'chevron-down' };
  change.componentRules = [{
    ruleId: 'component:web-core.tag-group.right-addon-allows-icon-replacement',
    ruleKind: 'design-rule',
    severity: 'info',
    source: 'component-contract',
    appliesTo: 'component.identity',
    conditions: { slot: 'RightAddon' },
    classification: { treatAsViolation: false },
    ruleText: 'RightAddon allows replacement with another design-system icon.',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 1,
    },
  }];
  const request = buildApolloCustomizationReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const model = buildApolloSemanticModel(request);
  assert.equal(validateApolloSemanticModel(model), null);
  const propertyFacts = model.facts.filter(
    (fact) => fact.kind === 'property_state'
  );
  assert.equal(propertyFacts.length, 1);
  assert.deepEqual(
    propertyFacts[0].semantics,
    ['baseline', 'relative_fact', 'slot']
  );
  assert.equal(propertyFacts[0].subject.slot, 'RightAddon');
  assert.equal(
    model.facts.filter((fact) => fact.kind === 'component_occurrence').length,
    1
  );
  assert.equal(model.rules.length, 1);
  assert.equal(model.rules[0].effect, 'allow');
  assert.equal(model.rules[0].scope, 'slot');
  assert.equal(model.rules[0].authoritative, true);
  assert.deepEqual(model.rules[0].semantics, ['exception', 'authority']);
});

test('Apollo semantic model preserves authoritative context-controlled rules as allow', () => {
  const payload = reportPayload();
  const change = payload.report.category.items[0].changes[0];
  change.property = 'layout.padding.bottom';
  change.componentRules = [{
    ruleId: 'component:test.designer-controlled-padding',
    ruleKind: 'design-rule',
    severity: 'info',
    appliesTo: 'layout.padding.*',
    classification: {
      doNotTreatAsViolationByDefault: true,
    },
    ruleText: 'Padding is controlled by the composition context.',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 1,
    },
  }];
  const request = buildApolloCustomizationReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const model = buildApolloSemanticModel(request);
  assert.equal(validateApolloSemanticModel(model), null);
  assert.equal(model.rules[0].effect, 'allow');
  assert.deepEqual(model.rules[0].semantics, ['exception', 'authority']);
});

test('Apollo semantic model preserves structured component constraints', () => {
  const payload = patternReportPayload();
  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const ruleId = 'component:test.structured-composition';
  const model = buildApolloSemanticModel(request, {
    additionalRules: [{
      rule: {
        ruleId,
        ruleKind: 'design-rule',
        severity: 'error',
        appliesTo: 'component.composition',
        target: { component: '[D] TabsView' },
        requiredComposition: {
          maximumVisible: 8,
          requiredOrder: ['Primary', 'Secondary'],
        },
        forbiddenState: { Active: true, Disabled: true },
        authority: {
          status: 'active',
          provenance: 'design-system-author',
          revision: 1,
        },
      },
      evidence: {
        source: 'design-system_ab',
        path: 'JSONS/Test/rules.json',
        ruleId,
        verified: true,
      },
    }],
  });
  const rule = model.rules.find((candidate) => candidate.id === ruleId);
  assert.equal(rule.authoritative, true);
  assert.deepEqual(rule.constraintModel.selector, {
    appliesTo: 'component.composition',
    target: { component: '[D] TabsView' },
  });
  assert.deepEqual(rule.constraintModel.predicates, [{
    field: 'requiredComposition',
    operator: 'require',
    value: {
      maximumVisible: 8,
      requiredOrder: ['Primary', 'Secondary'],
    },
  }, {
    field: 'forbiddenState',
    operator: 'forbid',
    value: { Active: true, Disabled: true },
  }]);
  assert.deepEqual(
    model.coverage.ruleReadiness.find((entry) => entry.ruleId === ruleId),
    {
      ruleId,
      status: 'not_evaluable',
      reason: 'missing-fact-kinds',
      requiredFactKinds: ['component_occurrence', 'group_aggregate'],
      missingFactKinds: ['group_aggregate'],
      requiredEvidence: [],
      missingEvidence: [],
    }
  );
});

test('Apollo compact pattern packet retains authoritative structural rules', () => {
  const componentRuleId = 'component:test.required-composition';
  const packet = compactResolvedPatternAuditPacket({
    schemaVersion: 1,
    documentType: 'apollo-resolved-pattern-audit-packet',
    mode: 'pattern-report',
    auditId: 'audit-1',
    context: { platform: 'desktop', pageType: 'form' },
    report: {},
    architectureAudit: { layoutRelations: [] },
    semanticModel: {
      schemaVersion: 1,
      documentType: 'apollo-semantic-audit-model',
      auditId: 'audit-1',
      context: { platform: 'desktop', pageType: 'form' },
      facts: [],
      rules: [{
        id: componentRuleId,
        scope: 'composition',
        authoritative: true,
        source: {
          source: 'design-system_ab',
          path: 'JSONS/Test/rules.json',
        },
      }, {
        id: 'context:test.unused',
        scope: 'global',
        authoritative: false,
        source: null,
      }],
      coverage: {
        factCount: 0,
        ruleCount: 2,
        factKinds: {},
        semantics: {},
        ruleReadiness: [{ ruleId: componentRuleId }, {
          ruleId: 'context:test.unused',
        }],
      },
    },
    resolution: {},
    observations: [],
  });
  assert.deepEqual(
    packet.semanticModel.rules.map((rule) => rule.id),
    [componentRuleId]
  );
  assert.deepEqual(
    packet.semanticModel.coverage.ruleReadiness.map((entry) => entry.ruleId),
    [componentRuleId]
  );
});

test('Apollo compact pattern packet removes redundant structural transport facts', () => {
  const packet = compactResolvedPatternAuditPacket({
    schemaVersion: 1,
    documentType: 'apollo-resolved-pattern-audit-packet',
    mode: 'pattern-report',
    auditId: 'audit-compact-facts',
    context: { platform: 'desktop', pageType: 'form' },
    report: {},
    architectureAudit: { layoutRelations: [] },
    semanticModel: {
      schemaVersion: 1,
      documentType: 'apollo-semantic-audit-model',
      auditId: 'audit-compact-facts',
      context: { platform: 'desktop', pageType: 'form' },
      facts: [{
        id: 'fact-component-long-hash',
        kind: 'component_occurrence',
        semantics: ['component'],
        subject: {
          nodeId: '1:2',
          name: 'Button',
          path: 'Page/Form/Button',
          componentKey: 'button-key',
          componentName: 'Button',
        },
        factPath: 'architecture.component.1:2.occurrence',
        component: {
          variantProperties: { View: 'Primary' },
          componentProperties: { View: 'Primary' },
          owner: {
            nodeId: '1:1',
            name: 'Form',
            relativePath: 'Page/Very/Long/Form/Button',
          },
        },
        evidence: { source: 'figma_snapshot', quality: 'exact' },
      }, {
        id: 'fact-owner-long-hash',
        kind: 'relation',
        semantics: ['composition'],
        subject: { nodeId: '1:1', name: 'Form' },
        target: { nodeId: '1:2', name: 'Button' },
        factPath: 'architecture.composition.1:1.1:2.componentOwner',
        relation: { structuralKind: 'component-owner' },
      }, {
        id: 'fact-layout-component-long-hash',
        kind: 'layout_state',
        semantics: ['layout'],
        subject: {
          nodeId: '1:2',
          name: 'Button',
          componentName: 'Button',
        },
        factPath: 'architecture.layout.1:2.state',
        layout: { bounds: { x: 0, y: 0, width: 100, height: 40 } },
      }, {
        id: 'fact-layout-unrelated-long-hash',
        kind: 'layout_state',
        semantics: ['layout'],
        subject: { nodeId: '9:9', name: 'Decorative frame' },
        factPath: 'architecture.layout.9:9.state',
        layout: { bounds: { x: 0, y: 0, width: 10, height: 10 } },
      }],
      rules: [],
      coverage: {
        factCount: 4,
        ruleCount: 0,
        factKinds: { component_occurrence: 1, relation: 1, layout_state: 2 },
        semantics: { component: 1, composition: 1, layout: 2 },
        ruleReadiness: [],
      },
    },
    resolution: {},
    observations: [],
  });

  assert.equal(packet.transport.fullFactCount, 4);
  assert.equal(packet.transport.transmittedFactCount, 2);
  assert.equal(packet.transport.omittedFactCount, 2);
  assert.deepEqual(
    packet.semanticModel.facts.map((fact) => fact.id),
    ['f1', 'f2']
  );
  assert.equal(
    packet.semanticModel.facts.some(
      (fact) => fact.relation?.structuralKind === 'component-owner'
    ),
    false
  );
  const occurrence = packet.semanticModel.facts[0];
  assert.equal('evidence' in occurrence, false);
  assert.equal('path' in occurrence.subject, false);
  assert.equal('componentProperties' in occurrence.component, false);
  assert.equal('relativePath' in occurrence.component.owner, false);
  assert.equal(validateApolloSemanticModel(packet.semanticModel), null);
});

test('Apollo pattern audit splits one frozen snapshot into faceted passes', () => {
  const facts = [{
    id: 'component-1',
    kind: 'component_occurrence',
    semantics: ['component'],
    subject: { nodeId: '1:1', componentName: 'BackgroundPlate' },
    factPath: 'architecture.component.1:1.occurrence',
    component: { variantProperties: { Type: 'Primary' } },
  }, {
    id: 'property-component',
    kind: 'property_state',
    semantics: ['baseline', 'relative_fact'],
    subject: { nodeId: '1:1', componentName: 'BackgroundPlate' },
    factPath: 'variant.Type',
    property: 'variant.Type',
    baseline: { value: 'Primary' },
    actual: { value: 'Secondary' },
    candidateRuleIds: ['rule:component'],
  }, {
    id: 'property-binding',
    kind: 'property_state',
    semantics: ['baseline', 'relative_fact', 'token_binding'],
    subject: { nodeId: '1:1', componentName: 'BackgroundPlate' },
    factPath: 'layout.padding.right',
    property: 'layout.padding.right',
    baseline: { value: 24 },
    actual: { value: 32 },
    binding: { status: 'missing' },
    candidateRuleIds: ['rule:binding'],
  }, {
    id: 'relation-1',
    kind: 'relation',
    semantics: ['composition', 'page_relation'],
    subject: { nodeId: '1:1' },
    target: { nodeId: '1:2' },
    factPath: 'architecture.pageRelation.1:1.1:2.gap',
    relation: { containerNodeId: '1:0', measurement: { actualPx: 48 } },
  }].map((fact, index) => ({
    ...fact,
    ...classifySemanticFact(fact),
    id: fact.id || `fact-${index}`,
  }));
  const rules = [{
    id: 'rule:component',
    scope: 'component',
    appliesTo: 'variant.Type',
    authoritative: true,
  }, {
    id: 'rule:binding',
    scope: 'slot',
    appliesTo: 'layout.padding.*|token.binding',
    authoritative: true,
  }, {
    id: 'rule:layout',
    scope: 'page',
    appliesTo: 'screen.layout',
    authoritative: true,
  }];
  const packet = {
    schemaVersion: 1,
    documentType: 'apollo-resolved-pattern-audit-packet',
    transport: { mode: 'semantic-v1' },
    mode: 'pattern-report',
    auditId: 'audit-faceted',
    context: { platform: 'desktop', pageType: 'form' },
    report: {},
    architectureAudit: { layoutRelations: [] },
    semanticModel: {
      schemaVersion: 1,
      documentType: 'apollo-semantic-audit-model',
      auditId: 'audit-faceted',
      context: { platform: 'desktop', pageType: 'form' },
      facts,
      rules,
      coverage: { factCount: facts.length, ruleCount: rules.length },
    },
    resolution: {},
    observations: [],
  };

  const passes = buildPatternAuditPassPackets(packet);
  assert.deepEqual(
    passes.map((pass) => pass.auditPass.id),
    ['component-contract', 'visual-bindings', 'layout-patterns']
  );
  assert.equal(new Set(
    passes.map((pass) => pass.transport.frozenSnapshot.checksum)
  ).size, 1);
  assert.deepEqual(
    passes.map((pass) => pass.auditPass.targets.map((target) => target.id)),
    [['property-component'], ['property-binding'], ['relation-1']]
  );
  assert.equal(
    passes[2].auditPass.targets[0].nodeId,
    '1:0',
    'Page-relation findings must focus the container that owns the spacing.',
  );
  assert.ok(
    passes[1].semanticModel.rules.find((rule) => rule.id === 'rule:binding')
      .requirements.includes('resource-bindings')
  );
});

test('Apollo faceted merge preserves every target and repairs missing coverage', () => {
  const pass = (id, target) => ({
    auditPass: { id, targets: [target] },
  });
  const response = (assessment) => ({
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: 'audit-merge',
    runStatus: 'completed',
    coverage: 'full',
    assessments: assessment ? [assessment] : [],
    summaryText: '',
    clarificationQuestions: [],
  });
  const merged = mergeCompactPatternAssessmentResponses([{
    pass: pass('component-contract', {
      id: 'fact-a', nodeId: '1:1', factPath: 'variant.View', kind: 'property_state',
    }),
    result: response({
      id: 'a', nodeId: '1:1', factPath: 'variant.View', disposition: 'allowed',
      ruleId: 'rule:a', title: 'ok', rationale: 'ok', expectation: 'ok', fix: 'ok',
    }),
  }, {
    pass: pass('layout-patterns', {
      id: 'fact-b', nodeId: '1:2', factPath: 'layout.gap', kind: 'property_state',
    }),
    result: response(null),
  }], { auditId: 'audit-merge' });

  assert.equal(merged.assessments.length, 2);
  assert.equal(merged.assessments[0].id, 'component-contract:a');
  assert.equal(merged.assessments[1].disposition, 'human_review');
  assert.equal(merged.coverage, 'partial');
});

test('Apollo faceted merge classifies property facts excluded from agent targets', () => {
  const packet = {
    auditId: 'audit-narrative-property',
    semanticModel: {
      facts: [{
        id: 'narrative-property',
        kind: 'property_state',
        subject: { nodeId: '1:1', componentName: '[D] Alpha' },
        factPath: 'variant.Type',
        baseline: { value: 'Primary' },
        actual: { value: 'Secondary' },
        candidateRuleIds: ['component:web-corp.alpha.component-properties-are-first-class'],
      }],
      rules: [{
        id: 'component:web-corp.alpha.component-properties-are-first-class',
        effect: 'unknown',
        authoritative: false,
        constraintModel: { predicates: [] },
      }],
    },
    resolution: {},
  };
  const result = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: packet.auditId,
    runStatus: 'completed',
    coverage: 'full',
    assessments: [],
    summaryText: '',
    clarificationQuestions: [],
  };

  const merged = mergeCompactPatternAssessmentResponses([{
    pass: {
      auditPass: {
        id: 'component-contract',
        runKey: 'component-contract.1',
        targets: [],
      },
    },
    result,
  }], packet);

  assert.equal(merged.coverage, 'partial');
  assert.equal(merged.assessments.length, 1);
  assert.equal(merged.assessments[0].nodeId, '1:1');
  assert.equal(merged.assessments[0].factPath, 'variant.Type');
  assert.equal(merged.assessments[0].disposition, 'human_review');
  assert.equal(merged.assessments[0].ruleId, null);
  assert.match(merged.assessments[0].title, /Нужно проверить Type у \[D\] Alpha/);
  assert.match(merged.assessments[0].expectation, /Secondary/);
});

test('Apollo faceted merge repairs a container nodeId for a unique target factPath', () => {
  const factPath = 'architecture.semanticGap.1:1.1:2.actualPx';
  const result = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: 'audit-target-node-repair',
    runStatus: 'completed',
    coverage: 'full',
    assessments: [{
      id: 'gap',
      nodeId: '1:0',
      factPath,
      disposition: 'error',
      ruleId: 'rule:gap',
      title: 'Неверный отступ',
      rationale: 'Получен другой размер.',
      expectation: 'Использовать нормативный отступ.',
      fix: 'Исправить отступ.',
    }],
    summaryText: '',
    clarificationQuestions: [],
  };
  const merged = mergeCompactPatternAssessmentResponses([{
    pass: {
      auditPass: {
        id: 'layout-patterns',
        runKey: 'layout-patterns.1',
        targets: [{
          id: 'gap-fact',
          nodeId: '1:1',
          factPath,
          kind: 'relation',
        }],
      },
    },
    result,
  }], {
    auditId: result.auditId,
    semanticModel: { facts: [], rules: [] },
    resolution: {},
  });

  assert.equal(merged.assessments.length, 1);
  assert.equal(merged.assessments[0].nodeId, '1:1');
  assert.equal(merged.assessments[0].factPath, factPath);
  assert.equal(merged.coverage, 'full');
});

test('Apollo faceted packets prune unrelated aggregates and narrative-only targets', () => {
  const classify = (fact) => ({ ...fact, ...classifySemanticFact(fact) });
  const facts = [
    classify({
      id: 'component-alpha', kind: 'component_occurrence', semantics: ['component'],
      subject: { nodeId: '1:1', componentName: '[D] Alpha' },
      factPath: 'architecture.component.1:1.occurrence',
      component: { parentNodeId: '1:0', variantProperties: {} },
    }),
    classify({
      id: 'aggregate-alpha', kind: 'group_aggregate', semantics: ['aggregate', 'composition'],
      subject: { nodeId: '1:1', name: '[D] Alpha' },
      factPath: 'architecture.aggregate.1:1.directChildren',
      aggregate: { directComponentCount: 1, memberNodeIds: ['1:2'] },
    }),
    classify({
      id: 'component-beta', kind: 'component_occurrence', semantics: ['component'],
      subject: { nodeId: '2:1', componentName: '[D] Beta' },
      factPath: 'architecture.component.2:1.occurrence',
      component: { parentNodeId: '2:0', variantProperties: {} },
    }),
    classify({
      id: 'aggregate-beta', kind: 'group_aggregate', semantics: ['aggregate', 'composition'],
      subject: { nodeId: '2:1', name: '[D] Beta' },
      factPath: 'architecture.aggregate.2:1.directChildren',
      aggregate: { directComponentCount: 1, memberNodeIds: ['2:2'] },
    }),
    classify({
      id: 'narrative-property', kind: 'property_state',
      semantics: ['baseline', 'relative_fact'],
      subject: { nodeId: '1:1', componentName: '[D] Alpha' },
      factPath: 'variant.View', property: 'variant.View',
      baseline: { value: 'A' }, actual: { value: 'B' },
      candidateRuleIds: ['component:web-corp.alpha.component-properties-are-first-class'],
    }),
  ];
  const rules = [{
    id: 'component:web-corp.alpha.structure', effect: 'violation',
    scope: 'composition', authoritative: true,
    authority: { status: 'active' },
    conditions: { component: '[D] Alpha' },
    constraintModel: { predicates: [{ field: 'maximumChildren', value: 1 }] },
  }, {
    id: 'component:web-corp.alpha.component-properties-are-first-class',
    effect: 'unknown', scope: 'component', authoritative: false,
    authority: null, constraintModel: { predicates: [] },
  }];
  const packet = {
    transport: { mode: 'semantic-v1' }, auditId: 'audit-local-subgraph',
    context: { figma: { rootNodeId: '1:0' } }, report: { scan: { selection: [] } },
    semanticModel: { facts, rules, coverage: {} }, observations: [], resolution: {},
  };

  const passes = buildPatternAuditPassPackets(packet);
  const componentPass = passes.find((pass) => pass.auditPass.id === 'component-contract');
  assert.deepEqual(
    componentPass.auditPass.targets.map((target) => target.id),
    ['aggregate-alpha']
  );
  assert.equal(
    componentPass.semanticModel.facts.some((fact) => fact.id === 'aggregate-beta'),
    false
  );
  assert.equal(
    componentPass.semanticModel.rules.some((rule) => (
      rule.id.endsWith('component-properties-are-first-class')
    )),
    false
  );
});

test('Apollo rule coverage requires the exact layout relation', () => {
  const rule = {
    id: 'rule:title-spacing', effect: 'violation', scope: 'page',
    authoritative: true, authority: { status: 'active' },
    assertion: {
      kind: 'vertical-spacing-relations',
      expectations: [{ fromRole: 'header', toRole: 'title-view', spacing: 40 }],
    },
    requiredEvidence: [
      'facts.layoutRelations[].relationKind',
      'facts.layoutRelations[].measurement.actualPx',
    ],
    constraintModel: { predicates: [] },
  };
  const baseFacts = [{
    id: 'header', kind: 'component_occurrence',
    subject: { nodeId: '1:1', componentName: '[D] Header' },
  }, {
    id: 'title', kind: 'component_occurrence',
    subject: { nodeId: '1:2', componentName: '[D] TitleView' },
  }, {
    id: 'layout', kind: 'layout_state', subject: { nodeId: '1:0' },
  }, {
    id: 'other-relation', kind: 'relation', semantics: ['page_relation'],
    subject: { nodeId: '2:1' }, target: { nodeId: '2:2' },
    factPath: 'architecture.semanticGap.2:1.2:2.actualPx',
    relation: { fromRole: 'first-level-block', toRole: 'first-level-block' },
  }];
  const missing = buildSemanticRuleCoverage([rule], baseFacts, {})[0];
  assert.equal(missing.status, 'not_evaluable');
  assert.equal(missing.reason, 'missing-required-evidence');
  assert.deepEqual(missing.missingEvidence, ['layoutRelation:header->title-view']);

  const ready = buildSemanticRuleCoverage([rule], [...baseFacts, {
    id: 'title-relation', kind: 'relation', semantics: ['page_relation'],
    subject: { nodeId: '1:1' }, target: { nodeId: '1:2' },
    factPath: 'architecture.pageRelation.1:1.1:2.gap',
    relation: { fromRole: 'header', toRole: 'title-view' },
  }], {})[0];
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.missingEvidence, []);
});

test('Apollo faceted merge exposes requested rules with missing evidence', () => {
  const ruleId = 'rule:components.title-view.external-spacing';
  const packet = {
    auditId: 'audit-missing-evidence',
    context: { figma: { rootNodeId: '1:0' } },
    report: { scan: { selection: [{ nodeId: '1:0', name: 'Page' }] } },
    resolution: { requestedRuleIds: [ruleId] },
    semanticModel: {
      facts: [{
        id: 'layout', kind: 'layout_state', subject: { nodeId: '1:0' },
      }],
      rules: [{
        id: ruleId, effect: 'violation', scope: 'page', authoritative: true,
        authority: { status: 'active' },
        requiredEvidence: ['facts.layoutRelations[].measurement.actualPx'],
        assertion: { kind: 'vertical-spacing-relations', expectations: [] },
        constraintModel: { predicates: [] },
      }],
    },
  };
  const result = {
    schemaVersion: 1,
    documentType: 'apollo-pattern-assessment-response',
    auditId: packet.auditId,
    runStatus: 'completed',
    coverage: 'full',
    assessments: [],
    summaryText: '',
    clarificationQuestions: [],
  };
  const merged = mergeCompactPatternAssessmentResponses([{
    pass: { auditPass: { id: 'layout-patterns', runKey: 'layout.1', targets: [] } },
    result,
  }], packet);

  assert.equal(merged.coverage, 'partial');
  assert.equal(merged.assessments.length, 1);
  assert.equal(merged.assessments[0].ruleId, ruleId);
  assert.equal(merged.assessments[0].disposition, 'human_review');
  assert.match(merged.assessments[0].factPath, /^coverage\.rule\./);

  const payload = patternReportPayload();
  payload.report.reportId = packet.auditId;
  payload.report.requestedRuleIds = [ruleId];
  const expanded = expandCompactPatternAssessmentResponse(
    merged,
    payload,
    skillManifest(),
    packet
  );
  assert.equal(
    expanded.findings[0].fact,
    'Не определены связи TitleView с соседними блоками.'
  );
});

test('Apollo semantic rule requirements keep cross-domain dependencies', () => {
  const requirements = classifySemanticRuleRequirements({
    scope: 'composition',
    appliesTo: 'layout.padding.*|token.binding',
    text: 'Padding слота должен быть привязан к Spacing token.',
  });
  assert.deepEqual(requirements, [
    'composition-slots',
    'layout-geometry',
    'resource-bindings',
  ]);
});

test('Apollo semantic model prefers current authoritative rules over stale report copies', () => {
  const payload = reportPayload();
  const change = payload.report.category.items[0].changes[0];
  change.componentRules = [{
    ruleId: 'component:test.current-authority',
    severity: 'error',
    matchKind: 'exact_component_rule',
  }];
  const request = buildApolloCustomizationReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const model = buildApolloSemanticModel(request, {
    additionalRules: [{
      rule: activeComponentRule('component:test.current-authority'),
      evidence: {
        source: 'design-system_ab',
        path: 'JSONS/web/components/test/rules.json',
        ruleId: 'component:test.current-authority',
        verified: true,
      },
    }],
  });
  const rule = model.rules.find(
    (item) => item.id === 'component:test.current-authority'
  );
  assert.equal(rule.authoritative, true);
  assert.equal(rule.source.path, 'JSONS/web/components/test/rules.json');
});

test('Apollo pattern compatibility projection receives canonical component authority', () => {
  const category = reportPayload().report.category;
  const change = category.items[0].changes[0];
  change.componentRules = [{
    ruleId: 'component:test.current-authority',
    severity: 'warning',
    ruleKind: null,
    authority: null,
    ruleText: 'Stale compatibility copy.',
  }];
  const hydrated = hydrateReportComponentRuleAuthority(category, [{
    id: 'component:test.current-authority',
    authoritative: true,
    severity: 'error',
    appliesTo: 'variant.View',
    text: 'Canonical active rule.',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 1,
    },
  }]);
  const rule = hydrated.items[0].changes[0].componentRules[0];
  assert.equal(rule.ruleKind, 'design-rule');
  assert.equal(rule.severity, 'error');
  assert.equal(rule.ruleText, 'Canonical active rule.');
  assert.equal(rule.authority.status, 'active');
  assert.equal(category.items[0].changes[0].componentRules[0].authority, null);
});

test('Apollo proxy measures and rejects prompts outside the safe input budget', () => {
  const metrics = buildCodexInputMetrics('short prompt', {
    architectureAudit: { evidenceBundle: { graph: { nodes: [] } } },
  });
  assert.equal(metrics.promptChars, 12);
  assert.equal(metrics.withinBudget, true);
  assert.doesNotThrow(() => assertCodexInputWithinBudget(metrics));
  assert.throws(
    () => assertCodexInputWithinBudget({
      ...metrics,
      promptChars: metrics.budgetChars + 1,
      withinBudget: false,
    }),
    (error) => error.code === 'CODEX_INPUT_BUDGET_EXCEEDED' &&
      error.status === 413
  );
});

test('Apollo proxy rejects hidden nodes in the architecture evidence bundle', () => {
  const payload = patternReportPayload();
  payload.report.evidenceBundle.graph.nodes[0].visible = false;
  assert.equal(
    validateCodexReportRequest(payload),
    'Apollo evidenceBundle must contain visible graph nodes only.'
  );
});

test('Apollo proxy persists private debug artifacts by run id', async () => {
  const debugRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'apollo-debug-artifacts-')
  );
  try {
    const filePath = await writeCodexDebugArtifact(
      'run:test/unsafe',
      '02-resolved-packet.json',
      { documentType: 'apollo-resolved-pattern-audit-packet' },
      debugRoot
    );
    assert.equal(
      path.dirname(filePath),
      path.join(debugRoot, 'run_test_unsafe')
    );
    assert.deepEqual(
      JSON.parse(await fsp.readFile(filePath, 'utf8')),
      { documentType: 'apollo-resolved-pattern-audit-packet' }
    );
  } finally {
    await fsp.rm(debugRoot, { recursive: true, force: true });
  }
});

test('Apollo proxy passes raw TitleView layout relations to an active general rule', async () => {
  const payload = patternReportPayload();
  payload.report.scan.pageType = null;
  payload.report.requestedRuleIds = [
    'rule:components.title-view.external-spacing',
  ];
  payload.report.summary.requestedRuleCount = 1;
  payload.report.summary.layoutRelationCount = 1;
  payload.report.facts.layoutRelations = [{
    id: '1:3>1:5:next-content-gap',
    axis: 'vertical',
    relationKind: 'next-content-gap',
    from: {
      nodeId: '1:3',
      name: '[D] TitleView',
      type: 'INSTANCE',
      path: 'Form / [D] TitleView',
    },
    to: {
      nodeId: '1:5',
      name: 'Body',
      type: 'FRAME',
      path: 'Form / Body',
    },
    container: {
      nodeId: '1:1',
      name: 'Form',
      type: 'SECTION',
      path: 'Form',
      layoutMode: 'VERTICAL',
      itemSpacing: 40,
    },
    measurement: { actualPx: 40, source: 'bounding-box-gap' },
    semantic: { fromRole: 'title-view', toRole: 'content' },
    contextComplete: true,
  }];

  const request = buildApolloPatternReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  const packet = await buildResolvedPatternAuditPacket(request, {
    knowledgeSource: 'design-system_ab',
    designSystemRoot: packetSourceRoots.designSystemRoot,
    dsAiHubRoot: packetSourceRoots.dsAiHubRoot,
  });

  assert.deepEqual(packet.resolution.unresolvedRuleIds, []);
  assert.equal(packet.resolution.rules[0].rule.assertion.kind, 'vertical-spacing-relations');
  assert.equal(packet.architectureAudit.layoutRelations[0].measurement.actualPx, 40);
  assert.deepEqual(packet.observations, []);

  const prompt = buildCodexPrompt(
    '/tmp/pattern-request.json',
    'pattern-report',
    skillManifest(),
    { checksum: 'knowledge-checksum' },
    'packet',
    packet
  );
  assert.match(prompt, /vertical-spacing-relations/);
  assert.match(prompt, /Proxy не вычислял verdict/);
});

test('Apollo proxy builds a private text audit packet from editorial sources', async () => {
  const payload = textReportPayload();
  payload.report.facts.texts[0].owner.componentKey =
    '31f2ee6f9abd90f582f914d77f10e5a18ceaf708';
  assert.equal(validateCodexReportRequest(payload), null);

  const request = buildApolloTextReportSkillRequest(
    payload,
    payload.report,
    { knowledge: { checksum: 'knowledge-checksum' } }
  );
  assert.equal(request.documentType, 'apollo-text-audit-request');
  assert.equal(request.mode, 'text-report');
  assert.equal(request.context.platform, 'desktop');
  assert.equal(compactApolloTextReport(payload.report).facts.texts.length, 1);

  const packet = await buildResolvedTextAuditPacket(request, packetSourceRoots);
  assert.equal(packet.documentType, 'apollo-resolved-text-audit-packet');
  assert.equal(packet.report.facts, undefined);
  assert.equal(packet.report.summary.scannedTextNodes, 1);
  assert.equal(validateApolloSemanticModel(packet.semanticModel), null);
  assert.equal(packet.semanticModel.facts[0].kind, 'text_content');
  assert.deepEqual(packet.semanticModel.facts[0].semantics, ['text']);
  assert.equal(packet.semanticModel.facts[0].text.characters, 'Сохранение');
  assert.ok(packet.semanticModel.rules.length > 0);
  assert.ok(packet.semanticModel.rules.every((rule) => (
    /(^|[|.])text([|.]|$)/i.test(rule.appliesTo || '')
  )));
  assert.ok(packet.resolution.redpolDocuments.length > 0);
  assert.ok(packet.resolution.redpolDocuments.some(
    (document) => document.rules.some((rule) => rule.id.startsWith('redpol:'))
  ));
  assert.ok(packet.resolution.patternRules.some(
    (rule) => rule.id === 'rule:controls.buttons-and-button-groups.action-verb'
  ));

  const prompt = buildCodexPrompt(
    '/tmp/text-request.json',
    'text-report',
    skillManifest(),
    { checksum: 'knowledge-checksum' },
    'packet',
    packet
  );
  assert.match(prompt, /read-only редакторский аудитор/);
  assert.match(prompt, /единственное представление текстовых фактов/);
  assert.doesNotMatch(prompt, /report\.facts\.texts/);
  assert.match(prompt, /classifications всегда пустой массив/);
  assert.match(prompt, /focus_node и open_source/);
  assert.doesNotMatch(prompt, /Используй \$apollo-design-validator/);
});

test('Apollo text audit accepts findings without customization classifications', () => {
  const payload = textReportPayload();
  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  const ruleId = 'rule:controls.buttons-and-button-groups.action-verb';
  response.auditId = payload.report.reportId;
  response.coverage = 'partial';
  response.summary.checkedNodes = 1;
  response.summary.skippedRuleGroups = [
    'layout-patterns',
    'non-text-component-audit',
  ];
  response.findings[0].nodeId = '1:5';
  response.findings[0].ruleId = ruleId;
  response.findings[0].factPath = 'text.characters';
  response.findings[0].dedupeKey = `1:5|${ruleId}|text.characters`;
  response.findings[0].category = 'editorial-rule';
  response.findings[0].title = 'Название кнопки не выражает действие';
  response.findings[0].fact = 'Сохранение';
  response.findings[0].expectation = 'Использовать глагол действия';
  response.findings[0].fix = 'Сохранить';
  response.findings[0].verifiedEvidence[0].factPath = 'text.characters';
  response.findings[0].verifiedEvidence[0].actual = 'Сохранение';
  response.findings[0].verifiedEvidence[1].source = 'design-system_ab';
  response.findings[0].verifiedEvidence[1].path =
    'patterns/p_buttons-and-buttons-group.md';
  response.findings[0].verifiedEvidence[1].ruleId = ruleId;
  response.findings[0].actions[0].payload = [{ key: 'nodeId', value: '1:5' }];
  response.sourceTrace.usedSources[0].source = 'design-system_ab';
  response.sourceTrace.usedSources[0].path =
    'patterns/p_buttons-and-buttons-group.md';
  response.sourceTrace.usedSources[0].ruleIds = [ruleId];

  const normalized = validateApolloSkillResponse(response, payload, manifest);
  assert.equal(normalized.classifications.length, 0);
  assert.equal(normalized.findings[0].factPath, 'text.characters');

  const unsafeResponse = structuredClone(response);
  unsafeResponse.findings[0].actions[0].type = 'propose_mutation';
  assert.throws(
    () => validateApolloSkillResponse(unsafeResponse, payload, manifest),
    /unsupported text-audit action/,
  );
});

test('Apollo text audit downgrades component guidance without active authority', async () => {
  const payload = textReportPayload();
  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  const ruleId = 'component:test.inactive-text-guidance';
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-text-authority-'));
  const rulesPath = path.join(root, 'JSONS', 'Test', 'rules.json');
  await fsp.mkdir(path.dirname(rulesPath), { recursive: true });
  await fsp.writeFile(rulesPath, JSON.stringify({
    rules: [{
      ruleId,
      severity: 'warning',
      ruleKind: null,
      authority: null,
    }],
  }));
  try {
    response.auditId = payload.report.reportId;
    response.coverage = 'partial';
    response.summary = {
      checkedNodes: 1,
      errors: 0,
      warnings: 1,
      humanReview: 0,
      allowed: 1,
      contextHints: 0,
      skippedRuleGroups: ['layout-patterns', 'non-text-component-audit'],
    };
    response.findings[0] = {
      ...response.findings[0],
      nodeId: '1:5',
      ruleId,
      factPath: 'text.characters',
      dedupeKey: `1:5|${ruleId}|text.characters`,
      priority: 'warning',
      verifiedEvidence: [
        {
          ...response.findings[0].verifiedEvidence[0],
          ruleId,
          factPath: 'text.characters',
          actual: 'Сохранение',
        },
        {
          ...response.findings[0].verifiedEvidence[1],
          kind: 'component_contract',
          source: 'design-system_ab',
          path: 'JSONS/Test/rules.json',
          ruleId,
        },
      ],
      actions: [{
        type: 'focus_node',
        label: 'Показать',
        userDecisionRequired: true,
        payload: [{ key: 'nodeId', value: '1:5' }],
      }],
    };
    response.sourceTrace.usedSources[0] = {
      ...response.sourceTrace.usedSources[0],
      source: 'design-system_ab',
      path: 'JSONS/Test/rules.json',
      ruleIds: [ruleId],
    };

    const normalized = validateApolloSkillResponse(
      response,
      payload,
      manifest,
      { designSystem: root }
    );
    assert.equal(normalized.findings[0].priority, 'human_review');
    assert.equal(normalized.findings[0].evidenceStatus, 'unresolved');
    assert.equal(normalized.findings[0].verifiedEvidence.length, 1);
    assert.equal(normalized.summary.warnings, 0);
    assert.equal(normalized.summary.humanReview, 1);
    assert.equal(normalized.summary.allowed, 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('Apollo pattern findings remove accidental structural classifications', () => {
  const payload = patternReportPayload();
  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  const ruleId = 'rule:forms.construction-rules.title-medium-one-per-plate';
  const factPath = `patterns.${ruleId}.matchingTargetCount`;
  response.auditId = payload.report.reportId;
  response.coverage = 'partial';
  response.summary.checkedNodes = 3;
  response.summary.skippedRuleGroups = [
    'component-customizations',
    'editorial-rules',
    'other-pattern-rules',
  ];
  response.findings[0].nodeId = '1:2';
  response.findings[0].ruleId = ruleId;
  response.findings[0].factPath = factPath;
  response.findings[0].dedupeKey = `1:2|${ruleId}|${factPath}`;
  response.findings[0].category = 'patterns';
  response.findings[0].verifiedEvidence[0].ruleId = ruleId;
  response.findings[0].verifiedEvidence[0].factPath = factPath;
  response.findings[0].verifiedEvidence[0].actual = 2;
  response.findings[0].verifiedEvidence[0].expected = 1;
  response.findings[0].verifiedEvidence[1] = {
    ...response.findings[0].verifiedEvidence[1],
    source: 'ds-ai-hub',
    path: 'products/ab/patterns/form-construction-rules.md',
    ruleId,
  };
  response.sourceTrace.usedSources[0] = {
    ...response.sourceTrace.usedSources[0],
    source: 'ds-ai-hub',
    path: 'products/ab/patterns/form-construction-rules.md',
    ruleIds: [ruleId],
  };
  response.classifications = [{
    nodeId: '1:2',
    factPath,
    disposition: 'error',
    findingId: 'finding-1',
    ruleId,
    rationale: 'The page-specific form rule is violated.',
  }];

  assert.equal(
    validateApolloSkillResponse(response, payload, manifest),
    response
  );
  assert.deepEqual(response.classifications, []);
});

test('Apollo pattern report requires classifications for every general change', () => {
  const payload = patternReportPayload();
  const sourceChange = reportPayload().report.category.items[0].changes[0];
  payload.report.category = reportPayload().report.category;
  payload.report.category.count = 1;
  payload.report.category.changeCount = 1;
  payload.report.summary.generalChangeCount = 1;
  payload.report.category.items[0].changes[0] = {
    ...sourceChange,
    node: { id: '1:9', name: 'Nested label', visible: true },
    assessment: {
      verdict: 'violation',
      ruleId: 'component:test.view',
    },
    componentRules: [activeComponentRule('component:test.view')],
  };

  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.coverage = 'partial';
  response.summary.checkedNodes = 3;
  response.summary.skippedRuleGroups = ['editorial-rules', 'other-pattern-rules'];
  response.findings[0].nodeId = '1:9';
  response.findings[0].ruleId = 'component:test.view';
  response.findings[0].factPath =
    'generalAudit.items[0].changes[0].variant.View';
  response.findings[0].dedupeKey =
    '1:9|component:test.view|generalAudit.items[0].changes[0].variant.View';
  response.findings[0].verifiedEvidence[0].ruleId = 'component:test.view';
  response.findings[0].verifiedEvidence[0].factPath = 'variant.View';
  response.findings[0].verifiedEvidence[1] = {
    ...response.findings[0].verifiedEvidence[1],
    kind: 'component_contract',
    source: 'design-system_ab',
    path: 'JSONS/web/components/test/rules.json',
    ruleId: 'component:test.view',
  };
  response.classifications = [{
    nodeId: '1:9',
    factPath: 'generalAudit.items[0].changes[0].variant.View',
    disposition: 'error',
    findingId: 'finding-1',
    ruleId: 'component:test.view',
    rationale: 'Active component design rule fixes the View.',
  }];

  assert.equal(
    validateApolloSkillResponse(response, payload, manifest),
    response
  );
  assert.equal(response.findings[0].factPath, 'variant.View');
  assert.equal(response.classifications[0].factPath, 'variant.View');
});

test('Apollo pattern report downgrades draft component evidence to human review instead of failing', () => {
  const payload = patternReportPayload();
  payload.report.category = reportPayload().report.category;
  payload.report.category.count = 1;
  payload.report.category.changeCount = 1;
  payload.report.summary.generalChangeCount = 1;
  payload.report.category.items[0].changes[0] = {
    ...payload.report.category.items[0].changes[0],
    node: { id: '1:9', name: 'Nested label', visible: true },
    assessment: {
      verdict: 'unknown',
      ruleId: null,
    },
    componentRules: [activeComponentRule('component:test.draft', {
      authority: {
        status: 'draft',
        provenance: 'design-system-author',
        revision: 1,
      },
    })],
  };

  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.coverage = 'partial';
  response.summary = {
    checkedNodes: 3,
    errors: 1,
    warnings: 0,
    humanReview: 0,
    allowed: 0,
    contextHints: 0,
    skippedRuleGroups: ['editorial-rules', 'other-pattern-rules'],
  };
  response.findings[0].nodeId = '1:9';
  response.findings[0].ruleId = 'component:test.draft';
  response.findings[0].factPath = 'variant.View';
  response.findings[0].dedupeKey = '1:9|component:test.draft|variant.View';
  response.findings[0].priority = 'error';
  response.findings[0].evidenceStatus = 'verified';
  response.findings[0].verifiedEvidence[0].ruleId = 'component:test.draft';
  response.findings[0].verifiedEvidence[0].factPath = 'variant.View';
  response.findings[0].verifiedEvidence[1] = {
    ...response.findings[0].verifiedEvidence[1],
    kind: 'component_contract',
    source: 'design-system_ab',
    path: 'JSONS/web/components/test/rules.json',
    ruleId: 'component:test.draft',
  };
  response.classifications = [{
    nodeId: '1:9',
    factPath: 'variant.View',
    disposition: 'error',
    findingId: 'finding-1',
    ruleId: 'component:test.draft',
    rationale: 'The component rule is still draft.',
  }];

  assert.equal(
    validateApolloSkillResponse(response, payload, manifest),
    response
  );
  assert.equal(response.findings[0].evidenceStatus, 'unresolved');
  assert.equal(response.findings[0].priority, 'human_review');
  assert.equal(response.classifications[0].disposition, 'human_review');
  assert.equal(response.summary.errors, 0);
  assert.equal(response.summary.humanReview, 1);
  assert.equal(
    response.findings[0].verifiedEvidence.some(
      (evidence) => evidence.kind === 'component_contract'
    ),
    false
  );
});

test('Apollo pattern report accepts current authority from the resolved semantic model', () => {
  const ruleId = 'component:test.current-rule';
  const payload = patternReportPayload();
  payload.report.category = reportPayload().report.category;
  payload.report.category.count = 1;
  payload.report.category.changeCount = 1;
  payload.report.summary.generalChangeCount = 1;
  payload.report.category.items[0].changes[0] = {
    ...payload.report.category.items[0].changes[0],
    node: { id: '1:9', name: 'Nested label', visible: true },
    assessment: { verdict: 'unknown', ruleId: null },
    componentRules: [{ ruleId, severity: 'error' }],
  };

  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.coverage = 'partial';
  response.summary = {
    checkedNodes: 3,
    errors: 1,
    warnings: 0,
    humanReview: 0,
    allowed: 0,
    contextHints: 0,
    skippedRuleGroups: ['editorial-rules', 'other-pattern-rules'],
  };
  response.findings[0] = {
    ...response.findings[0],
    nodeId: '1:9',
    ruleId,
    factPath: 'variant.View',
    dedupeKey: `1:9|${ruleId}|variant.View`,
    priority: 'error',
    evidenceStatus: 'verified',
    verifiedEvidence: [
      {
        ...response.findings[0].verifiedEvidence[0],
        ruleId,
        factPath: 'variant.View',
      },
      {
        ...response.findings[0].verifiedEvidence[1],
        kind: 'component_contract',
        source: 'design-system_ab',
        path: 'JSONS/web/components/test/rules.json',
        ruleId,
      },
    ],
  };
  response.classifications = [{
    nodeId: '1:9',
    factPath: 'variant.View',
    disposition: 'error',
    findingId: response.findings[0].id,
    ruleId,
    rationale: 'The current resolved package confirms the rule.',
  }];
  const requestDocument = {
    semanticModel: {
      rules: [{
        id: ruleId,
        authoritative: true,
        severity: 'error',
        appliesTo: 'variant.View',
        authority: {
          status: 'active',
          provenance: 'design-system-author',
          revision: 1,
        },
      }],
    },
  };

  assert.equal(
    validateApolloSkillResponse(
      response,
      payload,
      manifest,
      {},
      requestDocument
    ),
    response
  );
  assert.equal(response.findings[0].priority, 'error');
  assert.equal(response.findings[0].evidenceStatus, 'verified');
  assert.equal(response.classifications[0].disposition, 'error');
});

test('Apollo v3 compact report removes transport-heavy fields but keeps evidence facts', () => {
  const source = reportPayload().report;
  source.category.items[0].changes[0] = {
    ...source.category.items[0].changes[0],
    signature: 'large-derived-signature',
    presentation: { duplicated: true },
    assessment: {
      verdict: 'violation',
      source: 'component-contract',
      reasonCode: 'component-contract-violation',
      ruleId: 'component:test.view',
      message: 'View is fixed.',
    },
    reference: {
      value: 'Primary',
      resource: { type: 'token', name: 'primary', key: 'token-1', id: 'omit-id' },
      binding: { key: 'token-1', name: 'primary', collectionName: 'View', id: 'omit-id' },
    },
    actual: { value: 'Secondary' },
    context: {
      actualComponentKey: 'component-key',
      actualVariantProperties: { View: 'Secondary' },
      verboseUnusedField: 'omit',
    },
  };

  const compact = compactApolloCustomizationReport(source);
  const change = compact.category.items[0].changes[0];
  assert.equal(change.reference.resource.key, 'token-1');
  assert.equal(change.reference.resource.id, undefined);
  assert.equal(change.context.actualVariantProperties.View, 'Secondary');
  assert.equal(change.context.verboseUnusedField, undefined);
  assert.equal(change.signature, undefined);
  assert.equal(change.presentation, undefined);
  assert.equal(change.assessment.verdict, 'violation');
  assert.equal(change.assessment.ruleId, 'component:test.view');
});

test('Apollo v3 resolves a bounded audit packet without agent-side repository search', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-packet-test-'));
  const rulesPath = path.join(
    root,
    'JSONS',
    'web',
    'components',
    'test',
    'ButtonGroup',
    'rules.json'
  );
  await fsp.mkdir(path.dirname(rulesPath), { recursive: true });
  await fsp.writeFile(
    rulesPath,
    JSON.stringify({
      schemaVersion: 2,
      documentType: 'component-rules',
      manual: {
        rules: [{
          ruleId: 'component:test.button-group.view-is-fixed',
          ruleKind: 'design-rule',
          severity: 'error',
          authority: {
            status: 'active',
            provenance: 'design-system-author',
            revision: 1,
          },
        }],
      },
    }),
    'utf8'
  );

  try {
    const payload = reportPayload();
    const request = buildApolloCustomizationReportSkillRequest(
      payload,
      payload.report,
      { knowledge: { checksum: 'knowledge-checksum' } }
    );
    const keys = collectApolloReportComponentKeys(request.report);
    assert.deepEqual(keys, ['component-key', 'variant-key']);

    const packet = await buildResolvedAuditPacket(request, {
      knowledgeSource: 'design-system_ab',
      designSystemRoot: root,
      indexDocument: {
        schemaVersion: 2,
        generatedAt: '2026-08-14T00:00:00.000Z',
        packages: [{
          componentKey: 'test.button-group',
          packageName: 'ButtonGroup',
          packagePath: 'web/components/test/ButtonGroup',
          figmaKeys: ['component-key', 'variant-key'],
          artifacts: { rules: 'rules.json' },
          coverage: 'required',
        }],
      },
    });

    assert.equal(
      packet.documentType,
      'apollo-resolved-customization-audit-packet'
    );
    assert.equal(packet.resolution.packages.length, 1);
    assert.deepEqual(
      packet.resolution.packages[0].matchedKeys,
      ['component-key', 'variant-key']
    );
    assert.equal(
      packet.resolution.packages[0].rules.document.manual.rules[0].ruleId,
      'component:test.button-group.view-is-fixed'
    );
    assert.deepEqual(packet.resolution.unresolvedKeys, []);
    assert.equal(
      packet.semanticModel.rules.find(
        (rule) => rule.id === 'component:test.button-group.view-is-fixed'
      )?.authoritative,
      true
    );

    const prompt = buildCodexPrompt(
      '/tmp/packet.json',
      'customization-report',
      skillManifest(),
      { checksum: 'knowledge-checksum' },
      'packet',
      packet
    );
    assert.match(prompt, /Не вызывай skill, shell или другие tools/);
    assert.match(prompt, /apollo-resolved-customization-audit-packet/);
    assert.match(prompt, /component:test\.button-group\.view-is-fixed/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('Apollo v3 resolves component documents from ds-ai-hub by Figma key', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-ds-hub-test-'));
  const componentRoot = path.join(
    root,
    'products',
    'ab',
    'components',
    'button-group'
  );
  const patternRoot = path.join(root, 'products', 'ab', 'patterns');
  await fsp.mkdir(componentRoot, { recursive: true });
  await fsp.mkdir(patternRoot, { recursive: true });
  await fsp.writeFile(
    path.join(componentRoot, 'figma-keys.json'),
    JSON.stringify({
      components: {
        group: {
          componentSetKey: 'component-key',
          name: 'ButtonGroup',
        },
      },
    }),
    'utf8'
  );
  await fsp.writeFile(
    path.join(componentRoot, 'meta.json'),
    JSON.stringify({ id: 'ButtonGroup' }),
    'utf8'
  );
  await fsp.writeFile(
    path.join(componentRoot, 'instructions.md'),
    [
      '---',
      'status: verified',
      '---',
      '# ButtonGroup',
      '[Pattern](../../patterns/buttons-and-buttons-group.md)',
      '',
      '### Rule 1: Keep the group view',
      '',
      '- ruleId: rule:button-group.view',
      '- componentRuleId: component:test.button-group.view-is-fixed',
      '- ruleKind: design-rule',
      '- authorityStatus: active',
      '- authorityProvenance: design-system-author',
      '- authorityRevision: 1',
      '- severity: error',
      '- appliesTo: variant.View',
      '',
      'The group view is fixed by the component contract.',
    ].join('\n'),
    'utf8'
  );
  await fsp.writeFile(
    path.join(patternRoot, 'buttons-and-buttons-group.md'),
    ['---', 'status: draft', '---', '# Buttons pattern'].join('\n'),
    'utf8'
  );

  try {
    const payload = reportPayload();
    const request = buildApolloCustomizationReportSkillRequest(
      payload,
      payload.report,
      { knowledge: { checksum: null } }
    );
    const packet = await buildResolvedAuditPacket(request, {
      knowledgeSource: 'ds-ai-hub',
      dsAiHubRoot: root,
    });

    assert.equal(packet.resolution.source, 'ds-ai-hub');
    assert.deepEqual(packet.resolution.unresolvedKeys, []);
    assert.equal(packet.resolution.packages.length, 1);
    assert.deepEqual(
      packet.resolution.packages[0].matchedKeys,
      ['component-key', 'variant-key']
    );
    assert.deepEqual(
      packet.resolution.keyResolutions.map((item) => [
        item.componentKey,
        item.method,
      ]),
      [
        ['component-key', 'figma-key'],
        ['variant-key', 'report-name-alias'],
      ]
    );
    assert.deepEqual(
      packet.resolution.packages[0].documents.map((item) => [
        item.path,
        item.status,
      ]),
      [
        ['products/ab/components/button-group/instructions.md', 'verified'],
        ['products/ab/patterns/buttons-and-buttons-group.md', 'draft'],
      ]
    );
    assert.equal(
      packet.semanticModel.rules.find(
        (rule) => rule.id === 'component:test.button-group.view-is-fixed'
      )?.authoritative,
      true
    );

    const prompt = buildCodexPrompt(
      '/tmp/packet.json',
      'customization-report',
      skillManifest(),
      { checksum: null },
      'packet',
      packet
    );
    assert.match(prompt, /resolution\.source/);
    assert.match(prompt, /Draft, отсутствующий или malformed authority/);
    assert.match(prompt, /rule:button-group\.view/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('Apollo proxy validates report findings against report node ids', () => {
  const manifest = skillManifest();
  const payload = reportPayload();
  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.findings[0].nodeId = '1:3';
  response.findings[0].factPath = 'variant.View';
  response.findings[0].dedupeKey = '1:3|test.rule|variant.View';
  response.findings[0].verifiedEvidence[0].factPath = 'variant.View';
  response.classifications = [{
    nodeId: '1:3',
    factPath: 'variant.View',
    disposition: 'error',
    findingId: 'finding-1',
    ruleId: 'test.rule',
    rationale: 'Exact component rule.',
  }];

  const normalized = normalizeCodexValidation(response, payload, manifest);
  assert.equal(normalized.runId, payload.report.reportId);
  assert.equal(normalized.mode, 'customization-report');
  assert.equal(normalized.findings[0].nodeId, '1:3');
  assert.equal(normalized.summary.checkedNodes, 43);
  assert.equal(normalized.summary.allowed, 0);
});

test('Apollo proxy builds the normalized skill request', () => {
  const payload = snapshotPayload();
  const request = buildApolloSkillRequest(
    payload,
    payload.snapshot,
    skillManifest()
  );

  assert.equal(request.documentType, 'apollo-design-audit-request');
  assert.equal(request.context.platform, 'desktop');
  assert.equal(request.context.screenType, null);
  assert.equal(request.context.selectionScope, 'fragment');
  assert.equal(request.context.figma.rootNodeId, '1:2');
  assert.equal(request.snapshot.selection.length, 1);
  assert.equal(request.snapshot.screenshots.length, 1);
});

test('Apollo proxy validates and adapts a pinned skill response', () => {
  const manifest = skillManifest();
  const payload = snapshotPayload();
  const response = validSkillResponse(manifest);

  assert.equal(
    validateApolloSkillResponse(response, payload, manifest),
    response
  );
  const normalized = normalizeCodexValidation(response, payload, manifest);
  assert.equal(normalized.skill.checksum, manifest.checksum);
  assert.equal(normalized.coverage, 'base-only');
  assert.equal(normalized.findings[0].priority, 'error');
  assert.equal(normalized.findings[0].observed, 'actual.token');
  assert.deepEqual(normalized.summary, {
    checkedNodes: 1,
    errors: 1,
    warnings: 0,
    info: 0,
    allowed: 0,
  });
});

test('Apollo snapshot component-contract evidence requires active file authority', async () => {
  const manifest = skillManifest();
  const payload = snapshotPayload();
  const response = validSkillResponse(manifest);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-authority-'));
  const rulesPath = path.join(root, 'JSONS', 'Test', 'rules.json');
  await fsp.mkdir(path.dirname(rulesPath), { recursive: true });
  await fsp.writeFile(rulesPath, JSON.stringify({
    rules: [activeComponentRule('test.rule')],
  }));
  response.findings[0].verifiedEvidence[1] = {
    ...response.findings[0].verifiedEvidence[1],
    kind: 'component_contract',
    source: 'design-system_ab',
    path: 'JSONS/Test/rules.json',
  };

  assert.doesNotThrow(() => validateApolloSkillResponse(
    response,
    payload,
    manifest,
    { designSystem: root }
  ));

  const document = JSON.parse(await fsp.readFile(rulesPath, 'utf8'));
  document.rules[0].authority.status = 'draft';
  await fsp.writeFile(rulesPath, JSON.stringify(document));
  assert.throws(
    () => validateApolloSkillResponse(
      response,
      payload,
      manifest,
      { designSystem: root }
    ),
    (error) => (
      error.code === 'CODEX_SKILL_RESPONSE_INVALID' &&
      /without active authority/.test(error.message)
    )
  );
});

test('Apollo proxy repairs the derived finding dedupe key', () => {
  const manifest = skillManifest();
  const payload = snapshotPayload();
  const response = validSkillResponse(manifest);
  response.findings[0].dedupeKey = 'finding-title-typography';

  const validated = validateApolloSkillResponse(response, payload, manifest);

  assert.equal(
    validated.findings[0].dedupeKey,
    '1:2|test.rule|fill.token'
  );
});

test('Apollo proxy removes an unsafe mutation proposal without losing the finding', () => {
  const manifest = skillManifest();
  const payload = snapshotPayload();
  const response = validSkillResponse(manifest);
  response.findings[0].priority = 'warning';
  response.findings[0].actions.push({
    type: 'propose_mutation',
    label: 'Исправить',
    userDecisionRequired: true,
    payload: [{ key: 'token', value: 'expected.token' }],
  });
  response.summary.errors = 0;
  response.summary.warnings = 1;

  const validated = validateApolloSkillResponse(response, payload, manifest);

  assert.equal(validated.findings.length, 1);
  assert.deepEqual(
    validated.findings[0].actions.map((action) => action.type),
    ['focus_node']
  );
});

test('Apollo proxy still rejects duplicate atomic findings after dedupe repair', () => {
  const manifest = skillManifest();
  const payload = snapshotPayload();
  const response = validSkillResponse(manifest);
  const duplicate = JSON.parse(JSON.stringify(response.findings[0]));
  duplicate.id = 'finding-2';
  duplicate.dedupeKey = 'wrong-value';
  response.findings.push(duplicate);
  response.summary.errors = 2;

  assert.throws(
    () => validateApolloSkillResponse(response, payload, manifest),
    (error) => error.code === 'CODEX_SKILL_RESPONSE_INVALID'
  );
});

test('Apollo proxy rejects a response from a different skill build', () => {
  const manifest = skillManifest();
  const response = validSkillResponse(manifest);
  response.skill.checksum = '0'.repeat(64);

  assert.throws(
    () => validateApolloSkillResponse(response, snapshotPayload(), manifest),
    (error) => error.code === 'CODEX_SKILL_RESPONSE_INVALID'
  );
});

test('normalizer drops findings for node ids outside the snapshot', () => {
  const result = normalizeCodexValidation(
    {
      schemaVersion: 1,
      runId: 'model-run',
      mode: 'validation',
      status: 'completed',
      summary: { checkedNodes: 0, errors: 0, warnings: 0, info: 0 },
      findings: [
        { nodeId: '1:2', severity: 'error' },
        { nodeId: 'outside', severity: 'warning' },
      ],
      responseMarkdown: 'ok',
    },
    {
      mode: 'validation',
      snapshot: { runId: 'snapshot-run', nodes: [{ nodeId: '1:2' }] },
    }
  );

  assert.equal(result.runId, 'snapshot-run');
  assert.deepEqual(result.findings, [{ nodeId: '1:2', severity: 'error' }]);
  assert.deepEqual(result.summary, {
    checkedNodes: 1,
    errors: 1,
    warnings: 0,
    info: 0,
    allowed: 0,
  });
});

test('Apollo report rejects omitted or downgraded deterministic violations', () => {
  const manifest = skillManifest();
  const payload = reportPayload();
  const firstChange = payload.report.category.items[0].changes[0];
  firstChange.assessment = {
    verdict: 'violation',
    ruleId: 'buttons-group.composition.uniform-size',
  };
  firstChange.componentRules = [activeComponentRule(
    'buttons-group.composition.uniform-size'
  )];
  payload.report.category.items[0].changes.push({
    node: { id: '1:4', name: 'Button', visible: true },
    property: 'variant.SingleIcon',
    reference: { value: 'False' },
    actual: { value: 'True' },
    assessment: {
      verdict: 'violation',
      ruleId: 'buttons-group.composition.single-icon-position',
    },
    componentRules: [activeComponentRule(
      'buttons-group.composition.single-icon-position'
    )],
  });

  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.findings[0].nodeId = '1:3';
  response.findings[0].ruleId = 'buttons-group.composition.uniform-size';
  response.findings[0].factPath = 'variant.View';
  response.findings[0].dedupeKey =
    '1:3|buttons-group.composition.uniform-size|variant.View';
  response.findings[0].verifiedEvidence[0].factPath = 'variant.View';
  response.classifications = [{
    nodeId: '1:3',
    factPath: 'variant.View',
    disposition: 'error',
    findingId: 'finding-1',
    ruleId: 'buttons-group.composition.uniform-size',
    rationale: 'Locked deterministic violation.',
  }];

  assert.throws(
    () => validateApolloSkillResponse(response, payload, manifest),
    (error) => (
      error.code === 'CODEX_SKILL_RESPONSE_INVALID' &&
      /not fully classified/.test(error.message)
    )
  );

  response.classifications.push({
    nodeId: '1:4',
    factPath: 'variant.SingleIcon',
    disposition: 'allowed',
    findingId: null,
    ruleId: 'buttons-group.composition.single-icon-position',
    rationale: 'Incorrectly generalized Overflow permission.',
  });
  response.summary.allowed = 1;

  assert.throws(
    () => validateApolloSkillResponse(response, payload, manifest),
    (error) => (
      error.code === 'CODEX_SKILL_RESPONSE_INVALID' &&
      /downgrades a deterministic violation/.test(error.message)
    )
  );
});

test('Apollo report does not confirm a draft component design rule', () => {
  const manifest = skillManifest();
  const payload = reportPayload();
  const change = payload.report.category.items[0].changes[0];
  change.assessment = {
    verdict: 'violation',
    ruleId: 'component:test.draft-rule',
  };
  change.componentRules = [activeComponentRule(
    'component:test.draft-rule',
    { authority: {
      status: 'draft',
      provenance: 'design-system-author',
      revision: 1,
    } }
  )];

  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.findings[0].nodeId = '1:3';
  response.findings[0].ruleId = 'component:test.draft-rule';
  response.findings[0].factPath = 'variant.View';
  response.findings[0].dedupeKey =
    '1:3|component:test.draft-rule|variant.View';
  response.findings[0].verifiedEvidence[0].factPath = 'variant.View';
  response.classifications = [{
    nodeId: '1:3',
    factPath: 'variant.View',
    disposition: 'error',
    findingId: 'finding-1',
    ruleId: 'component:test.draft-rule',
    rationale: 'Draft rule must not confirm this error.',
  }];

  assert.doesNotThrow(
    () => validateApolloSkillResponse(response, payload, manifest)
  );
  assert.equal(response.findings[0].priority, 'human_review');
  assert.equal(response.findings[0].evidenceStatus, 'unresolved');
  assert.equal(response.classifications[0].disposition, 'human_review');
  assert.equal(response.summary.errors, 0);
  assert.equal(response.summary.humanReview, 1);
});

test('Apollo report preserves allowed customizations as a separate report section', async () => {
  const manifest = skillManifest();
  const payload = reportPayload();
  payload.report.category.items[0].changes[0].assessment = {
    verdict: 'allowed',
    ruleId: 'buttons-group.composition.single-icon-position',
  };
  payload.report.category.items[0].changes[0].componentRules = [
    activeComponentRule('buttons-group.composition.single-icon-position'),
  ];
  const response = validSkillResponse(manifest);
  response.auditId = payload.report.reportId;
  response.findings = [];
  response.summary.errors = 0;
  response.summary.allowed = 1;
  response.classifications = [{
    nodeId: '1:3',
    factPath: 'variant.View',
    disposition: 'allowed',
    findingId: null,
    ruleId: 'buttons-group.composition.single-icon-position',
    rationale: 'The exact composition rule permits this state.',
  }];
  response.sourceTrace.usedSources = [];

  const normalized = normalizeCodexValidation(response, payload, manifest);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-allowed-test-'));
  try {
    const verified = await verifyCodexEvidence(normalized, {
      dsAiHub: root,
      designSystem: root,
    });
    assert.equal(verified.findings.length, 0);
    assert.equal(verified.allowedCustomizations.length, 1);
    assert.equal(verified.summary.allowed, 1);
    assert.match(verified.responseMarkdown, /Допустимые кастомизации · 1/);
    assert.match(
      verified.responseMarkdown,
      /Button: variant\.View \| Primary → Secondary/
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('Codex JSONL events map to safe progress stages', () => {
  const event = parseCodexJsonEvent(
    '{"type":"item.started","item":{"type":"command_execution","command":"secret command"}}'
  );

  assert.equal(event.type, 'item.started');
  assert.equal(mapCodexEventToProgressStage(event), 'reading_design_system');
  assert.equal(
    mapCodexEventToProgressStage({
      type: 'item.completed',
      item: { type: 'reasoning', text: 'must stay private' },
    }),
    null
  );
  assert.equal(parseCodexJsonEvent('not-json'), null);
  assert.equal(
    mapCodexEventToProgressStage(
      { type: 'turn.started' },
      'analyzing_report'
    ),
    'analyzing_report'
  );
});

test('evidence verifier confirms real rules and rejects assumptions', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-evidence-test-'));
  const dsAiHub = path.join(root, 'ds-ai-hub');
  const designSystem = path.join(root, 'design-system_ab');
  await fsp.mkdir(path.join(dsAiHub, 'patterns'), { recursive: true });
  await fsp.mkdir(designSystem, { recursive: true });
  await fsp.writeFile(
    path.join(dsAiHub, 'patterns', 'button.md'),
    'Rule button.padding.horizontal: horizontal padding is 16.',
    'utf8'
  );

  try {
    const result = await verifyCodexEvidence(
      {
        mode: 'validation',
        status: 'completed',
        summary: { checkedNodes: 2, errors: 1, warnings: 1, info: 0 },
        sourcesUsed: [
          {
            source: 'ds-ai-hub',
            path: 'patterns/button.md',
            purpose: 'Button rules',
          },
          {
            source: 'design-system_ab',
            path: '../outside.md',
            purpose: 'Invalid traversal',
          },
        ],
        findings: [
          {
            id: 'confirmed',
            evidence: [
              {
                source: 'ds-ai-hub',
                path: 'patterns/button.md',
                ruleId: 'button.padding.horizontal',
                quote: null,
              },
            ],
          },
          {
            id: 'assumption',
            evidence: [
              {
                source: 'ds-ai-hub',
                path: 'patterns/button.md',
                ruleId: 'invented.rule',
                quote: null,
              },
            ],
          },
        ],
      },
      { dsAiHub, designSystem }
    );

    assert.equal(result.findings[0].verdict, 'confirmed');
    assert.equal(result.findings[0].verifiedEvidence[0].verified, true);
    assert.equal(result.findings[1].verdict, 'assumption');
    assert.equal(result.findings[1].verifiedEvidence[0].verified, false);
    assert.equal(result.sourcesUsed[0].verified, true);
    assert.equal(result.sourcesUsed[1].verified, false);
    assert.equal(result.summary.confirmed, 1);
    assert.equal(result.summary.assumptions, 1);
    assert.equal(result.status, 'needs_review');
    assert.match(result.responseMarkdown, /Подтверждённые нарушения/);
    assert.match(result.responseMarkdown, /Предположения агента/);
    assert.match(result.responseMarkdown, /Файлы, использованные при аудите/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('evidence verifier renders detailed Apollo v3 report findings', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-report-markdown-test-'));
  const dsAiHub = path.join(root, 'ds-ai-hub');
  const designSystem = path.join(root, 'design-system_ab');
  await fsp.mkdir(path.join(designSystem, 'contracts'), { recursive: true });
  await fsp.mkdir(dsAiHub, { recursive: true });
  await fsp.writeFile(
    path.join(designSystem, 'contracts', 'button-rules.json'),
    '{"ruleId":"button.view.fixed"}',
    'utf8'
  );

  try {
    const result = await verifyCodexEvidence(
      {
        mode: 'customization-report',
        status: 'completed',
        summary: { checkedNodes: 40, errors: 1, warnings: 0, info: 0 },
        responseMarkdown: 'Один override нарушает контракт.',
        sourcesUsed: [],
        findings: [
          {
            id: 'finding-1',
            title: 'Изменён view',
            observed: 'Primary → Secondary',
            expected: 'Primary',
            suggestedFix: 'Сбросить view',
            priority: 'error',
            evidence: [
              {
                source: 'design-system_ab',
                path: 'contracts/button-rules.json',
                ruleId: 'button.view.fixed',
                quote: null,
              },
            ],
          },
        ],
      },
      { dsAiHub, designSystem }
    );

    assert.match(result.responseMarkdown, /Apollo v3 · Кастомизации/);
    assert.match(result.responseMarkdown, /Один override нарушает контракт/);
    assert.match(result.responseMarkdown, /\| Приоритет \| Нарушение \| Ожидание \| Источник \| Исправление \|/);
    assert.match(
      result.responseMarkdown,
      /\| Ошибка \| \*\*Изменён view\*\*<br>Primary → Secondary \|/,
    );
    assert.doesNotMatch(result.responseMarkdown, /\| Нарушение \| Факт \|/);
    assert.doesNotMatch(result.responseMarkdown, /Предположения агента/);
    assert.doesNotMatch(result.responseMarkdown, /Контекст проверки/);
    assert.doesNotMatch(result.responseMarkdown, /Уточняющие вопросы/);
    assert.doesNotMatch(result.responseMarkdown, /Файлы, просмотренные при аудите/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('pattern report UI uses one status table per pattern tab', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-pattern-markdown-test-'));
  const dsAiHub = path.join(root, 'ds-ai-hub');
  const designSystem = path.join(root, 'design-system_ab');
  await fsp.mkdir(path.join(designSystem, 'contracts'), { recursive: true });
  await fsp.mkdir(path.join(designSystem, 'patterns'), { recursive: true });
  await fsp.mkdir(dsAiHub, { recursive: true });
  await fsp.writeFile(
    path.join(designSystem, 'contracts', 'plate.json'),
    '{"ruleId":"plate.padding.tokenized"}',
    'utf8'
  );
  await fsp.writeFile(
    path.join(designSystem, 'patterns', 'form.md'),
    'rule:forms.one-title-per-plate',
    'utf8'
  );

  try {
    const result = await verifyCodexEvidence(
      {
        mode: 'pattern-report',
        status: 'needs_review',
        summary: { checkedNodes: 110, errors: 2, warnings: 0, info: 1 },
        patternAudit: {
          pageType: 'form',
          generalChangeCount: 3,
          requestedRuleCount: 1,
        },
        responseMarkdown: 'Проверены общие правила и правило формы.',
        sourcesUsed: [],
        allowedCustomizations: [{
          title: 'Plate: layout.padding.bottom',
          observed: '24 → 32',
          rationale: 'Значение токенизировано.',
          ruleId: 'plate.padding.flexible',
          patternScope: 'general',
        }],
        findings: [
          {
            id: 'general-error',
            title: 'Raw padding',
            observed: '24 → 32',
            expected: 'Spacing/32',
            suggestedFix: 'Привязать',
            priority: 'error',
            patternScope: 'general',
            evidence: [{
              source: 'design-system_ab',
              path: 'contracts/plate.json',
              ruleId: 'plate.padding.tokenized',
              quote: null,
            }],
          },
          {
            id: 'general-review',
            title: 'Draft rule',
            observed: '24 → 12',
            expected: 'Требуется уточнение',
            suggestedFix: 'Проверить',
            priority: 'human_review',
            patternScope: 'general',
            evidence: [],
          },
          {
            id: 'form-error',
            title: 'Два заголовка',
            observed: '2 TitleView Medium',
            expected: 'Не более одного',
            suggestedFix: 'Оставить один',
            priority: 'error',
            patternScope: 'page-specific',
            evidence: [{
              source: 'design-system_ab',
              path: 'patterns/form.md',
              ruleId: 'rule:forms.one-title-per-plate',
              quote: null,
            }],
          },
        ],
      },
      { dsAiHub, designSystem }
    );

    assert.match(result.responseMarkdown, /## Общие компонентные паттерны/);
    assert.doesNotMatch(
      result.responseMarkdown,
      /Apollo v3 · Паттерны|Проверено компонентов:|Проверено изменений:/
    );
    const generalSection = result.responseMarkdown.split(
      '## Паттерны страницы · Форма'
    )[0];
    assert.equal(
      (generalSection.match(/\| Приоритет \| Нарушение \|/g) || []).length,
      1
    );
    assert.match(generalSection, /\| Ошибка \|/);
    assert.match(generalSection, /\| Требуется проверка \|/);
    assert.match(result.responseMarkdown, /## Паттерны страницы · Форма/);
    assert.match(
      result.responseMarkdown,
      /Проверено правил: 1\. Подтверждено: 1\. Требуют проверки: 0\./
    );
    assert.match(result.responseMarkdown, /### Допустимые изменения · 1/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { evaluateRules } = require('../src/predicate-engine');
const { compileContourRule } = require('../src/predicate-engine/contour-rules');
const { buildPredicateSnapshotV2 } = require('../src/predicate-engine/snapshot-adapter');

const rulesPath = path.resolve(
  __dirname,
  '../../../shared/design-system_ab/JSONS/web/components/web-corp/PaymentMaskedNumber/rules.json',
);
const paymentRules = require(rulesPath);

const keys = {
  root: 'payment-root',
  major: 'payment-major',
  minor: 'payment-minor',
  rightAddon: 'payment-right-addon',
  statusBadge: 'status-badge',
  swapMe: 'swap-me',
};

const componentIndex = {
  [keys.root]: { identity: 'web-corp.payment-masked-number', family: 'payment-masked-number' },
  [keys.major]: { identity: 'web-corp.payment-masked-number', family: 'major' },
  [keys.minor]: { identity: 'web-corp.payment-masked-number', family: 'minor' },
  [keys.rightAddon]: { identity: 'web-corp.payment-masked-number', family: 'right-addon' },
  [keys.statusBadge]: { identity: 'web-core.status-badge', family: 'status-badge' },
  [keys.swapMe]: { identity: 'web-corp.payment-masked-number', family: 'swap-me' },
};

function component(key, name) {
  return { key, name, variantProperties: {}, componentProperties: {}, directOverrides: [] };
}

function sourceNode({
  nodeId,
  parentNodeId = null,
  childNodeIds = [],
  childOrder = 0,
  name,
  type = 'INSTANCE',
  visible = true,
  bounds,
  component: componentValue = null,
  componentOwner = null,
  lineHeight = null,
}) {
  return {
    nodeId,
    parentNodeId,
    childNodeIds,
    childOrder,
    depth: parentNodeId ? 1 : 0,
    path: name,
    type,
    name,
    visible,
    bounds,
    layout: {
      mode: nodeId === 'root' ? 'HORIZONTAL' : 'NONE',
      positioning: 'AUTO',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'HUG',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      itemSpacing: 4,
      clipsContent: false,
    },
    component: componentValue,
    componentOwner,
    text: type === 'TEXT'
      ? { characters: '1234', length: 4, textStyleId: 'text-style', lineHeight }
      : null,
    styles: { fillStyleId: null, strokeStyleId: null, textStyleId: null, effectStyleId: null },
    appearance: { opacity: 1, radius: null, fill: null, stroke: null },
    variableBindings: [],
  };
}

function paymentEvidence({ gap = 4, addonHeight = 16, addonFamily = 'status-badge' } = {}) {
  const addonX = 104 + gap;
  const nestedKey = addonFamily === 'swap-me' ? keys.swapMe : keys.statusBadge;
  const owner = {
    nodeId: 'root',
    componentKey: keys.root,
    name: 'PaymentMaskedNumber',
    path: 'PaymentMaskedNumber',
    relativePath: '',
    variantProperties: {},
    componentProperties: {},
  };
  return {
    schemaVersion: 2,
    documentType: 'apollo-audit-evidence-bundle',
    generatedAt: '2026-09-01T00:00:00.000Z',
    sourceReportId: 'slot-contract-test',
    context: {
      fileKey: 'file-key', pageId: 'page-id', platform: 'desktop',
      viewportWidth: 1440, selectionNodeIds: ['root'], pageType: null,
    },
    graph: {
      nodes: [
        sourceNode({
          nodeId: 'root', name: 'PaymentMaskedNumber',
          childNodeIds: ['major', 'minor', 'addon'],
          bounds: { x: 0, y: 0, width: addonX + 16, height: 20 },
          component: component(keys.root, 'PaymentMaskedNumber'),
        }),
        sourceNode({
          nodeId: 'major', parentNodeId: 'root', childOrder: 0, name: 'Major',
          childNodeIds: ['major-text'], bounds: { x: 0, y: 0, width: 80, height: 20 },
          component: component(keys.major, 'Major'), componentOwner: owner,
        }),
        sourceNode({
          nodeId: 'major-text', parentNodeId: 'major', name: 'Major text', type: 'TEXT',
          bounds: { x: 0, y: 0, width: 80, height: 20 }, componentOwner: owner, lineHeight: 20,
        }),
        sourceNode({
          nodeId: 'minor', parentNodeId: 'root', childOrder: 1, name: 'Minor',
          childNodeIds: ['minor-text'], bounds: { x: 84, y: 0, width: 20, height: 20 },
          component: component(keys.minor, 'Minor'), componentOwner: owner,
        }),
        sourceNode({
          nodeId: 'minor-text', parentNodeId: 'minor', name: 'Minor text', type: 'TEXT',
          bounds: { x: 84, y: 0, width: 20, height: 20 }, componentOwner: owner, lineHeight: 20,
        }),
        sourceNode({
          nodeId: 'addon', parentNodeId: 'root', childOrder: 2, name: 'Addon',
          childNodeIds: ['addon-content'], bounds: { x: addonX, y: 0, width: 16, height: addonHeight },
          component: component(keys.rightAddon, 'RightAddon'), componentOwner: owner,
        }),
        sourceNode({
          nodeId: 'addon-content', parentNodeId: 'addon', name: addonFamily,
          bounds: { x: addonX, y: 0, width: 16, height: addonHeight },
          component: component(nestedKey, addonFamily), componentOwner: owner,
        }),
      ],
    },
    baselines: [], changes: [],
  };
}

function slotRules() {
  return paymentRules.manual.rules
    .filter((rule) => rule.ruleId.includes('.addon-'))
    .flatMap((rule) => compileContourRule(Object.assign({}, rule.predicateContour, {
      ruleId: rule.ruleId,
      revision: rule.authority.revision,
      sourcePath: 'design-system_ab/JSONS/web/components/web-corp/PaymentMaskedNumber/rules.json',
      sourceChecksum: 'test-checksum',
      sourceAnchor: `rules/${rule.ruleId}`,
      authorityStatus: rule.authority.status,
      provenance: rule.authority.provenance,
      severity: rule.severity,
    })));
}

function evaluateSlotRules(options) {
  const snapshot = buildPredicateSnapshotV2({
    evidenceBundle: paymentEvidence(options),
    release: { knowledgeSource: 'design-system_ab', revision: 'test', checksum: 'test' },
    componentIndex,
  });
  return evaluateRules({ snapshot, rules: slotRules(), ruleRelease: 'test' }).evaluations;
}

test('slot contract is compliant for a visible final Addon with valid geometry', () => {
  const evaluations = evaluateSlotRules();
  assert.deepEqual(evaluations.map((item) => item.ruleId).sort(), [
    'component:web-corp.payment-masked-number.addon-uses-final-component',
    'component:web-corp.payment-masked-number.addon-geometry.gap',
    'component:web-corp.payment-masked-number.addon-geometry.height',
  ].sort());
  assert.ok(evaluations.every((item) => item.classification === 'compliant'));
});

test('slot contract detects a placeholder and independent geometry defects', () => {
  assert.equal(
    evaluateSlotRules({ addonFamily: 'swap-me' }).find((item) => (
      item.ruleId.endsWith('addon-uses-final-component')
    )).classification,
    'violation',
  );
  assert.equal(
    evaluateSlotRules({ gap: 8 }).find((item) => item.ruleId.endsWith('addon-geometry.gap'))
      .classification,
    'violation',
  );
  assert.equal(
    evaluateSlotRules({ addonHeight: 24 }).find((item) => item.ruleId.endsWith('addon-geometry.height'))
      .classification,
    'violation',
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { evaluateRules, validateRule } = require('../src/predicate-engine');
const { compileContourRule } = require('../src/predicate-engine/contour-rules');
const { loadComponentContourCatalog } = require('../src/predicate-engine/release-loader');

const designSystemRoot = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.resolve(__dirname, '../../../shared/design-system_ab');
const jsonRoot = path.join(designSystemRoot, 'JSONS');
const packageEntry = {
  packagePath: 'web/components/web-corp/AmountStyles',
  artifacts: { rules: 'rules.json' },
};

function component(identity, family, properties = {}, platform = 'universal') {
  return {
    key: `${identity}:${family}`,
    identity,
    family,
    platform,
    lifecycle: 'active',
    properties,
  };
}

function node(id, overrides = {}) {
  return Object.assign({
    id,
    parentId: null,
    childIds: [],
    order: 0,
    path: `Fixture / ${id}`,
    name: id,
    type: 'INSTANCE',
    visible: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    component: null,
    layout: {},
    appearance: {},
    bindings: {},
    baseline: {},
    composition: {},
    ownership: null,
    overrides: [],
    overrideProperties: [],
    unknownFacts: [],
  }, overrides);
}

function snapshot(nodes, selection = [nodes[0].id], context = {}) {
  return {
    schemaVersion: 'apollo.predicate-snapshot.v2',
    auditId: 'amountstyles-executable-rules',
    generatedAt: '2026-08-30T00:00:00.000Z',
    context: Object.assign({
      fileKey: 'file-key',
      pageId: 'page',
      platform: 'desktop',
      pageType: 'form',
      viewportWidth: 1280,
      unknownFacts: [],
    }, context),
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'test-release',
      checksum: 'test-release-checksum',
    },
    selection,
    nodes,
  };
}

const definitions = loadComponentContourCatalog(jsonRoot, [packageEntry]);
const definitionsById = new Map(definitions.map((definition) => [definition.ruleId, definition]));

function compiled(suffix) {
  const ruleId = `component:web-corp.amount-styles.${suffix}`;
  const definition = definitionsById.get(ruleId);
  assert.ok(definition, `missing contour definition ${ruleId}`);
  const rules = compileContourRule(definition);
  const result = Array.isArray(rules) ? rules : [rules];
  for (const rule of result) assert.doesNotThrow(() => validateRule(rule));
  return result;
}

function assertViolation(suffix, fixture) {
  const result = evaluateRules({ snapshot: fixture, rules: compiled(suffix) });
  assert.ok(
    result.evaluations.some((evaluation) => evaluation.classification === 'violation'),
    `${suffix} must produce a violation for its failing fixture`,
  );
}

test('AmountStyles executable text, ownership and binding facts are observable', () => {
  const publicRoot = (id, childIds = [], platform = 'desktop') => node(id, {
    childIds,
    component: component('web-corp.amount-styles', 'amount-headline', {}, platform),
    ownership: { contour: { isRoot: true } },
  });
  const textOwner = (family) => ({ owner: { component: { identity: 'web-core.amount', family } } });

  assertViolation('major-is-required', snapshot([publicRoot('missing-major')]));

  const minus = node('minus', {
    type: 'TEXT',
    name: 'Minus',
    text: { characters: '-', length: 1 },
    ownership: { owner: { component: { identity: 'web-corp.amount-styles', family: 'operation' } } },
  });
  assertViolation('math-minus-is-required', snapshot([minus]));

  const majorColor = node('major-color', {
    parentId: 'color-root',
    type: 'TEXT',
    name: 'Major',
    text: { characters: '100', length: 3 },
    appearance: { fill: { value: 'text/primary' } },
    bindings: { fills: { bound: true, token: 'text/primary' } },
    ownership: textOwner('major'),
  });
  const minorColor = node('minor-color', {
    parentId: 'color-root',
    type: 'TEXT',
    name: 'Minor',
    text: { characters: ',00', length: 3 },
    appearance: { fill: { value: 'text/secondary' } },
    bindings: { fills: { bound: true, token: 'text/secondary' } },
    ownership: textOwner('minor'),
  });
  assertViolation('parts-share-color', snapshot([
    publicRoot('color-root', ['major-color', 'minor-color']),
    majorColor,
    minorColor,
  ]));

  const opacity = node('minor-opacity', {
    component: component('web-core.amount', 'minor', { Opacity: 'True' }),
    ownership: { contour: { host: { component: { identity: 'web-corp.amount-styles' } } } },
  });
  assertViolation('opacity-property-is-forbidden', snapshot([opacity]));

  const minorText = node('minor-text', {
    type: 'TEXT',
    name: 'Minor',
    text: { characters: ',123', length: 4 },
    ownership: textOwner('minor'),
  });
  assertViolation('minor-has-one-or-two-digits', snapshot([minorText]));

  const majorText = node('major-text', {
    type: 'TEXT',
    name: 'Major',
    text: { characters: '12345678901234', length: 14 },
    ownership: textOwner('major'),
  });
  assertViolation('major-max-13-digits', snapshot([majorText]));

  const styledMajor = node('styled-major', {
    type: 'TEXT',
    name: 'Major',
    text: { characters: '100', length: 3 },
    appearance: { styles: { textStyle: 'Headline/20' } },
    baseline: { effective: { appearance: { styles: { textStyle: 'Headline/40' } } } },
    ownership: textOwner('major'),
  });
  assertViolation('manual-text-style-is-layer-property', snapshot([styledMajor]));
});

function requireString(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function sourceRecord(options) {
  return {
    path: requireString(options.sourcePath, 'sourcePath'),
    checksum: requireString(options.sourceChecksum, 'sourceChecksum'),
    anchor: options.sourceAnchor || options.ruleId,
  };
}

function componentSelector(identity, extraWhere, options = {}) {
  const where = [{
    predicate: 'equals',
    actual: { fact: 'type' },
    expected: { literal: 'INSTANCE' },
  }, {
    predicate: 'equals',
    actual: { fact: 'component.identity' },
    expected: { literal: requireString(identity, 'identity') },
  }];
  if (options.publicRootOnly) {
    where.push({
      predicate: 'not',
      args: [{
        predicate: 'exists',
        actual: { fact: 'ownership.ownerNodeId' },
      }],
    });
  }
  return {
    from: options.from || 'selection-root',
    traverse: options.traverse || 'self-and-descendants',
    where: where.concat(extraWhere || []),
  };
}

function createRule(options) {
  const ruleId = requireString(options.ruleId, 'ruleId');
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId,
    revision: Number.isInteger(options.revision) ? options.revision : 1,
    source: sourceRecord(Object.assign({}, options, { ruleId })),
    authority: {
      status: options.authorityStatus || 'active',
      provenance: options.provenance || 'design-system-author',
    },
    effect: options.effect || 'require',
    scope: options.scope || {},
    select: options.select,
    when: options.when,
    assert: options.assert,
    severity: options.severity || 'error',
    unknownPolicy: options.unknownPolicy || 'not-evaluable',
    remediation: options.remediation || null,
    presentation: options.presentation || null,
  };
}

function publicRootRule(options) {
  const targetFact = options.contourRootFamilyFact
    || 'ownership.contour.root.component.family';
  const where = (options.where || []).concat([{
    predicate: 'equals',
    actual: { fact: 'ownership.contour.isRoot' },
    expected: { literal: true },
  }]);
  return createRule(Object.assign({}, options, {
    presentation: options.presentation
      ? Object.assign({}, options.presentation, { targetFact })
      : null,
    select: componentSelector(options.identity, where, {
      from: options.from,
      traverse: options.traverse,
    }),
    assert: {
      predicate: 'one-of',
      actual: {
        fact: targetFact,
      },
      expected: { literal: options.allowedFamilies.slice() },
    },
  }));
}

function contextMapRule(options) {
  const entries = Object.entries(options.mapping || {});
  if (!entries.length) throw new TypeError('contextMapRule mapping must not be empty');
  return createRule(Object.assign({}, options, {
    presentation: options.presentation
      ? Object.assign({}, options.presentation, {
          contextFact: options.contextFact,
          targetFact: options.targetFact,
        })
      : null,
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'any',
      args: entries.map(([contextValue, targetValue]) => ({
        predicate: 'all',
        args: [{
          predicate: 'equals',
          actual: { fact: options.contextFact },
          expected: { literal: contextValue },
        }, {
          predicate: 'equals',
          actual: { fact: options.targetFact },
          expected: { literal: targetValue },
        }],
      })),
    },
  }));
}

function queryRef(options) {
  return {
    query: {
      from: options.from || 'subject',
      traverse: options.traverse || 'descendants',
      where: options.where || [],
      project: options.project,
    },
  };
}

function uniformAllowedCollectionRule(options) {
  const actual = options.actual || queryRef(options.query);
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'count-between',
        actual,
        lower: { literal: options.minimumCount === undefined ? 1 : options.minimumCount },
        upper: { literal: options.maximumCount === undefined ? 1000000 : options.maximumCount },
      }, {
        predicate: 'every',
        actual,
        expected: { literal: options.allowedValues.slice() },
      }, {
        predicate: 'all-equal',
        actual,
      }],
    },
  }));
}

function widthRangeExpression(widthFact, range) {
  if (range.lower !== undefined && range.upper !== undefined) {
    return {
      predicate: 'between',
      actual: { fact: widthFact },
      lower: { literal: range.lower },
      upper: { literal: range.upper },
      bounds: range.bounds || 'inclusive',
    };
  }
  return {
    predicate: 'compare',
    actual: { fact: widthFact },
    expected: { literal: range.lower !== undefined ? range.lower : range.upper },
    operator: range.lower !== undefined ? 'gte' : 'lt',
  };
}

function breakpointMapRule(options) {
  if (!Array.isArray(options.ranges) || !options.ranges.length) {
    throw new TypeError('breakpointMapRule ranges must not be empty');
  }
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'any',
      args: options.ranges.map((range) => ({
        predicate: 'all',
        args: [widthRangeExpression(options.widthFact || 'page.context.viewportWidth', range), {
          predicate: 'equals',
          actual: { fact: options.targetFact },
          expected: { literal: range.expected },
        }],
      })),
    },
  }));
}

function sizingRule(options) {
  const expectations = options.expectations || {};
  const args = Object.entries(expectations).map(([factPath, expected]) => ({
    predicate: 'equals',
    actual: { fact: factPath },
    expected: { literal: expected },
  }));
  if (!args.length) throw new TypeError('sizingRule expectations must not be empty');
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: { predicate: 'all', args },
  }));
}

function baselineRule(options) {
  const pairs = options.pairs || [];
  if (!pairs.length) throw new TypeError('baselineRule pairs must not be empty');
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'all',
      args: pairs.map((pair) => ({
        predicate: 'matches-effective-baseline',
        actual: { fact: pair.actualFact },
        expected: { fact: pair.baselineFact },
      })),
    },
  }));
}

function queryCountRule(options) {
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'count-between',
      actual: queryRef(options.query),
      lower: { literal: options.lower },
      upper: { literal: options.upper },
    },
  }));
}

function derivedGeometryRule(options) {
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'approximately-equals',
      actual: options.actual,
      expected: options.expected,
      tolerance: options.tolerance || 0,
    },
  }));
}

const CONTOUR_BUILDERS = Object.freeze({
  'public-root': publicRootRule,
  'context-map': contextMapRule,
  'uniform-allowed-collection': uniformAllowedCollectionRule,
  'breakpoint-map': breakpointMapRule,
  sizing: sizingRule,
  baseline: baselineRule,
  'query-count': queryCountRule,
  'derived-geometry': derivedGeometryRule,
});

function compileContourRule(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('contour definition must be an object');
  }
  const builder = CONTOUR_BUILDERS[definition.kind];
  if (!builder) {
    throw new TypeError(`unsupported universal contour kind: ${definition.kind}`);
  }
  const options = Object.assign({}, definition);
  delete options.kind;
  return builder(options);
}

module.exports = {
  CONTOUR_BUILDERS,
  baselineRule,
  breakpointMapRule,
  compileContourRule,
  componentSelector,
  contextMapRule,
  createRule,
  derivedGeometryRule,
  publicRootRule,
  queryCountRule,
  queryRef,
  sizingRule,
  uniformAllowedCollectionRule,
};

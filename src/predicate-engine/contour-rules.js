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
    causality: options.causality || null,
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
  if (options.standaloneOnly === true) {
    where.push({
      predicate: 'not',
      args: [{
        predicate: 'exists',
        actual: { fact: 'ownership.contour.host.component.identity' },
      }],
    });
  }
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

function platformMatchRule(options) {
  const platformFact = options.platformFact || 'component.platform';
  const contextPlatformFact = options.contextPlatformFact || 'page.context.platform';
  const supportedPlatforms = options.supportedPlatforms || [
    'desktop',
    'mobile-web',
    'ios',
    'android',
  ];
  if (
    !Array.isArray(supportedPlatforms) ||
    !supportedPlatforms.length ||
    supportedPlatforms.some((platform) => typeof platform !== 'string' || !platform)
  ) {
    throw new TypeError('platformMatchRule supportedPlatforms must not be empty');
  }
  const publicFamilies = options.publicFamilies || [];
  if (
    options.publicRootOnly === true
    && (
      !Array.isArray(publicFamilies)
      || !publicFamilies.length
      || publicFamilies.some((family) => typeof family !== 'string' || !family)
    )
  ) {
    throw new TypeError(
      'platformMatchRule publicRootOnly requires a non-empty publicFamilies list',
    );
  }
  const suppliedSelect = options.select && typeof options.select === 'object'
    ? options.select
    : null;
  const suppliedWhere = suppliedSelect?.where || options.where || [];
  // Instance names are mutable document labels. Contract identity/key is the
  // platform authority, so a renamed PASS/FAIL fixture must remain selectable.
  const where = suppliedWhere.filter((expression) => (
    expression?.actual?.fact !== 'component.name'
    && expression?.actual?.fact !== platformFact
  ));
  const hasContourRootConstraint = where.some((expression) => (
    expression?.actual?.fact === 'ownership.contour.isRoot'
  ));
  const hasPublicFamilyConstraint = where.some((expression) => (
    expression?.actual?.fact === 'component.family'
  ));
  if (options.publicRootOnly === true && !hasContourRootConstraint) {
    where.push({
      predicate: 'equals',
      actual: { fact: 'ownership.contour.isRoot' },
      expected: { literal: true },
    });
  }
  if (options.publicRootOnly === true && !hasPublicFamilyConstraint) {
    where.push({
      predicate: 'one-of',
      actual: { fact: 'component.family' },
      expected: { literal: publicFamilies.slice() },
    });
  }
  if (options.standaloneOnly !== false) {
    where.push({
      predicate: 'not',
      args: [{
        predicate: 'exists',
        actual: { fact: 'ownership.contour.host.component.identity' },
      }],
    });
  }
  // Supported component platforms are the assertion input, not an
  // applicability gate. Keeping them in scope would make a desktop-only rule
  // not-applicable on mobile-web before the mismatch can be evaluated.
  const scope = Object.assign({}, options.scope || {});
  delete scope.platform;
  const select = suppliedSelect
    ? Object.assign({}, suppliedSelect, { where })
    : componentSelector(options.identity, where);
  return createRule(Object.assign({}, options, {
    scope,
    // The root trace is normalized to the page channel comparison. Do not set
    // targetFact here: the UI would otherwise render an internal false branch
    // (for example the raw `universal` contract marker) instead of that root.
    presentation: Object.assign({}, options.presentation || {}, {
      causalRole: 'platform-root',
    }),
    select,
    assert: {
      predicate: 'any',
      args: [{
        predicate: 'all',
        args: [{
          predicate: 'one-of',
          actual: { fact: platformFact },
          expected: { literal: supportedPlatforms.slice() },
        }, {
          predicate: 'equals',
          actual: { fact: contextPlatformFact },
          expected: { fact: platformFact },
        }],
      }, {
        predicate: 'all',
        args: [{
          predicate: 'equals',
          actual: { fact: platformFact },
          expected: { literal: 'universal' },
        }, {
          predicate: 'one-of',
          actual: { fact: contextPlatformFact },
          expected: { literal: supportedPlatforms.slice() },
        }],
      }],
      missingPolicy: 'unknown',
    },
  }));
}

function contextMapRule(options) {
  const entries = Array.isArray(options.mappingEntries)
    ? options.mappingEntries.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || !Object.prototype.hasOwnProperty.call(entry, 'context')
          || !Object.prototype.hasOwnProperty.call(entry, 'target')) {
          throw new TypeError('contextMapRule mappingEntries require context and target');
        }
        return [entry.context, entry.target];
      })
    : Object.entries(options.mapping || {});
  if (!entries.length) throw new TypeError('contextMapRule mapping must not be empty');
  const mappedContext = {
    predicate: 'one-of',
    actual: { fact: options.contextFact },
    expected: { literal: entries.map(([contextValue]) => contextValue) },
  };
  return createRule(Object.assign({}, options, {
    presentation: options.presentation
      ? Object.assign({}, options.presentation, {
          contextFact: options.contextFact,
          targetFact: options.targetFact,
        })
      : null,
    select: options.select || componentSelector(options.identity, options.where),
    // A context map is authoritative only for the context values it declares.
    // Missing, null or otherwise unmapped context must not turn every mapping
    // branch into a violation. Leave it outside the rule's applicability so the
    // engine can distinguish an absent mapping from a mismatched mapped target.
    when: options.when
      ? { predicate: 'all', args: [options.when, mappedContext] }
      : mappedContext,
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

function uniformCollectionPropertiesRule(options) {
  const memberIdentity = requireString(options.memberIdentity, 'memberIdentity');
  if (
    !Array.isArray(options.propertyFacts) ||
    !options.propertyFacts.length ||
    options.propertyFacts.some((factPath) => typeof factPath !== 'string' || !factPath)
  ) {
    throw new TypeError('uniformCollectionPropertiesRule propertyFacts must not be empty');
  }
  if (
    options.memberNames !== undefined &&
    (!Array.isArray(options.memberNames) ||
      !options.memberNames.length ||
      options.memberNames.some((name) => typeof name !== 'string' || !name))
  ) {
    throw new TypeError('uniformCollectionPropertiesRule memberNames must not be empty');
  }
  const memberWhere = [{
    predicate: 'equals',
    actual: { fact: 'type' },
    expected: { literal: 'INSTANCE' },
  }];
  if (options.memberNames) {
    memberWhere.push({
      predicate: 'one-of',
      actual: { fact: 'name' },
      expected: { literal: options.memberNames.slice() },
    });
  }
  memberWhere.push(...(options.memberWhere || []), {
    predicate: 'equals',
    actual: { fact: 'component.identity' },
    expected: { literal: memberIdentity },
  });
  const query = {
    from: options.from || 'subject',
    traverse: options.traverse || 'descendants',
    where: memberWhere,
  };
  const members = queryRef(query);
  const assertions = [{
    predicate: 'count-between',
    actual: members,
    lower: { literal: options.minimumCount === undefined ? 1 : options.minimumCount },
    upper: { literal: options.maximumCount === undefined ? 1000000 : options.maximumCount },
  }].concat(options.propertyFacts.map((factPath) => ({
    predicate: 'all-equal',
    actual: queryRef(Object.assign({}, query, { project: { fact: factPath } })),
  })));
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: { predicate: 'all', args: assertions },
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
  const assertions = pairs.flatMap((pair) => {
    if (!pair || typeof pair.actualFact !== 'string' || !pair.actualFact
      || typeof pair.baselineFact !== 'string' || !pair.baselineFact) {
      throw new TypeError('baselineRule pairs require actualFact and baselineFact');
    }
    const match = {
      predicate: 'matches-effective-baseline',
      actual: { fact: pair.actualFact },
      expected: { fact: pair.baselineFact },
    };
    return pair.required === true
      ? [{
          predicate: 'exists',
          actual: { fact: pair.actualFact },
        }, match]
      : [match];
  });
  const presentation = options.presentation && pairs.length === 1
    ? Object.assign({}, options.presentation, {
        targetFact: pairs[0].actualFact,
      })
    : options.presentation;
  return createRule(Object.assign({}, options, {
    presentation,
    select: options.select || componentSelector(options.identity, options.where),
    assert: {
      predicate: 'all',
      args: assertions,
    },
  }));
}

function baselineSetRules(options) {
  if (!Array.isArray(options.paths) || !options.paths.length) {
    throw new TypeError('baselineSetRules paths must not be empty');
  }
  const suffixes = new Set();
  return options.paths.map((path) => {
    const suffix = requireString(path?.suffix, 'baseline path suffix');
    const actualFact = requireString(path?.actualFact, 'baseline path actualFact');
    const baselineFact = requireString(path?.baselineFact, 'baseline path baselineFact');
    if (suffixes.has(suffix)) {
      throw new TypeError(`baselineSetRules duplicate suffix: ${suffix}`);
    }
    suffixes.add(suffix);
    const propertyLabel = requireString(path.label || suffix, 'baseline path label');
    const presentation = options.presentation
      ? Object.assign({}, options.presentation, {
          title: replacePropertyLabel(options.presentation.title, propertyLabel),
          observed: replacePropertyLabel(options.presentation.observed, propertyLabel),
          expectation: replacePropertyLabel(options.presentation.expectation, propertyLabel),
          action: replacePropertyLabel(options.presentation.action, propertyLabel),
          targetFact: actualFact,
        })
      : null;
    const baselineWhere = [{
      predicate: 'fact-present',
      actual: { fact: baselineFact },
    }].concat(path.where || []);
    const select = path.select || (options.select
      ? Object.assign({}, options.select, {
          where: (options.select.where || []).concat(baselineWhere),
        })
      : componentSelector(options.identity, (options.where || []).concat(baselineWhere)));
    return createRule(Object.assign({}, options, {
      ruleId: `${options.ruleId}.${suffix}`,
      presentation,
      select,
      assert: {
        predicate: 'matches-effective-baseline',
        actual: { fact: actualFact },
        expected: { fact: baselineFact },
      },
    }));
  });
}

function replacePropertyLabel(value, label) {
  return typeof value === 'string'
    ? value.replaceAll('{{property}}', label)
    : value;
}

function bindingSetRules(options) {
  if (!Array.isArray(options.paths) || !options.paths.length) {
    throw new TypeError('bindingSetRules paths must not be empty');
  }
  if (!options.expectedBinding || typeof options.expectedBinding !== 'object') {
    throw new TypeError('bindingSetRules expectedBinding must be an object');
  }
  const suffixes = new Set();
  return options.paths.map((path) => {
    const suffix = requireString(path?.suffix, 'binding path suffix');
    const valueFact = requireString(path?.valueFact, 'binding path valueFact');
    const bindingFact = requireString(path?.bindingFact, 'binding path bindingFact');
    const requireValue = path.requireValue !== false;
    if (suffixes.has(suffix)) {
      throw new TypeError(`bindingSetRules duplicate suffix: ${suffix}`);
    }
    suffixes.add(suffix);
    const propertyLabel = requireString(path.label || suffix, 'binding path label');
    const presentation = options.presentation
      ? Object.assign({}, options.presentation, {
          title: replacePropertyLabel(options.presentation.title, propertyLabel),
          observed: replacePropertyLabel(options.presentation.observed, propertyLabel),
          expectation: replacePropertyLabel(options.presentation.expectation, propertyLabel),
          action: replacePropertyLabel(options.presentation.action, propertyLabel),
          targetFact: valueFact,
        })
      : null;
    const pathWhere = (options.where || []).concat(path.where || []);
    const pathSelect = path.select || options.select || componentSelector(
      options.identity,
      pathWhere.concat(requireValue ? [{
        predicate: 'exists',
        actual: { fact: valueFact },
      }] : []),
      { publicRootOnly: options.publicRootOnly === true },
    );
    return createRule(Object.assign({}, options, {
      ruleId: `${options.ruleId}.${suffix}`,
      presentation,
      select: pathSelect,
      assert: {
        predicate: 'all',
        args: (requireValue ? [{
          predicate: 'exists',
          actual: { fact: valueFact },
        }] : []).concat([{
          predicate: 'binding-satisfies',
          actual: { fact: bindingFact },
          expected: { literal: options.expectedBinding },
        }]),
      },
    }));
  });
}

function ownedPeerPropertyEqualityRule(options) {
  const ownerIdentities = options.ownerIdentities || [requireString(options.ownerIdentity, 'ownerIdentity')];
  if (!Array.isArray(ownerIdentities) || !ownerIdentities.length) {
    throw new TypeError('ownedPeerPropertyEqualityRule ownerIdentities must not be empty');
  }
  const targetIdentities = options.target?.identities || [requireString(options.target?.identity, 'target.identity')];
  if (!Array.isArray(targetIdentities) || !targetIdentities.length) {
    throw new TypeError('ownedPeerPropertyEqualityRule target.identities must not be empty');
  }
  const targetNames = options.target?.names;
  if (!Array.isArray(targetNames) || !targetNames.length) {
    throw new TypeError('ownedPeerPropertyEqualityRule target.names must not be empty');
  }
  const collectionKey = requireString(options.collectionKey, 'collectionKey');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(collectionKey)) {
    throw new TypeError('ownedPeerPropertyEqualityRule collectionKey is invalid');
  }
  if (!Array.isArray(options.members) || options.members.length < 2) {
    throw new TypeError('ownedPeerPropertyEqualityRule members must contain at least two entries');
  }
  const memberRoles = options.members.map((member) => requireString(member?.role, 'member.role'));
  if (new Set(memberRoles).size !== memberRoles.length) {
    throw new TypeError('ownedPeerPropertyEqualityRule member roles must be unique');
  }
  for (const member of options.members) {
    if (!Array.isArray(member.names) || !member.names.length) {
      throw new TypeError('ownedPeerPropertyEqualityRule member.names must not be empty');
    }
    requireString(member.propertyFact, 'member.propertyFact');
  }
  const requiredRoles = options.requiredRoles || memberRoles;
  if (
    !Array.isArray(requiredRoles) ||
    !requiredRoles.length ||
    requiredRoles.some((role) => !memberRoles.includes(role))
  ) {
    throw new TypeError('ownedPeerPropertyEqualityRule requiredRoles must reference member roles');
  }
  const rolesFact = `composition.peerCollections.${collectionKey}.roles`;
  const valuesFact = `composition.peerCollections.${collectionKey}.values`;
  const presentation = options.presentation
    ? Object.assign({}, options.presentation, { targetFact: valuesFact })
    : null;
  return createRule(Object.assign({}, options, {
    presentation,
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'INSTANCE' },
      }, {
        predicate: 'one-of',
        actual: { fact: 'component.identity' },
        expected: { literal: targetIdentities.slice() },
      }, {
      predicate: 'one-of',
      actual: { fact: 'name' },
      expected: { literal: targetNames.slice() },
      }].concat(options.where || []),
    },
    when: {
      predicate: 'count-between',
      actual: { fact: rolesFact },
      lower: { literal: requiredRoles.length },
      upper: { literal: requiredRoles.length },
    },
    assert: {
      predicate: 'all-equal',
      actual: { fact: valuesFact },
    },
  }));
}

function propertyWhere(properties, factPrefix = 'component.properties') {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties).map(([property, expected]) => ({
    predicate: 'equals',
    actual: { fact: `${factPrefix}.${property}` },
    expected: { literal: expected },
  }));
}

function coLocatedUnderlayRule(options) {
  const subjectIdentity = requireString(options.subject?.identity, 'subject.identity');
  const underlayIdentity = requireString(options.underlay?.identity, 'underlay.identity');
  const relationKey = requireString(options.relationKey, 'relationKey');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(relationKey)) {
    throw new TypeError('coLocatedUnderlayRule relationKey is invalid');
  }
  const layoutModes = options.host?.layoutModes;
  if (!Array.isArray(layoutModes) || !layoutModes.length) {
    throw new TypeError('coLocatedUnderlayRule host.layoutModes must not be empty');
  }
  const prefix = `composition.underlayRelations.${relationKey}`;
  const assertions = [{
    predicate: 'exists',
    actual: { fact: `${prefix}.nodeId` },
  }, {
    predicate: 'ancestor',
    actual: { fact: 'id' },
    expected: { fact: `${prefix}.hostNodeId` },
  }, {
    predicate: 'one-of',
    actual: { fact: `${prefix}.hostLayoutMode` },
    expected: { literal: layoutModes.slice() },
  }, {
    predicate: 'equals',
    actual: { fact: `${prefix}.component.identity` },
    expected: { literal: underlayIdentity },
  }, ...propertyWhere(options.underlay.properties, `${prefix}.component.properties`)];
  if (options.underlay.positioning !== undefined) {
    assertions.push({
      predicate: 'equals',
      actual: { fact: `${prefix}.layout.positioning` },
      expected: { literal: options.underlay.positioning },
    });
  }
  if (options.content?.positioning !== undefined) {
    assertions.push({
      predicate: 'equals',
      actual: { fact: `${prefix}.contentLayout.positioning` },
      expected: { literal: options.content.positioning },
    });
  }
  if (options.content?.afterUnderlay === true) {
    assertions.push({
      predicate: 'after',
      actual: { fact: `${prefix}.contentNodeId` },
      expected: { fact: `${prefix}.nodeId` },
    });
  }
  if (options.geometry?.underlayContainsSubject === true) {
    assertions.push({
      predicate: 'contains',
      actual: { fact: `${prefix}.bounds` },
      target: { fact: 'bounds' },
    });
  }
  return createRule(Object.assign({}, options, {
    select: componentSelector(
      subjectIdentity,
      propertyWhere(options.subject.properties),
      { publicRootOnly: options.subject.publicRootOnly === true },
    ),
    assert: { predicate: 'all', args: assertions },
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

function queryUniqueRule(options) {
  if (!options.select || typeof options.select !== 'object' || Array.isArray(options.select)) {
    throw new TypeError('queryUniqueRule select must be an object');
  }
  if (!options.query || typeof options.query !== 'object' || Array.isArray(options.query)) {
    throw new TypeError('queryUniqueRule query must be an object');
  }
  if (!options.query.project || typeof options.query.project !== 'object') {
    throw new TypeError('queryUniqueRule query.project must be a value reference');
  }
  return createRule(Object.assign({}, options, {
    select: options.select,
    assert: {
      predicate: 'unique',
      actual: queryRef(options.query),
    },
  }));
}

function factDomainRule(options) {
  if (!options.select || typeof options.select !== 'object' || Array.isArray(options.select)) {
    throw new TypeError('factDomainRule select must be an object');
  }
  if (!options.actual || typeof options.actual !== 'object' || Array.isArray(options.actual)) {
    throw new TypeError('factDomainRule actual must be a value reference');
  }
  if (!Array.isArray(options.allowedValues) || !options.allowedValues.length) {
    throw new TypeError('factDomainRule allowedValues must not be empty');
  }
  return createRule(Object.assign({}, options, {
    presentation: options.presentation
      ? Object.assign({}, options.presentation, {
          targetFact: options.actual.fact || null,
        })
      : null,
    select: options.select,
    assert: {
      predicate: 'one-of',
      actual: options.actual,
      expected: { literal: options.allowedValues.slice() },
      missingPolicy: 'unknown',
    },
  }));
}

function factAssertionRule(options) {
  if (!options.select || typeof options.select !== 'object' || Array.isArray(options.select)) {
    throw new TypeError('factAssertionRule select must be an object');
  }
  if (!options.assert || typeof options.assert !== 'object' || Array.isArray(options.assert)) {
    throw new TypeError('factAssertionRule assert must be an expression');
  }
  return createRule(Object.assign({}, options, {
    select: options.select,
    assert: options.assert,
  }));
}

function distanceRule(options) {
  if (!options.select || typeof options.select !== 'object' || Array.isArray(options.select)) {
    throw new TypeError('distanceRule select must be an object');
  }
  if (!options.actual || typeof options.actual !== 'object' || Array.isArray(options.actual)) {
    throw new TypeError('distanceRule actual must be a value reference');
  }
  if (!options.target || typeof options.target !== 'object' || Array.isArray(options.target)) {
    throw new TypeError('distanceRule target must be a value reference');
  }
  if (!options.expected || typeof options.expected !== 'object' || Array.isArray(options.expected)) {
    throw new TypeError('distanceRule expected must be a value reference');
  }
  if (!['horizontal', 'vertical', 'euclidean'].includes(options.axis)) {
    throw new TypeError('distanceRule axis is invalid');
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) {
    throw new TypeError('distanceRule tolerance must be a non-negative finite number');
  }
  return createRule(Object.assign({}, options, {
    select: options.select,
    assert: {
      predicate: 'distance',
      actual: options.actual,
      target: options.target,
      expected: options.expected,
      axis: options.axis,
      tolerance: options.tolerance || 0,
    },
  }));
}

function derivedGeometryRule(options) {
  const checks = Array.isArray(options.checks) && options.checks.length
    ? options.checks
    : [{
        actual: options.actual,
        expected: options.expected,
        tolerance: options.tolerance,
      }];
  const assertions = checks.map((check) => ({
    predicate: 'approximately-equals',
    actual: check.actual,
    expected: check.expected,
    tolerance: check.tolerance || 0,
  }));
  return createRule(Object.assign({}, options, {
    select: options.select || componentSelector(options.identity, options.where),
    assert: assertions.length === 1
      ? assertions[0]
      : { predicate: 'all', args: assertions },
  }));
}

const CONTOUR_BUILDERS = Object.freeze({
  'public-root': publicRootRule,
  'platform-match': platformMatchRule,
  'context-map': contextMapRule,
  'uniform-allowed-collection': uniformAllowedCollectionRule,
  'uniform-collection-properties': uniformCollectionPropertiesRule,
  'breakpoint-map': breakpointMapRule,
  sizing: sizingRule,
  baseline: baselineRule,
  'baseline-set': baselineSetRules,
  'fact-domain': factDomainRule,
  'fact-assertion': factAssertionRule,
  'query-count': queryCountRule,
  'query-unique': queryUniqueRule,
  'derived-geometry': derivedGeometryRule,
  distance: distanceRule,
  'binding-set': bindingSetRules,
  'owned-peer-property-equality': ownedPeerPropertyEqualityRule,
  'co-located-underlay': coLocatedUnderlayRule,
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
  baselineSetRules,
  bindingSetRules,
  breakpointMapRule,
  compileContourRule,
  coLocatedUnderlayRule,
  ownedPeerPropertyEqualityRule,
  componentSelector,
  contextMapRule,
  createRule,
  derivedGeometryRule,
  distanceRule,
  factDomainRule,
  factAssertionRule,
  publicRootRule,
  platformMatchRule,
  queryCountRule,
  queryUniqueRule,
  queryRef,
  sizingRule,
  uniformCollectionPropertiesRule,
  uniformAllowedCollectionRule,
};

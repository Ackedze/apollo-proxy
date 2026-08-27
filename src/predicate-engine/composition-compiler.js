function requireString(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item)) {
    throw new TypeError(`${label} must be a non-empty string array`);
  }
  return value.slice();
}

function instanceSelector() {
  return {
    predicate: 'equals',
    actual: { fact: 'type' },
    expected: { literal: 'INSTANCE' },
  };
}

function identitySelector(fact, identities) {
  return {
    predicate: 'one-of',
    actual: { fact },
    expected: { literal: identities },
  };
}

function commonRule(definition, constraint, select, assert) {
  const authority = definition.authority;
  const ruleId = requireString(constraint.ruleId, `${constraint.id}.ruleId`);
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId,
    revision: Number.isInteger(constraint.revision)
      ? constraint.revision
      : Number.isInteger(authority.revision) ? authority.revision : 1,
    source: {
      path: definition.sourcePath,
      checksum: definition.sourceChecksum,
      anchor: `manual/contracts/${definition.id}/constraints/${constraint.id}`,
    },
    authority: {
      status: authority.status,
      provenance: authority.provenance,
    },
    effect: 'require',
    scope: definition.scope,
    select,
    assert,
    severity: constraint.severity || 'error',
    unknownPolicy: constraint.unknownPolicy || 'not-evaluable',
    remediation: null,
    presentation: constraint.presentation || null,
  };
}

function nestedSelector(definition) {
  return [
    instanceSelector(),
    identitySelector('component.identity', definition.select.nestedComponentIdentities),
    identitySelector(
      'ownership.owner.component.identity',
      definition.match.hostComponentIdentities,
    ),
  ];
}

function hostSelector(definition) {
  return [
    instanceSelector(),
    identitySelector('component.identity', definition.match.hostComponentIdentities),
  ];
}

function compileConstraint(definition, constraint) {
  const property = constraint.property;
  const nested = nestedSelector(definition);
  const facts = definition.facts;

  if (constraint.op === 'countBetween') {
    return commonRule(definition, constraint, {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: hostSelector(definition),
    }, {
      predicate: 'count-between',
      actual: { fact: facts.visibleMemberNodeIds },
      lower: { literal: constraint.min },
      upper: { literal: constraint.max },
      bounds: 'inclusive',
    });
  }

  if (constraint.op === 'propertyDomain') {
    return commonRule(definition, constraint, {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: nested,
    }, {
      predicate: 'one-of',
      actual: { fact: `component.properties.${requireString(property, `${constraint.id}.property`)}` },
      expected: { literal: requireStringArray(constraint.values, `${constraint.id}.values`) },
    });
  }

  if (constraint.op === 'propertyEqualsHost') {
    const childProperty = requireString(property, `${constraint.id}.property`);
    const hostProperty = constraint.hostProperty || childProperty;
    return commonRule(definition, constraint, {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: nested,
    }, {
      predicate: 'equals',
      actual: { fact: `component.properties.${childProperty}` },
      expected: { fact: `ownership.owner.component.properties.${hostProperty}` },
    });
  }

  if (constraint.op === 'propertyEqualsFirst') {
    const selectedProperty = requireString(property, `${constraint.id}.property`);
    return commonRule(definition, constraint, {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: nested,
    }, {
      predicate: 'all-equal',
      actual: { fact: `${facts.siblingPropertyValuesPrefix}.${selectedProperty}` },
    });
  }

  if (constraint.op === 'valuePosition') {
    const selectedProperty = requireString(property, `${constraint.id}.property`);
    const selectedValue = requireString(constraint.value, `${constraint.id}.value`);
    const rule = commonRule(definition, constraint, {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: nested.concat([{
        predicate: 'equals',
        actual: { fact: `component.properties.${selectedProperty}` },
        expected: { literal: selectedValue },
      }]),
    }, {
      predicate: 'value-position',
      actual: { fact: `${facts.siblingPropertyValuesPrefix}.${selectedProperty}` },
      expected: { literal: selectedValue },
      positions: constraint.positions,
      maxCount: constraint.maxCount,
    });
    if (constraint.whenHostProperty) {
      rule.when = {
        predicate: 'equals',
        actual: {
          fact: `ownership.owner.component.properties.${requireString(
            constraint.whenHostProperty.property,
            `${constraint.id}.whenHostProperty.property`,
          )}`,
        },
        expected: { literal: constraint.whenHostProperty.equals },
      };
    }
    return rule;
  }

  throw new TypeError(`unsupported composition constraint op: ${constraint.op}`);
}

function compileCompositionContract(definition) {
  if (!definition || definition.schemaVersion !== 'apollo.composition-predicate-contract.v1') {
    throw new TypeError('composition predicate contract has an unsupported schemaVersion');
  }
  if (definition.ruleKind !== 'design-rule' || definition.authority?.status !== 'active') {
    throw new TypeError('composition predicate contract requires active design-rule authority');
  }
  requireString(definition.sourcePath, 'sourcePath');
  requireString(definition.sourceChecksum, 'sourceChecksum');
  requireString(definition.id, 'id');
  requireString(definition.authority.provenance, 'authority.provenance');
  requireStringArray(definition.match?.hostComponentIdentities, 'match.hostComponentIdentities');
  requireStringArray(
    definition.select?.nestedComponentIdentities,
    'select.nestedComponentIdentities',
  );
  requireString(definition.facts?.visibleMemberNodeIds, 'facts.visibleMemberNodeIds');
  requireString(
    definition.facts?.siblingPropertyValuesPrefix,
    'facts.siblingPropertyValuesPrefix',
  );
  if (!Array.isArray(definition.constraints) || !definition.constraints.length) {
    throw new TypeError('composition predicate contract requires constraints');
  }
  const ids = new Set();
  return definition.constraints.map((constraint) => {
    const id = requireString(constraint.id, 'constraint.id');
    if (ids.has(id)) throw new TypeError(`duplicate composition constraint: ${id}`);
    ids.add(id);
    return compileConstraint(definition, constraint);
  });
}

function compileSlotOrderPolicy(definition) {
  if (!definition || definition.schemaVersion !== 'apollo.slot-order-policy.v1') {
    throw new TypeError('slot order policy has an unsupported schemaVersion');
  }
  if (
    definition.ruleKind !== 'design-rule' ||
    definition.authority?.status !== 'active' ||
    definition.required !== true
  ) {
    throw new TypeError('slot order policy requires active design-rule authority');
  }
  requireString(definition.sourcePath, 'sourcePath');
  requireString(definition.sourceChecksum, 'sourceChecksum');
  requireString(definition.ruleId, 'ruleId');
  requireString(definition.authority.provenance, 'authority.provenance');
  requireStringArray(definition.ownerComponentIdentities, 'ownerComponentIdentities');
  requireStringArray(definition.containerNames, 'containerNames');
  requireStringArray(definition.order, 'order');

  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: definition.ruleId,
    revision: Number.isInteger(definition.authority.revision)
      ? definition.authority.revision
      : 1,
    source: {
      path: definition.sourcePath,
      checksum: definition.sourceChecksum,
      anchor: 'manual/slotOrderPolicy',
    },
    authority: {
      status: definition.authority.status,
      provenance: definition.authority.provenance,
    },
    effect: 'require',
    scope: definition.scope,
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'one-of',
        actual: { fact: 'slot.ownerComponentIdentity' },
        expected: { literal: definition.ownerComponentIdentities.slice() },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.expectedPreviousSlotNodeId' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'after',
        actual: { fact: 'id' },
        expected: { fact: 'composition.expectedPreviousSlotNodeId' },
      }, {
        predicate: 'exists',
        actual: { fact: 'slot.role' },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.expectedPreviousSlotRole' },
      }],
    },
    severity: definition.severity || 'error',
    unknownPolicy: definition.unknownPolicy || 'not-evaluable',
    remediation: null,
    presentation: definition.presentation || null,
  };
}

module.exports = {
  compileCompositionContract,
  compileSlotOrderPolicy,
};

const { snapshotHash } = require('./index');

function copyRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.assign({}, value)
    : {};
}

function setObjectPath(root, factPath, value) {
  const parts = factPath.split('.').filter(Boolean);
  if (!parts.length) return;
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function resolveComponent(component, componentIndex) {
  if (!component) return { value: null, unknownFacts: [] };
  const metadata = component.key ? componentIndex[component.key] : null;
  const properties = Object.assign(
    {},
    copyRecord(component.variantProperties),
    copyRecord(component.componentProperties),
  );
  const unknownFacts = [];
  if (!metadata?.identity) unknownFacts.push('component.identity');
  if (!metadata?.lifecycle) unknownFacts.push('component.lifecycle');
  return {
    value: {
      key: component.key || null,
      identity: metadata?.identity || null,
      family: metadata?.family || null,
      library: metadata?.library || null,
      lifecycle: metadata?.lifecycle || null,
      properties,
      api: metadata?.api || null,
      directOverrides: Array.isArray(component.directOverrides)
        ? component.directOverrides.map((item) => ({
            nodeId: item.nodeId,
            fields: Array.isArray(item.fields) ? item.fields.slice().sort() : [],
          }))
        : [],
    },
    unknownFacts,
  };
}

function resolveOwner(owner, componentIndex) {
  if (!owner) return { value: null, unknownFacts: [] };
  const component = resolveComponent({
    key: owner.componentKey,
    variantProperties: owner.variantProperties,
    componentProperties: owner.componentProperties,
    directOverrides: [],
  }, componentIndex);
  return {
    value: {
      ownerNodeId: owner.nodeId,
      relativePath: owner.relativePath,
      owner: { component: component.value },
    },
    unknownFacts: component.unknownFacts.map((factPath) => `ownership.owner.${factPath}`),
  };
}

function addComponentContourFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  function nextComponentAncestor(node) {
    const ownerNodeId = node.ownership?.ownerNodeId;
    if (ownerNodeId && ownerNodeId !== node.id) {
      const ownerNode = nodeById.get(ownerNodeId);
      if (ownerNode?.type === 'INSTANCE' && ownerNode.component) {
        return { node: ownerNode, externalIdentity: null };
      }
      return {
        node: null,
        externalIdentity: node.ownership?.owner?.component?.identity || null,
      };
    }

    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (current.type === 'INSTANCE' && current.component) {
        return { node: current, externalIdentity: null };
      }
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return { node: null, externalIdentity: null };
  }

  for (const node of nodes) {
    if (node.type !== 'INSTANCE' || !node.component) continue;

    const identity = node.component.identity;
    let root = node;
    let cursor = node;
    let unresolvedBoundary = false;
    let uncertainAncestorIdentity = false;
    const ancestorNodeIds = [];
    const visitedNodeIds = new Set([node.id]);

    while (cursor) {
      const ancestor = nextComponentAncestor(cursor);
      if (!ancestor.node) {
        if (cursor.ownership?.ownerNodeId) uncertainAncestorIdentity = true;
        break;
      }
      if (visitedNodeIds.has(ancestor.node.id)) {
        uncertainAncestorIdentity = true;
        break;
      }
      visitedNodeIds.add(ancestor.node.id);
      cursor = ancestor.node;
      if (!identity) break;
      if (!cursor.component.identity) {
        uncertainAncestorIdentity = true;
        continue;
      }
      if (cursor.component.identity !== identity) continue;
      root = cursor;
      ancestorNodeIds.push(cursor.id);
    }

    unresolvedBoundary = !identity || (
      root.id === node.id && uncertainAncestorIdentity
    );

    node.ownership = Object.assign({}, node.ownership || {}, {
      contour: {
        identity,
        rootNodeId: unresolvedBoundary ? null : root.id,
        isRoot: unresolvedBoundary ? null : root.id === node.id,
        root: unresolvedBoundary ? null : { component: root.component },
        ancestorNodeIds: ancestorNodeIds.slice(),
      },
    });

    if (!identity || unresolvedBoundary) {
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        ...(!identity ? ['ownership.contour.identity'] : []),
        ...(unresolvedBoundary ? [
          'ownership.contour.rootNodeId',
          'ownership.contour.isRoot',
          'ownership.contour.root.component.family',
        ] : []),
      ])).sort();
    }
  }

  return nodes;
}

function snapshotBindingProperty(property) {
  const paddingMatch = /^padding(Top|Right|Bottom|Left)$/.exec(property);
  if (paddingMatch) return `padding.${paddingMatch[1].toLowerCase()}`;
  return property;
}

function bindingRecord(variableBindings, layout) {
  const result = {};
  const unknownFacts = [];
  if (layout?.padding && typeof layout.padding === 'object') {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      setObjectPath(result, `padding.${side}`, {
        bound: false,
        value: layout.padding[side] ?? null,
        variableIds: [],
        variables: [],
        collection: null,
        token: null,
        variableId: null,
      });
    }
  }
  for (const item of variableBindings || []) {
    if (!item || typeof item.property !== 'string') continue;
    const property = snapshotBindingProperty(item.property);
    const variableIds = Array.isArray(item.variableIds)
      ? item.variableIds.slice().sort()
      : [];
    const variables = Array.isArray(item.variables)
      ? item.variables.map((variable) => ({
          id: variable?.id || null,
          key: variable?.key || null,
          name: variable?.name || null,
          collectionId: variable?.collectionId || null,
          collectionName: variable?.collectionName || null,
        })).sort((left, right) => String(left.id).localeCompare(String(right.id)))
      : [];
    const collections = Array.from(new Set(
      variables.map((variable) => variable.collectionName).filter(Boolean),
    ));
    const tokens = Array.from(new Set(
      variables.map((variable) => variable.name).filter(Boolean),
    ));
    setObjectPath(result, property, {
      bound: variableIds.length > 0,
      value: property.startsWith('padding.')
        ? layout?.padding?.[property.slice('padding.'.length)] ?? null
        : null,
      variableIds,
      variables,
      collection: collections.length === 1 ? collections[0] : null,
      token: tokens.length === 1 ? tokens[0] : null,
      variableId: variableIds.length === 1 ? variableIds[0] : null,
    });
    if (
      variableIds.length > 0 &&
      (
        variables.length !== variableIds.length ||
        variables.some((variable) => !variable.collectionName || !variable.name)
      )
    ) {
      unknownFacts.push(`bindings.${property}`);
    }
  }
  return { value: result, unknownFacts };
}

function changesByNode(changes) {
  const result = new Map();
  for (const change of changes || []) {
    if (!result.has(change.nodeId)) result.set(change.nodeId, []);
    result.get(change.nodeId).push(change);
  }
  for (const values of result.values()) values.sort((left, right) => left.id.localeCompare(right.id));
  return result;
}

function baselineForNode(changes) {
  const effective = {};
  const overrides = [];
  for (const change of changes || []) {
    const property = snapshotPropertyForChange(change.property);
    setObjectPath(effective, property, readableChangeValue(change.baseline));
    overrides.push({
      id: change.id,
      property: change.property,
      baseline: change.baseline || null,
      actual: change.actual || null,
      bindingStatus: change.bindingStatus || null,
      baselineReferenceId: change.baselineReferenceId,
      mapping: change.mapping || null,
    });
  }
  const overrideProperties = Array.from(new Set(
    overrides
      .map((override) => override.property)
      .filter((property) => typeof property === 'string' && property),
  )).sort();
  return { effective, overrides, overrideProperties };
}

function snapshotPropertyForChange(property) {
  if (property === 'styles.text') return 'appearance.styles.textStyle';
  return property;
}

function readableChangeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.resourceName === 'string' && value.resourceName) {
    return value.resourceName;
  }
  return value.value ?? null;
}

const TEXT_STYLE_OVERRIDE_FIELDS = new Set([
  'textStyleId',
  'fontName',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'paragraphSpacing',
  'paragraphIndent',
]);

function directOverrideFields(ownerNode, nodeId) {
  const override = ownerNode?.component?.directOverrides?.find(
    (item) => item.nodeId === nodeId,
  );
  return Array.isArray(override?.fields) ? override.fields : [];
}

function hasTextStyleOverride(ownerNode, nodeId) {
  return directOverrideFields(ownerNode, nodeId).some(
    (field) => TEXT_STYLE_OVERRIDE_FIELDS.has(field),
  );
}

function addEffectiveBaselineFacts(nodes, sourceNodes, indexedChanges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceById = new Map(sourceNodes.map((node) => [node.nodeId, node]));
  for (const node of nodes) {
    const source = sourceById.get(node.id);
    const changes = indexedChanges.get(node.id) || [];
    for (const change of changes) {
      setObjectPath(
        node,
        snapshotPropertyForChange(change.property),
        readableChangeValue(change.actual),
      );
    }
    if (!source || source.type !== 'TEXT') continue;
    node.appearance.styles.textStyle = source.styles?.textStyleId ?? null;
    const textStyleChange = changes.find((change) => change.property === 'styles.text');
    if (textStyleChange) {
      node.appearance.styles.textStyle = readableChangeValue(textStyleChange.actual);
      setObjectPath(
        node.baseline.effective,
        'appearance.styles.textStyle',
        readableChangeValue(textStyleChange.baseline),
      );
      continue;
    }

    const ownerNodeId = node.ownership?.ownerNodeId;
    const ownerNode = ownerNodeId ? nodeById.get(ownerNodeId) : null;
    if (!ownerNode || hasTextStyleOverride(ownerNode, node.id)) {
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        'baseline.effective.appearance.styles.textStyle',
      ])).sort();
      continue;
    }

    const textStyle = source.styles?.textStyleId ?? null;
    node.appearance.styles.textStyle = textStyle;
    setObjectPath(
      node.baseline.effective,
      'appearance.styles.textStyle',
      textStyle,
    );
  }
  return nodes;
}

function compositionPosition(index, count) {
  if (count === 1) return 'single';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

function addCompositionFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const buttonsByOwner = new Map();
  for (const node of nodes) {
    const ownerNodeId = node.ownership?.ownerNodeId;
    if (!ownerNodeId || node.component?.identity !== 'web-core.button') continue;
    if (node.ownership?.owner?.component?.identity !== 'web-corp.buttons-group') continue;
    if (!buttonsByOwner.has(ownerNodeId)) buttonsByOwner.set(ownerNodeId, []);
    buttonsByOwner.get(ownerNodeId).push(node);
  }

  for (const buttons of buttonsByOwner.values()) {
    buttons.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const propertyNames = Array.from(new Set(buttons.flatMap(
      (button) => Object.keys(button.component?.properties || {}),
    ))).sort();
    const siblingPropertyValues = {};
    const unknownPropertyPaths = [];
    for (const propertyName of propertyNames) {
      const values = buttons.map((button) => button.component?.properties?.[propertyName]);
      if (values.every((value) => value !== undefined)) {
        siblingPropertyValues[propertyName] = values;
      } else {
        unknownPropertyPaths.push(`composition.siblingPropertyValues.${propertyName}`);
      }
    }
    const siblingNodeIds = buttons.map((button) => button.id);
    const ownerNode = nodeById.get(buttons[0]?.ownership?.ownerNodeId);
    if (ownerNode) {
      ownerNode.composition = Object.assign({}, ownerNode.composition || {}, {
        visibleButtonNodeIds: siblingNodeIds.slice(),
      });
    }
    for (const [index, button] of buttons.entries()) {
      button.composition = {
        ownerNodeId: button.ownership.ownerNodeId,
        siblingNodeIds: siblingNodeIds.slice(),
        siblingPropertyValues: copyRecord(siblingPropertyValues),
        position: compositionPosition(index, buttons.length),
      };
      button.unknownFacts = Array.from(new Set([
        ...button.unknownFacts,
        ...unknownPropertyPaths,
      ])).sort();
    }
  }

  return nodes;
}

function numericComponentProperty(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
    return Number(value.trim());
  }
  return null;
}

function addBenefitsCompositionFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const owners = nodes.filter((node) => node.component?.identity === 'web.benefits');
  const canonicalCardNames = new Set(['[D] BenefitCard', '[M] BenefitCard', 'BenefitCard']);
  const uniformCardProperties = [
    'Background',
    'CardAxis',
    'Compact',
    'GraphicPosition',
  ];

  function nearestBenefitsOwner(node) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (current.component?.identity === 'web.benefits') return current;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return null;
  }

  function hasBenefitCardAncestorBeforeOwner(node, ownerId) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current && current.id !== ownerId) {
      if (current.component?.identity === 'web.benefit-card') return true;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return false;
  }

  for (const owner of owners) {
    const descendants = nodes.filter((node) => nearestBenefitsOwner(node)?.id === owner.id);
    const unresolvedCards = descendants.filter((node) => (
      canonicalCardNames.has(node.name) &&
      node.component?.identity === null &&
      node.unknownFacts.includes('component.identity')
    ));
    const cards = descendants
      .filter((node) => (
        node.component?.identity === 'web.benefit-card' &&
        !hasBenefitCardAncestorBeforeOwner(node, owner.id)
      ))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const capacity = numericComponentProperty(owner.component?.properties?.Capacity);
    const cardPropertyValues = {};
    const unknownCardPropertyFacts = [];
    for (const propertyName of uniformCardProperties) {
      const values = cards.map((card) => card.component?.properties?.[propertyName]);
      if (values.every((value) => value !== undefined && value !== null)) {
        cardPropertyValues[propertyName] = values;
      } else {
        unknownCardPropertyFacts.push(
          `composition.benefitCardPropertyValues.${propertyName}`,
        );
      }
    }
    owner.composition = Object.assign({}, owner.composition || {}, {
      capacity,
      visibleBenefitCardNodeIds: cards.map((card) => card.id),
      visibleBenefitCardCount: cards.length,
      benefitCardPropertyNodeIds: cards.map((card) => card.id),
      benefitCardPropertyValues: cardPropertyValues,
    });
    const unknownFacts = [];
    if (capacity === null) unknownFacts.push('composition.capacity');
    if (unresolvedCards.length) {
      unknownFacts.push(
        'composition.visibleBenefitCardNodeIds',
        'composition.visibleBenefitCardCount',
        'composition.benefitCardPropertyNodeIds',
        ...uniformCardProperties.map(
          (propertyName) => `composition.benefitCardPropertyValues.${propertyName}`,
        ),
      );
    }
    owner.unknownFacts = Array.from(new Set([
      ...owner.unknownFacts,
      ...unknownFacts,
      ...unknownCardPropertyFacts,
    ])).sort();
  }
  return nodes;
}

function addTableViewCompositionFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tableViewRootFamilies = new Set([
    'table-view-horizontal',
    'table-view-vertical',
    'table-view-horizontal-side-panel',
  ]);
  const owners = nodes.filter((node) => (
    node.component?.identity === 'web-corp.table-view' &&
    tableViewRootFamilies.has(node.component?.family)
  ));
  const canonicalRowNames = new Set(['Row', 'Row / Presets=Header']);

  function nearestTableViewOwner(node) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (
        current.component?.identity === 'web-corp.table-view' &&
        tableViewRootFamilies.has(current.component?.family)
      ) return current;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return null;
  }

  function hasRowAncestorBeforeOwner(node, ownerId) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current && current.id !== ownerId) {
      if (current.component?.family === 'row') return true;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return false;
  }

  function nearestTableRow(node, ownerId) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current && current.id !== ownerId) {
      if (
        current.component?.identity === 'web-corp.table-view' &&
        current.component?.family === 'row'
      ) return current;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return null;
  }

  for (const owner of owners) {
    const descendants = nodes.filter((node) => nearestTableViewOwner(node)?.id === owner.id);
    const unresolvedRows = descendants.filter((node) => (
      canonicalRowNames.has(node.name) &&
      node.component?.identity === null &&
      node.unknownFacts.includes('component.identity')
    ));
    const rows = descendants
      .filter((node) => (
        node.component?.identity === 'web-corp.table-view' &&
        node.component?.family === 'row' &&
        !hasRowAncestorBeforeOwner(node, owner.id)
      ))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const headerRows = rows.filter((row) => row.component?.properties?.Presets === 'Header');
    const ownerCompact = owner.component?.properties?.Compact;
    const expectedRowSpacing = ownerCompact === 'False'
      ? 16
      : ownerCompact === 'True'
        ? 12
        : null;
    for (const row of rows) {
      const columns = descendants
        .filter((node) => (
          node.component?.identity === 'web-corp.table-view' &&
          node.component?.family === 'column' &&
          nearestTableRow(node, owner.id)?.id === row.id
        ))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      const unresolvedColumns = descendants.filter((node) => (
        node.name === 'Column' &&
        node.component?.identity === null &&
        node.unknownFacts.includes('component.identity') &&
        nearestTableRow(node, owner.id)?.id === row.id
      ));
      const directSpacingNodes = (row.childIds || [])
        .map((nodeId) => nodeById.get(nodeId))
        .filter((child) => child?.name === '↕ SpacingVertical');
      const spacingVerticalValues = directSpacingNodes.map((child) => (
        numericComponentProperty(child.component?.properties?.Size)
      ));
      const spacingVertical = (
        spacingVerticalValues.length > 0 &&
        spacingVerticalValues.every((value) => value !== null) &&
        spacingVerticalValues.every((value) => value === spacingVerticalValues[0])
      )
        ? spacingVerticalValues[0]
        : null;
      row.composition = Object.assign({}, row.composition || {}, {
        tableViewOwner: {
          nodeId: owner.id,
          component: owner.component,
        },
        expectedRowSpacing,
        visibleDataColumnNodeIds: columns.map((column) => column.id),
        visibleDataColumnCount: columns.length,
        spacingVerticalNodeIds: directSpacingNodes.map((child) => child.id),
        spacingVerticalValues,
        spacingVertical,
      });
      const rowUnknownFacts = [];
      if (ownerCompact !== 'False' && ownerCompact !== 'True') {
        rowUnknownFacts.push(
          'composition.tableViewOwner.component.properties.Compact',
          'composition.expectedRowSpacing',
        );
      }
      if (
        row.component?.properties?.Compact !== 'False' &&
        row.component?.properties?.Compact !== 'True'
      ) {
        rowUnknownFacts.push('component.properties.Compact');
      }
      if (!directSpacingNodes.length || spacingVertical === null) {
        rowUnknownFacts.push(
          'composition.spacingVerticalNodeIds',
          'composition.spacingVerticalValues',
          'composition.spacingVertical',
        );
      }
      if (unresolvedColumns.length) {
        rowUnknownFacts.push(
          'composition.visibleDataColumnNodeIds',
          'composition.visibleDataColumnCount',
        );
      }
      row.unknownFacts = Array.from(new Set([
        ...row.unknownFacts,
        ...rowUnknownFacts,
      ])).sort();
    }
    owner.composition = Object.assign({}, owner.composition || {}, {
      visibleTableRowNodeIds: rows.map((row) => row.id),
      visibleHeaderRowNodeIds: headerRows.map((row) => row.id),
      visibleHeaderRowCount: headerRows.length,
    });
    if (unresolvedRows.length) {
      owner.unknownFacts = Array.from(new Set([
        ...owner.unknownFacts,
        'composition.visibleTableRowNodeIds',
        'composition.visibleHeaderRowNodeIds',
        'composition.visibleHeaderRowCount',
      ])).sort();
    }
  }
  return nodes;
}

function addCollectionErrors(nodes, collectionErrors) {
  if (!Array.isArray(collectionErrors) || !collectionErrors.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const error of collectionErrors) {
    if (!error || typeof error.nodeId !== 'string' || typeof error.factPath !== 'string') {
      continue;
    }
    const node = nodeById.get(error.nodeId);
    if (!node) continue;
    node.unknownFacts = Array.from(new Set([
      ...node.unknownFacts,
      error.factPath,
    ])).sort();
  }
  return nodes;
}

function addTitleViewStatusFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const titleViewOwners = nodes.filter((node) => (
    node.component?.identity === 'web-corp.title-view' &&
    node.component?.properties?.View !== undefined
  ));

  function belongsToOwner(node, ownerId) {
    let current = node.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (current.id === ownerId) return true;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return false;
  }

  for (const owner of titleViewOwners) {
    const status = nodes.find((node) => (
      node.name === 'StatusPreset' &&
      node.component?.properties?.Type !== undefined &&
      belongsToOwner(node, owner.id)
    ));
    const titleStatus = nodes.find((node) => (
      ['[D] TitleStatus', '[M] TitleStatus'].includes(node.name) &&
      belongsToOwner(node, owner.id)
    ));
    if (!titleStatus) continue;

    const items = [
      status ? { role: 'Status', node: status } : null,
      { role: 'TitleStatus', node: titleStatus },
    ].filter(Boolean);
    const typeValues = items.map((item) => item.node.component?.properties?.Type);
    const complete = typeValues.every((value) => value !== undefined);
    titleStatus.composition = Object.assign({}, titleStatus.composition || {}, {
      ownerStatusTypeNodeIds: items.map((item) => item.node.id),
      ownerVisibleStatusRoles: items.map((item) => item.role),
      ownerStatusTypeValues: complete ? typeValues : null,
    });
    if (!complete) {
      titleStatus.unknownFacts = Array.from(new Set([
        ...titleStatus.unknownFacts,
        'composition.ownerStatusTypeValues',
      ])).sort();
    }
  }
  return nodes;
}

function normalizeSlotRole(name) {
  return String(name || '').replace(/^\[(?:D|M)\]\s*/, '').trim();
}

function addTitleViewSlotFacts(nodes, requiredOrder) {
  if (!Array.isArray(requiredOrder) || !requiredOrder.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const roleByNormalizedName = new Map(
    requiredOrder.map((role) => [normalizeSlotRole(role), role]),
  );
  const owners = nodes.filter((node) => (
    node.component?.identity === 'web-corp.title-view'
  ));

  for (const owner of owners) {
    const mainContent = (owner.childIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .find((node) => node?.name === 'MainContent');
    if (!mainContent) continue;

    const slots = (mainContent.childIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node) => node?.visible === true)
      .map((node) => ({
        node,
        role: roleByNormalizedName.get(normalizeSlotRole(node.name)) || null,
      }))
      .filter((entry) => entry.role !== null);
    const nodesByRole = new Map();
    for (const entry of slots) {
      if (!nodesByRole.has(entry.role)) nodesByRole.set(entry.role, []);
      nodesByRole.get(entry.role).push(entry.node);
    }
    const ambiguous = Array.from(nodesByRole.values()).some((items) => items.length !== 1);
    const actualRoles = slots.map((entry) => entry.role);
    const expectedRoles = requiredOrder.filter((role) => nodesByRole.has(role));

    for (const entry of slots) {
      entry.node.slot = {
        ownerNodeId: owner.id,
        ownerComponentIdentity: owner.component.identity,
        role: entry.role,
      };
      entry.node.composition = Object.assign({}, entry.node.composition || {}, {
        ownerVisibleSlotSequence: actualRoles.slice(),
        ownerExpectedVisibleSlotSequence: expectedRoles.slice(),
      });
      if (ambiguous) {
        entry.node.unknownFacts = Array.from(new Set([
          ...entry.node.unknownFacts,
          'composition.expectedPreviousSlotNodeId',
        ])).sort();
        continue;
      }
      const expectedIndex = expectedRoles.indexOf(entry.role);
      const previousRole = expectedIndex > 0 ? expectedRoles[expectedIndex - 1] : null;
      const previousNode = previousRole ? nodesByRole.get(previousRole)?.[0] : null;
      entry.node.composition.expectedPreviousSlotNodeId = previousNode?.id || null;
      entry.node.composition.expectedPreviousSlotRole = previousRole;
    }
  }
  return nodes;
}

function addParentCompositionFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const parent = node.parentId ? nodeById.get(node.parentId) : null;
    node.composition = Object.assign({}, node.composition || {}, {
      parent: parent
        ? {
            nodeId: parent.id,
            name: parent.name,
            type: parent.type,
            component: parent.component,
          }
        : null,
    });
    if (!parent) {
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        'composition.parent',
      ])).sort();
      continue;
    }
    const parentUnknownFacts = (parent.unknownFacts || [])
      .filter((factPath) => factPath === 'component' || factPath.startsWith('component.'))
      .map((factPath) => `composition.parent.${factPath}`);
    node.unknownFacts = Array.from(new Set([
      ...node.unknownFacts,
      ...parentUnknownFacts,
    ])).sort();
  }
  return nodes;
}

function addBackgroundPlateOverlayFacts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (
      node.component?.identity !== 'web-corp.background-plate' ||
      node.component?.properties?.Position !== 'Level 2 (inner)'
    ) {
      continue;
    }

    const parent = node.parentId ? nodeById.get(node.parentId) : null;
    if (!parent) {
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        'composition.level1Underlay',
      ])).sort();
      continue;
    }

    let host = parent;
    let candidates = [];
    while (host) {
      candidates = (host.childIds || [])
        .map((nodeId) => nodeById.get(nodeId))
        .filter((candidate) => (
          candidate &&
          candidate.visible === true &&
          candidate.component?.identity === 'web-corp.background-plate' &&
          candidate.component?.properties?.Position === 'Level 1 (outer)'
        ));
      if (candidates.length) break;
      host = host.parentId ? nodeById.get(host.parentId) : null;
    }

    if (candidates.length > 1) {
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        'composition.level1Underlay',
      ])).sort();
      continue;
    }

    const underlay = candidates[0] || null;
    let contentNode = node;
    if (underlay && host) {
      while (contentNode.parentId && contentNode.parentId !== host.id) {
        const ancestor = nodeById.get(contentNode.parentId);
        if (!ancestor) break;
        contentNode = ancestor;
      }
    }
    node.composition = Object.assign({}, node.composition || {}, {
      level1Underlay: underlay
        ? {
            nodeId: underlay.id,
            contentNodeId: contentNode.id,
            contentLayout: {
              positioning: contentNode.layout?.positioning ?? null,
            },
            parentNodeId: underlay.parentId,
            parentLayoutMode: host?.layout?.mode ?? null,
            component: underlay.component,
            layout: {
              positioning: underlay.layout?.positioning ?? null,
            },
            bounds: underlay.bounds,
          }
        : null,
    });

    if (underlay) {
      const underlayUnknownFacts = (underlay.unknownFacts || [])
        .filter((factPath) => (
          factPath === 'component' ||
          factPath.startsWith('component.') ||
          factPath === 'bounds' ||
          factPath === 'layout.positioning'
        ))
        .map((factPath) => `composition.level1Underlay.${factPath}`);
      const contentUnknownFacts = (contentNode.unknownFacts || [])
        .filter((factPath) => factPath === 'layout.positioning')
        .map((factPath) => `composition.level1Underlay.contentLayout.${factPath.slice('layout.'.length)}`);
      node.unknownFacts = Array.from(new Set([
        ...node.unknownFacts,
        ...underlayUnknownFacts,
        ...contentUnknownFacts,
      ])).sort();
    }
  }
  return nodes;
}

function isFormFirstLevelSurfaceComponent(node) {
  return (
    node?.visible === true &&
    node.component?.identity === 'web-corp.background-plate' &&
    (
      node.component?.family === 'background-plate-slot' ||
      node.component?.properties?.Position === 'Level 1 (outer)'
    )
  );
}

function buildFormSurfaceModel(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ownerByUnderlayId = new Map();
  const surfaces = [];

  function directChildren(node) {
    return (node?.childIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .filter(Boolean);
  }

  function isAbsoluteLevel1Underlay(node) {
    return (
      isFormFirstLevelSurfaceComponent(node) &&
      node.component?.properties?.Position === 'Level 1 (outer)' &&
      node.layout?.positioning === 'ABSOLUTE'
    );
  }

  for (const owner of nodes) {
    if (owner.visible !== true || !owner.bounds) continue;
    const underlays = directChildren(owner).filter(isAbsoluteLevel1Underlay);
    if (underlays.length !== 1) continue;
    const underlay = underlays[0];
    const surface = {
      node: owner,
      owner,
      underlay,
      model: 'owner-underlay',
    };
    surfaces.push(surface);
    ownerByUnderlayId.set(underlay.id, owner.id);
  }

  for (const node of nodes) {
    if (!isFormFirstLevelSurfaceComponent(node) || ownerByUnderlayId.has(node.id)) continue;
    surfaces.push({
      node,
      owner: node,
      underlay: null,
      model: 'component-root',
    });
  }

  const surfaceByOwnerId = new Map(surfaces.map((surface) => [surface.owner.id, surface]));

  function nearestSurface(node) {
    let current = node;
    while (current) {
      const surface = surfaceByOwnerId.get(current.id);
      if (surface) return surface;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return null;
  }

  function isDescendantOf(node, ancestorId) {
    let current = node?.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return false;
  }

  function containsSurface(node) {
    return surfaces.some((surface) => (
      surface.owner.id === node.id || isDescendantOf(surface.owner, node.id)
    ));
  }

  function isTechnicalSpacer(node) {
    const name = String(node?.name || '').toLowerCase();
    const identity = String(node?.component?.identity || '').toLowerCase();
    const family = String(node?.component?.family || '').toLowerCase();
    return name.includes('spacer') || identity.includes('spacing') || family.includes('spacing');
  }

  for (const surface of surfaces) {
    const owner = surface.owner;
    owner.composition = Object.assign({}, owner.composition || {}, {
      formFirstLevelSurface: Object.assign(
        {},
        owner.composition?.formFirstLevelSurface || {},
        {
          nodeId: owner.id,
          bounds: owner.bounds,
          model: surface.model,
          underlayNodeId: surface.underlay?.id || null,
        },
      ),
    });
  }

  return {
    nodeById,
    surfaces,
    surfaceByOwnerId,
    nearestSurface,
    isDescendantOf,
    containsSurface,
    isTechnicalSpacer,
    directChildren,
  };
}

function addFormFirstLevelBlockFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const model = buildFormSurfaceModel(nodes);
  const blocksByParent = new Map();
  for (const surface of model.surfaces) {
    const node = surface.owner;
    if (!node.parentId) continue;
    if (!blocksByParent.has(node.parentId)) blocksByParent.set(node.parentId, []);
    blocksByParent.get(node.parentId).push(node);
  }

  for (const [parentId, blocks] of blocksByParent.entries()) {
    const parent = model.nodeById.get(parentId);
    if (!parent || blocks.length < 2) continue;
    blocks.sort((left, right) => (
      (left.bounds?.y ?? Number.POSITIVE_INFINITY) -
        (right.bounds?.y ?? Number.POSITIVE_INFINITY) ||
      left.order - right.order ||
      left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < blocks.length; index += 1) {
      const previous = blocks[index - 1];
      const current = blocks[index];
      current.composition = Object.assign({}, current.composition || {}, {
        previousFormFirstLevelBlock: {
          nodeId: previous.id,
          parentNodeId: parent.id,
          bounds: previous.bounds,
        },
      });
      const unknownFacts = [];
      if (!previous.bounds) {
        unknownFacts.push('composition.previousFormFirstLevelBlock.bounds');
      }
      current.unknownFacts = Array.from(new Set([
        ...current.unknownFacts,
        ...unknownFacts,
      ])).sort();
    }
  }
  return nodes;
}

function addFormSecondLevelActionSpacingFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const model = buildFormSurfaceModel(nodes);
  const { nodeById } = model;

  function descendants(nodeId, maxDepth = 4) {
    const result = [];
    const queue = (nodeById.get(nodeId)?.childIds || [])
      .map((childId) => ({ node: nodeById.get(childId), depth: 1 }))
      .filter((item) => item.node);
    while (queue.length) {
      const current = queue.shift();
      result.push(current.node);
      if (current.depth >= maxDepth) continue;
      for (const childId of current.node.childIds || []) {
        const child = nodeById.get(childId);
        if (child) queue.push({ node: child, depth: current.depth + 1 });
      }
    }
    return result;
  }

  function isButton(node) {
    return node?.visible === true && node.component?.identity === 'web-core.button';
  }

  function componentSize(node) {
    const numeric = Number(
      node?.component?.properties?.Size ?? node?.component?.properties?.size,
    );
    return Number.isFinite(numeric) ? numeric : null;
  }

  function isPrimaryAction(node) {
    if (isButton(node)) {
      const view = String(node.component?.properties?.View || '').toLowerCase();
      return (
        componentSize(node) === 56 &&
        ['primary', 'accent'].includes(view)
      );
    }
    if (node?.visible !== true || node.layout?.mode !== 'HORIZONTAL') return false;
    const directChildren = (node.childIds || [])
      .map((childId) => nodeById.get(childId))
      .filter(Boolean);
    const directButtons = directChildren.filter(isButton);
    const allButtons = descendants(node.id).filter(isButton);
    const isComponentGroup = node.component?.identity === 'web-corp.buttons-group';
    const isStructuralGroup = directChildren.length > 0 &&
      directButtons.length === directChildren.length;
    if ((!isComponentGroup && !isStructuralGroup) || allButtons.length === 0) return false;
    const groupSize = componentSize(node);
    const buttonSizes = allButtons.map(componentSize);
    return groupSize === 56 || (
      buttonSizes.every((size) => size === 56) &&
      buttonSizes.length === allButtons.length
    );
  }

  for (const action of nodes) {
    const parent = action.parentId ? nodeById.get(action.parentId) : null;
    if (!parent || parent.layout?.mode !== 'VERTICAL' || !isPrimaryAction(action)) {
      continue;
    }
    const siblings = (parent.childIds || [])
      .map((childId) => nodeById.get(childId))
      .filter((node) => node?.visible === true);
    const actionIndex = siblings.findIndex((node) => node.id === action.id);
    if (actionIndex <= 0 || actionIndex !== siblings.length - 1) continue;
    let content = null;
    for (let index = actionIndex - 1; index >= 0; index -= 1) {
      if (model.isTechnicalSpacer(siblings[index])) continue;
      content = siblings[index];
      break;
    }
    if (!content || !model.containsSurface(content)) continue;

    action.composition = Object.assign({}, action.composition || {}, {
      previousFormContent: {
        nodeId: content.id,
        parentNodeId: parent.id,
        bounds: content.bounds,
        hierarchyLevel: 'second-level',
      },
    });
    if (!content.bounds || !action.bounds) {
      action.unknownFacts = Array.from(new Set([
        ...action.unknownFacts,
        'composition.previousFormContent.bounds',
      ])).sort();
    }
  }
  return nodes;
}

function addFormMediumTitleFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const model = buildFormSurfaceModel(nodes);

  const candidatesBySurface = new Map();
  for (const node of nodes) {
    const isMedium = node.component?.properties?.View === 'Medium';
    const isKnownTitle = node.component?.identity === 'web-corp.title-view';
    const isUnresolvedTitle = (
      node.component?.identity === null &&
      normalizeSlotRole(node.name) === 'TitleView'
    );
    if (node.visible !== true || !isMedium || (!isKnownTitle && !isUnresolvedTitle)) {
      continue;
    }
    const surface = model.nearestSurface(node);
    if (!surface) continue;
    if (!candidatesBySurface.has(surface.owner.id)) {
      candidatesBySurface.set(surface.owner.id, { surface, titles: [] });
    }
    candidatesBySurface.get(surface.owner.id).titles.push(node);
  }

  for (const { surface, titles } of candidatesBySurface.values()) {
    titles.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const titleNodeIds = titles.map((title) => title.id);
    const hasUnresolvedIdentity = titles.some(
      (title) => title.component?.identity !== 'web-corp.title-view',
    );
    for (const [index, title] of titles.entries()) {
      title.composition = Object.assign({}, title.composition || {}, {
        formFirstLevelSurface: {
          nodeId: surface.owner.id,
          component: surface.underlay?.component || surface.owner.component,
          mediumTitleNodeIds: titleNodeIds.slice(),
          mediumTitleCount: titles.length,
          mediumTitlePosition: compositionPosition(index, titles.length),
        },
      });
      if (hasUnresolvedIdentity) {
        title.unknownFacts = Array.from(new Set([
          ...title.unknownFacts,
          'composition.formFirstLevelSurface.mediumTitleNodeIds',
          'composition.formFirstLevelSurface.mediumTitleCount',
          'composition.formFirstLevelSurface.mediumTitlePosition',
        ])).sort();
      }
    }
  }
  return nodes;
}

function addFormTitleContentGapFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const model = buildFormSurfaceModel(nodes);
  const { nodeById } = model;

  function isMediumTitleCandidate(node) {
    if (node?.visible !== true || node.component?.properties?.View !== 'Medium') return false;
    return (
      node.component?.identity === 'web-corp.title-view' ||
      (
        node.component?.identity === null &&
        normalizeSlotRole(node.name) === 'TitleView'
      )
    );
  }

  const titlesBySurface = new Map();
  for (const node of nodes) {
    if (!isMediumTitleCandidate(node)) continue;
    const surface = model.nearestSurface(node);
    if (!surface) continue;
    if (!titlesBySurface.has(surface.owner.id)) {
      titlesBySurface.set(surface.owner.id, { surface, titles: [] });
    }
    titlesBySurface.get(surface.owner.id).titles.push(node);
  }

  for (const { surface, titles } of titlesBySurface.values()) {
    titles.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const title = titles.at(-1);
    const parent = title?.parentId ? nodeById.get(title.parentId) : null;
    if (!title || !parent) continue;
    const siblings = (parent.childIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node) => node?.visible === true)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const titleIndex = siblings.findIndex((node) => node.id === title.id);
    const content = siblings.slice(titleIndex + 1).find((node) => (
      !isMediumTitleCandidate(node) &&
      !model.isTechnicalSpacer(node) &&
      node.id !== surface.underlay?.id
    ));
    if (!content) continue;

    content.composition = Object.assign({}, content.composition || {}, {
      previousFormMediumTitle: {
        nodeId: title.id,
        surfaceNodeId: surface.owner.id,
        bounds: title.bounds,
      },
    });
    if (
      title.component?.identity !== 'web-corp.title-view' ||
      !title.bounds ||
      !content.bounds
    ) {
      content.unknownFacts = Array.from(new Set([
        ...content.unknownFacts,
        'composition.previousFormMediumTitle.bounds',
      ])).sort();
    }
  }
  return nodes;
}

function addFormStandardContentInsetsFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const model = buildFormSurfaceModel(nodes);

  function directBranch(node, surfaceOwner) {
    let current = node;
    while (current?.parentId && current.parentId !== surfaceOwner.id) {
      current = model.nodeById.get(current.parentId);
    }
    return current?.parentId === surfaceOwner.id ? current : null;
  }

  function unionBounds(items) {
    if (!items.length || items.some((item) => !item.bounds)) return null;
    const left = Math.min(...items.map((item) => item.bounds.x));
    const top = Math.min(...items.map((item) => item.bounds.y));
    const right = Math.max(...items.map((item) => item.bounds.x + item.bounds.width));
    const bottom = Math.max(...items.map((item) => item.bounds.y + item.bounds.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  for (const surface of model.surfaces) {
    const owner = surface.owner;
    const titles = nodes.filter((node) => (
      node.visible === true &&
      node.component?.identity === 'web-corp.title-view' &&
      node.component?.properties?.View === 'Medium' &&
      model.nearestSurface(node)?.owner.id === owner.id
    )).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const title = titles[0];
    if (!title) continue;

    const titleBranch = directBranch(title, owner);
    let contentBoundaryNodeIds = [];
    let contentBounds = null;
    if (titleBranch && titleBranch.id !== title.id) {
      contentBoundaryNodeIds = [titleBranch.id];
      contentBounds = titleBranch.bounds;
    } else {
      const semanticChildren = model.directChildren(owner).filter((node) => (
        node.visible === true &&
        node.id !== surface.underlay?.id &&
        node.id !== title.id &&
        node.layout?.positioning !== 'ABSOLUTE' &&
        !model.isTechnicalSpacer(node) &&
        (node.bounds?.y ?? Number.NEGATIVE_INFINITY) >= (title.bounds?.y ?? 0)
      ));
      contentBoundaryNodeIds = semanticChildren.map((node) => node.id);
      contentBounds = unionBounds(semanticChildren);
    }

    let contentInsets = {
      top: null,
      right: null,
      bottom: null,
      left: null,
    };
    if (title.bounds && contentBounds && owner.bounds) {
      contentInsets = {
        top: title.bounds.y - owner.bounds.y,
        right: (
          owner.bounds.x + owner.bounds.width -
          (contentBounds.x + contentBounds.width)
        ),
        bottom: (
          owner.bounds.y + owner.bounds.height -
          (contentBounds.y + contentBounds.height)
        ),
        left: contentBounds.x - owner.bounds.x,
      };
    }

    owner.composition = Object.assign({}, owner.composition || {}, {
      formFirstLevelSurface: Object.assign(
        {},
        owner.composition?.formFirstLevelSurface || {},
        {
          nodeId: owner.id,
          bounds: owner.bounds,
          titleNodeId: title.id,
          contentBoundaryNodeIds,
          contentInsets,
        },
      ),
    });
    if (!title.bounds || !contentBounds || !owner.bounds) {
      owner.unknownFacts = Array.from(new Set([
        ...owner.unknownFacts,
        'composition.formFirstLevelSurface.contentInsets.top',
        'composition.formFirstLevelSurface.contentInsets.right',
        'composition.formFirstLevelSurface.contentInsets.bottom',
        'composition.formFirstLevelSurface.contentInsets.left',
      ])).sort();
    }
  }
  return nodes;
}

function addFormEightFourLayoutFacts(nodes, pageType) {
  if (pageType !== 'form') return nodes;
  const surfaceModel = buildFormSurfaceModel(nodes);
  const { nodeById } = surfaceModel;

  function isDescendantOf(node, ancestorId) {
    let current = node?.parentId ? nodeById.get(node.parentId) : null;
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    return false;
  }

  function subtreeContains(node, predicate) {
    if (predicate(node)) return true;
    return nodes.some((candidate) => (
      candidate.visible === true &&
      isDescendantOf(candidate, node.id) &&
      predicate(candidate)
    ));
  }

  function containsFormSurface(node) {
    return surfaceModel.containsSurface(node);
  }

  function containsIsland(node) {
    return subtreeContains(node, (candidate) => (
      candidate.component?.identity === 'web-corp.isle-block'
    ));
  }

  for (const parent of nodes) {
    if (parent.visible !== true || parent.layout?.mode !== 'HORIZONTAL') continue;
    const flowChildren = (parent.childIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .filter((child) => (
        child?.visible === true && child.layout?.positioning !== 'ABSOLUTE'
      ));
    const mainCandidates = flowChildren.filter(containsFormSurface);
    const islandCandidates = flowChildren.filter(containsIsland);
    const pairs = [];
    for (const mainZone of mainCandidates) {
      for (const islandZone of islandCandidates) {
        if (mainZone.id !== islandZone.id) pairs.push({ mainZone, islandZone });
      }
    }
    if (!pairs.length) continue;

    let mainZone = null;
    let islandZone = null;
    if (pairs.length === 1) {
      ({ mainZone, islandZone } = pairs[0]);
    }
    const padding = parent.layout?.padding || {};
    const hasGeometry = Boolean(parent.bounds && mainZone?.bounds && islandZone?.bounds);
    const innerWidth = parent.bounds
      ? parent.bounds.width - (padding.left || 0) - (padding.right || 0)
      : null;
    const gutter = 24;
    const columnWidth = Number.isFinite(innerWidth)
      ? (innerWidth - (11 * gutter)) / 12
      : null;
    const expectedMainWidth = Number.isFinite(columnWidth)
      ? (8 * columnWidth) + (7 * gutter)
      : null;
    const expectedIslandWidth = Number.isFinite(columnWidth)
      ? (4 * columnWidth) + (3 * gutter)
      : null;
    const measuredGap = hasGeometry
      ? islandZone.bounds.x - (mainZone.bounds.x + mainZone.bounds.width)
      : null;

    parent.composition = Object.assign({}, parent.composition || {}, {
      formEightFourLayout: {
        nodeId: parent.id,
        mainZoneNodeId: mainZone?.id || null,
        islandZoneNodeId: islandZone?.id || null,
        contentWidth: innerWidth,
        gutter: measuredGap,
        expectedGutter: gutter,
        mainWidth: mainZone?.bounds?.width ?? null,
        expectedMainWidth,
        islandWidth: islandZone?.bounds?.width ?? null,
        expectedIslandWidth,
      },
    });
    if (pairs.length !== 1 || !hasGeometry) {
      parent.unknownFacts = Array.from(new Set([
        ...parent.unknownFacts,
        'composition.formEightFourLayout.mainZoneNodeId',
        'composition.formEightFourLayout.islandZoneNodeId',
        'composition.formEightFourLayout.gutter',
        'composition.formEightFourLayout.mainWidth',
        'composition.formEightFourLayout.islandWidth',
      ])).sort();
    }
  }
  return nodes;
}

function buildPredicateSnapshotV2(input) {
  const bundle = input.evidenceBundle;
  if (!bundle || bundle.schemaVersion !== 2 || bundle.documentType !== 'apollo-audit-evidence-bundle') {
    const error = new Error('Predicate snapshot adapter requires ApolloAuditEvidenceBundle v2');
    error.code = 'PREDICATE_EVIDENCE_INVALID';
    throw error;
  }
  const fileKey = input.fileKey || bundle.context.fileKey || null;
  const pageId = input.pageId || bundle.context.pageId;
  const platform = input.platform || bundle.context.platform;
  const viewportWidth = input.viewportWidth ?? bundle.context.viewportWidth ?? null;
  for (const [field, value] of [
    ['pageId', pageId],
    ['platform', platform],
    ['release.knowledgeSource', input.release?.knowledgeSource],
    ['release.revision', input.release?.revision],
    ['release.checksum', input.release?.checksum],
  ]) {
    if (typeof value !== 'string' || !value) {
      const error = new Error(`Predicate snapshot adapter requires ${field}`);
      error.code = 'PREDICATE_EVIDENCE_INVALID';
      throw error;
    }
  }
  const componentIndex = input.componentIndex || {};
  const indexedChanges = changesByNode(bundle.changes);
  let nodes = bundle.graph.nodes.map((source, order) => {
    const component = resolveComponent(source.component, componentIndex);
    const ownership = resolveOwner(source.componentOwner, componentIndex);
    const baseline = baselineForNode(indexedChanges.get(source.nodeId));
    const bindings = bindingRecord(source.variableBindings, source.layout);
    const unknownFacts = Array.from(new Set([
      ...component.unknownFacts,
      ...ownership.unknownFacts,
      ...bindings.unknownFacts,
      ...(source.bounds ? [] : ['bounds']),
    ])).sort();
    return {
      id: source.nodeId,
      parentId: source.parentNodeId,
      childIds: source.childNodeIds.slice(),
      order,
      path: source.path,
      name: source.name,
      type: source.type,
      visible: true,
      bounds: source.bounds,
      component: component.value,
      layout: {
        mode: source.layout.mode,
        positioning: source.layout.positioning ?? null,
        wrap: source.layout.wrap,
        sizingHorizontal: source.layout.sizingHorizontal,
        sizingVertical: source.layout.sizingVertical,
        primaryAxisAlignItems: source.layout.primaryAxisAlignItems,
        counterAxisAlignItems: source.layout.counterAxisAlignItems,
        padding: source.layout.padding,
        itemSpacing: source.layout.itemSpacing,
        clipsContent: source.layout.clipsContent,
      },
      appearance: { styles: copyRecord(source.styles) },
      bindings: bindings.value,
      text: source.text
        ? {
            characters: source.text.characters,
            length: source.text.length,
            textStyleId: source.text.textStyleId,
          }
        : null,
      ownership: ownership.value,
      slot: null,
      composition: null,
      baseline: { effective: baseline.effective },
      overrides: baseline.overrides,
      overrideProperties: baseline.overrideProperties,
      unknownFacts,
    };
  });
  nodes = addCompositionFacts(nodes);
  nodes = addBenefitsCompositionFacts(nodes);
  nodes = addTableViewCompositionFacts(nodes);
  nodes = addParentCompositionFacts(nodes);
  nodes = addComponentContourFacts(nodes);
  nodes = addBackgroundPlateOverlayFacts(nodes);
  nodes = addFormFirstLevelBlockFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addFormSecondLevelActionSpacingFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addFormMediumTitleFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addFormTitleContentGapFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addFormStandardContentInsetsFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addFormEightFourLayoutFacts(
    nodes,
    input.pageType ?? bundle.context.pageType ?? null,
  );
  nodes = addTitleViewSlotFacts(nodes, input.titleViewSlotOrder);
  nodes = addTitleViewStatusFacts(nodes);
  nodes = addEffectiveBaselineFacts(nodes, bundle.graph.nodes, indexedChanges);
  nodes = addCollectionErrors(nodes, input.collectionErrors);
  const snapshot = {
    schemaVersion: 'apollo.predicate-snapshot.v2',
    auditId: input.auditId || bundle.sourceReportId,
    generatedAt: bundle.generatedAt,
    context: {
      fileKey,
      pageId,
      platform,
      pageType: input.pageType ?? bundle.context.pageType ?? null,
      viewportWidth,
      surface: input.surface || null,
      modalRootNodeId: input.modalRootNodeId || null,
      unknownFacts: [
        ...(fileKey ? [] : ['fileKey']),
        ...(viewportWidth === null ? ['viewportWidth'] : []),
      ],
    },
    release: {
      knowledgeSource: input.release.knowledgeSource,
      revision: input.release.revision,
      checksum: input.release.checksum,
    },
    selection: bundle.context.selectionNodeIds.slice(),
    nodes,
    collectionErrors: Array.isArray(input.collectionErrors)
      ? input.collectionErrors.slice()
      : [],
  };
  snapshot.snapshotHash = snapshotHash(snapshot);
  return snapshot;
}

module.exports = {
  buildPredicateSnapshotV2,
};

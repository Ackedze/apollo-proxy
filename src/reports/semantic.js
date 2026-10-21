'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');


function compactApolloTextReport(report) {
  const texts = (report?.facts?.texts || []).map((fact) => ({
    node: {
      id: fact?.node?.id ?? null,
      name: fact?.node?.name ?? null,
      type: fact?.node?.type ?? null,
      path: fact?.node?.path ?? null,
      visible: fact?.node?.visible !== false,
    },
    text: fact?.text ?? '',
    owner: fact?.owner || null,
    ancestors: Array.isArray(fact?.ancestors) ? fact.ancestors : [],
    documentOrder: Number.isFinite(fact?.documentOrder)
      ? fact.documentOrder
      : null,
  }));
  return {
    schemaVersion: 1,
    reportKind: 'apollo-text-audit-report',
    reportId: report.reportId,
    sourceReportId: report.sourceReportId,
    scan: {
      channel: report?.scan?.channel || null,
      pageType: report?.scan?.pageType || null,
      selection: Array.isArray(report?.scan?.selection)
        ? report.scan.selection
        : [],
    },
    summary: report.summary,
    facts: { texts },
  };
}


function compactApolloPatternReport(report) {
  const occurrences = (report?.facts?.occurrences || []).map((occurrence) => ({
    node: {
      id: occurrence?.node?.id ?? null,
      name: occurrence?.node?.name ?? null,
      type: occurrence?.node?.type ?? null,
      path: occurrence?.node?.path ?? null,
      visible: occurrence?.node?.visible !== false,
    },
    component: {
      name: occurrence?.component?.name ?? null,
      key: occurrence?.component?.key ?? null,
      library: occurrence?.component?.library ?? null,
      sourceFile: occurrence?.component?.sourceFile ?? null,
    },
    variant: occurrence?.variant ? {
      name: occurrence.variant.name ?? null,
      key: occurrence.variant.key ?? null,
      properties: occurrence.variant.properties || {},
    } : null,
    ancestors: (occurrence?.ancestors || []).map((ancestor) => ({
      nodeId: ancestor?.nodeId ?? null,
      name: ancestor?.name ?? null,
      componentName: ancestor?.componentName ?? null,
      componentKey: ancestor?.componentKey ?? null,
      variantProperties: ancestor?.variantProperties || {},
    })),
  }));
  const layoutRelations = (report?.facts?.layoutRelations || []).map((relation) => ({
    id: relation?.id ?? null,
    axis: relation?.axis ?? null,
    relationKind: relation?.relationKind ?? null,
    from: relation?.from || null,
    to: relation?.to || null,
    container: relation?.container || null,
    measurement: relation?.measurement || null,
    semantic: relation?.semantic || null,
    contextComplete: relation?.contextComplete === true,
  }));
  const compactReport = {
    schemaVersion: 1,
    reportKind: 'apollo-pattern-audit-report',
    reportId: report.reportId,
    sourceReportId: report.sourceReportId,
    scan: {
      channel: report?.scan?.channel || null,
      pageType: report?.scan?.pageType || null,
      selection: Array.isArray(report?.scan?.selection)
        ? report.scan.selection
        : [],
    },
    summary: report.summary,
    requestedRuleIds: [...new Set(report.requestedRuleIds || [])],
    category: compactApolloCustomizationReport(report).category,
    facts: { occurrences, layoutRelations },
  };
  if (report?.evidenceBundle !== undefined) {
    compactReport.evidenceBundle = compactApolloEvidenceBundle(
      report.evidenceBundle
    );
  }
  return compactReport;
}


function compactApolloEvidenceBundle(bundle) {
  const nodeColumns = [
    'id',
    'parentId',
    'order',
    'type',
    'name',
    'bounds[x,y,width,height]',
    'layout[mode,wrap,sizingHorizontal,sizingVertical,primaryAlign,counterAlign,padding[top,right,bottom,left],itemSpacing,clipsContent]',
    'component[key,name,variantProperties,componentProperties]',
    'owner[id,componentKey,name,relativePath]',
    'text[characters,textStyleId]',
    'styles[fill,stroke,text,effect]',
    'variableBindings[[property,variableIds]]',
  ];
  const nodes = (bundle?.graph?.nodes || []).map((node) => trimTrailingNulls([
    node?.nodeId ?? null,
    node?.parentNodeId ?? null,
    Number.isFinite(node?.childOrder) ? node.childOrder : null,
    node?.type ?? null,
    node?.name ?? null,
    compactEvidenceBounds(node?.bounds),
    compactEvidenceLayout(node?.layout),
    compactEvidenceComponent(node?.component),
    compactEvidenceOwner(node?.componentOwner),
    compactEvidenceText(node?.text),
    compactEvidenceStyles(node?.styles),
    compactEvidenceVariableBindings(node?.variableBindings),
  ]));
  const paddingByContainer = new Map();
  const siblingGaps = [];
  for (const relation of bundle?.graph?.relations || []) {
    if (relation?.kind === 'container-padding') {
      const containerId = relation?.containerNodeId || relation?.fromNodeId;
      if (!containerId || !['top', 'right', 'bottom', 'left'].includes(relation?.edge)) {
        continue;
      }
      let entry = paddingByContainer.get(containerId);
      if (!entry) {
        entry = {
          values: { top: null, right: null, bottom: null, left: null },
          source: null,
          quality: null,
        };
        paddingByContainer.set(containerId, entry);
      }
      entry.values[relation.edge] = relation?.measurement?.actualPx ?? null;
      entry.source = entry.source || relation?.measurement?.source || null;
      entry.quality = entry.quality || relation?.measurement?.quality || null;
      continue;
    }
    if (relation?.kind !== 'sibling-gap') continue;
    siblingGaps.push(trimTrailingNulls([
      relation?.fromNodeId ?? null,
      relation?.toNodeId ?? null,
      relation?.containerNodeId ?? null,
      relation?.axis ?? null,
      relation?.measurement?.actualPx ?? null,
      relation?.measurement?.source ?? null,
      relation?.measurement?.quality ?? null,
    ]));
  }
  const paddings = Array.from(paddingByContainer.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([containerId, entry]) => trimTrailingNulls([
      containerId,
      entry.values.top,
      entry.values.right,
      entry.values.bottom,
      entry.values.left,
      entry.source,
      entry.quality,
    ]));
  const semanticArchitecture = buildSemanticArchitecture(bundle);
  return {
    schemaVersion: 3,
    documentType: 'apollo-audit-evidence-transport',
    sourceSchemaVersion: bundle?.schemaVersion ?? null,
    reportId: bundle?.reportId ?? null,
    sourceReportId: bundle?.sourceReportId ?? null,
    context: bundle?.context || {},
    graph: {
      encoding: {
        nodeColumns,
        parentChild: 'nodes.parentId + nodes.order',
        paddingColumns: [
          'containerId',
          'topPx',
          'rightPx',
          'bottomPx',
          'leftPx',
          'source',
          'quality',
        ],
        siblingGapColumns: [
          'fromId',
          'toId',
          'containerId',
          'axis',
          'actualPx',
          'source',
          'quality',
        ],
        paddingFactPath: 'architecture.padding.<containerId>.<edge>.actualPx',
        siblingGapFactPath: 'architecture.gap.<fromId>.<toId>.actualPx',
      },
      nodes,
      paddings,
      siblingGaps,
      semantic: semanticArchitecture,
    },
    baselines: Array.isArray(bundle?.baselines) ? bundle.baselines : [],
    changes: Array.isArray(bundle?.changes) ? bundle.changes : [],
    ruleCandidates: Array.isArray(bundle?.ruleCandidates)
      ? bundle.ruleCandidates
      : [],
    coverage: bundle?.coverage || {},
  };
}


function createSemanticModelId(prefix, parts) {
  const digest = crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}:${digest}`;
}


function decodeCompactSemanticRows(columns, rows) {
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  return rows.map((row) => Object.fromEntries(
    columns.map((column, index) => [column, row?.[index] ?? null])
  ));
}


function normalizeSemanticFactValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { value, resource: null, binding: null };
  }
  const resource = value.resource || (
    value.resourceType || value.resourceName
      ? {
          type: value.resourceType ?? null,
          name: value.resourceName ?? null,
          key: null,
          library: null,
        }
      : null
  );
  const binding = value.binding || (
    value.bindingName || value.bindingCollection
      ? {
          key: null,
          name: value.bindingName ?? null,
          collectionName: value.bindingCollection ?? null,
          resolvedModeName: null,
          explicitModeName: null,
        }
      : null
  );
  return {
    value: value.value ?? null,
    resource,
    binding,
  };
}


function decodeCompactEvidenceComponent(component) {
  if (!component) return null;
  if (!Array.isArray(component)) {
    return typeof component === 'object' ? component : null;
  }
  return {
    key: component[0] ?? null,
    name: component[1] ?? null,
    variantProperties: component[2] || {},
    componentProperties: component[3] || {},
  };
}


function decodeCompactEvidenceOwner(owner) {
  if (!owner) return null;
  if (!Array.isArray(owner)) {
    return typeof owner === 'object' ? owner : null;
  }
  return {
    nodeId: owner[0] ?? null,
    componentKey: owner[1] ?? null,
    name: owner[2] ?? null,
    relativePath: owner[3] ?? null,
  };
}


function decodeCompactEvidenceBounds(bounds) {
  if (!bounds) return null;
  if (!Array.isArray(bounds)) {
    return typeof bounds === 'object' ? bounds : null;
  }
  return {
    x: bounds[0] ?? null,
    y: bounds[1] ?? null,
    width: bounds[2] ?? null,
    height: bounds[3] ?? null,
  };
}


function decodeCompactEvidenceLayout(layout) {
  if (!layout) return null;
  if (!Array.isArray(layout)) {
    return typeof layout === 'object' ? layout : null;
  }
  const padding = Array.isArray(layout[6]) ? {
    top: layout[6][0] ?? null,
    right: layout[6][1] ?? null,
    bottom: layout[6][2] ?? null,
    left: layout[6][3] ?? null,
  } : null;
  return {
    mode: layout[0] ?? null,
    wrap: layout[1] ?? null,
    sizingHorizontal: layout[2] ?? null,
    sizingVertical: layout[3] ?? null,
    primaryAxisAlignItems: layout[4] ?? null,
    counterAxisAlignItems: layout[5] ?? null,
    padding,
    itemSpacing: layout[7] ?? null,
    clipsContent: layout[8] ?? null,
  };
}


function decodeCompactEvidenceStyles(styles) {
  if (!styles) return null;
  if (!Array.isArray(styles)) {
    return typeof styles === 'object' ? styles : null;
  }
  return {
    fillStyleId: styles[0] ?? null,
    strokeStyleId: styles[1] ?? null,
    textStyleId: styles[2] ?? null,
    effectStyleId: styles[3] ?? null,
  };
}


function decodeCompactEvidenceVariableBindings(bindings) {
  if (!Array.isArray(bindings)) return [];
  return bindings.map((binding) => {
    if (!Array.isArray(binding)) return binding;
    return {
      property: binding[0] ?? null,
      variableIds: Array.isArray(binding[1]) ? binding[1] : [],
    };
  }).filter(Boolean);
}


function decodeSemanticEvidenceNode(node) {
  if (!node) return null;
  if (!Array.isArray(node)) {
    return {
      nodeId: node.nodeId ?? node.id ?? null,
      parentNodeId: node.parentNodeId ?? node.parentId ?? null,
      childOrder: node.childOrder ?? node.order ?? null,
      type: node.type ?? null,
      name: node.name ?? null,
      path: node.path ?? null,
      bounds: decodeCompactEvidenceBounds(node.bounds),
      layout: decodeCompactEvidenceLayout(node.layout),
      component: decodeCompactEvidenceComponent(node.component),
      owner: decodeCompactEvidenceOwner(
        node.componentOwner ?? node.owner ?? null
      ),
      styles: decodeCompactEvidenceStyles(node.styles),
      variableBindings: decodeCompactEvidenceVariableBindings(
        node.variableBindings
      ),
    };
  }
  return {
    nodeId: node[0] ?? null,
    parentNodeId: node[1] ?? null,
    childOrder: node[2] ?? null,
    type: node[3] ?? null,
    name: node[4] ?? null,
    path: null,
    bounds: decodeCompactEvidenceBounds(node[5]),
    layout: decodeCompactEvidenceLayout(node[6]),
    component: decodeCompactEvidenceComponent(node[7]),
    owner: decodeCompactEvidenceOwner(node[8]),
    styles: decodeCompactEvidenceStyles(node[10]),
    variableBindings: decodeCompactEvidenceVariableBindings(node[11]),
  };
}


function incrementSemanticCount(record, key) {
  const normalizedKey = String(key ?? 'null');
  record[normalizedKey] = (record[normalizedKey] || 0) + 1;
}


function buildSemanticComponentAggregate(members) {
  const componentMembers = members.filter((member) => Boolean(member.component));
  const componentNameCounts = {};
  const propertyValueCounts = {};
  for (const member of componentMembers) {
    incrementSemanticCount(
      componentNameCounts,
      member.component?.name || member.name || 'unknown'
    );
    const properties = {
      ...(member.component?.variantProperties || {}),
      ...(member.component?.componentProperties || {}),
    };
    for (const [propertyName, propertyValue] of Object.entries(properties)) {
      if (!propertyValueCounts[propertyName]) {
        propertyValueCounts[propertyName] = {};
      }
      incrementSemanticCount(propertyValueCounts[propertyName], propertyValue);
    }
  }
  return {
    memberNodeIds: members.map((member) => member.nodeId),
    directChildCount: members.length,
    directComponentCount: componentMembers.length,
    componentMemberNodeIds: componentMembers.map((member) => member.nodeId),
    componentNameCounts,
    propertyValueCounts,
  };
}


function compactSemanticObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactSemanticObject);
  }
  if (!value || typeof value !== 'object') return value;
  const compact = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue === null || nestedValue === undefined) continue;
    const normalized = compactSemanticObject(nestedValue);
    if (
      normalized &&
      typeof normalized === 'object' &&
      !Array.isArray(normalized) &&
      Object.keys(normalized).length === 0
    ) continue;
    if (Array.isArray(normalized) && normalized.length === 0) continue;
    compact[key] = normalized;
  }
  return compact;
}


function buildSemanticSubject(node, fallback = {}) {
  return compactSemanticObject({
    nodeId: node?.nodeId || fallback.nodeId,
    name: node?.name || fallback.name || null,
    path: node?.path || fallback.path || null,
    componentKey:
      node?.component?.key || fallback.componentKey || null,
    componentName:
      node?.component?.name || fallback.componentName || null,
    slot: fallback.slot || null,
  });
}


function collectSemanticComponentOccurrences(report) {
  const occurrencesByNodeId = new Map();
  const mergeOccurrence = (candidate) => {
    if (typeof candidate?.nodeId !== 'string' || !candidate.nodeId) return;
    const existing = occurrencesByNodeId.get(candidate.nodeId) || {};
    const merged = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(candidate).filter(([, value]) => value !== undefined)
      ),
      variantProperties: {
        ...(existing.variantProperties || {}),
        ...(candidate.variantProperties || {}),
      },
      componentProperties: {
        ...(existing.componentProperties || {}),
        ...(candidate.componentProperties || {}),
      },
    };
    occurrencesByNodeId.set(candidate.nodeId, merged);
  };

  for (const occurrence of report?.facts?.occurrences || []) {
    mergeOccurrence({
      nodeId: occurrence?.node?.id,
      nodeType: occurrence?.node?.type ?? null,
      name: occurrence?.node?.name ?? null,
      path: occurrence?.node?.path ?? null,
      componentKey: occurrence?.component?.key ?? null,
      componentName: occurrence?.component?.name ?? null,
      library: occurrence?.component?.library ?? null,
      variantProperties: occurrence?.variant?.properties || {},
      componentProperties: {},
      parentNodeId: null,
      childOrder: null,
      owner: null,
      quality: 'exact',
    });
  }

  for (const encodedNode of report?.evidenceBundle?.graph?.nodes || []) {
    const node = decodeSemanticEvidenceNode(encodedNode);
    if (!node) continue;
    const component = node.component || {};
    if (
      node.type !== 'INSTANCE' &&
      !component.key &&
      !component.name
    ) continue;
    mergeOccurrence({
      nodeId: node.nodeId,
      nodeType: node.type,
      name: node.name,
      path: node.path,
      componentKey: component.key ?? null,
      componentName: component.name ?? null,
      variantProperties: component.variantProperties || {},
      componentProperties: component.componentProperties || {},
      parentNodeId: node.parentNodeId,
      childOrder: Number.isFinite(node.childOrder) ? node.childOrder : null,
      owner: node.owner,
      quality: 'exact',
    });
  }

  for (const item of report?.category?.items || []) {
    if (!item?.component?.key && !item?.component?.name) continue;
    mergeOccurrence({
      nodeId: item?.node?.id,
      nodeType: item?.node?.type ?? null,
      name: item?.node?.name ?? null,
      path: item?.node?.path ?? null,
      componentKey: item?.component?.key ?? null,
      componentName: item?.component?.name ?? null,
      library: item?.component?.library ?? null,
      variantProperties: item?.variant?.properties || {},
      componentProperties: {},
      quality: 'exact',
    });
  }

  return [...occurrencesByNodeId.values()].sort((left, right) => (
    left.nodeId.localeCompare(right.nodeId)
  ));
}


function readSemanticSlotName(change) {
  const explicit = change?.context?.nestedOwnerComponentRole;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const paths = [
    change?.context?.nestedOwnerPath,
    change?.mapping?.nestedOwnerRelativePath,
  ];
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const fragments = candidate.split(/[\\/]/).filter(Boolean);
    if (fragments.length) return fragments[fragments.length - 1];
  }
  return null;
}


function inferSemanticRuleEffect(rule) {
  if (rule?.classification?.treatAsViolation === true) return 'violation';
  if (rule?.classification?.treatAsViolation === false) return 'allow';
  if (
    rule?.classification?.doNotTreatAsViolationByDefault === true
  ) return 'allow';
  if (rule?.assertion && typeof rule.assertion === 'object') return 'violation';
  if (
    rule?.ruleKind === 'design-rule' &&
    ['error', 'warning'].includes(rule?.severity)
  ) return 'violation';
  return 'unknown';
}


function inferSemanticRuleScope(rule) {
  if (rule?.conditions?.slot) return 'slot';
  if (rule?.applicability?.pageTypes?.length) return 'page';
  const appliesTo = String(rule?.appliesTo || '');
  if (/text/i.test(appliesTo)) return 'text';
  if (/composition|order|slot/i.test(appliesTo)) return 'composition';
  if (/nested|composition/i.test(String(rule?.source || ''))) {
    return 'composition';
  }
  if (rule?.target?.component || rule?.target?.componentNames) {
    return 'component';
  }
  if (
    /^(component:|rule-ir:)/i.test(String(rule?.ruleId || rule?.id || '')) ||
    /variant|state|layout|style|fill|stroke|radius|opacity|component/i.test(
      appliesTo
    )
  ) return 'component';
  return 'global';
}


function inferSemanticConstraintOperator(fieldName) {
  if (/^required/i.test(fieldName)) return 'require';
  if (/^allowed/i.test(fieldName)) return 'allow';
  if (/^forbidden/i.test(fieldName)) return 'forbid';
  if (/^maximum/i.test(fieldName)) return 'maximum';
  if (/^minimum/i.test(fieldName)) return 'minimum';
  if (/^shared/i.test(fieldName)) return 'equality';
  if (/^expected/i.test(fieldName)) return 'expect';
  return 'assert';
}


function buildSemanticRuleConstraintModel(rule) {
  const predicates = [];
  for (const [field, value] of Object.entries(rule || {})) {
    if (!/^(required|allowed|forbidden|maximum|minimum|shared|expected)/i.test(
      field
    )) continue;
    if (value === null || value === undefined) continue;
    predicates.push({
      field,
      operator: inferSemanticConstraintOperator(field),
      value,
    });
  }
  if (rule?.assertion && typeof rule.assertion === 'object') {
    predicates.push({
      field: 'assertion',
      operator: 'assert',
      value: rule.assertion,
    });
  }
  if (
    rule?.requiredFactRelation &&
    typeof rule.requiredFactRelation === 'object'
  ) {
    predicates.push({
      field: 'requiredFactRelation',
      operator: 'require',
      value: rule.requiredFactRelation,
    });
  }
  if (!predicates.length && !rule?.target && !rule?.appliesTo) return null;
  return {
    version: 1,
    selector: {
      appliesTo: rule?.appliesTo ?? null,
      target: rule?.target || null,
    },
    predicates,
  };
}


function normalizeSemanticRule(rule, source = null) {
  const id = rule?.ruleId || rule?.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  const effect = inferSemanticRuleEffect(rule);
  const authority = rule?.authority || null;
  const authoritative = isActiveComponentDesignRule({
    ...rule,
    ruleKind: rule?.ruleKind,
    authority,
  });
  return {
    id,
    ruleKind: rule?.ruleKind || null,
    effect,
    scope: inferSemanticRuleScope(rule),
    severity: rule?.severity ?? null,
    appliesTo: rule?.appliesTo ?? null,
    conditions: rule?.conditions || rule?.applicability || null,
    assertion: rule?.assertion || rule?.requiredFactRelation || null,
    constraintModel: buildSemanticRuleConstraintModel(rule),
    text: rule?.ruleText || rule?.source?.quote || null,
    requiredEvidence: Array.isArray(rule?.requiredEvidence)
      ? rule.requiredEvidence
      : [],
    authority,
    authoritative,
    source,
    semantics: [
      ...(effect === 'allow' ? ['exception'] : []),
      'authority',
    ],
  };
}


function inferSemanticRuleFactKinds(rule) {
  const required = new Set();
  const descriptor = [
    rule?.scope,
    rule?.appliesTo,
    JSON.stringify(rule?.assertion || null),
    JSON.stringify(rule?.constraintModel || null),
    JSON.stringify(rule?.requiredEvidence || null),
  ].filter(Boolean).join(' ').toLowerCase();
  if (['component', 'slot', 'composition'].includes(rule?.scope)) {
    required.add('component_occurrence');
  }
  if (
    rule?.scope === 'text' ||
    /text_content|textcontent|characters|copy|label|caption|placeholder|message/.test(
      descriptor
    )
  ) {
    required.add('text_content');
  }
  if (/composition|order|maximum|minimum|visible|count/.test(descriptor)) {
    required.add('group_aggregate');
  }
  if (/layout|spacing|padding|gap|width|height|grid|radius|style|fill|stroke/.test(
    descriptor
  )) {
    required.add('layout_state');
  }
  if (/spacing|gap|relation/.test(descriptor)) {
    required.add('relation');
  }
  if (/baseline|relative|override|customization/.test(descriptor)) {
    required.add('property_state');
  }
  if (/variant|state|values|configuration|component/.test(descriptor)) {
    required.add('component_occurrence');
  }
  if (/token|binding/.test(descriptor)) {
    required.add('layout_state');
  }
  if (rule?.scope === 'page') {
    required.add('relation');
    required.add('layout_state');
  }
  return [...required].sort();
}


function semanticRuleRequiredEvidence(rule) {
  const evidence = new Set(
    Array.isArray(rule?.requiredEvidence) ? rule.requiredEvidence : []
  );
  for (const predicate of rule?.constraintModel?.predicates || []) {
    if (predicate?.field !== 'requiredEvidence') continue;
    for (const value of Array.isArray(predicate.value)
      ? predicate.value
      : [predicate.value]) {
      if (typeof value === 'string' && value.trim()) evidence.add(value.trim());
    }
  }
  return [...evidence];
}


function semanticFactMatchesEvidencePath(fact, evidencePath) {
  const path = String(evidencePath || '').toLowerCase();
  if (!path || path.startsWith('scan.')) return true;
  if (/layoutrelations|measurement\.actualpx|relationkind|fromrole|torole/.test(path)) {
    return fact?.kind === 'relation' && (
      fact?.semantics?.includes('page_relation') ||
      /pagerelation|semanticgap|layoutrelation/i.test(fact?.factPath || '')
    );
  }
  if (/occurrences|component\.name|componentkey|variant\.properties/.test(path)) {
    return fact?.kind === 'component_occurrence';
  }
  if (/ancestors|descendants|directchildren|membernodeids/.test(path)) {
    return fact?.kind === 'group_aggregate' || fact?.kind === 'relation';
  }
  if (/token|variable|binding/.test(path)) {
    return Boolean(fact?.binding) || fact?.semantics?.includes('token_binding');
  }
  if (/text|content|characters/.test(path)) return fact?.kind === 'text_content';
  if (/layout|padding|spacing|gap|bounds|width|height/.test(path)) {
    return fact?.kind === 'layout_state' || fact?.kind === 'relation';
  }
  return true;
}


function semanticRuleSpecificMissingEvidence(rule, facts) {
  const assertion = rule?.assertion || {};
  if (assertion.kind !== 'vertical-spacing-relations') return [];
  const relationFacts = facts.filter((fact) => fact?.kind === 'relation');
  const rolePresent = (role) => {
    const normalizedRole = normalizeSemanticComponentHint(role);
    if (!normalizedRole) return false;
    if (facts.some((fact) => (
      fact?.kind === 'role_assignment' &&
      normalizeSemanticComponentHint(fact?.role?.name) === normalizedRole
    ))) return true;
    return facts.some((fact) => {
      if (fact?.kind !== 'component_occurrence') return false;
      const name = normalizeSemanticComponentHint(
        fact?.subject?.componentName || fact?.subject?.name
      );
      if (!name) return false;
      if (normalizedRole === 'content') {
        return /contentcardwrapper|backgroundplateslot|contentbody/.test(name);
      }
      if (normalizedRole === 'plate') return /backgroundplate|plate/.test(name);
      return name.includes(normalizedRole) || normalizedRole.includes(name);
    });
  };
  const missing = [];
  for (const expectation of assertion.expectations || []) {
    const toRoles = new Set([
      expectation?.toRole,
      ...(expectation?.toRoles || []),
    ].filter(Boolean));
    if (
      !rolePresent(expectation?.fromRole) ||
      ![...toRoles].some(rolePresent)
    ) continue;
    const matched = relationFacts.some((fact) => {
      const relation = fact?.relation || {};
      return relation.fromRole === expectation?.fromRole &&
        toRoles.has(relation.toRole);
    });
    if (!matched) {
      missing.push(
        `layoutRelation:${expectation?.fromRole || 'unknown'}->${[...toRoles].join('|') || 'unknown'}`
      );
    }
  }
  return missing;
}


function semanticRuleMatchesContext(rule, context) {
  const pageTypes = rule?.conditions?.pageTypes;
  if (
    Array.isArray(pageTypes) &&
    pageTypes.length > 0 &&
    !pageTypes.includes(context?.pageType)
  ) return false;
  const platforms = rule?.conditions?.platforms;
  if (
    Array.isArray(platforms) &&
    platforms.length > 0 &&
    !platforms.includes(context?.platform)
  ) return false;
  return true;
}


function buildSemanticRuleCoverage(rules, facts, context) {
  const availableFactKinds = new Set(facts.map((fact) => fact.kind));
  return rules.map((rule) => {
    const requiredFactKinds = inferSemanticRuleFactKinds(rule);
    const missingFactKinds = requiredFactKinds.filter(
      (kind) => !availableFactKinds.has(kind)
    );
    const contextMatches = semanticRuleMatchesContext(rule, context);
    const requiredEvidence = semanticRuleRequiredEvidence(rule);
    const missingEvidence = requiredEvidence.filter((evidencePath) => (
      !facts.some((fact) => semanticFactMatchesEvidencePath(fact, evidencePath))
    ));
    missingEvidence.push(...semanticRuleSpecificMissingEvidence(rule, facts));
    const hasMachinePredicates = Boolean(
      rule?.assertion || rule?.constraintModel?.predicates?.length
    );
    let status = 'ready';
    let reason = 'required-facts-available';
    if (!contextMatches) {
      status = 'not_applicable';
      reason = 'context-mismatch';
    } else if (missingFactKinds.length > 0) {
      status = 'not_evaluable';
      reason = 'missing-fact-kinds';
    } else if (missingEvidence.length > 0) {
      status = 'not_evaluable';
      reason = 'missing-required-evidence';
    } else if (!hasMachinePredicates) {
      status = 'partial';
      reason = 'narrative-rule-without-machine-predicate';
    }
    return {
      ruleId: rule.id,
      status,
      reason,
      requiredFactKinds,
      missingFactKinds,
      requiredEvidence,
      missingEvidence,
    };
  });
}


function validateApolloSemanticModel(model) {
  if (
    !model ||
    model.schemaVersion !== 1 ||
    model.documentType !== 'apollo-semantic-audit-model'
  ) {
    return 'Apollo semantic model requires schemaVersion 1.';
  }
  if (!Array.isArray(model.facts) || model.facts.length > 20000) {
    return 'Apollo semantic model facts must be a bounded array.';
  }
  if (!Array.isArray(model.rules) || model.rules.length > 10000) {
    return 'Apollo semantic model rules must be a bounded array.';
  }
  const factIds = new Set();
  for (const fact of model.facts) {
    if (!fact?.id || factIds.has(fact.id)) {
      return `Apollo semantic model contains duplicate fact ${fact?.id || 'unknown'}.`;
    }
    factIds.add(fact.id);
    if (!fact?.subject?.nodeId || !fact?.factPath) {
      return `Apollo semantic fact ${fact.id} lacks subject or factPath.`;
    }
  }
  const ruleIds = new Set();
  for (const rule of model.rules) {
    if (!rule?.id || ruleIds.has(rule.id)) {
      return `Apollo semantic model contains duplicate rule ${rule?.id || 'unknown'}.`;
    }
    ruleIds.add(rule.id);
  }
  return null;
}


function buildApolloSemanticModel(request, options = {}) {
  const report = request?.report || {};
  const facts = [];
  const factKeys = new Set();
  const rulesById = new Map();
  const addFact = (key, fact) => {
    if (factKeys.has(key)) return;
    factKeys.add(key);
    facts.push(fact);
  };
  const addRule = (rule, source = null) => {
    const normalized = normalizeSemanticRule(rule, source);
    if (!normalized) return;
    const existing = rulesById.get(normalized.id);
    if (
      existing &&
      !(
        normalized.authoritative &&
        (!existing.authoritative || source !== null)
      )
    ) return;
    rulesById.set(normalized.id, normalized);
  };

  for (const occurrence of collectSemanticComponentOccurrences(report)) {
    const nodeId = occurrence.nodeId;
    addFact(`component|${nodeId}`, {
      id: createSemanticModelId('fact:component', [nodeId]),
      kind: 'component_occurrence',
      semantics: ['component'],
      subject: buildSemanticSubject(null, occurrence),
      factPath: `architecture.component.${nodeId}.occurrence`,
      component: compactSemanticObject({
        nodeType: occurrence.nodeType || null,
        library: occurrence.library || null,
        variantProperties: occurrence.variantProperties || {},
        componentProperties: occurrence.componentProperties || {},
        parentNodeId: occurrence.parentNodeId || null,
        childOrder: occurrence.childOrder ?? null,
        owner: occurrence.owner || null,
      }),
      evidence: {
        source: 'figma_snapshot',
        quality: occurrence.quality === 'derived' ? 'derived' : 'exact',
      },
    });
  }

  const evidenceNodes = (report?.evidenceBundle?.graph?.nodes || [])
    .map(decodeSemanticEvidenceNode)
    .filter(Boolean);
  const evidenceNodesById = new Map(
    evidenceNodes.map((node) => [node.nodeId, node])
  );
  const layoutRelevantNodeIds = new Set();
  for (const node of evidenceNodes) {
    if (node.component) layoutRelevantNodeIds.add(node.nodeId);
    if (node.parentNodeId) layoutRelevantNodeIds.add(node.parentNodeId);
  }
  for (const change of report?.evidenceBundle?.changes || []) {
    if (typeof change?.nodeId === 'string') {
      layoutRelevantNodeIds.add(change.nodeId);
    }
  }
  const semanticGraph = report?.evidenceBundle?.graph?.semantic;
  for (const role of decodeCompactSemanticRows(
    semanticGraph?.encoding?.roleColumns,
    semanticGraph?.roles
  )) {
    if (role.nodeId) layoutRelevantNodeIds.add(role.nodeId);
  }
  for (const gap of decodeCompactSemanticRows(
    semanticGraph?.encoding?.gapColumns,
    semanticGraph?.siblingGaps
  )) {
    for (const nodeId of [gap.fromId, gap.toId, gap.containerId]) {
      if (nodeId) layoutRelevantNodeIds.add(nodeId);
    }
  }
  for (const node of evidenceNodes) {
    if (!layoutRelevantNodeIds.has(node.nodeId)) continue;
    const variableBindings = node.variableBindings || [];
    const layoutState = compactSemanticObject({
      bounds: node.bounds || null,
      layout: node.layout || null,
      styles: node.styles || null,
    });
    if (!layoutState.bounds && !layoutState.layout && !layoutState.styles &&
      variableBindings.length === 0) continue;
    addFact(`layout|${node.nodeId}`, {
      id: createSemanticModelId('fact:layout', [node.nodeId]),
      kind: 'layout_state',
      semantics: [
        'layout',
        ...(variableBindings.length ? ['token_binding'] : []),
      ],
      subject: buildSemanticSubject(node),
      factPath: `architecture.layout.${node.nodeId}.state`,
      ...(variableBindings.length ? {
        binding: { variables: variableBindings },
      } : {}),
      layout: layoutState,
      evidence: {
        source: 'figma_snapshot',
        quality: 'exact',
      },
    });
  }
  const evidenceChildrenByParent = new Map();
  for (const node of evidenceNodes) {
    if (!node.parentNodeId) continue;
    const children = evidenceChildrenByParent.get(node.parentNodeId) || [];
    children.push(node);
    evidenceChildrenByParent.set(node.parentNodeId, children);
  }
  for (const children of evidenceChildrenByParent.values()) {
    children.sort((left, right) => (
      (Number.isFinite(left.childOrder) ? left.childOrder : 0) -
      (Number.isFinite(right.childOrder) ? right.childOrder : 0)
    ));
  }
  for (const [containerNodeId, children] of evidenceChildrenByParent) {
    const container = evidenceNodesById.get(containerNodeId) || null;
    const aggregate = buildSemanticComponentAggregate(children);
    addFact(`aggregate|direct-children|${containerNodeId}`, {
      id: createSemanticModelId(
        'fact:aggregate',
        ['direct-children', containerNodeId]
      ),
      kind: 'group_aggregate',
      semantics: ['aggregate', 'composition'],
      subject: buildSemanticSubject(container, { nodeId: containerNodeId }),
      factPath: `architecture.aggregate.${containerNodeId}.directChildren`,
      aggregate: compactSemanticObject({
        scope: 'direct-children',
        ...aggregate,
      }),
      evidence: {
        source: 'figma_snapshot',
        quality: 'exact',
      },
    });
  }
  for (const node of evidenceNodes) {
    if (!node.component) continue;
    const ownerNodeId = node.owner?.nodeId;
    if (!ownerNodeId || ownerNodeId === node.nodeId) continue;
    const owner = evidenceNodesById.get(ownerNodeId) || null;
    addFact(`composition|owner|${ownerNodeId}|${node.nodeId}`, {
      id: createSemanticModelId(
        'fact:composition',
        ['component-owner', ownerNodeId, node.nodeId]
      ),
      kind: 'relation',
      semantics: ['composition'],
      subject: buildSemanticSubject(owner, {
        nodeId: ownerNodeId,
        name: node.owner?.name,
        componentKey: node.owner?.componentKey,
        componentName: node.owner?.name,
      }),
      target: buildSemanticSubject(node),
      factPath:
        `architecture.composition.${ownerNodeId}.${node.nodeId}.componentOwner`,
      relation: {
        type: 'owns',
        structuralKind: 'component-owner',
        containerNodeId: ownerNodeId,
        ownerRelativePath: node.owner?.relativePath || null,
      },
      evidence: {
        source: 'figma_snapshot',
        quality: 'exact',
      },
    });
  }

  for (const item of report?.category?.items || []) {
    for (const change of item?.changes || []) {
      const nodeId = change?.node?.id;
      const property = change?.property;
      if (typeof nodeId !== 'string' || typeof property !== 'string') continue;
      const slot = readSemanticSlotName(change);
      const baseline = normalizeSemanticFactValue(change?.reference);
      const actual = normalizeSemanticFactValue(change?.actual);
      const hasBindingSemantics = Boolean(
        change?.bindingStatus || baseline?.binding || actual?.binding
      );
      const kind = property === 'component.identity' && slot
        ? 'property_state'
        : 'property_state';
      const semantics = [
        'baseline',
        'relative_fact',
        ...(hasBindingSemantics ? ['token_binding'] : []),
        ...(slot ? ['slot'] : []),
      ];
      const candidateRuleIds = new Set();
      for (const rule of change?.componentRules || []) {
        addRule(rule, null);
        if (rule?.ruleId) candidateRuleIds.add(rule.ruleId);
      }
      if (change?.assessment?.ruleId) {
        candidateRuleIds.add(change.assessment.ruleId);
      }
      addFact(`${nodeId}|${property}`, {
        id: createSemanticModelId('fact:property', [nodeId, property]),
        kind,
        semantics: [...new Set(semantics)],
        subject: {
          nodeId,
          name: change?.node?.name || item?.node?.name || null,
          path: change?.node?.path || item?.node?.path || null,
          componentKey:
            change?.context?.actualComponentKey || item?.component?.key || null,
          componentName: item?.component?.name || null,
          slot,
        },
        target: null,
        factPath: property,
        property,
        baseline,
        actual,
        binding: hasBindingSemantics ? {
          status: change?.bindingStatus ?? null,
          baseline: baseline?.binding || null,
          actual: actual?.binding || null,
        } : null,
        relation: null,
        role: null,
        text: null,
        candidateRuleIds: [...candidateRuleIds].sort(),
        evidence: {
          source: 'figma_snapshot',
          quality: 'exact',
          sourceId: null,
        },
      });
    }
  }

  const evidenceBundle = report?.evidenceBundle;
  for (const change of evidenceBundle?.changes || []) {
    const nodeId = change?.nodeId;
    const property = change?.property;
    if (typeof nodeId !== 'string' || typeof property !== 'string') continue;
    for (const ruleId of change?.candidateRuleIds || []) {
      const candidate = (evidenceBundle?.ruleCandidates || []).find(
        (rule) => (rule?.ruleId || rule?.id) === ruleId
      );
      if (candidate) addRule(candidate, null);
    }
    const slot = readSemanticSlotName(change);
    const baseline = normalizeSemanticFactValue(change?.baseline);
    const actual = normalizeSemanticFactValue(change?.actual);
    const hasBindingSemantics = Boolean(
      change?.bindingStatus || baseline?.binding || actual?.binding
    );
    addFact(`${nodeId}|${property}`, {
      id: createSemanticModelId('fact:property', [nodeId, property]),
      kind: 'property_state',
      semantics: [
        'baseline',
        'relative_fact',
        ...(hasBindingSemantics ? ['token_binding'] : []),
        ...(slot ? ['slot'] : []),
      ],
      subject: {
        nodeId,
        name: change?.nodeName ?? null,
        path: change?.nodePath ?? null,
        componentKey: change?.ownerComponentKey ?? null,
        componentName: null,
        slot,
      },
      target: null,
      factPath: property,
      property,
      baseline,
      actual,
      binding: hasBindingSemantics ? {
        status: change?.bindingStatus ?? null,
        baseline: baseline?.binding || null,
        actual: actual?.binding || null,
      } : null,
      relation: null,
      role: null,
      text: null,
      candidateRuleIds: [...new Set(change?.candidateRuleIds || [])].sort(),
      evidence: {
        source: 'figma_snapshot',
        quality: change?.mapping?.quality === 'derived' ? 'derived' : 'exact',
        sourceId: change?.id || null,
      },
    });
  }
  for (const rule of evidenceBundle?.ruleCandidates || []) addRule(rule, null);

  const semantic = evidenceBundle?.graph?.semantic;
  const roles = decodeCompactSemanticRows(
    semantic?.encoding?.roleColumns,
    semantic?.roles
  );
  for (const entry of roles) {
    if (!entry.nodeId || !entry.role) continue;
    addFact(`role|${entry.nodeId}|${entry.role}`, {
      id: createSemanticModelId('fact:role', [entry.nodeId, entry.role]),
      kind: 'role_assignment',
      semantics: ['composition'],
      subject: {
        nodeId: entry.nodeId,
        name: null,
        path: null,
        componentKey: null,
        componentName: null,
        slot: null,
      },
      target: null,
      factPath: `architecture.semanticRole.${entry.nodeId}.${entry.role}`,
      property: null,
      baseline: null,
      actual: null,
      binding: null,
      relation: null,
      role: {
        name: entry.role,
        signals: entry.signals || [],
      },
      text: null,
      candidateRuleIds: [],
      evidence: {
        source: 'figma_snapshot',
        quality: entry.confidence === 'exact' ? 'exact' : 'derived',
        sourceId: null,
      },
    });
  }
  const gaps = decodeCompactSemanticRows(
    semantic?.encoding?.gapColumns,
    semantic?.siblingGaps
  );
  for (const entry of gaps) {
    if (!entry.fromId || !entry.toId || !entry.containerId) continue;
    const factPath = String(semantic?.encoding?.gapFactPath || '')
      .replace('<fromId>', entry.fromId)
      .replace('<toId>', entry.toId);
    addFact(`relation|${entry.id}`, {
      id: createSemanticModelId('fact:relation', [entry.id]),
      kind: 'relation',
      semantics: ['composition', 'page_relation'],
      subject: {
        nodeId: entry.fromId,
        name: null,
        path: null,
        componentKey: null,
        componentName: null,
        slot: null,
      },
      target: { nodeId: entry.toId },
      factPath,
      property: null,
      baseline: null,
      actual: null,
      binding: null,
      relation: {
        type: 'precedes',
        containerNodeId: entry.containerId,
        axis: entry.axis,
        measurement: {
          kind: 'sibling-gap',
          actualPx: entry.actualPx,
        },
        fromRole: entry.fromRole,
        toRole: entry.toRole,
        structuralKind: entry.structuralKind,
        hierarchyLevel: entry.hierarchyLevel,
        signals: entry.structuralSignals || [],
      },
      role: null,
      text: null,
      candidateRuleIds: [],
      evidence: {
        source: 'figma_snapshot',
        quality: entry.confidence === 'exact' ? 'exact' : 'derived',
        sourceId: entry.sourceRelationId || entry.id,
      },
    });
  }

  for (const textFact of report?.facts?.texts || []) {
    const nodeId = textFact?.node?.id;
    if (typeof nodeId !== 'string') continue;
    addFact(`text|${nodeId}`, {
      id: createSemanticModelId('fact:text', [nodeId, textFact?.text]),
      kind: 'text_content',
      semantics: ['text'],
      subject: {
        nodeId,
        name: textFact?.node?.name ?? null,
        path: textFact?.node?.path ?? null,
        componentKey: textFact?.owner?.componentKey ?? null,
        componentName: textFact?.owner?.componentName ?? null,
        slot: null,
      },
      target: null,
      factPath: 'text.characters',
      property: null,
      baseline: null,
      actual: null,
      binding: null,
      relation: null,
      role: null,
      text: {
        characters: textFact?.text ?? '',
        owner: textFact?.owner || null,
        ancestors: textFact?.ancestors || [],
        documentOrder: textFact?.documentOrder ?? null,
      },
      candidateRuleIds: [],
      evidence: {
        source: 'figma_snapshot',
        quality: 'exact',
        sourceId: null,
      },
    });
  }

  for (const entry of options.patternRules || []) {
    addRule(entry?.rule || entry, entry?.evidence || null);
  }
  for (const entry of options.additionalRules || []) {
    addRule(
      entry?.rule || entry,
      entry?.evidence || entry?.source || null
    );
  }

  const factKindCounts = {};
  const semanticCounts = {};
  for (const fact of facts) {
    factKindCounts[fact.kind] = (factKindCounts[fact.kind] || 0) + 1;
    for (const semanticName of fact.semantics) {
      semanticCounts[semanticName] = (semanticCounts[semanticName] || 0) + 1;
    }
  }
  const model = {
    schemaVersion: 1,
    documentType: 'apollo-semantic-audit-model',
    auditId: request.auditId,
    context: {
      platform: request?.context?.platform || null,
      pageType: request?.context?.pageType || null,
    },
    facts,
    rules: [...rulesById.values()].sort((left, right) => (
      left.id.localeCompare(right.id)
    )),
    coverage: {
      factCount: facts.length,
      ruleCount: rulesById.size,
      factKinds: factKindCounts,
      semantics: semanticCounts,
      interactionFactsAvailable: facts.some((fact) => fact.kind === 'interaction'),
      componentOccurrenceCount:
        factKindCounts.component_occurrence || 0,
      groupAggregateCount: factKindCounts.group_aggregate || 0,
      layoutStateCount: factKindCounts.layout_state || 0,
      compositionRelationCount: facts.filter((fact) => (
        fact.kind === 'relation' &&
        fact.semantics.includes('composition') &&
        !fact.semantics.includes('page_relation')
      )).length,
      ruleReadiness: buildSemanticRuleCoverage(
        [...rulesById.values()],
        facts,
        {
          platform: request?.context?.platform || null,
          pageType: request?.context?.pageType || null,
        }
      ),
    },
  };
  const validationError = validateApolloSemanticModel(model);
  if (validationError) throw new Error(validationError);
  return model;
}


function hydrateReportComponentRuleAuthority(category, semanticRules = []) {
  const authoritativeRules = new Map(
    semanticRules
      .filter((rule) => (
        rule?.authoritative === true &&
        typeof rule?.id === 'string' &&
        rule.id
      ))
      .map((rule) => [rule.id, rule])
  );
  if (!category || typeof category !== 'object' || !authoritativeRules.size) {
    return category;
  }
  return {
    ...category,
    items: (category.items || []).map((item) => ({
      ...item,
      changes: (item?.changes || []).map((change) => ({
        ...change,
        componentRules: (change?.componentRules || []).map((rule) => {
          const canonical = authoritativeRules.get(rule?.ruleId);
          if (!canonical) return rule;
          return {
            ...rule,
            ruleKind: 'design-rule',
            authority: canonical.authority,
            severity: canonical.severity ?? rule?.severity ?? null,
            appliesTo: canonical.appliesTo ?? rule?.appliesTo ?? null,
            ruleText: canonical.text ?? rule?.ruleText ?? null,
          };
        }),
      })),
    })),
  };
}


function buildSemanticArchitecture(bundle) {
  const sourceNodes = Array.isArray(bundle?.graph?.nodes)
    ? bundle.graph.nodes
    : [];
  const sourceRelations = Array.isArray(bundle?.graph?.relations)
    ? bundle.graph.relations
    : [];
  const pageType = String(bundle?.context?.pageType || '').trim().toLowerCase();
  const nodesById = new Map(
    sourceNodes
      .filter((node) => typeof node?.nodeId === 'string')
      .map((node) => [node.nodeId, node])
  );
  const childrenByParent = new Map();
  for (const node of sourceNodes) {
    if (typeof node?.parentNodeId !== 'string') continue;
    const children = childrenByParent.get(node.parentNodeId) || [];
    children.push(node);
    childrenByParent.set(node.parentNodeId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => (
      (Number.isFinite(left?.childOrder) ? left.childOrder : 0) -
      (Number.isFinite(right?.childOrder) ? right.childOrder : 0)
    ));
  }

  const rolesByNode = new Map();
  const addRole = (nodeId, role, confidence, signals) => {
    if (!nodesById.has(nodeId)) return;
    const key = `${nodeId}|${role}`;
    if (rolesByNode.has(key)) return;
    rolesByNode.set(key, {
      nodeId,
      role,
      confidence,
      signals: [...new Set(signals)].sort(),
    });
  };

  for (const node of sourceNodes) {
    if (isSemanticComponent(node, 'backgroundplateslot')) {
      addRole(node.nodeId, 'first-level-block', 'exact', [
        'component:background-plate-slot',
      ]);
    }
  }

  const semanticGaps = [];
  const semanticGapKeys = new Set();
  const addSemanticGap = (gap) => {
    const key = [
      gap?.fromNodeId,
      gap?.toNodeId,
      gap?.containerNodeId,
      gap?.axis,
    ].join('|');
    if (semanticGapKeys.has(key)) return;
    semanticGapKeys.add(key);
    semanticGaps.push(gap);
  };
  if (pageType === 'form') {
    // First-level form sections are already identified by their component
    // role. Promote the measured gap between adjacent sections into the
    // semantic model without evaluating it here; the agent compares this raw
    // relation with the active page pattern.
    for (const relation of sourceRelations) {
      if (
        relation?.kind !== 'sibling-gap' ||
        relation?.axis !== 'vertical' ||
        !Number.isFinite(relation?.measurement?.actualPx)
      ) continue;
      const fromNode = nodesById.get(relation.fromNodeId);
      const toNode = nodesById.get(relation.toNodeId);
      const container = nodesById.get(relation.containerNodeId);
      if (
        !fromNode ||
        !toNode ||
        !container ||
        container?.layout?.mode !== 'VERTICAL' ||
        !isSemanticComponent(fromNode, 'backgroundplateslot') ||
        !isSemanticComponent(toNode, 'backgroundplateslot')
      ) continue;
      addSemanticGap({
        id: `semantic-gap:${fromNode.nodeId}:${toNode.nodeId}`,
        fromNodeId: fromNode.nodeId,
        toNodeId: toNode.nodeId,
        containerNodeId: container.nodeId,
        axis: 'vertical',
        actualPx: relation.measurement.actualPx,
        fromRole: 'first-level-block',
        toRole: 'first-level-block',
        structuralKind: 'first-level-block-boundary',
        hierarchyLevel: 'first-level',
        structuralSignals: [
          'adjacent:first-level-blocks',
          'same-parent:vertical-container',
        ],
        confidence: 'exact',
        sourceRelationId: relation.id || null,
      });
    }

    for (const node of sourceNodes) {
      const parent = nodesById.get(node?.parentNodeId);
      if (!parent || parent?.layout?.mode !== 'VERTICAL') continue;
      const siblings = childrenByParent.get(parent.nodeId) || [];
      const siblingIndex = siblings.findIndex((candidate) => (
        candidate.nodeId === node.nodeId
      ));
      if (siblingIndex <= 0 || siblingIndex !== siblings.length - 1) continue;

      const actionEvidence = inspectPrimaryActionGroup(
        node,
        childrenByParent
      );
      if (!actionEvidence.matches) continue;

      const preceding = siblings[siblingIndex - 1];
      const contentNodes = [
        preceding,
        ...collectSemanticDescendants(
          preceding.nodeId,
          childrenByParent,
          8
        ),
      ];
      const firstLevelBlockCount = contentNodes.filter((candidate) => (
        isSemanticComponent(candidate, 'backgroundplateslot')
      )).length;
      const gap = sourceRelations.find((relation) => (
        relation?.kind === 'sibling-gap' &&
        relation?.axis === 'vertical' &&
        relation?.fromNodeId === preceding.nodeId &&
        relation?.toNodeId === node.nodeId &&
        relation?.containerNodeId === parent.nodeId &&
        Number.isFinite(relation?.measurement?.actualPx)
      ));
      if (!gap) continue;

      addRole(parent.nodeId, 'form-main-column', 'exact', [
        'layout:vertical',
        'contains:form-primary-actions',
      ]);
      addRole(preceding.nodeId, 'form-content', 'exact', [
        'precedes:form-primary-actions',
        'same-parent:form-main-column',
      ]);
      addRole(node.nodeId, 'form-primary-actions', 'exact', [
        ...actionEvidence.signals,
        'position:last-in-form-main-column',
      ]);
      addSemanticGap({
        id: `semantic-gap:${preceding.nodeId}:${node.nodeId}`,
        fromNodeId: preceding.nodeId,
        toNodeId: node.nodeId,
        containerNodeId: parent.nodeId,
        axis: 'vertical',
        actualPx: gap.measurement.actualPx,
        fromRole: 'form-content',
        toRole: 'form-primary-actions',
        structuralKind: firstLevelBlockCount > 0
          ? 'form-section-boundary'
          : null,
        hierarchyLevel: firstLevelBlockCount > 0
          ? 'second-level'
          : null,
        structuralSignals: firstLevelBlockCount > 0
          ? [
              `content:first-level-blocks=${firstLevelBlockCount}`,
              'sequence:content-before-primary-actions',
              'same-parent:form-main-column',
            ]
          : [],
        confidence: 'exact',
        sourceRelationId: gap.id || null,
      });
    }

    // Promote the measured relation between the primary form area and an
    // adjacent island area. This is structural classification only: expected
    // grid proportions and gap still come from the active page pattern.
    for (const relation of sourceRelations) {
      if (
        relation?.kind !== 'sibling-gap' ||
        relation?.axis !== 'horizontal' ||
        !Number.isFinite(relation?.measurement?.actualPx)
      ) continue;
      const fromNode = nodesById.get(relation.fromNodeId);
      const toNode = nodesById.get(relation.toNodeId);
      const container = nodesById.get(relation.containerNodeId);
      if (
        !fromNode ||
        !toNode ||
        !container ||
        container?.layout?.mode !== 'HORIZONTAL' ||
        !rolesByNode.has(`${fromNode.nodeId}|form-main-column`)
      ) continue;
      const asideCandidates = [
        toNode,
        ...collectSemanticDescendants(toNode.nodeId, childrenByParent, 4),
      ];
      if (!asideCandidates.some((candidate) => (
        isSemanticComponent(candidate, 'isleblock')
      ))) continue;

      addRole(container.nodeId, 'form-zones', 'exact', [
        'layout:horizontal',
        'contains:form-main-column',
        'contains:form-aside-zone',
      ]);
      addRole(toNode.nodeId, 'form-aside-zone', 'exact', [
        'contains:isle-block',
        'sibling:form-main-column',
      ]);
      addSemanticGap({
        id: `semantic-gap:${fromNode.nodeId}:${toNode.nodeId}`,
        fromNodeId: fromNode.nodeId,
        toNodeId: toNode.nodeId,
        containerNodeId: container.nodeId,
        axis: 'horizontal',
        actualPx: relation.measurement.actualPx,
        fromRole: 'form-main-column',
        toRole: 'form-aside-zone',
        structuralKind: 'form-zone-boundary',
        hierarchyLevel: 'page-zone',
        structuralSignals: [
          'main-before-aside',
          'same-parent:horizontal-container',
        ],
        confidence: 'exact',
        sourceRelationId: relation.id || null,
      });
    }
  }

  const roles = Array.from(rolesByNode.values())
    .sort((left, right) => (
      left.nodeId.localeCompare(right.nodeId) ||
      left.role.localeCompare(right.role)
    ))
    .map((entry) => trimTrailingNulls([
      entry.nodeId,
      entry.role,
      entry.confidence,
      entry.signals,
    ]));
  const gaps = semanticGaps
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => trimTrailingNulls([
      entry.id,
      entry.fromNodeId,
      entry.toNodeId,
      entry.containerNodeId,
      entry.axis,
      entry.actualPx,
      entry.fromRole,
      entry.toRole,
      entry.structuralKind,
      entry.hierarchyLevel,
      entry.structuralSignals,
      entry.confidence,
      entry.sourceRelationId,
    ]));

  return {
    encoding: {
      roleColumns: ['nodeId', 'role', 'confidence', 'signals'],
      gapColumns: [
        'id',
        'fromId',
        'toId',
        'containerId',
        'axis',
        'actualPx',
        'fromRole',
        'toRole',
        'structuralKind',
        'hierarchyLevel',
        'structuralSignals',
        'confidence',
        'sourceRelationId',
      ],
      gapFactPath:
        'architecture.semanticGap.<fromId>.<toId>.actualPx',
    },
    roles,
    siblingGaps: gaps,
    coverage: {
      pageType: pageType || null,
      roleCount: roles.length,
      gapCount: gaps.length,
    },
  };
}


function inspectPrimaryActionGroup(node, childrenByParent) {
  if (node?.layout?.mode !== 'HORIZONTAL') {
    return { matches: false, signals: [] };
  }
  const descendants = collectSemanticDescendants(
    node.nodeId,
    childrenByParent,
    4
  );
  const buttons = descendants.filter(isSemanticButton);
  const groupComponent = isSemanticComponent(node, 'buttonsgroup');
  const directChildren = childrenByParent.get(node.nodeId) || [];
  const directButtons = directChildren.filter(isSemanticButton);
  const hasStructuralButtonGroup = groupComponent || (
    directChildren.length > 0 && directButtons.length === directChildren.length
  );
  if (!hasStructuralButtonGroup || buttons.length === 0) {
    return { matches: false, signals: [] };
  }
  const sizes = buttons
    .map(readSemanticComponentSize)
    .filter((value) => value !== null);
  const groupSize = readSemanticComponentSize(node);
  const usesPrimaryActionSize = groupSize === 56 || (
    sizes.length === buttons.length && sizes.every((value) => value === 56)
  );
  if (!usesPrimaryActionSize) return { matches: false, signals: [] };
  const signals = [
    'layout:horizontal',
    `descendants:button=${buttons.length}`,
    'button-size:56',
  ];
  if (groupComponent) signals.push('component:buttons-group');
  if (directButtons.length === directChildren.length) {
    signals.push('children:buttons-only');
  }
  return { matches: true, signals };
}


function collectSemanticDescendants(nodeId, childrenByParent, maxDepth) {
  const result = [];
  const queue = (childrenByParent.get(nodeId) || [])
    .map((node) => ({ node, depth: 1 }));
  while (queue.length) {
    const current = queue.shift();
    result.push(current.node);
    if (current.depth >= maxDepth) continue;
    for (const child of childrenByParent.get(current.node.nodeId) || []) {
      queue.push({ node: child, depth: current.depth + 1 });
    }
  }
  return result;
}


function isSemanticButton(node) {
  const componentName = normalizeSemanticName(node?.component?.name);
  if (componentName === 'button' || componentName.endsWith('button')) {
    return !componentName.includes('buttongroup') &&
      !componentName.includes('buttonsgroup');
  }
  return false;
}


function isSemanticComponent(node, expectedName) {
  const componentName = normalizeSemanticName(node?.component?.name);
  return componentName.includes(expectedName);
}


function readSemanticComponentSize(node) {
  const properties = Object.assign(
    {},
    node?.component?.variantProperties || {},
    node?.component?.componentProperties || {}
  );
  for (const [name, value] of Object.entries(properties)) {
    if (normalizeSemanticName(name) !== 'size') continue;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}


function normalizeSemanticName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, '');
}


function trimTrailingNulls(values) {
  let end = values.length;
  while (end > 0 && values[end - 1] === null) end -= 1;
  return values.slice(0, end);
}


function compactEvidenceBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  return [
    bounds.x ?? null,
    bounds.y ?? null,
    bounds.width ?? null,
    bounds.height ?? null,
  ];
}


function compactEvidenceLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;
  const padding = layout.padding && typeof layout.padding === 'object'
    ? [
        layout.padding.top ?? null,
        layout.padding.right ?? null,
        layout.padding.bottom ?? null,
        layout.padding.left ?? null,
      ]
    : null;
  const compact = trimTrailingNulls([
    layout.mode ?? null,
    layout.wrap ?? null,
    layout.sizingHorizontal ?? null,
    layout.sizingVertical ?? null,
    layout.primaryAxisAlignItems ?? null,
    layout.counterAxisAlignItems ?? null,
    padding,
    layout.itemSpacing ?? null,
    layout.clipsContent ?? null,
  ]);
  return compact.some((value) => value !== null) ? compact : null;
}


function compactEvidenceComponent(component) {
  if (!component || typeof component !== 'object') return null;
  return trimTrailingNulls([
    component.key ?? null,
    component.name ?? null,
    compactEvidenceRecord(component.variantProperties),
    compactEvidenceRecord(component.componentProperties),
  ]);
}


function compactEvidenceOwner(owner) {
  if (!owner || typeof owner !== 'object') return null;
  return trimTrailingNulls([
    owner.nodeId ?? null,
    owner.componentKey ?? null,
    owner.name ?? null,
    owner.relativePath ?? null,
  ]);
}


function compactEvidenceText(text) {
  if (!text || typeof text !== 'object') return null;
  return trimTrailingNulls([
    text.characters ?? null,
    text.textStyleId ?? null,
  ]);
}


function compactEvidenceStyles(styles) {
  if (!styles || typeof styles !== 'object') return null;
  const compact = trimTrailingNulls([
    styles.fillStyleId ?? null,
    styles.strokeStyleId ?? null,
    styles.textStyleId ?? null,
    styles.effectStyleId ?? null,
  ]);
  return compact.some((value) => value !== null) ? compact : null;
}


function compactEvidenceVariableBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  return bindings.map((binding) => trimTrailingNulls([
    binding?.property ?? null,
    Array.isArray(binding?.variableIds) ? binding.variableIds : [],
  ]));
}


function compactEvidenceRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? value : null;
}


function compactApolloCustomizationReport(report) {
  const compactNode = (node) => node && typeof node === 'object' ? {
    id: node.id ?? null,
    name: node.name ?? null,
    type: node.type ?? null,
    path: node.path ?? null,
    visible: node.visible !== false,
  } : null;
  const compactComponent = (component) => component && typeof component === 'object' ? {
    name: component.name ?? null,
    key: component.key ?? null,
    library: component.library ?? null,
    sourceFile: component.sourceFile ?? null,
  } : null;
  const compactValue = (value) => value && typeof value === 'object' ? {
    value: value.value ?? null,
    resource: value.resource && typeof value.resource === 'object' ? {
      type: value.resource.type ?? null,
      name: value.resource.name ?? null,
      key: value.resource.key ?? null,
      library: value.resource.library ?? null,
    } : null,
    binding: value.binding && typeof value.binding === 'object' ? {
      key: value.binding.key ?? null,
      name: value.binding.name ?? null,
      collectionName: value.binding.collectionName ?? null,
      resolvedModeName: value.binding.resolvedModeName ?? null,
      explicitModeName: value.binding.explicitModeName ?? null,
    } : null,
  } : { value: value ?? null, resource: null, binding: null };
  const compactContext = (context) => context && typeof context === 'object' ? {
    actualComponentKey: context.actualComponentKey ?? null,
    referenceComponentKey: context.referenceComponentKey ?? null,
    actualNestedOwnerComponentKey: context.actualNestedOwnerComponentKey ?? null,
    nestedOwnerComponentKey: context.nestedOwnerComponentKey ?? null,
    nestedOwnerComponentRole: context.nestedOwnerComponentRole ?? null,
    nestedOwnerPath: context.nestedOwnerPath ?? null,
    actualVariantProperties: context.actualVariantProperties ?? null,
    referenceVariantProperties: context.referenceVariantProperties ?? null,
    surfaceContext: context.surfaceContext ?? null,
  } : null;
  const compactAssessment = (assessment) => (
    assessment && typeof assessment === 'object'
      ? {
          verdict: assessment.verdict ?? 'unknown',
          source: assessment.source ?? null,
          reasonCode: assessment.reasonCode ?? null,
          ruleId: assessment.ruleId ?? null,
          contractId: assessment.contractId ?? null,
          constraintId: assessment.constraintId ?? null,
          evidence: assessment.evidence ?? null,
          message: assessment.message ?? '',
          remediation: assessment.remediation ?? null,
        }
      : null
  );
  const items = Array.isArray(report?.category?.items)
    ? report.category.items.map((item) => ({
        node: compactNode(item?.node),
        component: compactComponent(item?.component),
        variant: compactComponent(item?.variant),
        changes: Array.isArray(item?.changes)
          ? item.changes.map((change) => ({
              node: compactNode(change?.node),
              kind: change?.kind ?? null,
              property: change?.property ?? '',
              message: change?.message ?? '',
              reference: compactValue(change?.reference),
              actual: compactValue(change?.actual),
              bindingStatus: change?.bindingStatus ?? null,
              variableMode: change?.variableMode ?? null,
              context: compactContext(change?.context),
              assessment: compactAssessment(change?.assessment),
              componentRules: Array.isArray(change?.componentRules)
                ? change.componentRules
                : [],
            }))
          : [],
      }))
    : [];
  return {
    schemaVersion: report?.schemaVersion ?? 1,
    reportKind: report?.reportKind,
    reportId: report?.reportId,
    sourceReportId: report?.sourceReportId ?? null,
    generatedAt: report?.generatedAt ?? null,
    user: report?.user ?? null,
    figma: report?.figma ?? null,
    scan: {
      channel: report?.scan?.channel ?? null,
      selection: Array.isArray(report?.scan?.selection)
        ? report.scan.selection.map(compactNode)
        : [],
      settings: report?.scan?.settings ?? null,
    },
    summary: report?.summary ?? {},
    category: {
      id: report?.category?.id ?? 'customizationsWip',
      title: report?.category?.title ?? 'Кастомизации [WIP]',
      count: report?.category?.count ?? items.length,
      changeCount: report?.category?.changeCount ?? items.reduce(
        (total, item) => total + item.changes.length,
        0
      ),
      items,
    },
  };
}


function collectApolloReportComponentKeys(report) {
  const keys = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) keys.add(value.trim());
  };
  const items = Array.isArray(report?.category?.items)
    ? report.category.items
    : [];
  for (const item of items) {
    add(item?.component?.key);
    add(item?.variant?.key);
    for (const change of Array.isArray(item?.changes) ? item.changes : []) {
      const context = change?.context;
      add(context?.actualComponentKey);
      add(context?.referenceComponentKey);
      add(context?.actualNestedOwnerComponentKey);
      add(context?.nestedOwnerComponentKey);
    }
  }
  for (const fact of Array.isArray(report?.facts?.texts)
    ? report.facts.texts
    : []) {
    add(fact?.owner?.componentKey);
    for (const ancestor of Array.isArray(fact?.ancestors)
      ? fact.ancestors
      : []) {
      add(ancestor?.componentKey);
    }
  }
  return [...keys].sort();
}


async function readApolloPacketArtifact(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe Apollo packet artifact path: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Apollo packet artifact escapes knowledge root: ${relativePath}`);
  }
  const stat = await fsp.stat(resolvedPath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
    throw new Error(`Apollo packet artifact is unavailable or too large: ${relativePath}`);
  }
  return JSON.parse(await fsp.readFile(resolvedPath, 'utf8'));
}


function normalizeSemanticComponentHint(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/web[-_. ]?(core|corp)/g, '')
    .replace(/[^a-zа-я0-9]+/gi, '');
}


function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes('..')
  );
}


function isActiveComponentDesignRule(rule) {
  const authority = rule?.authority;
  return Boolean(
    rule?.ruleKind === 'design-rule' &&
    authority?.status === 'active' &&
    ['design-system-author', 'generated-policy'].includes(
      authority?.provenance
    ) &&
    Number.isInteger(authority?.revision) &&
    authority.revision >= 1
  );
}

module.exports = {compactApolloTextReport, compactApolloPatternReport, compactApolloEvidenceBundle, createSemanticModelId, decodeCompactSemanticRows, normalizeSemanticFactValue, decodeCompactEvidenceComponent, decodeCompactEvidenceOwner, decodeCompactEvidenceBounds, decodeCompactEvidenceLayout, decodeCompactEvidenceStyles, decodeCompactEvidenceVariableBindings, decodeSemanticEvidenceNode, incrementSemanticCount, buildSemanticComponentAggregate, compactSemanticObject, buildSemanticSubject, collectSemanticComponentOccurrences, readSemanticSlotName, inferSemanticRuleEffect, inferSemanticRuleScope, inferSemanticConstraintOperator, buildSemanticRuleConstraintModel, normalizeSemanticRule, inferSemanticRuleFactKinds, semanticRuleRequiredEvidence, semanticFactMatchesEvidencePath, semanticRuleSpecificMissingEvidence, semanticRuleMatchesContext, buildSemanticRuleCoverage, validateApolloSemanticModel, buildApolloSemanticModel, hydrateReportComponentRuleAuthority, buildSemanticArchitecture, inspectPrimaryActionGroup, collectSemanticDescendants, isSemanticButton, isSemanticComponent, readSemanticComponentSize, normalizeSemanticName, trimTrailingNulls, compactEvidenceBounds, compactEvidenceLayout, compactEvidenceComponent, compactEvidenceOwner, compactEvidenceText, compactEvidenceStyles, compactEvidenceVariableBindings, compactEvidenceRecord, compactApolloCustomizationReport, collectApolloReportComponentKeys, readApolloPacketArtifact, normalizeSemanticComponentHint, isActiveComponentDesignRule, isSafeRelativePath};

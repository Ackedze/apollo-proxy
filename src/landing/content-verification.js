'use strict';

const { readState } = require('./source-plan');
const componentRoot = 'knowledge/data/ds-ai-hub/products/ab/components/';
const contentRule = 'references/rules/content-and-assets.md';
const recipes = {
  Benefits: [
    'benefits/cookbook/04-compose-cards.md',
    'benefit-card/cookbook/04-graphic-and-surface.md',
  ],
  BentoGrid: [
    'bento-grid/cookbook/04-compose-cards.md',
    'bento-grid/cookbook/06-verify.md',
    'promo-card/cookbook/04-image-and-surface.md',
    'promo-card/cookbook/05-actions-sizing-and-responsive.md',
  ],
};

const nodeId = value => typeof value === 'string' && /^[\w:;-]{1,512}$/.test(value);
const assetKey = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
const positive = value => Number.isFinite(value) && value > 0;
const same = (a, b) => Math.abs(a - b) <= 1;
const contains = (outer, inner) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

function illustrationSlots(ids) {
  return Array.isArray(ids) && ids.every(nodeId) && new Set(ids).size === ids.length ? ids : null;
}

function contentFamilies(instances) {
  if (!Array.isArray(instances) || !instances.every(instance => nodeId(instance?.id) && typeof instance.setName === 'string')) return null;
  const found = {};
  for (const instance of instances) {
    const family = instance.setName.trim().match(/^(?:🔒\s*)?\[[DM]\]\s+(Benefits|BentoGrid)$/)?.[1];
    if (family) found[instance.id] = family;
  }
  return found;
}

function contentInputs(source, families) {
  const rules = source.skill.bodies?.[contentRule];
  if (source.skill.id !== 'ab-generate-custom-landing' || typeof rules !== 'string') return null;
  const names = new Set(Object.values(families || {}));
  const recipesByFamily = Object.fromEntries(Object.entries(recipes).map(([family, paths]) => [
    family, paths.map(file => componentRoot + file),
  ]));
  const sources = [{ id: 'skills/' + source.skill.id + '/' + contentRule, text: rules }];
  const missing = [];
  for (const family of names) {
    for (const id of recipesByFamily[family] || []) {
      let result;
      try { result = source.read({ id, limit: 16000 }); }
      catch (error) {
        if (error.code !== 'LANDING_RESOURCE_INVALID') throw error;
      }
      if (!result?.text || result.offset !== 0 || result.next !== null || result.error || result.tooLarge) {
        missing.push(id);
      } else {
        sources.push({ id, text: result.text });
      }
    }
  }
  return { sources, recipesByFamily, missing };
}

function unfinishedRecipes(source, content, inventory, ledger) {
  if (!inventory) return [];
  const provided = new Set(content.sources.map(doc => doc.id));
  const names = new Set(Object.values(inventory.families));
  const missing = [];
  for (const name of names) {
    for (const id of content.recipesByFamily[name] || []) {
      if (provided.has(id)) continue;
      let row;
      try { row = source.read({ id, limit: 1 }); }
      catch (error) {
        if (error.code !== 'LANDING_RESOURCE_INVALID') throw error;
      }
      if (!row?.sha256 || readState({ file: id, sha256: row.sha256 }, ledger) !== 'read') missing.push(id);
    }
  }
  return missing;
}

const instructions = [
  'Read the provided contentInputs. contentInventory preserves the agreed section and illustration-slot IDs across partial turns; confirm the current owned root before reusing it. contentValidation contains the previous host checks and exact field diagnostics to resolve. After corrections return a new actual read-only contentReadback; repairing JSON alone or repeating completed is not fresh evidence. Before content writes, confirm the current owned root and return instances: [{id,setName}] for the visible library sections using actual Figma component-set names, and illustrationSlotIds: [id] for all visible illustration slots to fill in the agreed structure. Use stable slot node IDs, including slots still showing default art. A structure change requires renewed approval rather than dropping previously agreed slots from inventory. Read any applicable recipesByFamily not already in sources separately with read_source limit 16000 and follow next. If required guidance is unavailable, report the affected block.',
  'Plan all image slots together. Use the approved art direction and the installed catalogs. After the last write, return target and contentReadback from fresh read-only use_figma calls. You may split the measured facts by section or between imageSlots and groups. Each read carries the canonical target and only actual measurements. Report affectedIds on writes and reread all required facts after another mutation. Follow the skill rules for confirmed art direction, nested card resizing, and glyph-26 provenance.',
  'Return contentReadback: {imageSlots, groups}. imageSlots lists every visible illustration slot, with {id, variantKey, familyKey, gridVisible, repeatQuote?}. Use the verified actual asset mainComponent key and owning set key (or mainComponent key for a standalone asset). Leave keys null for a default or missing illustration. gridVisible is false when no visible Grid exists. Include repeatQuote only for a verbatim user approval of repeated art in that slot.',
  'groups lists every visible Benefits or BentoGrid instance as {id, family, capacity, cards}. family is exactly Benefits or BentoGrid; a standalone PromoCard row is not a BentoGrid and must be checked against its skill/Hub recipe in the reported checks, not encoded as a fictitious PromoCards group. capacity, width, height, graphicBottom, size and expectedSize are JSON numbers, not variant labels or numeric strings. Identify visible cards from their actual nodes, including ancestor visibility. Each card has its actual {id, width, height}. For Benefits also report {verticalSizing, stopperSizing, graphicBottom, graphicKind, graphicId, icon}; graphicKind is icon or image, graphicBottom is measured in one common coordinate system for the whole group, icon is null or {variantKey, expectedVariantKey, set, size, expectedSize, gridVisible} verified using the glyph-26 recipe. icon.set is the catalog marker "glyph-26", not the owning component-set name such as shopping-bag; size is the actual mounted pixel size, not the variant label m. For image Graphic put graphicId in imageSlots. gridVisible is false when no visible .Grid exists.',
  'For the confirmed homogeneous Desktop Benefits Capacity=3 preset with CardAxis=Vertical, Compact=True, Background=True and one common GraphicPosition (Left or Right), report group sizingMode="vertical-content-wrapper" and platform="D". Read each card after Auto Layout reflow: add its x,y; preset:{componentKey,cardAxis,graphicPosition,compact,background} from the actual selected variant (compact/background are the variant strings "True"); wrapper and content:{id,x,y,width,height,verticalSizing}; graphicBounds:{x,y,width,height}; stopper:{height,presetHeight,minHeight} from the actual Stopper and selected native preset, all dimensions numeric, not constants copied from an example. All bounds and graphicBottom use one common coordinate system. The maximum-content anchor Root and ContentWrapper are HUG/HUG; shorter cards are FILL/FILL. Content stays HUG and every Stopper stays FIXED at its selected native preset height/minimum. Equal Root heights alone do not prove equal ContentWrapper heights or fit. Do not apply this mode to other axes, mobile, Compact=False, mixed variants or other capacities. Existing readbacks without sizingMode retain the legacy sizing check; the reported readback does not replace independent host verification.',
  'For BentoGrid also report {areaWidth, areaHeight, verticalSizing} for each PromoCard and its assigned preset area, plus sizingRecipe when the preset deliberately leaves space below the card. Use final measured values, along with the actual preset modes. Finish with partial if a required slot or check remains unresolved.',
].join(' ');

function mergeContentReadback(previous, next) {
  const fields = ['imageSlots', 'groups'];
  if (!next || typeof next !== 'object' || Array.isArray(next) ||
      !Object.keys(next).length || Object.keys(next).some(field => !fields.includes(field))) return null;
  const merged = { ...previous };
  for (const field of fields) {
    if (!Object.hasOwn(next, field)) continue;
    const rows = next[field];
    if (!Array.isArray(rows) || !illustrationSlots(rows.map(row => row?.id))) return null;
    const entries = new Map((merged[field] || []).map(row => [row.id, row]));
    for (const row of rows) entries.set(row.id, row);
    merged[field] = [...entries.values()];
  }
  return merged;
}

function verifyContent(readback, inventory, messages) {
  const invalid = (path, expected, code = 'CONTENT_READBACK_INVALID') => [{
    name: 'Данные проверки наполнения', status: 'unknown',
    evidence: path + ': ' + expected,
    details: [{ code, path, expected }],
  }];
  if (!inventory || !inventory.families || typeof inventory.families !== 'object' ||
      Array.isArray(inventory.families) || !illustrationSlots(inventory.slots)) {
    return invalid('inventory', 'Требуется подтверждённый список секций и слотов до наполнения.', 'CONTENT_INVENTORY_REQUIRED');
  }
  if (!Array.isArray(readback?.imageSlots)) return invalid('contentReadback.imageSlots', 'Ожидается массив фактически прочитанных слотов.');
  if (!Array.isArray(readback.groups)) return invalid('contentReadback.groups', 'Ожидается массив фактически прочитанных групп Benefits/BentoGrid.');
  const { families, slots } = inventory;
  const failures = { images: [], icons: [], sizing: [] };
  const ids = new Set();
  const assets = new Map();
  for (const [index, slot] of readback.imageSlots.entries()) {
    if (!nodeId(slot?.id) || ids.has(slot.id)) return invalid('contentReadback.imageSlots[' + index + '].id', 'Ожидается уникальный фактический nodeId.');
    ids.add(slot.id);
    if (!assetKey(slot.variantKey) || !assetKey(slot.familyKey) || slot.gridVisible !== false) {
      failures.images.push(slot.id + ' без подтверждённой иллюстрации');
      continue;
    }
    for (const key of new Set([slot.familyKey, slot.variantKey])) {
      const previous = assets.get(key);
      if (previous && !(typeof slot.repeatQuote === 'string' && slot.repeatQuote.trim().length >= 12 &&
          messages.some(message => message.role === 'user' && message.text.includes(slot.repeatQuote)))) {
        const duplicate = previous + ' и ' + slot.id;
        if (!failures.images.includes(duplicate)) failures.images.push(duplicate);
      }
      if (!previous) assets.set(key, slot.id);
    }
  }
  for (const id of slots) if (!ids.has(id)) failures.images.push(id + ' — пропал согласованный слот иллюстрации');
  const seen = new Set();
  for (const [index, group] of readback.groups.entries()) {
    const groupPath = 'contentReadback.groups[' + index + ']';
    if (!['Benefits', 'BentoGrid'].includes(group?.family)) {
      return invalid(groupPath + '.family', 'Поддержаны Benefits и BentoGrid; PromoCard проверяется по рецепту в итоговых checks, без выдуманной группы PromoCards.', 'CONTENT_GROUP_UNSUPPORTED');
    }
    if (!nodeId(group?.id) || seen.has(group.id) || !Object.hasOwn(families, group.id) ||
        families[group.id] !== group.family) return invalid(groupPath + '.id', 'Группа должна соответствовать уникальному ID и семейству из inventory.');
    if (!Array.isArray(group.cards)) return invalid(groupPath + '.cards', 'Ожидается массив видимых карточек.');
    seen.add(group.id);
    if (!Number.isSafeInteger(group.capacity) || group.capacity < 1) return invalid(groupPath + '.capacity', 'Ожидается положительное целое JSON-число, например 3, а не строка "3".');
    const vertical = group.sizingMode === 'vertical-content-wrapper';
    if (group.sizingMode !== undefined && (!vertical || group.family !== 'Benefits')) {
      return invalid(groupPath + '.sizingMode', 'Режим vertical-content-wrapper поддержан только для Benefits.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
    }
    if (vertical && group.platform !== 'D') return invalid(groupPath + '.platform', 'Режим поддержан только для фактического Desktop-пресета D.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
    if (vertical && group.capacity !== 3) return invalid(groupPath + '.capacity', 'Режим поддержан только для Capacity=3.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
    if (group.capacity !== group.cards.length) {
      failures.sizing.push(group.id + ' — число видимых карточек расходится с Capacity');
    }
    const cardIds = new Set();
    const partIds = new Set(group.cards.map(card => card?.id));
    let anchors = 0;
    for (const [cardIndex, card] of group.cards.entries()) {
      const cardPath = groupPath + '.cards[' + cardIndex + ']';
      if (!nodeId(card?.id) || cardIds.has(card.id)) return invalid(cardPath + '.id', 'Ожидается уникальный фактический nodeId карточки.');
      for (const field of ['width', 'height']) if (!positive(card[field])) return invalid(cardPath + '.' + field, 'Ожидается положительное JSON-число в пикселях.');
      cardIds.add(card.id);
      if (group.family === 'Benefits') {
        if (!nodeId(card.graphicId)) return invalid(cardPath + '.graphicId', 'Ожидается фактический nodeId Graphic.');
        if (card.graphicKind === 'icon') {
          const icon = card.icon;
          if (icon?.set !== 'glyph-26' || !assetKey(icon.variantKey) || icon.variantKey !== icon.expectedVariantKey ||
              !positive(icon.size) || icon.size !== icon.expectedSize || icon.gridVisible !== false) {
            const fields = [];
            if (icon?.set !== 'glyph-26') fields.push('icon.set должен быть маркером каталога "glyph-26", а не именем component set');
            if (!assetKey(icon?.variantKey) || icon.variantKey !== icon.expectedVariantKey) fields.push('icon.variantKey/expectedVariantKey не подтверждены');
            if (!positive(icon?.size) || !positive(icon?.expectedSize) || icon.size !== icon.expectedSize) fields.push('icon.size/expectedSize должны быть равными JSON-числами фактического размера в px, не m или "24"');
            if (icon?.gridVisible !== false) fields.push('icon.gridVisible должен быть false');
            failures.icons.push(cardPath + ' (' + card.graphicId + '): ' + fields.join('; '));
          }
        } else if (card.graphicKind !== 'image' || !ids.has(card.graphicId)) {
          failures.icons.push(card.graphicId + ' — Graphic не подтверждён');
        }
        const first = group.cards[0];
        if (vertical) {
          const preset = card.preset;
          if (!assetKey(preset?.componentKey)) return invalid(cardPath + '.preset.componentKey', 'Ожидается фактический 40-символьный hex key выбранного native-варианта.');
          for (const [field, allowed] of Object.entries({cardAxis: ['Vertical'], graphicPosition: ['Left', 'Right'], compact: ['True'], background: ['True']})) {
            if (!allowed.includes(preset[field])) return invalid(cardPath + '.preset.' + field, 'Режим требует фактическое значение ' + allowed.join(' или ') + '.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
            if (preset[field] !== first.preset[field]) return invalid(cardPath + '.preset.' + field, 'Пресет должен быть однородным во всей группе.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
          }
          if (preset.componentKey !== first.preset.componentKey) return invalid(cardPath + '.preset.componentKey', 'Выбранный native-вариант должен быть одинаковым во всей группе.', 'CONTENT_SIZING_MODE_UNSUPPORTED');
          for (const field of ['x', 'y', 'graphicBottom']) if (!Number.isFinite(card[field])) return invalid(cardPath + '.' + field, 'Ожидается фактическая числовая координата после reflow.');
          for (const part of ['wrapper', 'content', 'graphicBounds']) {
            const bounds = card[part];
            for (const field of ['x', 'y', 'width', 'height']) {
              if (!(field === 'x' || field === 'y' ? Number.isFinite(bounds?.[field]) : positive(bounds?.[field]))) return invalid(cardPath + '.' + part + '.' + field, 'Ожидается фактическое JSON-число bounds после reflow.');
            }
            if (part !== 'graphicBounds') {
              if (!nodeId(bounds.id) || partIds.has(bounds.id)) return invalid(cardPath + '.' + part + '.id', 'Ожидается уникальный фактический nodeId внутреннего слоя.');
              partIds.add(bounds.id);
              if (!['HUG', 'FILL', 'FIXED'].includes(bounds.verticalSizing)) return invalid(cardPath + '.' + part + '.verticalSizing', 'Ожидается фактический HUG, FILL или FIXED.');
            }
          }
          for (const field of ['height', 'presetHeight', 'minHeight']) {
            if (!(field === 'minHeight' ? Number.isFinite(card.stopper?.[field]) && card.stopper[field] >= 0 : positive(card.stopper?.[field]))) return invalid(cardPath + '.stopper.' + field, 'Ожидается фактическое JSON-число native Stopper; height/presetHeight >0, minHeight >=0.');
          }
          if (!['HUG', 'FILL', 'FIXED'].includes(card.verticalSizing)) return invalid(cardPath + '.verticalSizing', 'Ожидается фактический HUG, FILL или FIXED.');
          const anchor = card.verticalSizing === 'HUG' && card.wrapper.verticalSizing === 'HUG';
          if (anchor) anchors++;
          if ((!anchor && (card.verticalSizing !== 'FILL' || card.wrapper.verticalSizing !== 'FILL')) ||
              card.content.verticalSizing !== 'HUG' || card.stopperSizing !== 'FIXED' ||
              !same(card.stopper.height, card.stopper.presetHeight) || card.stopper.height < card.stopper.minHeight ||
              !same(card.stopper.presetHeight, first.stopper.presetHeight) || card.stopper.minHeight !== first.stopper.minHeight ||
              !same(card.height, first.height) || !same(card.wrapper.height, first.wrapper.height) ||
              !same(card.graphicBottom, first.graphicBottom) || !same(card.graphicBottom, card.graphicBounds.y + card.graphicBounds.height) ||
              !contains(card, card.wrapper) || !contains(card.wrapper, card.content) || !contains(card, card.graphicBounds)) {
            failures.sizing.push(card.id + ' — Root/ContentWrapper, Content, штатный Stopper, baseline или вместимость не подтверждены');
          }
        } else if (card.verticalSizing !== 'FILL' || !['FILL', 'FIXED'].includes(card.stopperSizing) ||
            !Number.isFinite(card.graphicBottom) || !same(card.height, first.height) ||
            !same(card.graphicBottom, first.graphicBottom)) {
          failures.sizing.push(card.id + ' — высота, Stopper или положение Graphic расходятся с группой');
        }
      } else {
        for (const field of ['areaWidth', 'areaHeight']) if (!positive(card[field])) return invalid(cardPath + '.' + field, 'Ожидается положительное JSON-число размера области в px.');
        if (!['FILL', 'HUG', 'FIXED'].includes(card.verticalSizing)) return invalid(cardPath + '.verticalSizing', 'Ожидается FILL, HUG или FIXED из фактического readback.');
        if (!same(card.width, card.areaWidth) || card.height > card.areaHeight + 1 ||
            !same(card.height, card.areaHeight) && (card.verticalSizing === 'FILL' ||
              !recipes.BentoGrid.some(file => file.startsWith('bento-grid/') && componentRoot + file === card.sizingRecipe))) {
          failures.sizing.push(card.id + ' — размеры карточки расходятся с областью пресета');
        }
      }
    }
    if (vertical && (!anchors || group.cards.some(card => card.verticalSizing === 'HUG' &&
        card.content.height < Math.max(...group.cards.map(item => item.content.height)) - 1))) {
      failures.sizing.push(group.id + ' — требуется опорная Root/ContentWrapper HUG/HUG с максимальным контентом');
    }
  }
  if (seen.size !== Object.keys(families).length) return invalid('contentReadback.groups', 'Не прочитаны группы из inventory: ' + Object.keys(families).filter(id => !seen.has(id)).join(', '));

  const status = (name, items, evidence) => ({
    name, status: items.length ? 'failed' : 'passed', evidence: (items.join(', ') || evidence).slice(0, 4000),
  });
  return [
    status('Иллюстрации', failures.images, readback.imageSlots.map(slot => slot.id + ' → ' + slot.familyKey).join(', ') || 'Видимых слотов иллюстраций: 0'),
    status('Иконки Benefits', failures.icons, readback.groups.filter(group => group.family === 'Benefits')
      .flatMap(group => group.cards.map(card => card.graphicId + ' → ' + (card.icon?.variantKey || 'изображение'))).join(', ') || 'Компонент Benefits отсутствует'),
    status('Размеры карточек', failures.sizing, readback.groups.flatMap(group =>
      group.cards.map(card => card.id + ' — ' + card.width + '×' + card.height)).join(', ') || 'Компоненты Benefits и BentoGrid отсутствуют'),
  ];
}

module.exports = { contentFamilies, contentInputs, illustrationSlots, instructions, mergeContentReadback, unfinishedRecipes, verifyContent };

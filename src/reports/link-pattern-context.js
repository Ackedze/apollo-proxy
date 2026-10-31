'use strict';
const PREFIX = 'rule:components.link.';
const CONTEXT = [
  ['supported-actions', 'error', 'llm'],
  ['pseudo-link', 'error', 'llm'],
  ['no-underline-exception', 'error', 'contextual'],
  ['context-color', 'error', 'llm'],
  ['cards-actions', 'warning', 'llm'],
  ['component-context', 'warning', 'llm'],
  ['self-contained-text', 'error', 'dictionary'],
  ['punctuation', 'warning', 'llm'],
];
const RULES = CONTEXT.map(([name, severity, checkType]) => ({ id: PREFIX + name, severity, checkType, family: 'link', profile: 'link' }));
const ROUTING = [
  ['supported-actions', 'agent-context'], ['desktop-only', 'applicability'],
  ['default-underline', 'appearance-and-relative-size'], ['pseudo-link', 'agent-context'],
  ['no-underline-exception', 'agent-context'], ['context-color', 'agent-context'],
  ['cards-actions', 'agent-context'], ['component-context', 'agent-context'],
  ['tooltip', 'host-appearance'], ['legal', 'host-appearance'],
  ['external-standalone', 'appearance-and-browser-interaction'], ['external-inline', 'host-appearance'],
  ['self-contained-text', 'agent-context'], ['punctuation', 'agent-context'], ['url-format', 'text-format-and-layout'],
].map(([name, route]) => ({ ruleId: PREFIX + name, route }));
const PROFILE = { id: 'link', patternId: 'ptrn:components.link', path: 'patterns/p_link.md', hub: null,
  identities: [{ path: 'JSONS/web/components/web-core/core/Link/contract.generated.json', ids: ['link.universal'] }] };

// This is declared audit context, never evidence of the actual Figma platform.
function scope(context) {
  if (context?.channel && context.channel !== 'ab' || context?.platform && context.platform !== 'desktop') return 'not-applicable';
  return context?.channel === 'ab' && context?.platform === 'desktop' ? 'applicable' : 'insufficient-data';
}
function validContext(value) {
  return value && Object.keys(value).sort().join(',') === 'basis,channel,platform'
    && value.basis === 'audit-settings'
    && [null, 'ab', 'other'].includes(value.channel)
    && [null, 'desktop', 'mobile-web', 'ios', 'android'].includes(value.platform);
}
const INSTRUCTIONS = [
  'Link: проверяй все восемь подключённых контекстных правил, включая dictionary self-contained-text. Не превращай их в повтор контрактного аудита. scope Link — AB desktop по явно переданному declaredContext; это пользовательский контекст, не наблюдаемое свойство Figma. При известной неприменимости верни not-applicable по всем восьми, при неизвестной применимости — insufficient-data.',
  'supported-actions: оцени роль действия и уместность Link вместо основного CTA, IconButton или стандартного действия. Имя слоя и сам тип Link не доказывают назначение. Если действие не установлено по наблюдаемому контексту, insufficient-data.',
  'pseudo-link: различай переход и локальное информационное действие. Вид пунктирной линии не доказывает поведение; объявление псевдоссылки разработчику и её фактический эффект не видны по одному PNG. Не выдумывай callback, URL, новую вкладку или спецификацию.',
  'no-underline-exception: отсутствие подчёркивания допустимо для телефонного назначения. Не требуй отсутствия подчёркивания у каждого телефона. Доказанное отсутствие у обычной ссылки — нарушение; неизвестное назначение или неразличимое подчёркивание — insufficient-data. Разрешённый в Core вариант None сам не разрешает его применение.',
  'context-color: оцени контекст выбора и наличие подтверждённого исключения. По PNG нельзя подтвердить exact token identity, согласование или отсутствие override. Если вывод требует этих данных, insufficient-data; не назначай arbitrary цвету канонический token по внешнему сходству.',
  'cards-actions: различай вспомогательную ссылку и стандартное действие карточки; проверяй смысловое размещение в TitleView RightAddon/Type Link при доступных структурных фактах. Ссылка сама по себе не доказывает, что она основное действие.',
  'component-context: установи host и его применимую норму. Tooltip, legal/Checkbox, Plate, островок, Hint, Notification, FAQ требуют собственного контекста. Не наследуй generic-синий default без основания. Нормативные подсказки tooltip/legal/external находятся в полном p_link.md; их точный стиль, размер, иконки и реальный browser effect не входят в этот отчёт. Неизвестный host или конфликт применимых требований — insufficient-data.',
  'self-contained-text: оцени понятность цели подписи, а не только совпадение с запрещёнными словами. Слова здесь/тута/документ/файл/ссылка/сайт запрещены как единственная подпись, но не как часть осмысленной фразы.',
  'punctuation: оцени смысл границ ссылочного текста. Не вводи общий запрет пунктуации: предлог, союз или знак допустимы, когда необходимы для смысла. Если нужные границы текста или соседний текст недоступны, insufficient-data.',
  'Для Link допустимые evidenceNodeIds перечислены в subject.contextNodeIds: собственное поддерево, наблюдаемые ancestors и их непосредственные текстовые дети; текст другой Link не доказывает назначение текущей. Если захвачен только экземпляр, отсутствие внешнего контекста не является нарушением. Не оценивай реальные клики и не объявляй весь исходный RuleID/компонент проверенным: результат относится только к contextual scope.',
].join('\n');
module.exports = { RULES, ROUTING, PROFILE, scope, validContext, INSTRUCTIONS };

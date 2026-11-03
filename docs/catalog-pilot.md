# Каталожный reference-пилот

`POST /v2/contracts/catalog-resolve` читает только явно выбранный установленный
`APOLLO_DATA_ROOT` (или `releaseRoot` при подключении маршрутов). Он не вызывает
модель/Figma, не создаёт pristine instances и не использует checkout как fallback.
Существующий `/v2/contracts/resolve` сохраняет прежний формат и поведение.

## Данные

В `contracts/manifest.json` поставка объявляет ссылки:

```json
{
  "rawCatalogs": [{
    "contractId": "core.web.button",
    "componentId": "core.web.button",
    "revision": 31,
    "representationIds": ["core.web.button.figma.desktop"],
    "catalog": {
      "file": "catalogs/<sha256>.json",
      "sha256": "<sha256>",
      "bytes": 12345
    }
  }]
}
```

`file` разрешается относительно установленного contracts root. Один исходный
raw JSON может обслуживать несколько representations; отдельные projection files
не нужны. Индекс и raw pin должны войти в неизменный пакет обычным data producer.
Producer и npm consumer включают объявленные raw-файлы в точное замыкание
пакета и проверяют их хеши. Необъявленный файл остаётся ошибкой. Изменение
кода само по себе не обновляет пакет данных или установленный runtime.
Отсутствующий descriptor возвращает `CATALOG_REFERENCE_UNAVAILABLE`, без
дочитывания данных из репозитория.

## Запрос

```json
{
  "releaseId": "<current-contract-index-id>",
  "selection": {
    "contractId": "core.web.button",
    "componentId": "core.web.button",
    "revision": 31,
    "representationId": "core.web.button.figma.desktop",
    "componentKey": "<catalog-component-set-key>",
    "variantKey": "<exact-selected-variant-key>",
    "config": {},
    "modes": {},
    "hostContext": {}
  }
}
```

`releaseId` необязателен, но при передаче обязан совпасть с текущим индексом.
`componentKey` также может быть точным ключом выбранного variant: тогда
`variantKey` можно опустить. Для component set с вариантами пропуск variant
не выбирает default. Кодовая representation, чужой variant и отсутствующие
patches завершаются отдельной ошибкой.

## Ответ и границы доказательства

`apollo.catalog-reference.v1` возвращает `releaseId`, `componentId`, `revision`,
`contract`, `runtime.profileVersion`, точный проверенный `selection`, metadata
выбранного `component`, один `variant`, `structure`, pins `provenance`,
зависимости, selected diagnostics, `completeness` и `referenceHash`.
Контрактный индекс сам по себе не доказывает точный runtimeId; он не выдумывается.

Сборка повторяет V3 `resolveStructure/buildStructureFromPatches`: нормализация
paint/layout, shallow update, порядок add/remove, ownership paths и имя корневого
пути. Неизвестные поля raw сохраняются, включая `nativeAuditFactsV1` в узлах и
`nativeAuditV1` компонента. Чужие components/variants не передаются.

`structure: assembled` означает только успешную сборку выбранного дерева.
`facts: partial`, `nativeCorrespondence: unproven` и `configuredReference: false`
не являются разрешением считать каталог полным native capture. Переданные
config/modes/hostContext возвращаются как `unresolved`; модификации instance,
режимы переменных и host context этим пилотом не применяются. Дубли id и
отсутствующие родители помечают структуру `incomplete`, дерево не исправляется.
Каталожные diagnostics сохраняют сведения о прежних/неполных исходных фактах.

Consumer принимает только доказанные факты для своей операции. Неизвестное поле
нельзя молча заполнять default или выдавать за отсутствие нарушения.

Узкая проверка без агента и реального runtime:

```bash
TMPDIR=/private/tmp node --test test/contract-catalog.test.js
```

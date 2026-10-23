# Единый источник инструкций навыков

Авторский каталог находится в `design-system_ab/apollo/skills`; структура и
публикация описаны в его README. Сборка приложения передаёт этот каталог явно
в `build-data-release.js --skills-root`. Отсутствующий или несовместимый явно
заданный каталог не заменяется старой копией.

Первый этап сохраняет четыре прежних delivery paths и все wire/protocol/adapter
проверки. Нет новых UI, registry routes, CLI tools или native-операций. Существующие
bundled инструкции — замороженный fallback старых выпусков, а не второй источник
авторинга. `src/skills/catalog.js` обслуживает только сборку и доставку данных.

## Git-индекс

`apollo/data-packages/current.json` сохраняет прежний `snapshot` и содержит
необязательную ссылку `skills: {path, sha256, bytes}` на
`apollo/skills/manifest.json`. Индекс, описание навыка и его MD/JSON файлы читаются
из одного точного commit. Ссылки, состав файлов, размеры и хеши проверяются до
сборки/установки; дополнительные JS или произвольные пути не доставляются.

В собранном release manifest сохраняется `skillsSourceSha256`. Git check сравнивает
его отдельно от dataId, поэтому обновление только навыка не пропускается.
Неизменные контракты берутся из принятой installed версии; локальные knowledge
сохраняются. Старый Git-индекс без skills сохраняет уже установленные инструкции.
Откат данных возвращает прежние профили тем же атомарным указателем.

Первичное подключение обновляет bootstrap data updater и его producer/helper;
активный immutable code release, Node, зависимости и native UI не заменяются.
При сборке `.app` Git updater устанавливается под существующим именем
`scripts/data-release-cli.js`. Настройки, аккаунты и история не входят в каталог.

## Адресные проверки

```sh
TMPDIR=/private/tmp node --test test/skill-catalog.test.js test/git-data-update.test.js

APOLLO_TEST_RUNTIME_ROOT=/accepted/immutable-runtime \
APOLLO_TEST_RELEASE_ROOT=/accepted/immutable-data-release \
APOLLO_TEST_SKILLS_ROOT=/path/to/design-system_ab/apollo/skills \
TMPDIR=/private/tmp node --test test/skill-catalog-delivery.cjs
```

Configured проверка использует существующие immutable inputs, синтетическую
копию инструкций и подставной Git transport. Она проверяет actual loaders,
skill-only update, no-op, порчу данных и rollback без модели/Figma и пересборки
Core/плагина. Отдельное расширение `.cjs` оставляет этот configured прогон вне
общего `test/*.test.js`; обычный unit-прогон не требует новых локальных inputs.

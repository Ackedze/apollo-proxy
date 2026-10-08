# Apollo knowledge package MVP

## Аудит исходного flow

До MVP `macos-app/scripts/build-app.sh` копировал в `.app` весь `ds-ai-hub`, Apollo/pattern/redpolicy и все семь contract artifacts каждого компонента. При новом `.bundle-build-id` `ApolloProxyControl` удалял `~/Library/Application Support/ApolloProxyControl/proxy` целиком и копировал embedded proxy заново. Это связывало любое изменение rules/contracts/patterns с пересборкой `.app`, создавало риск потери пользовательского `.env` и не давало отдельной версии knowledge release.

Node runtime выбирал `CODEX_DS_AI_HUB` и `CODEX_DESIGN_SYSTEM` один раз при старте процесса. Predicate release имел checksum индекса, но не content version и не source commits всего knowledge package. Menubar не проверял и не показывал обновления.

## Архитектура MVP

Knowledge release — immutable npm-compatible `.tgz`, который приложение скачивает напрямую по HTTPS и распаковывает без `npm install`. В tarball допустимы только обычные data-файлы под `package/data`, `manifest.json` и metadata-only `package.json`; lifecycle scripts отсутствуют.

Локальное хранилище:

```text
~/Library/Application Support/ApolloProxyControl/knowledge/
├── state.json                 # один атомарно заменяемый current/previous pointer
└── versions/
    ├── <current>/package data
    └── <previous>/package data
```

Seed лежит только внутри `.app` в `Contents/Resources/knowledge-seed/package`. Если `current` повреждён, используется валидный `previous`; если обе локальные версии повреждены или отсутствуют — seed. После атомарной записи `state.json` удаляются все не referenced version directories. Обновление proxy сохраняет установленный `.env`; Codex authorization хранится самим Codex и не затрагивается.

Proxy получает абсолютные immutable roots и release metadata через environment при старте. После ручной активации приложение ждёт, пока `/health` сообщит одновременно `activeRequests=0` и `codex.busy=false`, и только затем перезапускает proxy. Поэтому выполняющийся HTTP-аудит или фоновый Codex run заканчивается на версии процесса, с которой стартовал; первый запрос после restart использует новую версию.

## Manifest и проверки

`manifest.json` соответствует `schemas/apollo-knowledge-package-v1.schema.json` и содержит:

- `schemaVersion`, `contentVersion`, `channel`, `generatedAt`;
- `engineCompatibility.min/max`;
- полные SHA `design-system_ab` и `ds-ai-hub`;
- `artifactCount`, `totalBytes`, список `artifacts[]` с path/size/SHA-256;
- checksum и SRI integrity канонического artifact index;
- описание Predicate и agent projections.

Перед переключением updater проверяет HTTPS, descriptor schema, tarball SRI, отсутствие absolute/`..` paths и symlinks в tar, manifest schema, engine compatibility, каждый artifact checksum и обязательные индексы/Rule IR roots. Любая ошибка оставляет `current` без изменений.

## Минимальная runtime-проекция

Predicate/детерминированный runtime:

- `design-system_ab/JSONS/apollo/**`;
- индексированные `rules.json`;
- индексированные `composition-contract.json`;
- компактные `contract.generated.json`, содержащие только identity/name/status/platform/role/library и Figma keys;
- `design-system_ab/apollo/**`, `patterns/**`, `redpolrules/**` и три корневых документа.

Не включаются `agent-context`, `audit-mapping`, `overrides`, `examples`, raw Figma catalogs и остальные неиспользуемые generated fields. На текущих source commits проекция занимает около 19 MB вместо примерно 208 MB несжатых данных; `.tgz` существенно меньше.

Agent/chat projection:

- text/JSON/YAML из `ds-ai-hub/products/ab/**`;
- text/JSON/YAML из `ds-ai-hub/products/abm/patterns/**`;
- text/JSON/YAML из `ds-ai-hub/core/web/components/**`;
- корневые `README.md` и `CONTRACT.md`.

Не включаются `skills`, `tools`, `evals`, registry builds, node_modules, изображения и бинарные assets. Это сохраняет используемые resolver-ом component keys/instructions/guidelines/meta и product patterns AB/ABM. Для будущего полнотекстового dialogue за пределами этой проекции нужен отдельный opt-in package/channel, а не раздувание Predicate release.

## Delivery и авторизация

Для MVP выбран уже используемый public-репозиторий
[`Ackedze/design-system_ab`](https://github.com/Ackedze/design-system_ab). Большой
архив не коммитится в Git history, а хранится как immutable asset GitHub Release;
в `main` лежит только маленький указатель на активную stable-версию:

```text
Ackedze/design-system_ab
├── GitHub Release: apollo-knowledge-<contentVersion>
│   └── apollo-knowledge-<contentVersion>.tgz
└── main/apollo/knowledge/channels/stable.json
```

`stable.json` содержит immutable HTTPS URL release asset и его SRI. Приложение
читает descriptor через `raw.githubusercontent.com` с cache-busting query и
`Cache-Control: no-cache`, а архив — напрямую из Releases, без `npm install`.
Поскольку репозиторий публичный, на компьютерах дизайнеров не нужны GitHub-токены.
Право записи нужно только владельцу при публикации и берётся из уже авторизованного
`gh`; credentials не попадают в `.app`, пакет, descriptor или логи.

Это сознательный компромисс: содержимое пакета публично так же, как содержимое
`design-system_ab`. Если репозиторий станет private, понадобится отдельный безопасный
read-auth flow; общий write-token в приложение помещать нельзя.

## Публикация одной командой или по промпту

Один раз выполни `gh auth login` с правом писать в `Ackedze/design-system_ab`.
Пути к чистым source checkout можно передать аргументами или записать в
игнорируемый `.env.knowledge-publish` по примеру
`docs/knowledge-publish.env.example`. Проверка без публикации:

```bash
npm run knowledge:publish -- --dry-run
```

Команда последовательно запускает Apollo gates, требует чистые source worktree,
дважды воспроизводимо строит и валидирует data-only package и показывает будущие
`contentVersion`, release tag и descriptor URL. Live-публикация запускается только
после отдельного подтверждения владельца:

```bash
npm run knowledge:publish
```

Publisher убеждается, что локальный `design-system_ab/main` совпадает с
`origin/main`, создаёт release и загружает archive, повторно скачивает его и
сверяет SHA-256. Только после этого он атомарно записывает `stable.json`, создаёт
отдельный commit и push в `main`. При любой ошибке descriptor не продвигается;
уже установленный `current` продолжает работать. Повторный запуск с той же версией
идемпотентен после проверки существующего release asset.

Рабочий UX владельца: промпт «собери и опубликуй новую stable-версию знаний
Apollo». Агент делает dry-run, сообщает размер и версию, отдельно спрашивает
разрешение на live publish/commit/push, затем возвращает release и descriptor URL.

## Возможный CI в будущем

Prompt-driven publisher является основным MVP-flow и не требует GitHub Actions
secrets. Если позже понадобится автоматизация, source repos после успешных
собственных gates могут отправлять `repository_dispatch` типа
`knowledge-inputs-changed` при изменениях:

`design-system_ab`:

- `JSONS/apollo/**`;
- `JSONS/web/components/**/{rules.json,composition-contract.json,contract.generated.json}`;
- `apollo/**`;
- `patterns/**/*.md|json`;
- `redpolrules/**/*.md|json`;
- `README.md`, `AGENTIC_FILES.md`, `COMPONENT_AUTHORING.md`.

`ds-ai-hub`:

- `products/ab/**/*.md|json|yaml|yml|txt`;
- `products/abm/patterns/**/*.md|json|yaml|yml|txt`;
- `core/web/components/**/*.md|json|yaml|yml|txt`;
- `README.md`, `CONTRACT.md`.

Будущий workflow должен checkout exact dispatched SHAs, прогнать Apollo/source
gates, дважды собрать пакет и сравнить SHA-256, загрузить immutable tarball и
только последним шагом закоммитить `channels/stable.json`. Частичная или
несовместимая сборка не должна становиться stable.

Такой workflow потребует отдельный repository-scoped token с правом создавать
Releases и писать только в `design-system_ab`. Активного workflow в MVP нет,
поэтому отсутствие этого секрета не создаёт падающие CI-запуски.

Конфигурация workflow:

- variables: `DESIGN_SYSTEM_REPOSITORY` (default `Ackedze/design-system_ab`) и `DS_AI_HUB_REPOSITORY` (default `core-ds/ds-ai-hub`);
- secrets: `KNOWLEDGE_SOURCES_TOKEN` (read source repos) и `KNOWLEDGE_PUBLISH_TOKEN` (write only to the selected delivery repository).

## Acceptance checklist

- rules/contracts/pattern changes publish a package without rebuilding `.app`;
- app checks on launch and every two hours, even when proxy is Off;
- check is read-only; download starts only through `Update Knowledge`;
- current/previous rotation and rollback are atomic through one state file;
- corrupt, traversing or incompatible tarballs never activate;
- offline start resolves current → previous → seed;
- menubar represents checking/update available/downloading/validating/ready/failed/up to date;
- audit responses, async run records, health and logs include content version and source commits.

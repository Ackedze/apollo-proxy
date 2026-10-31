# apollo-proxy

Пакет знаний автоматически включает `apollo/deprecated-styles.index.json`,
собранный из `apollo/deprecated-style-policy.json` и упакованных style-каталогов
`design-system_ab`. Индекс содержит версию/дату политики, ключи и типы стилей,
pins источников и собственный hash. `GET /v1/style-token-catalog/deprecated-styles`
отдаёт только индекс выбранного установленного пакета после сверки его pins и
повторного вычисления. Отсутствующий/повреждённый индекс не подменяется данными
checkout и не считается пустым успешным результатом. Существующие catalog
reader pins и права автоматических замен не меняются.

[Общий старт агента](https://github.com/Ackedze/apollo/blob/main/docs/AGENT_START_PROMPT.md) · [Карта проекта](docs/PROJECT_GUIDE.md) · [Контрибьютинг](CONTRIBUTING.md) · [Установка приложения](macos-app/DELEGATION.md)

Apollo Proxy — локальный HTTP-сервис для Figma-плагина Apollo. Он поставляет
контрактные данные, запускает выбранного агента, обслуживает генерацию и навыки,
хранит состояние запросов и управляет обновлениями данных. macOS miniapp
управляет установкой, входом, настройками и жизненным циклом сервера.

## С чего начать

1. Для подключения к разработке прочитайте [общий промпт](https://github.com/Ackedze/apollo/blob/main/docs/AGENT_START_PROMPT.md).
2. Для поиска функции/API используйте [карту модулей](docs/PROJECT_GUIDE.md).
3. Для готовой установки — [DELEGATION.md](macos-app/DELEGATION.md), для Git-данных — [git-data-update.md](docs/git-data-update.md).
4. Дальнейшие разделы README содержат технические детали и исторические пилоты;
   текущие возможности сверяйте с активными runtime/data и service-модулями.

## Возможности и ограничения

| Область | Что делает Proxy |
| --- | --- |
| Проверка | Отдаёт контракты локальному runtime; обычная проверка не вызывает модель |
| Данные Apollo | Возвращает metadata index без агента и сборки planning context |
| Диалог и AI-анализ | Направляет запрос поддержанному провайдеру, сохраняет источник и ошибки |
| Генерация | Ведёт диалог лендинга по каноническому навыку, читает установленный пакет и запускает Figma MCP |
| Навыки | Управляет ограниченным циклом анализа и callbacks плагина |
| Обновления | Проверяет совместимость данных, сохраняет предыдущий пакет и переключает текущий |

Codex и Claude используют собственные CLI-входы пользователя; AlfaGen — HTTP.
AlfaGen пока поддержан для диалога, а не структурированных проверок, навыков
и генерации. Лендинги используют Codex и собственный Figma MCP/OAuth. Нормативные
и визуальные проверки входят в навык; неизвестное покрытие остаётся UNKNOWN и Draft.
Прежние исполнители генерации, включая frontend, отключены. Данные mapping сохраняются.
Подключение: [лендинги](docs/landing.md). Текущий файл/страница берутся из плагина;
выбор секции передаётся в контексте чата. Пакет включает обязательный `ds-ai-hub/AGENTS.md`;
адресный поиск сохраняет предыдущие результаты и диагностику отсутствующих данных.

## Быстрый старт исходников

```bash
npm ci
```

Для запуска нужны собственная конфигурация и совместимые runtime/данные:
[dev-запуск и проверки](docs/PROJECT_GUIDE.md#dev-запуск). `npm start` сам их
не устанавливает. Checkout и установленный miniapp не обновляют друг друга
автоматически. Клиент по умолчанию ожидает localhost:3001.

## Навык «Переназвать слои»

`POST /skills/layer-names/runs` начинает анализ выделения через выбранный
Codex/Claude. Агент получает компактный обзор и возвращает типизированный
`read_nodes` (до 24 доступных ID) или `finish` с планом. Плагин опрашивает
`GET /runs/:runId?requestId=…`, выполняет только разрешённое чтение через native
bridge и передаёт ответ в `POST /runs/:runId/context` с одноразовым `callId`.
Все пути имеют префикс `/skills/layer-names`. Чужие ID, повторные callbacks,
несовместимый wire и изменённый снимок отклоняются. Агент не получает CLI tools,
MCP или запись в Figma; применение выбранных имён и откат выполняет плагин.

Весь запуск ограничен `min(CODEX_MAX_RUNTIME_MS, 900000)` и восемью шагами;
ожидание контекста тоже расходует этот бюджет. Каждый CLI получает только
оставшееся время. `POST /runs/:runId/cancel` прерывает запуск и активный процесс.
Во время ожидания callback существующий `/health` сохраняет `agent.busy=true`.
Результат хранится в памяти Proxy до 30 минут, максимум 64 запуска; перезапуск
Proxy завершает сессию. Лог содержит этап, длительность, число чтений и хеш
контекста без имён и текстов. Ошибка подключения агента показывается отдельно
от исчерпания бюджета анализа.

Инструкции цикла и их pins: `src/skills/figma-layer-name-hygiene-run/`.
Wire 0.2.0 реализован code-owned адаптерами в плагине и Proxy; тест проверяет
равенство байтов. Старые `figma-layer-name-hygiene` 0.1.0 и portable runtime
сохраняются. Legacy `POST /skills/layer-names/plan` продолжает возвращать план
одним ответом; его прежний интерфейс отмены не менялся.

Контракты и mapping можно подключать отдельно от runtime через `npm run data:import`.
`APOLLO_DATA_ROOT` включает атомарный индекс и обновление без перезапуска proxy.
Текущая доставка и границы данных: [Git-обновление](docs/git-data-update.md)
и [карта проекта](docs/PROJECT_GUIDE.md#код-runtime-данные-и-знания).

## Установленная версия и удалённые данные

Дистрибутив миниаппа содержит код Proxy, встроенный Node, минимальный Apollo runtime
и начальный пакет `runtime/seed`. На компьютере пользователя checkout автора не нужен.
Начальный пакет включает legacy knowledge и современный installed-data snapshot:
архивы контрактов, compiled cache, facts и принятые mapping с точными pins.
Код Apollo и данные имеют отдельные inventories; пакет данных принимается только
для совпадающего `runtimeId`, runtime profile и native source hash.

Внешний канал задаётся HTTPS-адресом `APOLLO_DATA_DESCRIPTOR_URL` либо командой
`portable:configure -- --data-url HTTPS_URL`. Канал содержит ссылку на неизменяемый
архив и его SHA-256. Код из этого канала не исполняется. Сборщик готовит
`stable.json` и `apollo-data-<id>.tgz`; их публикация выполняется отдельно.
Если канал ещё не опубликован, URL оставляют пустым: встроенный пакет работает офлайн.

Миниапп проверяет наличие обновления и показывает жёлтый индикатор. После команды
«Обновить знания» Proxy загружает архив во временную папку, проверяет inventory,
совместимость и реальные readers, затем атомарно меняет один указатель на весь пакет.
Знания, контракты и включённые в пакет правила навыка переключаются вместе. Для применения полного пакета миниапп
перезапускает свой сервер после завершения активного запроса. Это отдельный механизм
от локального `data:import`, который сохраняет прежнее обновление контрактного индекса.

Версии, включая начальный пакет, хранятся в
`~/Library/Application Support/ApolloProxyControl/data-releases/versions/<id>`.
Предыдущая версия остаётся доступна для отката; повреждённый или несовместимый
архив не меняет текущую. Личные `.env`, аккаунт CLI и история не входят в архив данных.

Начиная с Proxy 1.4.7 хранилище автоматически сохраняет текущую, предыдущую и
версии, которые ещё читает живой процесс Proxy или обновления. Другие проверенные
версии удаляются после обновления и при открытии хранилища. Процесс закрепляет
свой пакет до завершения, поэтому очистка не прерывает активную проверку.
Неизвестные каталоги и символические ссылки не удаляются. Подробности —
[политика хранения](docs/git-data-update.md#хранение-и-очистка-версий).

### Обновление правил «Переназвать слои» из Git

Текст `skills/figma-layer-name-hygiene/SKILL.md` и его `profile.json` могут входить
в тот же пакет данных. Установленный Proxy читает их из выбранного
`APOLLO_RELEASE_ROOT`; новый пакет не требует пересборки Apollo runtime или
переустановки Figma-плагина. Миниапп применяет его штатной командой «Обновить знания»
и перезапускает свой сервер после завершения активного запроса. Для старого пакета,
в котором навык не объявлен, используются встроенные правила. Объявленный, но
отсутствующий, повреждённый или несовместимый навык отклоняется без скрытой подмены.

Для нового цикла аналогично передаются только два файла из
`skills/figma-layer-name-hygiene-run/`: `SKILL.md` и `profile.json`. Исходником
для `--skills-root` может служить `src/skills` закреплённого checkout Proxy.
Профиль содержит версию правил, pins Markdown и установленного адаптера,
версию и digest wire. Несовместимые правила блокируются до запуска модели;
JavaScript из пакета данных не загружается. Если новый профиль не объявлен,
Proxy использует свою встроенную версию 0.2.0. Эта реализация подготавливает
поддержку обновления правил; публикация архива и активация канала выполняются отдельно.

Публикующий процесс берёт папку `skills` из выбранного неизменного Git checkout.
В `profile.json` указываются версия вида `0.1.1`, точные SHA-256 и размер Markdown;
pin установленного `src/skills/layer-names/protocol.js` сохраняется. Затем к обычной
команде сборки добавляется явный источник правил:

```bash
node scripts/build-data-release.js \
  --data /accepted/contracts --knowledge /accepted/knowledge \
  --runtime /accepted/immutable-runtime \
  --skills-root /pinned-git-checkout/skills \
  --output /new/data-release \
  --tarball-url 'https://example.org/releases/{version}/apollo-data.tgz'
```

Это шаблон с заменяемыми путями и URL. Если `--skills-root` не задан, сборщик
включает встроенный навык runtime, когда он присутствует. Неверные pins явного
источника останавливают сборку. В архив попадают только Markdown и декларативный
профиль: schema ответа, лимиты, JS-протокол и native-права остаются в коде.
Изменение этих возможностей требует отдельного совместимого обновления программы.
Ответ `/skills/layer-names/plan` сохраняет фактически использованные версию навыка
и SHA-256 профиля; pins проверяются до и после ответа агента.

После сборки публикуются неизменный архив и затем `stable.json` в существующем
Git/HTTPS-канале. Сам commit или локальная сборка не публикуют обновление и
не включают канал на компьютерах пользователей. Точные bytes обоих файлов
навыка входят в inventory пакета, а обычный откат возвращает предыдущие правила.

Figma MCP требует собственной связи CLI с Figma и собственного `fileKey`.
Первая поставка имеет профиль `checking-ask-figma-mcp`: проверка, «Спросить»
и Figma MCP. Frontend в нём явно недоступен; подключение собственного SDK
будет выполнено следующим шагом. Derived index хранит `parentDataId` принятого
полного индекса. SDK, его исходники и доказательства сборки не входят в архив.
Полный исходный локальный индекс и история сохраняются. Настройка и ограничения
описаны в [инструкции для агента](macos-app/DELEGATION.md).

## Структура

`server.js` связывает HTTP routes, состояние запусков и сервисы. Конфигурация находится в `src/config.js`; подготовка отчётов, semantic model, проверка ответов и CLI transport — в `src/reports/`. `src/contracts/` и `src/generation-agent/` сохраняют отдельные маршруты проверки и генерации.

`src/data-packages/` разделяет безопасное чтение артефактов, загрузку контрактов, generation context и атомарный импорт. `scripts/import-data-package.js` — CLI этого импорта. Постоянный локальный набор — `runtime/data/`, выбранный через `APOLLO_DATA_ROOT`; он исключён из Git вместе с личной конфигурацией и историей.

## AI-агент: Codex, Claude или AlfaGen

В miniapp откройте «О прокси…» и выберите агент. Выбор сохраняется в
`APOLLO_CLI_PROVIDER=codex|claude|alfagen`; по умолчанию остаётся Codex. Авторизация
принадлежит официальному CLI: `codex login` или `claude auth login`.
Miniapp проверяет статус входа и не извлекает токены аккаунта.

В «О прокси» под выбранным Codex/Claude находится список «Модель». Настройки
независимы: `CODEX_MODEL` для Codex, `CLAUDE_MODEL` для Claude. «По умолчанию (CLI)»
сохраняет пустое значение и не добавляет `--model`. Смена модели применяется
управляемым перезапуском, недоступна во время активного запроса и не меняет
выбор другого провайдера. Запрошенная модель видна в `/health.agent.model`
и используется во всех уже поддерживаемых действиях выбранного CLI.

Каталог Codex загружается у установленного официального CLI через
[`model/list`](https://learn.chatgpt.com/docs/app-server#list-models-modellist),
без создания чата или генерации. «Обновить список» повторяет запрос метаданных.
Для Claude предложены официальные
[алиасы Sonnet/Opus/Haiku](https://code.claude.com/docs/en/model-config#model-aliases);
их версию определяет CLI. «Указать ID модели…» позволяет задать точную модель.
При недоступном каталоге остаются текущая настройка, CLI default и ввод ID.
Ошибка недоступной модели возвращается явно: Proxy не заменяет настройку
другой моделью. Доступность конкретной модели проверяет сам CLI/провайдер.

Для Claude нужен установленный Claude Code 2.1.248+. Можно задать `CLAUDE_BIN`,
`CLAUDE_MODEL` и, для отдельной конфигурации аккаунта, `CLAUDE_CONFIG_DIR`.
Программа вызывает неизменённый CLI пользователя, не реализует собственный
Claude OAuth и не использует Agent SDK с токенами подписки.
См. [вход в Claude Code](https://code.claude.com/docs/en/authentication) и
[условия интеграции официального CLI](https://code.claude.com/docs/en/legal-and-compliance).

Агент выбирается для существующих маршрутов проверок, анализа отчётов,
объяснения контрактов и диалога. Имена маршрутов с `codex` сохранены для
совместимости клиентов; `/health.agent.provider` показывает выбранный CLI.
Детерминированные движки и проверки evidence работают независимо от агента.

AlfaGen — корпоративный HTTP-агент для «Спросить», без локального CLI и входа
через Codex/Claude. Во вкладке AlfaGen адрес доступен для копирования;
«Изменить адрес…» сохраняет свой адрес, «По умолчанию» возвращает endpoint
`/api/v1/run/673dae00-0e9e-439f-ba4c-106f176af74d`. Старый поставляемый адрес
мигрирует на новый, пользовательские адреса сохраняются. Выбор и адрес
применяются управляемым перезапуском; во время запроса изменение недоступно.
Исторический wire `source=codex` в `/analyze` следует этому выбору, явный
`source=langflow` сохраняет корпоративный маршрут. Ответ содержит фактический
`provider`; при отказе нет перехода на другой агент. Структурированные AI-проверки,
навыки и генерация с AlfaGen явно недоступны до согласования соответствующего
протокола. Локальный детерминированный анализ контрактов остаётся доступен.

Claude запускается в отдельной папке запроса с `--restricted`, `--safe-mode`,
только `Read,Glob,Grep`, без сохранения сессии и без пользовательских MCP/skills.
Apollo явно разрешает нужные knowledge roots, свой проверенный skill и
изображения запроса. JSON Schema передаётся в CLI, а ответ проходит те же
проверки Apollo. Неизвестный provider блокирует запуск; ошибки входа дают 401,
отсутствующий/устаревший CLI — 503, таймаут — 504.

Проверки без обращения к аккаунтам:
`node --test test/cli-agent.test.js test/contract-launcher.test.js`.

## Локальный пилот Apollo

Новые ComponentContract v2.1 обслуживаются отдельными маршрутами:

- `GET /v2/contracts` — index локального pilot release.
- `GET /v2/contracts/:id` — главный manual с фактами и авторскими dependencies (`source`), release pins.
- `POST /v2/contracts/resolve` — уникальные пары componentKey/componentSetKey → нужные source packages с dependency closure; missing/conflicting keys видны явно. Пустой batch + releaseId проверяет неизменность release (409 при смене).
- `POST /v2/contracts/explain` — frozen snapshot + release + auditId;
  Proxy повторно исполняет snapshot и просит Codex объяснить тот же результат.

Действующий исторический pilot включает CorporateContent r11 + Button r31 + Spinner r8 + Amount r5 + AmountStyles r10 и runtime profile 0.4.0. Loader также принимает authoring profiles 0.3.0 и 0.4.1: allowlist, authoring mode и revision checks согласованы. Поддержка профиля не устанавливает новый пакет и не расширяет generation mappings. Общий assembler умеет подготовить новый staging из одного accepted source list и явного accepted runtime/core; используйте прямой `node scripts/build-pilot-release.js --inputs …`, описанный в README Apollo. `npm run v4:release:pilot` выполняет shared build и не является изолированным updater. Proxy сверяет source/manual/facts hashes и производный compiled cache, затем проверяет всю цепочку dependency pins и сверяет
embedded child с отдельным пакетом, scope, revision и index hashes. По умолчанию
используется соседний `projects/Apollo/dist/pilot-release`;
`APOLLO_V4_RELEASE_ROOT` задаёт иной путь. Embedded `.app` получает проверенный
пакет при следующей сборке; в отдельном checkout его нужно передать явно.
Отсутствие или несовместимость пакета даёт 503, изменившийся release — 409.
Legacy knowledge не подмешивается. Это unpublished component pilot с fixed dependencies.

Apollo по умолчанию сканирует любое выделение и запрашивает контракты по ключам; package ID и имя вручную не выбираются. JSON-отчёт содержит отдельные component snapshots/pins и area coverage. Объяснение вызывается явно для выбранного checked instance.

Новый агентский маршрут пользуется existing Codex launcher и authorization,
но работает в отдельной temporary directory без `--add-dir` к Hub или DS.
Snapshot не пишется в debug artifacts. При ответе проверяются exact
rule/evaluation references; агентское объяснение не меняет deterministic verdict.
Delegated execution не включён. Локальный audit installer/manifest rollback доступен через `scripts/install-pilot-release.js` в Apollo только для отдельно принятого data update классаA с неизменным runtime и retained entries. Первая миграция/runtime или изменение generation pins требует отдельного согласованного окна и независимой проверки обоих readers; generic knowledge sync этот release не активирует.
Агент получает неисполняемую проекцию: все source rules и dependency pins,
variant facts выбранных snapshots и deterministic evaluations. Неиспользуемые
варианты и asset catalogs исключены с явным указанием ограничений. Повторный
аудит всегда использует полный compiled contract, а лимит prompt остаётся прежним.
Reference bodies и baselines также опущены явно. Все нарушения/unknown сохраняют
полные traces; остальные оценки представлены таблицей `resolvedEvaluations`,
с точными IDs, RuleID, classification, focus и `dependencyEvidence` provenance.
Original frozen snapshot и engine result не меняются.

Проверки: сначала соберите Apollo, затем
`node --test test/contract.test.js test/contract-launcher.test.js`.
23 service/HTTP/projection tests и CLI launcher test прошли. CLI в тестах имитируется;
HTTP test требует разрешённого loopback. Workspace integration tests пропускаются,
если соседний v4 bundle не собран. Полный existing suite также запускался:
обнаружены прежние отсутствующие knowledge/migration-wave paths и несогласованный
ContentCardWrapper crosswalk. Они не исправлялись в рамках v4 pilot.

На предыдущем профиле 0.1.0 отдельный smoke с настоящим авторизованным Codex прошёл через сервер
собранной `.app` на синтетическом снимке. Запускается явно (использует агент):

```sh
node scripts/test-contract-agent.js macos-app/dist/ApolloProxyControl.app/Contents/Resources/embedded-proxy
```

Скрипт создаёт temporary synthetic release, намеренно исключает legacy
knowledge directories и private .env, проверяет response references и очищает
сервер/temporary files. В `.local/v4-qa/agent-smoke.json` остаются только агрегаты.
Реальный Figma snapshot этим smoke не подтверждается.

Проверка размера проекции на 115 приватных Button archives выполняется отдельно
без вызова Codex/Figma: `node scripts/test-contract-projection.js`.
Максимальный пакет — 842 813 символов при лимите 900 000; проверены все RuleIR,
source policies, actual/before facts, evaluation identities/provenance и traces
замечаний. В `.local/v4-qa/button-prompt-size.json` сохраняются только агрегаты.

Локальный Node.js-прокси для Langflow, Apollo v2 Codex validator и анализа
компактных отчётов Apollo v3.

## Настройка

### Predicate Engine: применимость ComponentContract

Scope `platform`, `product`, `channel`, `pageType` исполняется одинаково:
совпадение запускает assertion, известное несовпадение даёт `not-applicable`,
отсутствие/null/пустое значение или explicit `unknownFacts` даёт applicability
`unknown` с `unknownPolicy` правила. Пустой массив scope означает все значения.
Заведомо ложная другая ось/when делает AND-условие неприменимым даже при
недостающем контексте. Неизвестные оси scope отклоняются, а не игнорируются.
Это изменение исправляет прежнее поведение, где отсутствие Product/pageType
считалось доказательством неприменимости правила. Потребители должны передавать
подтверждённый контекст; нельзя заполнять его догадками ради зелёной проверки.

Матрица Editor: `projects/ComponentContractEditor/docs/P0_APPLICABILITY.ru.md`.

### Запуск

Для установки готового приложения используйте [инструкцию дизайнеру](macos-app/DELEGATION.md).
Для разработки подготовьте зависимости данных по [CONTRIBUTING.md](CONTRIBUTING.md).
Из каталога собственного checkout `apollo-proxy`:

1. Скопируйте `.env.example` в `.env`, если своего файла ещё нет.
2. Выберите `APOLLO_CLI_PROVIDER=codex` или `claude` и войдите через собственный
   официальный CLI. `CODEX_BIN`/`CLAUDE_BIN` оставьте пустыми для автопоиска.
3. Установите зафиксированные зависимости и запустите сервис:

```bash
npm ci
npm start
```

## Конфигурация

```env
HOST=127.0.0.1
PORT=3001
APOLLO_AGENT_URL=https://aiflowteam3.aiflow-test.moscow.alfaintra.net/api/v1/run/673dae00-0e9e-439f-ba4c-106f176af74d
APOLLO_AGENT_KEY=
APOLLO_AGENT_INSECURE_TLS=1

APOLLO_CLI_PROVIDER=codex
CODEX_BIN=
CODEX_MODEL=
CLAUDE_BIN=
CLAUDE_MODEL=
APOLLO_CODEX_REPORT_STRATEGY=packet
APOLLO_CODEX_KNOWLEDGE_SOURCE=ds-ai-hub
APOLLO_DATA_DESCRIPTOR_URL=
APOLLO_DATA_TOKEN=
APOLLO_KNOWLEDGE_DESCRIPTOR_URL=
APOLLO_KNOWLEDGE_TOKEN=
APOLLO_CODEX_INPUT_WARN_CHARS=700000
APOLLO_CODEX_INPUT_BUDGET_CHARS=900000
CODEX_IDLE_TIMEOUT_MS=300000
CODEX_MAX_RUNTIME_MS=900000
CODEX_RUN_TTL_MS=600000
CODEX_WORKSPACE=
CODEX_DS_AI_HUB=/absolute/path/to/ds-ai-hub
CODEX_DESIGN_SYSTEM=/absolute/path/to/design-system_ab
```

`APOLLO_AGENT_KEY` нужен только для отдельно используемого корпоративного HTTP/Langflow
backend. Для собственного Codex/Claude CLI ключ Langflow не требуется.
`APOLLO_AGENT_KEY` и `APOLLO_AGENT_INSECURE_TLS` сохраняют совместимость со старыми
`LANGFLOW_KEY` и `LANGFLOW_INSECURE_TLS`.

В прежних установках `APOLLO_KNOWLEDGE_DESCRIPTOR_URL` задаёт HTTPS descriptor удалённого
data-only knowledge package. Проверка выполняется при запуске ApolloProxyControl
и каждые два часа, но скачивание и активация происходят только после действия
`Обновить знания`. Опциональный read-only bearer token хранится только в
пользовательском `.env`. Архитектура, manifest, CI и recovery описаны в
[`docs/knowledge-package.md`](docs/knowledge-package.md).

В пакет знаний входят также паттерны ABM из `ds-ai-hub/products/abm/patterns/**`.
Их изменения учитываются при определении версии пакета.

В прежнем knowledge-only канале архив хранится как immutable asset GitHub Release в `Ackedze/design-system_ab`,
а `stable.json` — в `main` того же репозитория. Владельцу достаточно иметь
авторизованный `gh` и по запросу запускать `npm run knowledge:publish`.
Команда сама прогоняет Apollo gates, собирает и валидирует пакет, проверяет
загруженный архив и только затем обновляет descriptor. Пример переменных находится в
[`docs/knowledge-publish.env.example`](docs/knowledge-publish.env.example).

## Эндпоинты

- `GET /health` -> `{ ok: true, proxy: { name, version }, codex: { skill, knowledge }, generation: { context } }`; блок
  `knowledge` показывает полноту contract package (`packageCount`,
  `artifactCount`, checksum), а `generation.context` — готовность semantic index,
  число проиндексированных паттернов/компонентов и лимит context packet.
- `POST /analyze` -> `{ success, result, source }`
- `POST /v1/validate/predicates` -> `{ success, validation: { snapshot, result } }`
- `POST /v1/generation/plan` -> `{ success, status, plan? | clarification? | blocked? }`
- `POST /v1/validate/codex` -> `{ success, validation }`
- `POST /v1/validate/codex/runs` -> `202 { success, run }`
- `GET /v1/validate/codex/runs/:runId` -> `{ success, run }`
- `POST /v1/analyze/codex/runs` -> `202 { success, run }`
- `GET /v1/analyze/codex/runs/:runId` -> `{ success, run }`

`POST /v1/generation/plan` — независимый от проверки MVP-планировщик макетов.
Он принимает `{ "prompt": "...", "brief": "...", "dialogue": [...], "clarificationRound": 0 }`.
Исходный brief сохраняется отдельно и не заменяется очередным ответом. До запуска агента Proxy
строит локальный semantic index по pattern- и component-метаданным `ds-ai-hub`,
ранжирует кандидатов по всему диалогу и собирает ограниченный
`apollo.generation-context.v3` packet. В packet входят обязательные manifest/pattern
документы и полные, не обрезанные semantic projections релевантных
pattern/cookbook/adapter-файлов. Figma URL, file/component keys и node IDs в этих
проекциях редактируются; исходный и проекционный SHA-256 сохраняются раздельно.

Отдельный read-only Codex-планировщик работает во временном каталоге, видит
только `context-packet.json`, не получает `ds-ai-hub`/`design-system_ab` через
`--add-dir` и возвращает semantic plan без Figma keys. Proxy отклоняет ссылку на
любой source path, которого не было в выданном packet. Если решение
зависит от отсутствующих или спорных данных, endpoint отвечает
`status: "clarification_required"`; до ответа пользователя технический план не
строится и Figma не изменяется. Технический тупик, пятый раунд или повтор уже
заданного вопроса завершаются `status: "blocked"`, а не новым уточнением. Для готового semantic plan Proxy перепроверяет
каждый source path и ruleId в `ds-ai-hub`, затем отдельно разрешает component
keys, допустимые variants, текстовые пути и variable keys из
`design-system_ab`. Результат — закрытый список frame/component-узлов формата
`apollo.generation-plan.v5` с trace обоих источников, retrieval packet и preflight report.
Общий semantic resolver остаётся универсальным; для desktop landing MVP поверх него есть
детерминированные compiler defaults для `CorporateContent → slots.body`, PromoCard bento 3+2 и
base-surface footer. Semantic target maps также задают state-dependent `availableWhen` и временный
`editContext`: Proxy удаляет недоступный необязательный target до Figma, а Apollo может временно
переключить вложенный variant для записи контента и восстановить требуемое финальное состояние.
Endpoint не запускает predicate engine и не принимает
клиентские правила.

Меню `ApolloProxyControl` показывает установленную версию Proxy и точный UTC
`build-id`, например `Proxy: v1.0.1 · build 20260903T081500Z`. Значение читается
из runtime в `Application Support`, поэтому по нему можно отличить фактически
запущенную сборку от другой `.app` с тем же semver.

`POST /analyze` принимает строку, `{ text: "..." }` или `{ report: {...} }`. Apollo отправляет compact `*_agent.json` как `report`. Для открытых вопросов поле `source` выбирает маршрут: `langflow` (значение по умолчанию) или `codex`. В режиме `codex` proxy извлекает вопрос из envelope `design-dialogue`, ограничивает историю, запускает отдельный `codex exec` в `read-only`/`ephemeral` режиме и возвращает финальный Markdown из активного `APOLLO_CODEX_KNOWLEDGE_SOURCE`; LangFlow-секреты в процесс Codex не передаются.

`POST /v1/validate/predicates` — изолированный детерминированный production-контур
Predicate Engine. Endpoint принимает `{ auditId, pageType, evidenceBundle }`, не
запускает Codex и отвергает `rules` и `ruleSet`, переданные клиентом. Proxy
разрешает встречающиеся в frozen bundle `componentKey` через pinned
`componentContractIndex`, загружает только соответствующие source packages,
компилирует их `predicateContour`, composition contracts и применимые активные
страничные контуры, закрепляет checksum release, строит и хеширует Snapshot v2.
Adapter заранее формирует необходимые ownership, ordered-sequence, binding и
composition facts, а Predicate Engine проверяет их без участия агента. Неизвестный
ключ или недостающий факт возвращает `not-evaluable`, а не догадку. Правило без
source `apollo.predicate-presentation.v1` делает release неполным и не может
молча получить текст из runtime-кода.
Платформенные ограничения компилируются универсальным contour
`platform-match`: release loader читает `platform` конкретного опубликованного
ключа из `contract.generated.json`, snapshot публикует его как
`component.platform`, а правило из пакетного `rules.json` сравнивает факт с
`page.context.platform`. Runtime не содержит ключей или веток конкретного
компонента. Имя instance не участвует в выборе цели: оно изменяемо в рабочем
файле. `publicRootOnly` ограничивает проверку публичным contour root, а
`standaloneOnly` исключает вложенные roots, которыми уже владеет другой
компонент. Платформа страницы является проверяемым фактом, поэтому не
используется как applicability-gate самого `platform-match`.

`POST /v1/validate/codex` принимает Apollo v2 snapshot с одним выбранным корнем
и одним PNG, приводит его к `apollo-design-audit-request` и запускает
`codex exec` в `read-only` и `ephemeral` режимах. Запуск явно вызывает
`$apollo-design-validator`. До запуска proxy проверяет версию и SHA-256 checksum
пакета скила, а после ответа — `apollo-design-audit-response`, совпадение
skill trace, nodeId, evidence lanes, summary и source trace. Только после этой
fail-closed проверки ответ адаптируется к UI-контракту Apollo v2. Временные
файлы удаляются после run. Для локального checkout пути DS определяются
автоматически. Сборка `ApolloProxyControl.app` включает read-only knowledge
snapshot из `ds-ai-hub` и релевантных `patterns`, `apollo` и `JSONS/apollo`
каталогов `design-system_ab`. Из `componentContractIndex.json` дополнительно
собираются все явно перечисленные contract artifacts без тяжёлых raw catalog
JSON; token-каталоги также включаются для разрешения published variable keys
генератором. Неполный набор блокирует запуск с `CODEX_KNOWLEDGE_INCOMPLETE`, а не
превращается в уточняющий вопрос дизайнеру. Переменные `CODEX_DS_AI_HUB` и
`CODEX_DESIGN_SYSTEM` позволяют явно использовать другие checkout-каталоги.
Для единого isolated-worktree workflow proxy также принимает их алиасы
`DS_AI_HUB_ROOT` и `DESIGN_SYSTEM_AB_ROOT`; явные `CODEX_*` имеют приоритет.
Langflow-ключи и другие proxy secrets не передаются в окружение Codex-процесса.
Требуемая версия Apollo skill закреплена в сборке proxy и не задаётся через
пользовательский `.env`, поэтому старый конфиг не блокирует обновление приложения.

`POST /v1/analyze/codex/runs` принимает `{ report }` с документом
`apollo-baseline-customization-report`. Это контур Apollo v3: агент получает
только уже вычисленные факты `effective baseline → actual`, сведения о
компонентах и Figma-ссылки. Полный snapshot и screenshot повторно не
передаются. Ответ проходит тот же fail-closed output/evidence validator, но
имеет `mode=customization-report` и `coverage.status=partial`: отсутствие
finding означает только отсутствие доказанного нарушения среди переданных
кастомизаций, а не полную проверку макета и паттернов.

Тот же endpoint принимает комбинированный `apollo-pattern-audit-report`.
Общие component-pattern факты из `Кастомизации [WIP]` классифицируются при
любом `pageType`. Дополнительно proxy разрешает явно запрошенные active
design-rules из `design-system_ab/JSONS/apollo/designPatternRules.json`,
проверяет их applicability по `pageType` и channel и строит bounded observations
по компактной иерархии компонентов. Первый specialized rule проверяет максимум
один `TitleView View=Medium` внутри одной `BackgroundPlateSlot` на странице
типа `form`. Если тип страницы не задан, не запускаются только specialized
rules; общий component-pattern аудит остаётся в том же единственном agent run.
Редполитика и остальные ещё не мигрированные pattern groups пропускаются.
В итоговом UI-отчёте proxy разделяет findings по происхождению факта: общие
компонентные паттерны получают отдельные счётчики по WIP-изменениям, а
специализированные правила выводятся в секции выбранного типа страницы. При
отсутствующем `pageType` отчёт явно показывает, что специализированная секция
не выполнялась.

Тот же endpoint принимает `apollo-text-audit-report`. Proxy строит компактный
`apollo-resolved-text-audit-packet` из видимых TEXT-фактов, правил
`design-system_ab/redpolrules`, active text-rules из `design-system_ab/patterns`
и text-rules только разрешённых component packages. Proxy не выносит
редакторских решений: агент применяет иерархию component/slot rule → contextual
pattern → global redpolicy, а конфликт или нехватку контекста переводит в
`human_review`. В текстовом режиме запрещены мутации и classifications;
допустимы только `focus_node` и `open_source`.

Component rule считается нормативным только при полном rule-level gate:
`ruleKind=design-rule`, `authority.status=active`, provenance
`design-system-author|generated-policy` и целочисленный `revision>=1`.
Отсутствующий, draft или некорректный authority не подтверждает violation или
allowed assessment; proxy требует `human_review`, если тот же факт не доказан
отдельным approved textual pattern rule.

По умолчанию Apollo v3 использует `APOLLO_CODEX_REPORT_STRATEGY=packet`.
Экспериментальный `prompt` передаёт Codex короткий ограниченный алгоритм,
запрещает повторный обход макета и чтение нерелевантных пакетов, но сохраняет
тот же JSON Schema, skill trace и независимую evidence-проверку. На контрольном
отчёте prompt не улучшил latency, поэтому он оставлен только для A/B. Apollo v2
всегда использует полный skill workflow.

Режим `packet` переносит discovery в proxy: component и
variant keys разрешаются через источник, выбранный в
`APOLLO_CODEX_KNOWLEDGE_SOURCE`. По умолчанию `ds-ai-hub` сопоставляет ключи по
`products/ab/components/*/figma-keys.json`, а core web — по
`core/web/components/*/{figma-keys.json,figma/keys.json}`. В packet включаются
только `instructions.md`/`guidelines.md`, связанные product patterns и identity
metadata соответствующих пакетов.
Документы `draft` передаются только как контекст и не могут подтвердить
ошибку. Значение `design-system_ab` возвращает прежний resolver через
`componentContractIndex` и `rules.json`. Packet встраивается в начальный prompt, каталоги
`ds-ai-hub` и `design-system_ab` не выдаются процессу Codex через `--add-dir`,
поэтому агент выполняет только классификацию уже подготовленных фактов.
`skill` и `prompt` сохранены для A/B и диагностического отката.

Архитектурный `evidenceBundle` поступает из плагина в полном schema v2, но в
resolved packet преобразуется в компактный transport schema v3. Иерархия
кодируется колонками `parentId + order`, отдельные `direct-child` relations не
дублируются, четыре измерения padding объединяются в одну строку контейнера, а
пустые и вычисляемые поля не отправляются агенту. Это транспортное сжатие не
выносит verdict или применение design-rules в proxy. Полный v2 сохраняется в
debug-артефакте `01-input-report.json`.

Для выбранного `pageType` transport также содержит `graph.semantic`: роли,
которые однозначно выводятся из структуры и опубликованных компонентов, и
измеренные связи между ними. Например, горизонтальная последняя группа из
desktop Button `Size=56` распознаётся как `form-primary-actions`, а предыдущий
сосед в вертикальной основной колонке — как `form-content`. Proxy не сравнивает
расстояние с нормой и не создаёт finding. В `resolution.pagePatternDocuments`
агент получает полный active-паттерн выбранного типа страницы и самостоятельно
применяет уже существующий `ruleId` к семантическому факту.

Если `form-content` содержит блоки первого уровня, связь от него к завершающим
`form-primary-actions` маркируется как `form-section-boundary` с
`hierarchyLevel=second-level`. Это только классификация архитектурного уровня:
ожидаемое расстояние и verdict по-прежнему извлекаются агентом из активного
паттерна, а не вычисляются proxy.

Resolved packets дополнительно содержат `semanticModel` по схеме
`schemas/apollo-semantic-audit-model.schema.json`. Модель разделяет три слоя:
Figma facts, design-system rules и agent decision. `property_state` объединяет
effective baseline, actual и token binding одного свойства; slot остаётся
контекстом subject. `component_occurrence` фиксирует каждый видимый INSTANCE и
его actual variants/component properties независимо от кастомизаций.
`group_aggregate` описывает прямой состав контейнера и распределение свойств,
`layout_state` — bounds, auto-layout, styles и variable bindings.
`role_assignment` и `relation` описывают composition, component owner и page
relations, `text_content` — текст и component owner context. Rule authority и
allow-exceptions не записываются во Figma facts: они находятся только в
`semanticModel.rules`. Active slot-exception применяется лишь при точном
совпадении conditions; отсутствие authority переводит решение в review.

Каждый fact дополнительно получает `domains` и `facets`. Domains
разделяют component state, composition/slots, visual properties,
resource bindings, layout/geometry и content semantics. Facets отделяют
value, binding, baseline, relative value, slot и relation. Поэтому
`значение=32` и `binding=missing` не склеиваются в один
неразличимый факт. Rules получают `requirements`, которые
перечисляют нужные междоменные данные.

Структурированные поля component rules (`required*`, `allowed*`, `forbidden*`,
`minimum*`, `maximum*`, `shared*`, `expected*`) сохраняются в
`rule.constraintModel` как selector и predicates, а не теряются при
нормализации. `coverage.ruleReadiness` показывает для каждого правила
`ready`, `partial`, `not_evaluable` или `not_applicable` и перечисляет
`missingFactKinds`. Это диагностическая готовность данных, а не verdict агента.

На первом этапе `semanticModel` является канонической семантической проекцией,
а `generalAudit`, `architectureAudit` и `resolution` сохраняются как
compatibility-представления для текущего output contract. После покрытия
остальных pattern facts эти дубли будут удалены из agent packet, что сократит
prompt без переноса verdict-логики в proxy.

В semantic-режиме pattern-аудит использует компактный output protocol
`apollo-pattern-assessment-response`: агент возвращает только ссылку на факт,
disposition, выбранный `ruleId` и короткие тексты для UI. Proxy восстанавливает
из канонических fact/rule полные evidence lanes, source trace, безопасные
actions и счётчики, после чего пропускает результат через прежний fail-closed
валидатор. Это не переносит verdict в proxy: решение остаётся за агентом, а
proxy выполняет только проверяемую проекцию ответа в UI-контракт. Совместимые
active rules с одинаковым effect усиливают друг друга; review создаётся только
для действительно противоречащих effects или нормативных ожиданий.

По умолчанию pattern-аудит запускает последовательные faceted passes:
`component-contract`, `visual-bindings`, `layout-patterns`. Все проходы
используют один `auditId` и checksum frozen snapshot. `auditPass.targets`
отделяет обязательные к оценке факты от междоменного
контекста. Coverage ledger требует ровно одно оценку каждого
target; пропущенный property безопасно восстанавливается как
`human_review`, а не исчезает. Пакет больше
`APOLLO_CODEX_PATTERN_PASS_BUDGET_CHARS` рекурсивно делится по
targets. `APOLLO_CODEX_PATTERN_AUDIT_MODE=single` сохраняет A/B rollback.

До запуска Codex proxy измеряет итоговый prompt. После
`APOLLO_CODEX_INPUT_WARN_CHARS` в лог пишется предупреждение, а превышение
`APOLLO_CODEX_INPUT_BUDGET_CHARS` останавливается локально с кодом
`CODEX_INPUT_BUDGET_EXCEEDED`, не расходуя время и токены на заведомо
непринимаемый запрос.

Асинхронный run endpoint использует `codex exec --json` и преобразует JSONL
события только в безопасные продуктовые этапы. Команды, reasoning и тексты
внутренних событий не возвращаются в плагин. Завершённый run хранится в памяти
`CODEX_RUN_TTL_MS` миллисекунд; перезапуск proxy очищает историю run-ов.
`CODEX_IDLE_TIMEOUT_MS` ограничивает только период без вывода от Codex и
сбрасывается при каждом событии; `CODEX_MAX_RUNTIME_MS` задаёт абсолютный предел
аудита. Старый `CODEX_TIMEOUT_MS` поддерживается как alias idle-timeout.

Для pattern- и text-аудитов proxy по умолчанию сохраняет локальный debug-трейс
в `CODEX_WORKSPACE/debug-runs/<runId>/`: исходный report, resolved packet, сырой
ответ агента и нормализованный ответ. `02-input-metrics.json` содержит размер
prompt и вклад его разделов. При ошибке рядом создаётся `99-error.json`.
Каталог содержит тексты и структуру проверяемого макета, поэтому остаётся только
на компьютере дизайнера и не должен публиковаться. Сохранение можно выключить
через `APOLLO_CODEX_DEBUG_ENABLED=0` или перенести с помощью
`APOLLO_CODEX_DEBUG_ROOT`.

Validation contract schema v2 требует `sourcesUsed` и относительные evidence
paths. После ответа Codex proxy независимо ограничивает путь корнем
`ds-ai-hub`/`design-system_ab`, проверяет существование файла и наличие в нём
заявленного `ruleId` или точной цитаты. Finding получает `verdict=confirmed`
только при хотя бы одном проверенном evidence; остальные findings получают
`verdict=assumption`, а весь ответ — `needs_review`. `sourcesUsed` показывает
файлы, которые агент заявил как прочитанные, и результат проверки каждого пути.

Канонический скил хранится в
`projects/Apollo-v2/.agents/skills/apollo-design-validator`. Команда
`npm run skill:sync` копирует его в
`services/apollo-proxy/codex-workspace/.agents/skills`; `npm start`, `npm test`
и сборка `ApolloProxyControl.app` выполняют sync автоматически. Копию в
`codex-workspace` не редактируют вручную.

Перед запуском endpoint авторизуйте Codex CLI один раз:

```bash
codex login
```

В `ApolloProxyControl` терминал для этого не нужен: пункт `Authorize Codex...`
запускает тот же официальный browser flow, а `Check Codex Access` выполняет
`codex login status`. `Start Proxy` заблокирован, пока настроенный Codex backend
не авторизован. Приложение не читает и не сохраняет credentials самостоятельно.

Если сессия отозвана уже во время проверки, Codex endpoint возвращает стабильный
код `CODEX_AUTH_REQUIRED`, а Apollo предлагает повторить вход через
`ApolloProxyControl`.

Если Codex уже используется через ChatGPT/Codex Desktop, сохранённая CLI
авторизация обычно переиспользуется. Отдельный входящий сервер или открытый чат
Codex не нужен: proxy запускает изолированный agent run на каждый запрос.

## macOS app

Для передачи дизайнерам есть menu bar приложение `ApolloProxyControl`, которое запускает этот proxy без терминала.

Локальная сборка:

```bash
./services/apollo-proxy/macos-app/scripts/build-app.sh
```

Готовые артефакты:

- `services/apollo-proxy/macos-app/dist/ApolloProxyControl.app`
- `services/apollo-proxy/macos-app/dist/ApolloProxyControl-macOS.zip`

Core component packages are compiled through the same universal contour
registry as product components. `IconView` is the first reusable boundary
package: the package owns public-root and effective-baseline rules, while a
host package owns contextual permissions for its `Content` slot. The runtime
does not branch on the `IconView` name or Figma key; absent host authority
remains non-enforcing.

Запуск у пользователя после передачи архива:

1. Распаковать `ApolloProxyControl-macOS.zip`.
2. Переместить `ApolloProxyControl.app` в `/Applications`.
3. Если macOS блокирует запуск ad-hoc или не notarized сборки, выполнить:

```bash
xattr -dr com.apple.quarantine /Applications/ApolloProxyControl.app
chmod +x /Applications/ApolloProxyControl.app/Contents/MacOS/ApolloProxyControl
open /Applications/ApolloProxyControl.app
```

4. В строке меню нажать `Start Proxy`.

Для передачи другим пользователям используйте zip-архив. Локальная сборка подписывается ad-hoc и может показывать предупреждения Gatekeeper. Для бесшовной передачи нужна Developer ID подпись и notarization:

```bash
CODESIGN_IDENTITY="Developer ID Application: <Team Name> (<TEAMID>)" \
NOTARY_KEYCHAIN_PROFILE="apollo-proxy-notary" \
REQUIRE_NOTARIZATION=1 \
./services/apollo-proxy/macos-app/scripts/build-app.sh
```

По умолчанию shareable `.app` не вшивает `services/apollo-proxy/.env`. Для старого
внутреннего режима это можно явно включить переменной `EMBED_PROXY_ENV=1`, но
такой архив может содержать секреты и не предназначен для раздачи дизайнерам.

Apollo Generation frontend использует отдельные `/v4/generation/frontend/execute`, `/cancel` и `/artifacts/:id/*` routes. Fixed DTO, server-owned accepted profile/bank, private tmp output, actual TS/Vite/Chrome checks, cancel/TTL cleanup; default profile port unavailable. Details: [Apollo frontend handoff](https://github.com/Ackedze/apollo/blob/main/docs/GENERATION_FRONTEND_HOST.md). Current local runtime updated only in isolated Generation service files.

06.10.2026 isolated Generation service поддерживает current producer registry 1.1.0
с полным lock/currentInputs/full five-package closure. Actual current BG request
доходит до SOURCE_COMPILE; CC source/API Ready сохраняет Code profile/native block.
No normative artifact; legacy release/knowledge routing не менялось.
[Fresh consumer handoff и pins](https://github.com/Ackedze/apollo/blob/main/docs/GENERATION_CURRENT_INPUTS.md).

## Apollo static source / producer review

`POST /v4/generation/static-review` accepts only version, requestId, input and
current UI buildHash. Filesystem paths and trusted manifest/report SHA pins are
server-owned in `src/generation-agent/static-review-config.json`. The existing
read-only reader checks source/build closure and returns compact unaccepted
metadata, blocked targets and Generation hash null. Missing product fields remain
explicit; stale producer content stays historical. No prepare/execute/native/
import/preview/writer or installed app/process lifecycle operation is called.

Synthetic HTTP16/context+frontend7 and panel browser440/360 passed. Full suite:
391 passed/7 legacy catalog/crosswalk failures, reproduced with pre-stage service;
knowledge check passed. Installed-runtime deployment and a fully green Proxy gate
are not claimed. [Detailed evidence](https://github.com/Ackedze/apollo/blob/main/docs/GENERATION_STATIC_REVIEW_ROUTE.md).

### Local knowledge roots

The bare Node/CLI default selects a complete local knowledge root, or the existing
shared checkout when `knowledge/design-system_ab` is only a component projection.
The design-system root must contain the JSONS component index and pattern catalog,
redpol dictionary and Markdown patterns. The hub root must contain product/core
component directories and product patterns. A component-only copy produced by
`sync-contract-knowledge` is not a complete runtime knowledge package.

Explicit `CODEX_DESIGN_SYSTEM` / `CODEX_DS_AI_HUB` (or their existing root aliases)
retain priority, including roots supplied by the desktop current-release launcher.
An incomplete or malformed selected root fails with `CODEX_KNOWLEDGE_INCOMPLETE`;
it is never replaced silently or mixed with checkout sources. This structural
check does not replace the existing managed-release inventory/hash validator.
Migration audit reads the existing `experiments/migration-wave-1.json` and resolves
its compiled contract entries inside `experiments`, rejecting escaping paths.


Static-review consumer-binding preparation supports a closed additive v2
request/result/envelope at the existing read-only route. v1 stays closed.
Only local provider/operator context can supply `staticReviewReceiptPin` and
`staticReviewArtifactRoots`; environment equivalents are
`APOLLO_STATIC_REVIEW_RECEIPT_PATH`, `APOLLO_STATIC_REVIEW_RECEIPT_SHA256` and
optional `APOLLO_STATIC_REVIEW_ARTIFACT_ROOT`. No trust anchor is read from HTTP,
imported JSON or static-review-config. C0 selectors remain unchanged during
stage1. Missing/invalid receipt stays unverified/rejected; a verified detached
binding does not rewrite original producer freshness or grant generation,
source/API/coverage/native/live/release acceptance. Config, provider/readers,
complete source/API/dependency vectors and build pins are checked across reads.
Final receipt creation and selector write require a separate reviewed handoff;
no automatic repin loop or app restart is part of preparation.


## Каталоги токенов и стилей для V3 / V4

Выбранный immutable knowledge package служит источником каталогов. `GET /v1/style-token-catalog/inventory` возвращает `snapshotId`, `knowledge.contentVersion`, `readerCodeSha256` и идентификаторы доступных источников. `POST /v1/style-token-catalog/catalogs` принимает только `{ protocolVersion: "apollo.style-token-read.v1", snapshotId, contentVersion, sourceIds }`, где `sourceIds` содержит от 1 до 32 уникальных строк из inventory. Ответ содержит полный исходный JSON каждого каталога, исходные hash pins и `loaderMeta` для существующего загрузчика V3. Все режимы, concrete alias values, scopes и поля PAINT / TEXT / EFFECT сохраняются; matching выполняют существующие helpers потребителя.

Новый parser ограничивает эти POST-запросы и `/v1/style-token-catalog/query`, `/v2/resources/display-names/resolve` до 65 536 байт, включая chunked whitespace. Полный ответ каталогов ограничен 8 MiB. Disconnect отменяет чтение; частичные ответы не возвращаются. Ошибки: 400 — некорректный JSON / типы / лишние поля, 404 — неизвестный источник, 409 — устаревший пакет / lease, 413 — превышение лимита, 503 — источник отсутствует в пакете. После смены пакета следует перезапустить Proxy и получить новый inventory. Runtime не читает каталоги из незакреплённого checkout.

`GET /v2/resources/display-names` и `POST /v2/resources/display-names/resolve` возвращают имена по точному key. Для одного EFFECT key с несколькими экспортированными строками и одинаковыми name / group возвращается `duplicateState: "same-label-export-records"`; различающиеся имена и конфликтующие token records остаются ambiguous. Эти read API не разрешают native mutation и не меняют существующие selected-key guards потребителя.

Обычная сборка knowledge включает `JSONS/styles/*.json`. Для локального добавления ровно 9 каталогов стилей к существующему пакету builder принимает `--base-package <immutable-package-root>` вместе с `--directory-only`, `--design-system-root`, `--ds-ai-hub-root` и `--output`. Он проверяет 23 token catalogs, 9 style catalogs и reference manifest против source commit базового пакета; не включает другие изменённые файлы checkout. Неизменённые данные переиспользуются через hardlinks, generated provenance создаётся отдельно. Результат валидируется существующим package validator; этот режим не создаёт архив или descriptor и не публикует пакет.


### Apollo: планирование по текущим контрактам

Планировщик передаёт `TARGET_CONTEXT` и `CONTRACT_CONTEXT` по одному разу.
Для generic Figma mapping используется полная authoring-проекция
`figmaMappingRecords`; физические native targets остаются в пакете исполнения.
Нормы и доступные semantic/typed ports не обрезаются. Итоговый prompt проверяется
до запуска CLI: свыше 900 000 символов возвращается `PROMPT_CONTEXT_LIMIT`,
а не общий `CODEX_PROCESS_FAILED` после отказа процесса.

`POST /v4/generation/plan` принимает только версионированный запрос с описанием,
платформой и viewport. Сервер читает current-contract-packages через текущий
producer, затем вызывает настроенный read-only CLI агент с authoring manuals.
Ответ — Draft ScreenSpec с hashes использованных входов; создание targets не
запускается. Неизвестные mappings/порты, stale inputs и некорректная схема
отклоняются. Клиент не задаёт пути, source, readiness или результаты проверок.
Новый Draft использует ScreenSpec v2: у статичных owned items явно задан
`behavior: "none"`, технические ограничения находятся в `capabilityGaps`,
продуктовые вопросы — в `unresolved`. V1 продолжает приниматься с обязательным
объявленным `eventId` у каждого owned item. Envelope запроса и ответа остаётся v1;
ни одна версия Draft не разрешает target execution.
# Native generation callback budget

Planning and native worker CLI requests share a 900 000 character pre-launch
budget. The worker counts its profile prefix as part of that budget. Its model
view keeps complete manual bodies once and retains RuleID/source references,
semantic bindings, typed ports, physical targets, skills and the latest native
observation. Immutable provider packets and broker guards remain complete.
Identical rule/manual copies are referenced rather than truncated; differing
source data is preserved. Excess input returns `AGENT_CONTEXT_LIMIT` before
spawn. Failed worker processes preserve a private `*.failure.json` receipt with
bounded stderr, error events, exit code, prompt sizes/hashes and trace ID. Public
diagnostics contain the code, sizes and trace ID, without stderr or source text.

Figma model steps may request up to 24 low-level operations. The proxy forwards
them in ordered callbacks of at most four operations, with a fresh sequence and
nonce for each receipt. This prevents earlier work in a large step from consuming
the broker's ten-second callback budget. It adds no model turns and preserves the
192-operation/run and existing callback, cancellation and cleanup limits.

Every full native receipt remains in eval and postcondition checks. The next
model prompt retains the latest complete tree/image and explicitly marked
summaries of older receipts, including every original evidence hash. Summary
hashes are references to stored receipts and do not grant native authority.

Contract/planning CLI failures save `process-error.json` through the existing
private Codex debug recorder before the temporary workspace is removed. This
contains the error code, message and existing bounded process details, without
the input prompt.


Native eval events belong to the model attempt that requested their operations;
callback sequence/callId remain separate in each original receipt. Invalid eval
event types or attempt links preserve the first `recording-failure.json` with
run, event type, native call and expected/actual values. The same bounded
diagnostic appears in the native run gaps under assembly details.


Ask (`POST /analyze`, source=codex) читает базу знаний, установленную в Proxy. Пользовательскому плагину не требуются CODEX_WORKSPACE, checkout дизайн-системы, validator skill или audit schema. Каждый запрос CLI выполняется в отдельной временной директории Proxy с read-only доступом к выбранной базе; директория удаляется после завершения. Проверки пакета знаний и CLI сохраняются; legacy audit/generation readiness не меняется.

### Идентификаторы сбоев генерации

Планировщик, worker CLI, native broker и журнал используют общий публичный формат
`apollo.generation-failure.v1`: канонический модуль `generation-failure.js` Apollo
и его побайтово одинаковая локальная поставка `failure-diagnostic.js` в proxy.
Proxy загружает только локальную поставку и не требует checkout автора. `code` —
постоянный идентификатор типа (`AGENT_CONTEXT_LIMIT`, `FIGMA_PORT_UNAVAILABLE`
и т. п.); `errorId` — уникальный случай. При передаче ошибки этот ID сохраняется.
Коды определяются в местах отказа; отдельные коды для каждого компонента не нужны.

Контекст: `phase`, `stage`, `requestId` либо `runId`, `revision`, `specHash`,
`sourceHash`, `modelStep`, `callId`, `nativeSequence`, `operationIndex` (с нуля),
`operation`, `handle`, `nodeId`, `rootNodeId`, `mappingId`, `port`, `traceId`.
Неизвестные значения — `null`; `nodeStatus=unresolved` означает, что физический
узел не установлен. Root ID или родитель не подставляются вместо неисправного
узла. Отказ CLI до native-вызова не свидетельствует об ошибке Figma-компонента.

Публичный контекст содержит ограниченные идентификаторы и числовые индексы.
stderr, исходные значения и полные traces остаются в приватных evidence. По
`traceId` находится `<traceId>.failure.json`; по `runId` — журнал `run-evals`,
где `model-error.diagnostic` сохраняет тот же `errorId`. Native gap передаёт JSON
в существующем поле `message`, без ослабления закрытой схемы наблюдения.
Журнал сохраняет первую ошибку записи в `recording-failure.json` вместе с
ожидаемыми и фактическими значениями. Старые записи без новых ID не переписываются.

### Figma MCP: только генерация

По решению владельца от16.10.2026 MCP собирает макет без DS проверки. RuleIR,
полный default/source comparator, нормативный ledger и автоматические repair
циклы не запускаются. Результат — «без проверки», Draft, Ready=false. Отдельный
Design Check и встроенный executor сохраняют прежнее поведение.

Portable figma-mcp.md version0.2.0 содержит полные figma-use/SKILL.md и
figma-generate-design/SKILL.md, обязательные API references и все API type
signatures без documentation comments. Он укладывается в прежний262144-byte
лимит skill. Пользователю не нужны локальные skills/workspace. Inline тексты
уже загружены в каждый ephemeral exec; файловый fallback не используется.

Provider/planning сохраняют полные исходные нормы. Только исполнительный view
исключает ruleLinks/manual.rules и нормативный ledger; construction API, typed
ports, dependencies и mapping сохраняются. Исходные manuals остаются по прежним
immutable refs. Отсутствие проверки не означает нормативный PASS или parity.

Scope transport использует отдельный capture: актуальные root/owner/page/outside
и квитанция сохранности, без обхода компонентов, RuleIR и сверки ScreenSpec.
checks=[]; validationMode=generation-only. Старый collector read не вызывается
MCP transport. Старый plugin требует reload; пустой root не объявляется экраном.
Current-input/hash/sequence guards, типы API, опубликованные keys и защита внешних
узлов сохраняются. createMcpInstance готовит source fonts/modes. Полный comparator
доступен только как guard удаления untouched default payload при штатной замене
native SLOT, не для проверки каждого компонента. Нет failure cleanup/rollback.

Лимиты прежние:24calls/run,60s/tool,300s/exec,900s/run,8exec и2context requests.
Диагностика первых native сбоев и неизвестность удалённой записи сохраняются.
Root receipt доказывает существование/владение, не качество или полноту макета.

### Экспериментальный исполнитель Figma MCP

`/v4/agent/mcp/status` сообщает доступность отдельного маршрута; draft/run/poll/observation/preservation/cancel обслуживаются под `/v4/agent/mcp/`. Приём draft разрешён только для `figma-owned` с явным `generationMethod: mcp`. Встроенный Figma и frontend сохраняют свои маршруты. Автоматического fallback нет.

Для MCP требуется отдельный принятый JSON, путь которого задаёт `APOLLO_AGENT_MCP_CONFIG`: `schemaVersion: apollo.mcp-worker-config.v1`, `name: apollo_figma_mcp`, `url: https://mcp.figma.com/mcp`, точный `fileKey`, `tools: [use_figma, get_screenshot]`. Файл должен входить в принятый runtime descriptor. Credential-поля в конфиг не входят; OAuth подключается официальным клиентом отдельно. Новая конфигурация не становится current без независимой приёмки source/build/config. Наличие status/config и protocol inventory ещё не доказывает успешный model exec.

Работают отдельные MCP eval/trace/workspace и журнал фактического сохранения. Лимиты: 8 CLI exec на run (включая не более 2 запросов контекста), 24 MCP calls на весь run, остаток этого числа на exec, 64 KiB суммарного tool output на exec, 60 s на tool, 300 s на exec и 900 s на run. Наблюдение CLI events может следовать за удалённой записью: это экспериментальная гарантия с независимым readback, а не встроенный конечный prewrite broker. При неизвестном завершении не повторяется запись и не удаляется Draft.

Planner и оба Figma launcher сохраняют исходные usage events, размеры полного ввода, длительность, request/attempt correlation и ошибки. Отсутствующие effective model, внутреннее число provider iterations и стоимость остаются `null`; cached input и reasoning output являются подмножествами общих токенов. Агрегат request group охватывает сессию планирования, её уточнения/повторы, а не автоматически изолированную стоимость одного задания. Полные нормы и source guards не сокращаются ради лимита; превышение останавливает запуск до модели. Исходные errorId/traceId/stage и неизвестный child node сохраняются в terminal snapshot и eval.

MCP shared PluginData uses the canonical `apollomcp` namespace exported by the Node-compatible target module. The fixed collector and worker prompt use that same value; hyphenated namespaces are rejected by the native API. Scope failures keep the existing string error envelope with a safe structured diagnostic (error ID, run/request/stage, source and actual root/node when known). A partial root is retained, never deleted or silently adopted. A scope-open failure precedes worker start and is not a completed model run.


MCP slot assembly permits replacing only a proven untouched default placeholder
inside a fresh instance created in the admitted owned root. The worker must verify
ownership, exact mapped SLOT/property identity and full pristine-default
correspondence, require replacement content in the frozen ScreenSpec, append and
verify that content before removing the default, and return removed IDs. The native
SLOT, instance, root, other generated/user content and library definitions remain
protected. This forward assembly allowance never authorizes cleanup or rollback
after failure, timeout, cancellation or an unknown write. Independent readback and
Draft/Ready gates remain unchanged. This uses the normal
[Figma slot-content API](https://developers.figma.com/docs/plugins/working-with-component-properties/).


### Read-only contract data overview

`GET /v2/contracts/data-overview` serves a JSON metadata index kept in proxy memory.
The index is prepared once when the proxy starts, from the configured checking
release and target readers for desktop/mobile-web. Opening or refreshing the
window does not compile contracts, unpack ZIPs or build planning contexts. It returns
only contract identity/version/date and per-adapter data connection status.
Independent mappings and exact dependency closure are distinct; ZIP presence,
manual presence alone and Ready state never imply adapter connection. A missing
or stale reader stays explicit and does not hide other sources. Source dates
come from manual metadata, never file mtime or scan time. No model, run admission,
workspace construction or Figma action is performed. HTTP responses are not cached;
requests cannot choose files, roots, configuration or adapters.
The installed configuration is immutable during operation. Accepted package,
mapping or configuration installation restarts the proxy and recreates the index;
the plugin needs no local workspace or metadata files. The first request during
startup may wait for that single preparation. Subsequent reads only recheck the
captured source checkpoints and return the metadata JSON. A changed/missing
source makes its column/platform stale or unavailable, while other columns remain
visible; it never triggers compilation or a planner from an HTTP request.
Every consumed checking manifest, runtime, source, dependency and derived-cache
artifact is still rehashed. The plugin allows
30 seconds for this metadata request and distinguishes timeout, HTTP failure
and loss of connection.

### Рецепты композиции

`recipes/catalog.json` хранит данные рецептов и отдельную готовность адаптеров.
`GET /recipes?target=figma` возвращает короткий индекс без запуска агента;
`GET /recipes/:id` — описание выбранного рецепта. Frontend-индекс содержит
только рецепты, проверенные для фронта. Изменение каталога требует проверки
и перезапуска proxy: текущий запуск закрепляет точные bytes каталога.

Planner получает только индекс. MCP получает полное описание подходящего
рецепта после сопоставления замороженного ScreenSpec: viewport, mapping,
варианты, количество, пустые слоты, направление, отступы и порядок строк.
Запрошенный контент и неподдержанные параметры не заменяются рецептом.
Для первой версии поддержаны 4 и 5 пустых BackgroundPlateSlot, desktop 1600×900,
две колонки и отступ 24 px. Figma authoring-проверка выполнена; frontend пока
не проверен. Рецепт не включает проверку дизайна и не выдаёт Ready.

Для пользовательского прогона: «Собери страницу 1600×900, четыре пустых плейта
сеткой 2 на 2 с отступами 24 px». В подробностях сборки должна появиться строка
`Рецепт: layout.two-column-plates r1`. Повтор с пятью плейтами проверяет неполный
последний ряд. Сопоставьте результат с эталоном и проверьте, что смена контекста
поверхности у корня наследуется плейтами. Эталон и незавершённые результаты
сохраняются. Проверка через обычный proxy отдельно от прямых authoring-проб.


Исторический пилот подключал CorporateContent Mobile Web r8 и BackgroundPlate r6
к прежнему набору проверки. Это не текущий список revision или количества
компонентов: смотрите `/v2/contracts` и `/v2/contracts/data-overview` своей
поставки. Платформа выбирается по замороженному ScreenSpec; неподходящая
отклоняется. Подключение mapping не означает полную нормативную или live-приёмку.


### Пачки навыка названий и безопасная диагностика

Каждая пачка использует прежний строгий snapshot v1 / run 0.2. Дополнительная
диагностика возвращается отдельно от run: стадия, elapsed/idle/remaining,
provider, запрошенная модель, коррелированный CLI ID и до 24 событий.
Модель берётся из фактически подготовленного запроса выбранного provider,
включая поддержанные идентификаторы с @; это настройка, не доказательство
фактически исполненной модели. Сырые stdout/stderr остаются в прежнем
закрытом debug evidence и не попадают в HTTP-диагностику. Routing timeout
распознаётся также в stdout; это классификация ошибки, а не исправление сети.
AlfaGen отклоняется до запуска агента с
AGENT_PROVIDER_CAPABILITY_UNAVAILABLE; автоматического fallback нет.

Runner хранит до 64 полных результатов, освобождая старые завершённые при
новой заявке или спустя 30 минут от старта. Активный запуск не вытесняется.
Отдельный ограниченный реестр до 8192 request ID на процесс сохраняет
SHA-256 снимка и run ID после вытеснения. Повтор того же ID возвращает
сохранённый run либо LAYER_NAMES_RUN_EXPIRED (410); изменённый снимок —
LAYER_NAMES_REQUEST_REPLAY. Ни один из них не вызывает модель повторно.
После заполнения реестра новые запуски получают LAYER_NAMES_RUN_LIMIT;
нужен обычный перезапуск Proxy. Реестр и результаты не сохраняются после
перезапуска. Отменённые и поздние callbacks не возрождают завершённые runs.

Учёт токенов использует существующие started/completed/failed/cancelled
события и callbacks CLI. Пустая область завершает операцию без вызова модели;
диагностика не создаёт дополнительных model calls или начислений.

Перед полным `npm test` задайте отдельный `APOLLO_SKILL_SOURCE_ROOT` для legacy
validator. `APOLLO_PROJECT_ROOT` этот путь не определяет. Для текущей поставки
используется собственный tracked `codex-workspace/.agents/skills/apollo-design-validator`
с 11 файлами и checksum `be22fd658b471e75932dd704a497886525d62ab41c9968587840fb0df6a878b5`.
Явный missing/invalid source прерывает sync до изменения target; автоматический
поиск сохранён только при отсутствии override. Это независимый legacy input,
его содержимое текущая доработка не меняет.

В текущем журнале один run (одна пачка) даёт одну строку «Навык · Переименовать
слои». Несколько CLI-проходов внутри run суммируются в этой строке. Три пачки
дают три строки; общий идентификатор всей очереди этот протокол не добавляет.


## Агентский пилот компонентных паттернов

Маршрут `POST /v1/analyze/codex/runs` принимает `component-patterns-v2`:
два прежних правила Goal / Limit, денежное назначение Amount и отсутствие
повтора валюты в одной колонке, название действия Button и понятный контекст
IconButton. Детерминированные проверки остаются отдельными.

Каждый опубликованный компонент получает только свои правила. Идентичность
проверяется по ключам подключённой библиотеки; доказательства привязаны к
конкретному правилу и снимку. Для Hub проверяется совпадение выбранных правил,
а не всего документа. Вложенные части уже проверяемого компонента не создают
повторных карточек.

Прежний `progressbar-goal-limit-v1` сохраняет совместимость. Расширенный UI
требует кода Proxy с поддержкой `component-patterns-v2`: обновление данных
само по себе код Proxy не обновляет.


### Автоматическая отправка статистики проверок

Новый sender запрашивает `X-Apollo-Stats-Layout: v3`: publisher сохраняет отчёты в
`apollo/stats/<Figma-user>/<dd-mm-yyyy>/<user>_<date>_<time>_metrics-<origin>.json`.
Имя и локальное время даёт плагин; старые pending без автора получают
`Unknown-User` с исходным временем UTC. Синтетические отчёты остаются в `apollo/tests/`.
Receipt проверяется по точному ID, SHA и ожидаемому пути (либо старому hash-пути).
До обновления publisher старые отчёты без метаданных могут получить прежний
hash-путь — очередь совместима. Для новых метаданных нужны обе новые стороны.
Перед выпуском плагина с этими метаданными нужен Proxy с расширенным validator;
старый Proxy не принимает дополнительные поля. Изменения кода требуют отдельных
публикаций Proxy и Edge Function, обычного push недостаточно.

`POST /statistics/results` принимает только компактный `apollo-audit-metrics`
(schemaVersion=2). Исходники маршрута и durable publisher: `src/audit-statistics/`.
Новая запись атомарно сохраняется в `APOLLO_STATE_ROOT/audit-statistics`
(для dev — `.local/audit-statistics`) до receipt `proxy-durable`. Повторный
reportId с другими bytes отвергается; одинаковый отчёт идемпотентен.

Отдельный фоновый sender автоматически отправляет очередь существующей Supabase
функции `apollo-stats`. Только совпадение reportId/SHA256 и подтверждённый путь
в `Ackedze/design-system_stats` разрешают убрать pending-файл. Ошибка, offline,
перезапуск или ошибочная запись не мешают другим отчётам и обычной работе Proxy.
Deadline включает чтение всего HTTP body. GitHub token находится только в
серверном приёмнике; Proxy его не получает. Endpoint фиксирован в коде.

Pending-очередь ограничена 32 MiB; при заполнении Proxy отвечает 503, плагин
сохраняет свою копию. Хранятся последние 4096 receipts; после их ротации
идемпотентность обеспечивается стабильным серверным путём из сохранённого отчёта.
В логах различаются локальное принятие и ошибки окончательной доставки.
Рабочий UI не требует retry/export или обслуживания статистики пользователем.
Новая функция не заменяет существующий журнал токенов `/usage`.

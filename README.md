# apollo-proxy

Локальный Node.js-прокси для Langflow, Apollo v2 Codex validator и анализа
компактных отчётов Apollo v3.

## Настройка

1. Скопируйте `.env.example` в `.env`.
2. Заполните `APOLLO_AGENT_KEY`. Можно использовать тот же ключ, что и в `langflow-proxy`.
3. Запустите сервис:

```bash
cd /Users/alexkukhta/Desktop/DS-AB-Plugin/services/apollo-proxy
npm install
npm start
```

## Конфигурация

```env
HOST=127.0.0.1
PORT=3001
APOLLO_AGENT_URL=https://aiflowteam3.aiflow-test.moscow.alfaintra.net/api/v1/run/f89d7dbf-8602-4495-8735-952e0ac2028b
APOLLO_AGENT_KEY=
APOLLO_AGENT_INSECURE_TLS=1

CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex
CODEX_MODEL=
APOLLO_CODEX_REPORT_STRATEGY=packet
APOLLO_CODEX_KNOWLEDGE_SOURCE=ds-ai-hub
APOLLO_CODEX_INPUT_WARN_CHARS=700000
APOLLO_CODEX_INPUT_BUDGET_CHARS=900000
CODEX_IDLE_TIMEOUT_MS=300000
CODEX_MAX_RUNTIME_MS=900000
CODEX_RUN_TTL_MS=600000
CODEX_WORKSPACE=
CODEX_DS_AI_HUB=/absolute/path/to/ds-ai-hub
CODEX_DESIGN_SYSTEM=/absolute/path/to/design-system_ab
```

`APOLLO_AGENT_KEY` и `APOLLO_AGENT_INSECURE_TLS` имеют fallback на старые переменные `LANGFLOW_KEY` и `LANGFLOW_INSECURE_TLS`, чтобы можно было переиспользовать текущий локальный конфиг.

## Эндпоинты

- `GET /health` -> `{ ok: true, codex: { skill, knowledge } }`; блок
  `knowledge` показывает полноту contract package (`packageCount`,
  `artifactCount`, checksum).
- `POST /analyze` -> `{ success, result }`
- `POST /v1/validate/codex` -> `{ success, validation }`
- `POST /v1/validate/codex/runs` -> `202 { success, run }`
- `GET /v1/validate/codex/runs/:runId` -> `{ success, run }`
- `POST /v1/analyze/codex/runs` -> `202 { success, run }`
- `GET /v1/analyze/codex/runs/:runId` -> `{ success, run }`

`POST /analyze` принимает строку, `{ text: "..." }` или `{ report: {...} }`. Apollo отправляет compact `*_agent.json` как `report`.

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
JSON. Неполный набор блокирует запуск с `CODEX_KNOWLEDGE_INCOMPLETE`, а не
превращается в уточняющий вопрос дизайнеру. Переменные `CODEX_DS_AI_HUB` и
`CODEX_DESIGN_SYSTEM` позволяют явно использовать другие checkout-каталоги.
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
контекстом subject. `role_assignment` и `relation` описывают composition и page
relations, `text_content` — текст и component owner context. Rule authority и
allow-exceptions не записываются во Figma facts: они находятся только в
`semanticModel.rules`. Active slot-exception применяется лишь при точном
совпадении conditions; отсутствие authority переводит решение в review.

На первом этапе `semanticModel` является канонической семантической проекцией,
а `generalAudit`, `architectureAudit` и `resolution` сохраняются как
compatibility-представления для текущего output contract. После покрытия
остальных pattern facts эти дубли будут удалены из agent packet, что сократит
prompt без переноса verdict-логики в proxy.

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

# Лендинги в Apollo Proxy

Канонический навык: `design-system_ab/apollo/skills/ab-generate-custom-landing` 0.3.0.
Proxy читает его из совместимого установленного пакета данных; личный checkout или Python
не нужны. Официальный Figma workflow входит в portable runtime. Это отдельные входы:
новый код сам не добавляет навык в старый пакет. `GET /landing/status` сообщает версию и gaps.

Сценарий, сохранность и условия: [Apollo LANDING.md](https://github.com/Ackedze/apollo/blob/main/docs/LANDING.md).
Первый профиль: Desktop, Codex, собственный OAuth Figma MCP и текущий файл/страница
из native-контекста плагина. Контекст передаётся модели до первого шага: URL запрашивать
не нужно. Размещение задаётся при создании чата: новая или существующая секция;
после привязки root оно не меняется. Новые target содержат `parentNodeId` секции,
старые root непосредственно на странице продолжают поддерживаться.

API: `/landing/chats` (GET/POST), `/landing/chats/:id` (GET), POST суффиксы
`messages`, `canvas`, `observation`, `cancel`, `failure`. Корреляция: chat ID, revision,
request ID, монотонный sequence. Native readback передаётся отдельным запросом.
История, spec, usage, источники и первая диагностика сохраняются в state root/landing.
После перезапуска незавершённый запуск не возобновляется автоматически.

В проекцию знаний обязательно входит `ds-ai-hub/AGENTS.md`. При его отсутствии
`/landing/status` сразу сообщает `LANDING_REQUIRED_KNOWLEDGE_MISSING`; нужен новый
пакет данных. Модель получает результаты всех адресных поисков, включая пустые,
а не только последнего. Повтор одного поиска без новых прочитанных данных сохраняет
точную диагностику `LANDING_NO_PROGRESS` вместо исчерпания 24 шагов без объяснения.
Поиск использует AND по словам пути: один компонентный путь на запрос. Один
`request_context` может прочитать все выбранные документы; host отдаёт управление
между порциями по восемь чтений для Stop и проверки свежести. Это размер порции,
а не предел общего числа документов. Сохраняются ограничения каждого чтения и
размер контекста. Usage сохраняется до валидации ответа; при отказе диагностика
содержит тип шага, число ресурсов, hash ответа и ID/позицию сбойного чтения.

Чтение данных ограничено закреплённым индексом JSON/Markdown; shell и произвольные файлы
недоступны агенту. Старые API генерации возвращают 410 без fallback. Публичные mappings,
контракты, проверка и «Спросить» сохраняются. Наличие readback не доказывает полное соответствие
DS: непроверенные визуальные/нормативные свойства остаются UNKNOWN; Ready=false.

Проверки: `node --test test/landing*.test.js test/skill-catalog.test.js
 test/portable-runtime.test.js test/portable-bundle.test.js test/data-packages.test.js
 test/frontend-authoring.test.js test/async-generation-health.test.js` (одной строкой).
Synthetic CLI и native bridge не заменяют ручную приёмку владельца.

Перегрузка выбранной модели передаётся как `AGENT_MODEL_CAPACITY`, с отдельной
коррелированной диагностикой и usage каждой попытки. Планировщик без инструментов
повторяет только неудавшийся шаг не более двух раз, через 5 и 15 секунд. Повторы
учитываются в прежнем общем бюджете 24 вызовов. Прочитанные данные, история и spec
сохраняются; ожидание доступно для Stop, перед повтором проверяется свежесть источников.
Модель не подменяется. Для `landing-figma` слепой автоматический повтор запрещён:
при возможных изменениях canvas продолжение требует обычного независимого readback.
После исчерпания повторов остаётся точное сообщение о перегрузке и возможность
продолжить позже в том же чате. Успешное восстановление CLI до `turn.completed`
не считается новым отказом из-за более раннего события перегрузки.

## Чтение каталогов и продолжение

Ответ адресного reader ограничен 32768 байтами всего сериализованного UTF-8 envelope.
Для массивов `returned` — фактическое число элементов, `next` — точный следующий
offset, `total` — полный размер. Следовать нужно `next`, а не `offset + limit`.
Один слишком большой элемент остаётся непрочитанным: `tooLarge`, `returned: 0`
и `availablePath` позволяют запросить его ключи/поля. Такое чтение не считается
доказательством источника. Markdown делится без разрыва UTF-16 surrogate pair.

`mode: summary` доступен только для `components` технического `component-index`
из `JSONS/indexes`. Он возвращает имена, категории, статусы и `fullPath`;
component/variant keys и полные объекты не заменяются обзором. До выбора ключа
агент читает нужный объект по `fullPath` в режиме `read`. Нормы не проецируются.

Повторы неизменных запросов используют ответ текущего запуска. Три раунда без
новых данных сохраняют `LANDING_NO_PROGRESS` до исчерпания 24 шагов. Уменьшение
уже прочитанного диапазона не считается прогрессом. Сохранённый reader state
содержит адреса и хеши, а не копии payload на каждую revision. При продолжении
они перечитываются и сверяются; при смене release/workflow/skill pins старый
контекст не переносится. История и spec сохраняются. Target/lease и readback
всегда подтверждаются заново перед записью.

## Подключаемые навыки Figma

Существующий landing v1 поддерживается для совместимости. Новые навыки одного
исполнителя используют `apollo.skill-package.v2`, `executorId: apollo.figma-mcp`
и декларативное `generation`: `platforms`, `requiredResources`, `initialQueries`,
`initialFiles`, `hostInstructions`. Формат и порядок добавления —
[design-system_ab/apollo/skills/README.md](https://github.com/Ackedze/design-system_ab/blob/main/apollo/skills/README.md).

`GET /landing/status` возвращает `skills` и `defaultSkillId` из установленного
пакета. Необязательный `skillId` в `POST /landing/chats` закрепляет навык за чатом;
его нельзя подменить существующему chat ID. Старые клиенты без `skillId`
продолжают использовать landing. Историческое имя `/landing` сохранено как API
совместимости, нового параллельного контроллера нет. Будущий навык меняет инструкции
и источники; CLI, reader, история, Stop, lease/ownership и независимый readback общие.
Полный `SKILL.md` и заявленные initial files поступают сразу, остальные references
доступны адресно через `skills/<id>/…`. Универсальные права не расширяются профилем.

Первой поставке v2 нужен runtime с `capabilities.generationSkills` равным
`figma-mcp-skills-v1`. Он получает отдельный runtime ID/канал при обычной сборке.
Reader и сборщик отвергают v2 на старом runtime; новый профиль нельзя направлять
в существующий канал401 для старых приложений. После этой первоначальной совместимой
поставки добавление навыков/инструкций выполняется пакетом данных без пересборки Proxy.
Новая платформа, исполнитель или native-возможность по-прежнему требуют кода.

## Section checkpoints

The host schedules one work unit at a time: `bootstrap` (host/layout only), each
requested section in spec order, then read-only `verify` with the final screenshot.
`execution.activeSectionId` and `execution.stage` are host-owned. Workers return
`continue` with `resultJson` containing:

```json
{"checkpoint":{"sectionId":"hero","status":"complete","nextAction":"Inspect the next section"}}
```

Use `sectionId: null` for bootstrap; use `status: "partial"` to keep the same
section active. The host advances only after independent observation confirms the
actual section node ID. Tagged other sections must preserve IDs/fingerprints; a
new later section is rejected. `finish` is admitted only in the verification unit,
after the requested section checkpoints. This does not establish DS conformance:
checks remain agent-reported, unknown visual/sizing evidence remains UNKNOWN and
`Ready=false` is retained.

A worker should make at most two small MCP calls per turn. The launcher requests
a controlled checkpoint after three completed calls, at the 90-second soft limit
between calls, or after an observed native tool error. The existing 300-second
hard limit and global 24 model steps / 96 MCP calls remain. The 60-second MCP
transport deadline is unchanged. An in-flight call is not declared finished when
the soft limit expires. A hard timeout after observed MCP work also requires
independent readback before another worker can continue. Three recovery cycles
without observed progress stop with `LANDING_NO_PROGRESS`.

CLI item events are **post-dispatch**: stopping the worker does not revoke a
remote write and is not a pre-mutation section sandbox. Controlled yields and
partial failures therefore retain the root and require a fresh host observation;
critical file/tool/output/argument guards and Stop outrank a controlled yield.
Scripts still verify owner, parent/page and active lease before mutations. Scope
comparison covers the host reader's tagged section fingerprints; arbitrary JS
and untagged content are not newly claimed as isolated or proven safe.

`execution` is additive chat/export diagnostics: active unit, last operation and
call ID, elapsed pass time, tool count, pending action, last issue, completed
section fingerprints and last independent readback hash. The existing UI notice
shows the active unit and elapsed time. A retained checkpoint is reused only when
source, root owner, queue, section spec and actual fingerprint match. A changed
source or root requires rebuilding the checkpoint state from current reads.
No automatic cleanup, root recreation, provider fallback, installation or Figma
manual acceptance is implied by these checkpoints.

### Host-owned plan and write deltas

The planner alone returns the complete `specJson`. After `build`, the accepted
plan stays in Proxy storage and is supplied to workers as read-only context.
The write profile uses a separate strict schema: `specJson` is absent and
replacement full-plan payloads are rejected. This overrides generic skill
transport wording about returning a complete specification; normative rules and
business facts are unchanged.

Every write response contains `sectionPatch`, either `null` or exactly:

```json
{"sectionId":"hero","nodeId":"actual-section-root-id"}
```

Only `continue` in the active section accepts that patch. Bootstrap, resource
reads, questions, repeat-build readback and final verification require `null`.
`resultJson.checkpoint` still declares partial/complete and the next action.
Properties, content, assets, rules, facts, decisions, section order and other
section bindings cannot be replaced by a write worker. Changing the plan belongs
to an explicitly scoped planning request.

The proposed binding is pending until independent host observation matches both
section ID and actual node ID. A mismatched binding fails without changing the
stored plan. Successful observations update only that binding; all other plan
fields remain intact. No missing-field merge, implicit deletion or permissive
fullspec compatibility fallback is used. Existing scope/readback/Stop/freshness
and global budgets are retained. Historical fullspec failure replays must state
when an old response is projected into the new wire schema; that is not a new
model execution or a claim that the old invalid wire response is now accepted.

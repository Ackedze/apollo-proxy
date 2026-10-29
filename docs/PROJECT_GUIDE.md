# Карта Apollo Proxy для разработчика

Proxy — локальный HTTP-сервис между Figma-плагином Apollo, установленными
данными и выбранным агентом. macOS miniapp управляет его установкой, входом,
настройками и процессом. Общий старт четырёх репозиториев находится в
[Apollo](https://github.com/Ackedze/apollo/blob/main/docs/AGENT_START_PROMPT.md).

## Функции и путь данных

| Сценарий | Роль Proxy | Модель |
| --- | --- | --- |
| Обычная проверка | Разрешает версии контрактов и отдаёт данные локальному runtime Apollo | Не вызывается |
| Данные Apollo | Отдаёт индекс версий и подключения по адаптерам | Не вызывается |
| Диалог | Готовит запрос, запускает выбранный provider и возвращает ответ | Вызывается |
| AI-анализ/пояснение | Подготавливает контекст, запускает поддержанный CLI и проверяет формат | Вызывается отдельно |
| Генерация | Планирование, контекст контрактов/mapping, исполнение и сохранение результата | Вызывается |
| Навыки | Управляет циклом анализа и разрешёнными запросами фактов | Вызывается; native-применение остаётся в плагине |
| Git-обновление | Проверяет данные, совместимость и переключает пакет | Не вызывается |

Codex/Claude запускаются как локальные CLI; это не означает локальное исполнение
самой модели. AlfaGen вызывается по HTTP. Имя маршрута с `codex` может быть
историческим: смотрите фактический provider в ответе и `/health`.
HTTP 200 не доказывает готовность знаний, генерации или успешный ответ модели.

## Провайдеры и ограничения

| Возможность | Codex | Claude | AlfaGen |
| --- | --- | --- | --- |
| Диалог | Да | Да | Да, через настроенный HTTP endpoint |
| Структурированные AI-проверки/пояснения | Поддержанный CLI-профиль | Поддержанный CLI-профиль | Не поддержаны |
| Анализ названий слоёв | Да | Да | Не поддержан |
| Экспериментальная генерация Figma MCP | Отдельный MCP-профиль и OAuth | Не поддержана этим профилем | Не поддержана |

Детерминированные проверки не зависят от выбора агента. Для модели и каждого
адаптера нужны свои принятые входы. Нет автоматического перехода к другому
провайдеру при ошибке. Настройки `CODEX_MODEL` и `CLAUDE_MODEL` независимы;
пустое значение оставляет выбор модели CLI. Запрошенная настройка модели
не является доказательством фактически исполненной модели.

Figma MCP работает generation-only: Draft, `Ready=false`, DS-проверка отключена,
частичный результат сохраняется при остановке. Root receipt подтверждает
сохранность, а не полноту макета. Frontend runtime и mapping присутствуют
в проекте, но переносимость frontend с собственным SDK — отдельный этап.
Наличие manual не включает компонент автоматически во все адаптеры.

## Где искать код

| Задача | Модуль |
| --- | --- |
| HTTP, wiring и общие состояния запусков | [`server.js`](../server.js) |
| Конфигурация и выбор CLI | [`src/config.js`](../src/config.js), [`src/cli-agent.js`](../src/cli-agent.js) |
| Формирование запросов/отчётов | [`src/reports/`](../src/reports) |
| Контракты и metadata overview | [`src/contracts/`](../src/contracts) |
| Детерминированные legacy predicates | [`src/predicate-engine/`](../src/predicate-engine) |
| ScreenSpec, контекст и исполнители | [`src/generation/`](../src/generation), [`src/generation-agent/`](../src/generation-agent) |
| Рецепты | [`recipes/catalog.json`](../recipes/catalog.json), [`src/generation-agent/recipe-catalog.js`](../src/generation-agent/recipe-catalog.js) |
| Навыки | [`src/skills/`](../src/skills) |
| Данные и установка пакетов | [`src/data-packages/`](../src/data-packages), [`src/data-release/`](../src/data-release) |
| Знания | [`src/knowledge-package/`](../src/knowledge-package), [`src/knowledge-root.js`](../src/knowledge-root.js) |
| Portable paths/runtime | [`src/portable-runtime.js`](../src/portable-runtime.js), [`scripts/`](../scripts) |
| macOS miniapp | [`macos-app/Sources/ApolloProxyControl/`](../macos-app/Sources/ApolloProxyControl) |
| Тесты | [`test/`](../test), [`package.json`](../package.json) |

Legacy-модули и названия прежних версий остаются действующими, пока используются
клиентами. Их удаление не входит в обычную задачу по соседнему модулю.

## Основные API

| Маршрут | Назначение |
| --- | --- |
| `GET /health` | Версия, provider, readiness, busy и состояние сервисов |
| `GET /v2/contracts` | Текущий список доступных контрактов |
| `GET /v2/contracts/data-overview` | Лёгкий индекс для окна данных, без агента |
| `POST /v2/contracts/resolve` | Разрешение контрактов по захваченным identities |
| `POST /v2/contracts/explain` | Отдельное AI-пояснение по контракту |
| `POST /analyze` | Диалог/анализ по существующему request envelope |
| `GET /recipes?target=figma` | Индекс подходящего адаптеру каталога рецептов |
| `GET /recipes/:id` | Полное описание рецепта |

Остальные генерационные и skill routes смотрите в соответствующих service-модулях
и тестах. `server.js` сохраняет совместимый префикс `/v4/`: например,
`/v4/recipes` и `/recipes` обращаются к одному обработчику.
Не меняйте wire contract по описанию в старом пилоте. Например,
диалог не передаёт выделение/отчёт проверки автоматически; у навыка свой цикл
контекста и отмены.

## Код, runtime, данные и знания

- Git checkout содержит исходники. `npm ci` устанавливает зависимости,
  а `npm start` запускает `server.js`; это не полная установка приложения.
- Portable-поставка содержит код Proxy, Node, минимальный Apollo runtime и seed.
  Личный checkout автора и его установленный skill не требуются.
- Активный пакет данных имеет `dataId` и привязан к совместимому `runtimeId`.
  Установленные версии и предыдущий пакет хранятся отдельно от кода.
- Git-канал обновляет контрактные данные и сохраняет текущие локальные знания.
  Публикация knowledge, обновление кода и обновление контрактов — разные цепочки.
- История, авторизация и пользовательские настройки не являются данными контракта.

В macOS установленный код находится в
`~/Library/Application Support/ApolloProxyControl/proxy`, данные — в соседней
`data-releases/`, история — в `history/` и `generation/`. Для своей разработки
используйте отдельный `APOLLO_STATE_ROOT`; не подменяйте файлы рабочей установки.

Важно: исходный [`scripts/git-data-cli.js`](../scripts/git-data-cli.js)
поставляется в совместимую установку под именем `scripts/data-release-cli.js`.
Совпадение имени с checkout не означает совпадение реализации. Порядок работы:
[git-data-update.md](git-data-update.md). Установка/восстановление:
[DELEGATION.md](../macos-app/DELEGATION.md).

## Dev-запуск

Для самостоятельного сервера сначала нужны совместимые runtime/seed и знания.
Не копируйте чужой `.env`. Из checkout Proxy пример с собственной установленной
portable-поставкой:

```bash
APOLLO_USER_PROXY="$HOME/Library/Application Support/ApolloProxyControl/proxy"
APOLLO_STATE_ROOT="$HOME/.apollo-dev/feature" \
APOLLO_CLI_PROVIDER=codex \
PORT=3001 \
node scripts/git-data-cli.js run \
  --store "$HOME/.apollo-dev/feature/data-releases" \
  --seed "$APOLLO_USER_PROXY/runtime/seed" \
  --runtime "$APOLLO_USER_PROXY/runtime/apollo"
```

Предварительно завершите только свой idle miniapp и проверьте свободный порт.
Пример запускает код текущего checkout с принятым runtime, но не собирает новый
runtime и берёт seed, а не обязательно последний активный пакет миниаппа.
Зафиксируйте полученные versions/dataId. Если меняется сам runtime, подготовьте
соответствующую совместимую пару вместо использования старой поставки.
После теста остановите dev-процесс и верните свою обычную установку.

Плагин должен обращаться к вашему серверу. Сейчас адрес Apollo и разрешённый
домен manifest рассчитаны на localhost:3001; другой PORT требует dev-клиента.
`CODEX_WORKSPACE` — папка запросов выбранной установки, а не обязательная
папка `workplace` владельца. Настраивайте её через штатный portable flow.

## Проверки и передача

Запустите `npm ci`, затем релевантные тесты из `test/`. Например, проверки CLI:

```bash
TMPDIR=/private/tmp node --test test/cli-agent.test.js
```

На Linux оставьте системный TMPDIR. Полный `npm test` использует принятые Apollo,
DS и knowledge inputs; запишите фактические корни. `DESIGN_SYSTEM_AB_ROOT`
и `DS_AI_HUB_ROOT` относятся к тестам, `CODEX_DESIGN_SYSTEM` и `CODEX_DS_AI_HUB` —
к серверным знаниям. Отсутствующий вход не исправляется отключением проверки.
Fake-тесты не доказывают доступность реальной модели, аккаунта или Figma.

Перед полным gate отдельно закрепите `APOLLO_SKILL_SOURCE_ROOT`: это источник
legacy `apollo-design-validator`, а `APOLLO_PROJECT_ROOT` его не задаёт.
Для текущего checkout допустим собственный tracked root
`codex-workspace/.agents/skills/apollo-design-validator`; запишите его полный
путь, 11 файлов и checksum до/после. Если источник совпадает с target, pretest
проверяет его на месте. Явный отсутствующий или некорректный источник отклоняется
до изменения target; без override сохраняется прежний поиск источника.

Для изменений miniapp нужны релевантные native-тесты и сборка macOS, для API —
совместимость плагина и сервера. Передавайте связанную пару SHA, dataId и порядок
обновления. Политика ревью: [CONTRIBUTING.md](../CONTRIBUTING.md).
Техническая справка и исторические пилоты остаются в [README](../README.md);
их фиксированные revision/числа не являются текущим каталогом возможностей.

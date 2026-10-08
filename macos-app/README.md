# ApolloProxyControl (приложение в строке меню macOS)

Мини-приложение для дизайнеров: запуск/остановка `apollo-proxy` без VS Code и терминала.
Сборка включает endpoint `POST /v1/validate/codex`, асинхронные endpoints
Apollo v2 и Apollo v3, версионированный `apollo-design-validator`, его Codex
output schema и read-only knowledge snapshot. Apollo v3 отправляет через
`POST /v1/analyze/codex/runs` компактный WIP-отчёт кастомизаций без полного
snapshot.

Для Apollo v4 build script дополнительно включает локальный unpublished
contract release CorporateContent + Button + Spinner + Amount + AmountStyles, если предварительно выполнен `npm run v4:release:pilot`
в Apollo-v3. Можно указать `APOLLO_V4_RELEASE_ROOT`. Пакет содержит главные manual с facts/dependency sources, производный compiled cache, полный dependency index и pinned runtime profile 0.4.0;
GET `/v2/contracts`, пакетный POST `/v2/contracts/resolve` по ключам выделения и POST
`/v2/contracts/explain` не используют legacy knowledge. Старую установленную
`.app` требуется пересобрать. Новая локальная ad-hoc сборка создана, подпись и
встроенный release проверены. Сервер предыдущей сборки (профиль 0.1.0) вызвал настоящий Codex
на synthetic snapshot; desktop launcher и полный Figma run пока не проверены.

## Что умеет

- Компактное меню: одна команда запуска/остановки, доступное обновление знаний,
  проверка обновлений, «О прокси…» и выход. Вход показывается в меню, когда он нужен.
- Немодальное окно «О прокси» содержит версию и build, полный адрес сервера,
  источник/версию знаний и source commits, откат, конфигурацию, журнал и папку.
- В окне можно выбрать Codex или Claude. Выбор сохраняется локально в
  `APOLLO_CLI_PROVIDER` и применяется после перезапуска proxy. Смена агента
  недоступна во время активного запроса.
- Claude использует установленный пользователем официальный Claude Code CLI
  версии 2.1.248+. Поиск: `CLAUDE_BIN`, `~/.local/bin/claude`, Homebrew, PATH.
  Кнопка входа открывает `claude auth login` в Terminal, чтобы работал и
  браузерный вход, и ручной ввод кода. Miniapp проверяет `claude auth status`
  и показывает результат; токены и файлы учётной записи не читает.
- При отсутствии CLI доступна ссылка на официальную инструкцию установки.
  `CLAUDE_CONFIG_DIR` позволяет выбрать отдельную конфигурацию аккаунта;
  `CLAUDE_MODEL` задаёт модель только для Claude. CLI устанавливается отдельно.
- `Запустить прокси` / `Остановить прокси` из строки меню.
- При выходе приложение дожидается остановки своих дочерних процессов;
  после трёх секунд ожидания зависший процесс получает `SIGKILL`. Прокси также
  отслеживает закрытие канала с приложением и освобождает порт после Force Quit.
- Явный `--start-proxy` для автоматического локального тестового цикла: после
  успешной проверки Codex приложение запускает proxy без клика по меню.
- Статус авторизации выбранного агента и действия входа в окне «О прокси».
- Для Codex кнопка входа запускает официальный browser flow `codex login`.
- Кнопка проверки входа использует `codex login status` или `claude auth status`.
- Проверка доступности `GET /health`.
- Изменение `APOLLO_AGENT_URL` прямо в miniapp без пересборки `.app`.
- Переключение источника Apollo v3 между `ds-ai-hub` и `design-system_ab` с
  автоматическим перезапуском proxy.
- Независимый от On/Off knowledge updater: launch check, проверка каждые два
  часа, `Обновить знания`, `Откатить знания` и current/previous/seed recovery.
- Индикатор справа от `AP:On`: зелёный дот при нормальной работе и после обновления
  знаний, жёлтый при доступном обновлении, красный при ошибке. Проверка, загрузка
  и валидация знаний показывают маленький спиннер. При `AP:Off` индикатор скрыт;
  подсказка и VoiceOver называют текущее состояние.
- Просмотр и редактирование `.env`.
- Просмотр `proxy.log`.
- Автоматическая установка встроенного прокси в:
  `~/Library/Application Support/ApolloProxyControl/proxy`
- Запуск через встроенный `node`, который вшивается в `.app` при сборке.
- Запуск локального Codex CLI из `ChatGPT.app` или пути `CODEX_BIN`.

## Требования

- macOS 13+
- На машине сборщика должен быть установлен Node.js.
- На машине тестировщика Node.js не нужен: runtime вшивается в `.app`.
- Для Apple Silicon и Intel используется один universal bundle.

## Сборка `.app`

Из корня `DS-AB-Plugin`:

```bash
./services/apollo-proxy/macos-app/scripts/build-app.sh
```

При сборке из изолированных worktree явно передайте оба источника знаний:

```bash
DS_AI_HUB_ROOT="/absolute/path/to/ds-ai-hub" \
DESIGN_SYSTEM_AB_ROOT="/absolute/path/to/design-system_ab" \
./macos-app/scripts/build-app.sh
```

Сборщик использует эти же пути для human knowledge, Apollo rules, crosswalk и
индексированных contract artifacts. Это исключает незаметную упаковку старых
данных из основного checkout во время проверки изменений из worktree.

Перед первой сборкой на машине должен быть принят Xcode license:

```bash
sudo xcodebuild -license
```

Эта команда делает локальную self-contained-сборку. Если `CODESIGN_IDENTITY` не задан,
bundle будет подписан ad-hoc и годится только для проверки на машине сборщика.

Shareable-сборка для передачи пользователям:

```bash
CODESIGN_IDENTITY="Developer ID Application: <Team Name> (<TEAMID>)" \
NOTARY_KEYCHAIN_PROFILE="apollo-proxy-notary" \
REQUIRE_NOTARIZATION=1 \
./services/apollo-proxy/macos-app/scripts/build-app.sh
```

Где `apollo-proxy-notary` - профиль, заранее созданный через `xcrun notarytool store-credentials`.

Сборка автоматически делает bundle self-contained:

- собирает universal launcher (`arm64` + `x86_64`);
- по умолчанию не копирует общий `.env` в app bundle;
- копирует системный `node` в app bundle;
- подписывает весь `.app` после упаковки ресурсов;
- при `NOTARY_KEYCHAIN_PROFILE` отправляет архив на notarization, stapling и перепаковывает zip;
- вшивает build marker, чтобы при обновлении `.app` встроенный proxy переустанавливался у пользователя.
- добавляет data-only проекцию `ds-ai-hub` и компактный Apollo/pattern/redpolicy
  snapshot из `design-system_ab` как аварийный seed; новые версии приходят
  отдельно от `.app` по HTTPS и не требуют системного `npm install`;
- по умолчанию вшивает stable descriptor
  `https://raw.githubusercontent.com/Ackedze/design-system_ab/main/apollo/knowledge/channels/stable.json`;
  другой URL можно задать сборочной переменной `KNOWLEDGE_DESCRIPTOR_URL`;
- добавляет все индексированные component contract packages, копируя только
  объявленные artifacts и проверяя полноту относительно
  `componentContractIndex.json`;
- синхронизирует канонический skill из Apollo v2, а runtime проверяет его версию
  и checksum перед каждой проверкой;
- создаёт zip-архив для передачи участникам тестирования.

Готовое приложение:

```bash
services/apollo-proxy/macos-app/dist/ApolloProxyControl.app
```

Архив для передачи:

```bash
services/apollo-proxy/macos-app/dist/ApolloProxyControl-macOS.zip
```

Рабочая сборка создаётся только в `dist/`. Bundle внутри `Sources/` запрещён и не должен появляться в репозитории.

## Проверка новых знаний перед Figma-тестом

Изменение Predicate-правил больше не требует пересборки `.app`. После публикации
нового knowledge release:

1. запусти ApolloProxyControl и дождись `Доступно обновление знаний` либо вызови
   `Проверить обновление знаний`;
2. выбери `Обновить знания` и дождись состояния `Знания обновлены`;
3. в меню или `GET /health` сверь `contentVersion` и source commits с release;
4. выполни smoke-test `POST /v1/validate/predicates` с известным componentKey и
   убедись, что нужные `ruleId` присутствуют в `validation.rules`;
5. только затем запускай ручной Figma-тест.

Текущий аудит не прерывается: приложение ждёт освобождения proxy и применяет
новую версию со следующего запроса. Для аварийной проверки доступно действие
`Откатить знания`, меняющее местами валидные `current` и `previous`.

## Диагностика проблем запуска

Если `proxy.log` содержит `Port 3001 is already in use on 127.0.0.1`, проверьте
слушающий процесс: `lsof -nP -iTCP:3001 -sTCP:LISTEN`. В старых сборках Node мог
пережить закрытие приложения. Исправленный launcher передаёт серверу
`APOLLO_PROXY_MANAGED=1` и сохраняет отдельный stdin pipe: EOF при выходе родителя
останавливает HTTP-сервер, с пределом ожидания активных запросов две секунды.
Общий `applicationWillTerminate` закрывает канал, останавливает proxy и Codex
authorization process и ждёт их завершения. Обычный `node server.js` / `npm start`
не зависит от stdin. Уже запущенный процесс старой версии не получает это
исправление автоматически; требуется новая локальная сборка приложения.

Регрессионная проверка из корня `services/apollo-proxy`:

```bash
node --test test/proxy-lifecycle.test.js
```

Тесты проверяют реальный server entrypoint и освобождение порта при EOF,
SIGTERM/SIGINT, повторный запуск, незавершённый HTTP-запрос и независимость CLI
от stdin. На macOS дополнительно компилируется harness с тем же Swift helper:
обычный выход, SIGKILL родительского приложения и принудительная остановка
дочернего процесса, игнорирующего SIGTERM.

Если пользователь видит системное окно `Не удается открыть программу "ApolloProxyControl"`,
сначала проверьте, какой именно артефакт был передан:

- передавать нужно только `macos-app/dist/ApolloProxyControl-macOS.zip`;
- нельзя отправлять `.app`, собранный вручную или взятый из `Sources/`;
- после сборки запустите:

```bash
./services/apollo-proxy/macos-app/scripts/diagnose-app.sh
```

Ключевые строки в отчете:

- `codesign verify` должен проходить без ошибок;
- `Signature=adhoc` означает, что архив не является полноценной shareable-сборкой;
- `gatekeeper assessment` должен быть `accepted` для бесшовного запуска на чужих Mac;
- `launcher architecture` и `node architecture` должны показывать universal binary с `x86_64` и `arm64`.

Если ошибка повторяется уже на notarized-сборке, попросите пользователя прислать:

```bash
sw_vers
uname -m
xattr -lr /path/to/ApolloProxyControl.app | head -50
codesign --verify --deep --strict --verbose=4 /path/to/ApolloProxyControl.app
spctl --assess --type execute --verbose=4 /path/to/ApolloProxyControl.app
```

Чтобы намеренно собрать внутренний архив со старой общей конфигурацией, нужно
явно задать `EMBED_PROXY_ENV=1`. Такой архив может содержать секреты и не должен
использоваться для обычной раздачи дизайнерам.

## Первичный запуск у пользователя

1. Передавать тестировщикам именно `ApolloProxyControl-macOS.zip`, а не голую `.app` директорию.
2. На машине тестировщика распаковать архив в Finder.
3. Переместить `ApolloProxyControl.app` в `/Applications`.
4. Если macOS блокирует запуск ad-hoc или не notarized сборки, снять quarantine flag и открыть приложение:

```bash
xattr -dr com.apple.quarantine /Applications/ApolloProxyControl.app
chmod +x /Applications/ApolloProxyControl.app/Contents/MacOS/ApolloProxyControl
open /Applications/ApolloProxyControl.app
```

5. При необходимости нажать `Set Apollo URL...` и сохранить адрес Apollo прямо в меню приложения.
6. Проверить строку `Codex`. Если показано `Authorization required`, нажать
   `Authorize Codex...` и завершить вход через браузер.
7. Дождаться `Codex: Authorized via ChatGPT`.
8. Нажать `Start Proxy`.
9. В строке `Knowledge` проверить активный источник. По умолчанию используется
   `ds-ai-hub`; пункт `Switch to design-system_ab...` позволяет вернуться к
   прежним contract packages и затем переключиться обратно.
10. Если нужно проверить или поменять остальные параметры, использовать `Open .env`.

Для локального автоматизированного прогона ту же сборку можно открыть так:

```bash
open /Applications/ApolloProxyControl.app --args --start-proxy
```

Без флага поведение для дизайнера не меняется: приложение открывается в
состоянии `Off`, запуск выполняется через `Start Proxy`.

## Что важно по безопасности

- По умолчанию shareable-сборка не вшивает `services/apollo-proxy/.env` и создаёт
  пользовательский конфиг из `.env.example` при первом запуске.
- Режим `EMBED_PROXY_ENV=1` вшивает `.env`, включая секреты, и предназначен
  только для контролируемой внутренней диагностики.
- ApolloProxyControl не читает и не сохраняет токены Codex: ими управляет сам
  Codex CLI через стандартное локальное хранилище пользователя.
- На каждом Mac встроенный proxy раскладывается в `~/Library/Application Support/ApolloProxyControl/proxy`.
- Пользовательское значение `APOLLO_AGENT_URL`, заданное через miniapp, хранится локально в
  `~/Library/Application Support/ApolloProxyControl/user-overrides.env`
  и повторно применяется после обновления `.app`.
- При выдаче новой версии `.app` встроенный proxy автоматически переустановится при первом запуске.
- Ad-hoc подпись не заменяет Developer ID notarization. Для передачи через интернет, Telegram или мессенджеры
  используйте Developer ID подпись и notarization.

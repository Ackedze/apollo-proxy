# ApolloProxyControl (приложение в строке меню macOS)

Мини-приложение для дизайнеров: запуск/остановка `apollo-proxy` без VS Code и терминала.
Сборка включает endpoint `POST /v1/validate/codex`, асинхронные endpoints
Apollo v2 и Apollo v3, версионированный `apollo-design-validator`, его Codex
output schema и read-only knowledge snapshot. Apollo v3 отправляет через
`POST /v1/analyze/codex/runs` компактный WIP-отчёт кастомизаций без полного
snapshot.

## Что умеет

- `Start Proxy` / `Stop Proxy` из строки меню.
- Явный `--start-proxy` для автоматического локального тестового цикла: после
  успешной проверки Codex приложение запускает proxy без клика по меню.
- Статус авторизации Codex: `Checking`, `Authorization required`, `Authorized`.
- `Authorize Codex...` запускает официальный browser flow `codex login`.
- `Check Codex Access` проверяет сессию через `codex login status`.
- Проверка доступности `GET /health`.
- Изменение `APOLLO_AGENT_URL` прямо в miniapp без пересборки `.app`.
- Переключение источника Apollo v3 между `ds-ai-hub` и `design-system_ab` с
  автоматическим перезапуском proxy.
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
- добавляет `ds-ai-hub` и компактный Apollo/pattern/redpolicy knowledge snapshot из `design-system_ab`.
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

## Диагностика проблем запуска

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

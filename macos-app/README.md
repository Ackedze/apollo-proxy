# ApolloProxyControl (приложение в строке меню macOS)

Мини-приложение для дизайнеров: запуск/остановка `apollo-proxy` без VS Code и терминала.

## Что умеет

- `Start Proxy` / `Stop Proxy` из строки меню.
- Проверка доступности `GET /health`.
- Изменение `APOLLO_AGENT_URL` прямо в miniapp без пересборки `.app`.
- Просмотр и редактирование `.env`.
- Просмотр `proxy.log`.
- Автоматическая установка встроенного прокси в:
  `~/Library/Application Support/ApolloProxyControl/proxy`
- Запуск через встроенный `node`, который вшивается в `.app` при сборке.

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
- копирует `services/apollo-proxy/.env` в app bundle;
- копирует системный `node` в app bundle;
- подписывает весь `.app` после упаковки ресурсов;
- при `NOTARY_KEYCHAIN_PROFILE` отправляет архив на notarization, stapling и перепаковывает zip;
- вшивает build marker, чтобы при обновлении `.app` встроенный proxy переустанавливался у пользователя.
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

## Первичный запуск у пользователя

1. Передавать тестировщикам именно `ApolloProxyControl-macOS.zip`, а не голую `.app` директорию.
2. На машине тестировщика распаковать архив в Finder.
3. Запустить `ApolloProxyControl.app`.
4. При необходимости нажать `Set Apollo URL...` и сохранить адрес Apollo прямо в меню приложения.
5. Нажать `Start Proxy`.
6. Если нужно проверить или поменять остальные параметры, использовать `Open .env`.

## Что важно по безопасности

- В shareable-сборку теперь вшивается `services/apollo-proxy/.env`, включая секреты.
- Такой `.app` нужно передавать только участникам тестирования, которым разрешён доступ к этим секретам.
- На каждом Mac встроенный proxy раскладывается в `~/Library/Application Support/ApolloProxyControl/proxy`.
- Пользовательское значение `APOLLO_AGENT_URL`, заданное через miniapp, хранится локально в
  `~/Library/Application Support/ApolloProxyControl/user-overrides.env`
  и повторно применяется после обновления `.app`.
- При выдаче новой версии `.app` встроенный proxy автоматически переустановится при первом запуске.
- Ad-hoc подпись не заменяет Developer ID notarization. Для передачи через интернет, Telegram или мессенджеры
  используйте Developer ID подпись и notarization.

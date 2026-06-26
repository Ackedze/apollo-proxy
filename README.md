# apollo-proxy

Локальный Node.js-прокси для отправки Apollo agent report в корпоративного агента.

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
```

`APOLLO_AGENT_KEY` и `APOLLO_AGENT_INSECURE_TLS` имеют fallback на старые переменные `LANGFLOW_KEY` и `LANGFLOW_INSECURE_TLS`, чтобы можно было переиспользовать текущий локальный конфиг.

## Эндпоинты

- `GET /health` -> `{ ok: true }`
- `POST /analyze` -> `{ success, result }`

`POST /analyze` принимает строку, `{ text: "..." }` или `{ report: {...} }`. Apollo отправляет compact `*_agent.json` как `report`.

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

Важно: shareable `.app` вшивает `services/apollo-proxy/.env`, включая секреты.

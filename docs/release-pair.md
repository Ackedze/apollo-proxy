# Парный выпуск Proxy и данных

`npm run release:pair -- --config /absolute/release.json` собирает и проверяет
приложение и пакет данных. Он использует существующие `build-app.sh`,
`prepare-data-package.js`, `prepare-app-update.sh` и readers готового приложения.
По умолчанию удалённые изменения не выполняются.

Перед запуском General принимает неизменные источники, runtime, знания и навыки.
Один конфиг описывает одну пару и одну новую приватную папку результата.
Версия Proxy берётся из `proxyRoot/package.json`; скрипт версии не изменяет.
Пути разрешаются относительно файла конфигурации, symlink-корни запрещены.
Конфиг хранится вне `outputRoot`. Пароли и приватные ключи в него не включаются.

```json
{
  "schemaVersion": "apollo.paired-release.v1",
  "proxyRoot": "/accepted/workspace/services/apollo-proxy",
  "apolloRoot": "/accepted/workspace/projects/Apollo",
  "runtimeRoot": "/accepted/runtime",
  "baseRuntimeRoot": "/previous/runtime",
  "baseRelease": "/previous/bootstrap-store/versions/ACCEPTED_CONTENT_ID",
  "knowledgeRoot": "/accepted/knowledge/package",
  "skillsRoot": "/accepted/skills-source",
  "previousApp": "/previous/app/ApolloProxyControl.app",
  "previousData": "/previous/data/ACCEPTED_DATA_VERSION",
  "sparkleTools": "/accepted/sparkle/bin",
  "nodeSource": "/previous/app/ApolloProxyControl.app/Contents/Resources/runtime/bin/node",
  "outputRoot": "/private/releases/NEW_PAIR",
  "dataVersion": "1.4.32-data.20261106.1",
  "buildNumber": "20261106190000",
  "appRepository": "Ackedze/apollo-proxy",
  "dataRepository": "Ackedze/design-system_ab",
  "signingIdentity": "REPLACE_WITH_ACCEPTED_40_HEX_FINGERPRINT",
  "sparklePublicKey": "REPLACE_WITH_PREVIOUS_APP_PUBLIC_KEY",
  "sparkleAccount": "apollo-proxy",
  "previousAppReleaseId": 123456789,
  "priorChannels": {"1.4.31": "REPLACE_WITH_ACCEPTED_40_HEX_BLOB"},
  "expected": {
    "runtimeId": "REPLACE_WITH_ACCEPTED_64_HEX_RUNTIME_ID",
    "auditDataId": "REPLACE_WITH_ACCEPTED_64_HEX_V3_DATA_ID",
    "workflow": "direct-cli-mcp-v1",
    "skills": {
      "ab-generate-custom-landing": "0.6.0",
      "ab-audit-figma": "0.4.4",
      "figma-layer-name-hygiene": "0.2.0"
    }
  }
}
```

Это шаблон: pins и версии заменяются фактическими принятыми значениями.
`priorChannels` перечисляет все сохраняемые каналы, а `previousData` указывает
существующую папку предыдущего producer с индексом и pack, без догадок по имени.
Для неизменных данных отдельный парный выпуск не нужен: выпуск только приложения
с прежним совместимым каналом остаётся отдельным существующим процессом.

## Запуск и результат

```bash
# Только preflight: входы, toolchain, права GitHub, подписи и доступ к данным.
TMPDIR=/private/tmp npm run release:pair -- --config /absolute/release.json --preflight
# Локальная сборка и проверки, без публикации.
TMPDIR=/private/tmp npm run release:pair -- --config /absolute/release.json
# После разрешения владельца — продолжить ту же пару до публикации.
TMPDIR=/private/tmp npm run release:pair -- --config /absolute/release.json --publish
```

Нужны macOS, Node.js 22+, Swift/Xcode toolchain, установленный `gh` с правами
публикации и прежние Keychain identities. Preflight проверяет доступ к ним до
дорогой сборки; он не создаёт и не сбрасывает ключи. Используется существующий
профиль локальной подписи без нотариализации. На другом Mac первое открытие
может требовать ручного разрешения, как и у предыдущего приложения.
Sandbox-отказ доступа к macOS trust/Keychain требует штатного разрешения среды;
скрипт не обходит его и не ослабляет проверку подписи.

Порядок: preflight → сборка приложения и данных → подпись → локальные проверки
готового приложения → публикация данных → анонимная проверка архива и Range →
новый канал → миграция → откат/восстановление → приложение → публичный appcast
и архив → итоговые readback. Старые каналы сверяются по Git blob SHA.

`state.json` сохраняет pins входов и результатов, начало, конец и длительность
каждого этапа. Повтор того же конфига переиспользует завершённые этапы; смена
входов, состава файлов или готовых артефактов останавливает продолжение.
`failure-*.json` и логи сохраняют первую ошибку. SIGINT/SIGTERM останавливает
дочернюю группу процессов и запрещает следующие этапы.

Частичная локальная сборка сохраняется и требует отдельного разбора либо новой
папки выпуска. Скрипт не удаляет её автоматически. Неизвестный исход удалённой
записи сначала проверяется чтением по маркеру этого запуска, версии и хэшам.
Если подтверждения нет, повторная мутация запрещена. Аналогично неизвестный
исход миграции без forward-receipt требует разбора. Live lock не удаляется
автоматически; после аварийного завершения его владелец проверяется отдельно.

Тесты запускаются без изменения assertions в приватной структуре workspace,
где `src` указывает на готовый bundle. Это распространяется и на дочерний MCP.
Сравниваются объявленные в manifest файлы; число исходников, документов и
исполняемых файлов навыка различается. Аудит и генерация используют собственные
manifest. Длительность миграции берётся из реального таймера, объём — из
терминальных ответов и зашифрованного индекса; redirects не считаются payload.

Итог: `FINAL-HANDOFF.json` и `FINAL-SEAL.json`, затем одна приёмка General.
Скрипт не публикует плагин, не устанавливает приложение и не запускает Figma
или модель. Ручная приёмка остаётся владельцу.

Автоматические регрессии: `TMPDIR=/private/tmp node --test test/release-pair.test.js`.

# Полное обновление miniapp через Sparkle

Sparkle 2.10.1 закреплён в SwiftPM/Package.resolved. Обновляется весь `.app`:
native UI, bootstrap, Node, dependencies и embedded Proxy. Версия данных
независима. Одна проверка последовательно проверяет приложение и данные;
установка начинается только после действия пользователя.

При установке повторно проверяется busy/managed ownership, существующий
authenticated maintenance barrier закрывает вход новым запросам. Owned children
останавливаются штатным `applicationWillTerminate`. При отказе установки до
завершения приложения maintenance lease освобождается, старый Proxy продолжает
работать. При новом bundled build старый code-releases overlay не выбирается.
Перед заменой сохраняется одноразовое намерение восстановить только запущенный
управляемый Proxy. Новый miniapp забирает его при запуске: аргументы старого
процесса Sparkle не переносит. Выключенный или внешний Proxy не запускается;
отмена и ошибка подготовки очищают намерение и освобождают maintenance lease.
Штатное завершение цикла Sparkle после передачи установки не считается отменой:
намерение и lease сохраняются до завершения старого процесса.
Legacy JS CLI сохранён для сопровождения.

`.env`, credentials, история, data-releases, overrides и настройки остаются в
Application Support. Вложенные legacy `.local`, runtime/data/config и debug-runs
сохраняются установщиком bootstrap. SDK/личные знания не публикуются автоматически.

## Сборка и локальная подготовка выпуска

`macos-app/scripts/build-app.sh` принимает:

- `APOLLO_APP_BUILD_NUMBER` — возрастающий числовой CFBundleVersion, независимо
  от версии JS в package.json; по умолчанию UTC timestamp.
- `APOLLO_APPCAST_URL` — HTTPS appcast, например GitHub Releases asset URL.
- `APOLLO_SPARKLE_PUBLIC_KEY` — постоянный публичный EdDSA ключ выпуска.
- Если ключ явно не задан, сборка читает его из Keychain account `apollo-proxy`
  (можно переопределить `APOLLO_SPARKLE_KEY_ACCOUNT`) и использует стандартный
  appcast GitHub Releases. Приватный ключ не читается в shell и не экспортируется.
- Существующие runtime/seed/Node/signing/notary настройки; `APOLLO_APP_DIST_DIR`
  и `APOLLO_APP_WORK_DIR` задают изолированные output roots.

Feed URL и ключ задаются вместе. Без них локальный miniapp собирается, но честно
сообщает, что канал полного обновления ещё не настроен. Framework и его helpers
копируются с symlinks и подписываются изнутри наружу; executable имеет bundle
rpath. Выпуск использует постоянный бесплатный локальный сертификат приложения
и отдельную постоянную EdDSA подпись обновлений. Developer ID и notarization для этого профиля
не требуются; первый запуск на другом Mac может потребовать ручного разрешения.
Gatekeeper/distribution PASS без отдельной проверки не заявляется.

`build-app.sh` автоматически создаёт и повторно использует сертификат
`Apollo Proxy Publisher` в login Keychain. `app-signing.swift` выводит только
публичный fingerprint; приватный ключ остаётся в Keychain, временные материалы
создания удаляются. Доступ к подписанию разрешён системному `codesign`.
Постоянный сертификат сохраняет designated requirement между выпусками и доступ
приложения к собственному ключу данных. Ad-hoc подпись (`CODESIGN_IDENTITY=-`)
допустима для одноразового стенда, но меняет identity и не обеспечивает эту
преемственность. Не менять сертификат и bundle ID между рабочими выпусками.

Один раз создайте ключ официальным инструментом Sparkle:

```sh
bash macos-app/scripts/sparkle-key.sh init
```

Повторный запуск сохраняет существующий ключ. Он хранится в macOS Keychain;
не добавляйте его в Git, архив приложения или логи. Сохранность Keychain важна:
утрата ключа без Apple Developer ID потребует отдельного восстановления доверия
и ручной установки новой базовой сборки.

После подписания приложения подготовьте архив и appcast **локально**:

```sh
./macos-app/scripts/prepare-app-update.sh /path/ApolloProxyControl.app \
  /new/release-output https://github.com/OWNER/REPO/releases/download/TAG
```

Используется официальный Sparkle `sign_update`; ключ проверяется против
SUPublicEDKey. По умолчанию подпись берётся из Keychain; приватный файл не нужен.
Четвёртый аргумент с файлом ключа сохранён для изолированных старых стендов.
Tool создаёт zip, appcast.xml, release.json и PUBLISHING.txt,
ничего не загружает в GitHub/npm. Приватный ключ не входит в артефакты и Git.
После отдельного решения о выпуске загрузите архив и appcast в указанный
GitHub Release; проверьте, что SUFeedURL отдаёт нужный feed.

Локальная приёмка использует отдельные test app/state и loopback origin;
Для локального загрузчика разрешено только NSAllowsLocalNetworking; глобального
NSAllowsArbitraryLoads в рабочей сборке нет. Тесты во временной
папке не требуют доступа релонча к Desktop. Рабочая установка и порт3001 не
используются. Проверки fake lifecycle и фактическая Sparkle replace/relaunch
фиксируются раздельно. Публичный канал проверяется после отдельного разрешения
на публикацию; локальная проверка его не активирует.

Загрузчик Git/npm учитывает `HTTP_PROXY`, `HTTPS_PROXY` и `NO_PROXY` через
Undici. Sparkle получает appcast и архив через этот же загрузчик: небольшой
временный процесс на loopback использует те же настройки HTTP_PROXY/HTTPS_PROXY/
NO_PROXY, что и обновление данных. Feed и archive подключаются через официальные
SPUUpdaterDelegate hooks; байты архива не изменяются, EdDSA проверяет Sparkle.
Порт случайный, URL защищён случайным nonce, upstream ограничен HTTPS GitHub
Releases выбранного repository и официальными asset redirects. Процесс закрывается
вместе с приложением; он не зависит от запуска основной службы. Release notes
не загружаются отдельным native запросом. Настройки сети macOS не меняются.
Ошибка проверки обновления
показывается в About и жёлтым предупреждением при работающем Proxy; красный
индикатор остаётся для ошибки самой службы.

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
- Существующие runtime/seed/Node/signing/notary настройки; `APOLLO_APP_DIST_DIR`
  и `APOLLO_APP_WORK_DIR` задают изолированные output roots.

Feed URL и ключ задаются вместе. Без них локальный miniapp собирается, но честно
сообщает, что канал полного обновления ещё не настроен. Framework и его helpers
копируются с symlinks и подписываются изнутри наружу; executable имеет bundle
rpath. Для распространения нужны Developer ID и notarization. Ad-hoc сборка
допустима для локального теста и не означает Gatekeeper/distribution PASS.

После подписания приложения подготовьте архив и appcast **локально**:

```sh
./macos-app/scripts/prepare-app-update.sh /path/ApolloProxyControl.app \
  /new/release-output https://github.com/OWNER/REPO/releases/download/TAG \
  /private/path/eddsa-seed.key
```

Используется официальный Sparkle `sign_update`; ключ проверяется против
SUPublicEDKey. Tool создаёт zip, appcast.xml, release.json и PUBLISHING.txt,
ничего не загружает в GitHub/npm. Приватный ключ не входит в артефакты и Git.
После отдельного решения о выпуске загрузите архив и appcast в указанный
GitHub Release; проверьте, что SUFeedURL отдаёт нужный feed.

Локальная приёмка использует отдельные test app/state и loopback origin;
HTTP/ATS исключение разрешено только в private test harness. Тесты во временной
папке не требуют доступа релонча к Desktop. Рабочая установка и порт3001 не
используются. Проверки fake lifecycle и фактическая Sparkle replace/relaunch
фиксируются раздельно. Developer ID/notary и реальное production обновление
проверяются перед выпуском отдельно.

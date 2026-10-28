# Активация данных Apollo

Публичное приложение поставляется без контрактов и знаний. На первом запуске
дизайнер вводит корпоративный пароль. Приложение загружает зашифрованный npm-пакет,
расшифровывает его и проверяет полный release существующим runtime. Только после
успешной установки производный ключ сохраняется в macOS Keychain. Пароль не
сохраняется в `.env`, истории, настройках или журнале.

## Публичная поставка

- Миниапп и appcast: GitHub Releases `Ackedze/apollo-proxy`; подпись Sparkle EdDSA.
- Git-индекс: `design-system_ab/main/apollo/channels/stable/data-packages/current.json`.
- `apollo.git-data-index.v3`: runtimeId, публичные параметры активации и точный
  npm reference с name/version/bytes/sha512/dataId. Здесь dataId — identity полного
  release, содержащего contracts, knowledge и skills.
- npm wrapper содержит только metadata-only `package.json`, `encryption.json`
  и `payload.enc`. Незашифрованные `.tgz`, temporary staging, source checkout,
  SDK, credentials и пользовательские файлы публиковать нельзя.
- Получение пакета не требует npm CLI или GitHub-аккаунта. `npm install` и scripts
  не запускаются. Зашифрованный файл публичен; для чтения нужен пароль.

Формат: AES-256-GCM, случайный nonce для каждого payload, keyId/contentVersion в
AAD. Ключ выводится из пароля scrypt N=131072,r=8,p=1 с постоянной случайной salt
канала. Допустимые параметры строго ограничены до KDF. Проверка пароля использует
отдельный authenticated ciphertext. Ключ не входит в приложение или индекс и
передаётся Node только через stdin pipe.

После активации обновление использует ключ из Keychain. Полный release
переключается одним pointer: контракты и знания обновляются и откатываются вместе.
Ошибки пароля, checksum, AEAD, структуры, runtime или reader сохраняют прежний
current. Временная расшифрованная копия удаляется; рабочие данные после активации
хранятся локально в Application Support и доступны пользователю этого Mac.

Чтение Keychain при запуске запрашивает режим без системного диалога.
Запись доступа создаёт само приложение после штатной активации. Не создавайте
её заранее сторонней утилитой: macOS может назначить другой ACL и запросить
системное подтверждение доступа, несмотря на совпадение designated requirement.
Рабочие выпуски подписываются постоянным локальным сертификатом
`Apollo Proxy Publisher`; смена ad-hoc identity при каждой сборке несовместима
с обещанием сохранения доступа после обновления. Настройка подписи автоматическая
на компьютере издателя, без Developer ID и настроек на компьютерах дизайнеров.

Общий пароль можно передать другому человеку. Индивидуальный отзыв доступа не
поддерживается; смена keyId требует новой активации. Уже полученные данные нельзя
отозвать удалённо. Это командный доступ без удалённого сервера авторизации.

## Подготовка владельцем

Один раз создайте случайный корпоративный пароль в Keychain:

```sh
swift macos-app/scripts/data-publisher.swift init
```

Keychain item: service `Apollo Proxy Data Publisher`, account `corporate-password`.
Владелец может посмотреть пароль в системном приложении «Связка ключей» и передать
его коллегам по внутреннему каналу. Не вставлять пароль в issues, Git или receipts.

Подготовьте принятый полный release существующим `build-data-release.js`, затем:

```sh
swift macos-app/scripts/data-publisher.swift password | \
  node scripts/build-protected-data-package.js \
    --release /accepted/release/package --runtime /accepted/runtime \
    --output /new/encrypted-output --version 1.4.3 \
    --activation /persistent/publisher/activation.json \
    --tarball-url https://github.com/Ackedze/apollo-proxy/releases/download/v1.4.3/apollo-data-1.4.3.tgz
```

Публичные параметры activation создаются один раз и сохраняются между выпусками.
Удаление activation.json создаст новую salt/keyId и потребует повторного ввода
пароля у команды. В output публикуются только указанный npm tarball и current.json;
исходный полный release содержит открытый текст и остаётся локальным.
Сначала загрузите и проверьте архив, затем обновите Git-индекс.

`build-app.sh` по умолчанию делает пустую поставку (`APOLLO_EMPTY_DATA_START=1`).
Значение 0 предназначено для прежних закрытых seed fixtures. Произвольные custom
descriptor URLs сохраняются; прежний shipped Git URL мигрирует на защищённый канал.

## Совместимость

Git v1/v2 и прежние full-release URL продолжают читаться для существующих
установок. Новая публичная поставка использует v3; прежний v1/v2 канал не
переключается автоматически. Обновление приложения и активация данных независимы.
Авторизация Codex/Claude/Figma сохраняется отдельно и не заменяет корпоративный
пароль. Платные агентские вызовы для активации не нужны.

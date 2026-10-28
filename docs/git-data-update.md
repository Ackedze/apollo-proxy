# Обновление данных Apollo из Git

## Публичная поставка с активацией

Apollo Proxy 1.4.3 поддерживает `apollo.git-data-index.v3`: полный согласованный
release контрактов, знаний `ds-ai-hub` и skills внутри зашифрованного npm-пакета.
Публичный миниапп пустой; первый ввод корпоративного пароля активирует данные,
после чего ключ берётся из macOS Keychain. Формат, сборка и ограничения описаны в
[data-activation.md](data-activation.md). Защищённый канал имеет Git URL
`apollo/channels/stable/data-packages/current.json`; прежние v1/v2 входы
продолжают читаться. Подготовка локального пакета сама по себе его не публикует.

## npm-пакет за закреплённым Git-индексом

Новый `apollo.git-data-index.v2` использует тот же Git URL и commit pinning.
Он содержит `runtimeId` и `npm`: точные `name`, `version`, `tarballUrl`,
`integrity` (sha512 SRI), `bytes`, `dataId`. `latest` и диапазоны версий не
принимаются. Необязательный `skills` имеет прежние path/sha256/bytes и читается
из того же Git-коммита. Публикация индекса и npm registry — отдельные действия.

Подготовка настоящего npm tarball без публикации:

```sh
node scripts/build-npm-data-package.js --data /accepted/contracts \
  --runtime /accepted/runtime --output /new/package-output \
  --name @apollo/contracts --version 1.0.0 \
  --tarball-url https://registry.example.test/apollo-contracts-1.0.0.tgz
```

Сборщик вызывает `npm pack --ignore-scripts`. Внутри `package/package.json`
и `package/data/` — замкнутый набор переносимых manual/facts/compiled cache и
достижимых generation-ресурсов. Export `entry.archive` ZIP исключены; shared ZIP,
которые реально читаются generation, сохранены. Draft не становится Ready.

Получатель скачивает точный HTTPS tarball и проверяет размер, sha512, безопасные
tar entries, package name/version, отсутствие scripts/dependencies/bin, dataId,
runtime и зависимости actual reader. `npm install` и lifecycle scripts не
выполняются. Git-токен не передаётся на npm asset origin; отдельная авторизация
закрытого registry этим локальным профилем не реализована.

Контрактный npm-пакет соединяется с текущими локальными знаниями и skills штатным
assembler/store. Если индекс закрепляет новый skills catalog, используется он.
Новая knowledge Hub версия самим этим пакетом не доставляется. Переключение
указателя и offline rollback остаются согласованными, старые принятые версии
доступны текущим запросам. Повреждённый пакет оставляет прежний current.

Пределы ресурсов: npm tarball 256 МиБ, release 2 ГиБ суммарно, файл 128 МиБ,
inventory 20000 файлов, contract index 16 МиБ. Произвольного потолка количества
контрактов нет. Эти budgets покрывают текущую оценку 1000 контрактов; реальная
производительность такого набора требует отдельного измерения. Новый лексический
поиск/RAG здесь не реализуется.

## Совместимость с прежним форматом

Источник — `https://raw.githubusercontent.com/Ackedze/design-system_ab/main/apollo/data-packages/current.json`. Proxy читает текущий commit ветки, затем индекс и архив ровно из этого commit. При совпадении dataId скачивание архива не выполняется.

`scripts/git-data-cli.js` устанавливается как `scripts/data-release-cli.js` в
совместимую portable-поставку Proxy 1.4.0. Он сохраняет команды
ensure/status/check/update/rollback/run и прежний full-release режим для других
существующих URL. При установке готового приложения используйте переданную версию
с Git updater: наличие скрипта в Git не обновляет уже установленное приложение.
В исходниках prerequisite — `src/data-release`, `src/data-packages` и
`scripts/build-data-release.js`; не подменяйте их файлами из другой версии.

Прежний Git-индекс `apollo.git-data-index.v1`, runtimeId и snapshot с относительным path, bytes, sha256 и dataId продолжает читаться. Архив содержит только переносимые контрактные данные. Не помещать knowledge Hub, credentials, SDK или исполняемый код в data snapshot.

Клиент проверяет commit identity, размер и SHA архива, safe tar members, отсутствие ссылок, совместимость runtime и actual reader. Затем штатный сборщик соединяет новые contracts с **текущими локальными** knowledge, а штатный installer переключает один pointer. Перед install проверяется, что current не изменился за время скачивания. Архивирование исключает AppleDouble; исходные контрактные bytes сохраняются.

Настройка `APOLLO_DATA_DESCRIPTOR_URL` продолжает использоваться миниаппом; для Git это URL индекса, отдельного сервера/канала нет. Публичный Git не требует токена; необязательный `APOLLO_DATA_TOKEN` используется только при наличии отдельного read-доступа. Commit читается через стандартный Git HTTPS info/refs, файлы — с raw.githubusercontent.com по точному commit, до 100 MiB. GitHub REST API и установленный git не требуются. Нынешняя единица обновления — полный контрактный архив, около 5.6 MB.

В installed runtime скрипт использует соседний producer. Для проверки из main checkout можно явно задать `APOLLO_DATA_PRODUCER_ROOT` на принятую portable установку. Все state-changing команды сначала проходят существующую валидацию store/runtime. Настройки, история и авторизация вне пакета данных.

Локальная подготовка архива не означает активацию в работающем сервере. Финальная
проверка — actual API/reader после переключения и сохранность runtimeId и knowledge
hashes. Исторический пилот проверял 12 contracts с PaymentMaskedNumber r1 Draft,
rollback на 11 и повторное обновление на 12; это не требование к текущей revision
или числу контрактов. Сверяйте текущий набор с переданной поставкой. PMN format gap
не закрывается доставкой.

# Обновление данных Apollo из Git

Источник — `https://raw.githubusercontent.com/Ackedze/design-system_ab/main/apollo/data-packages/current.json`. Proxy читает текущий commit ветки, затем индекс и архив ровно из этого commit. При совпадении dataId скачивание архива не выполняется.

`scripts/git-data-cli.js` устанавливается как `scripts/data-release-cli.js` в существующий portable Proxy 1.4.0. Он сохраняет команды ensure/status/check/update/rollback/run и прежний full-release режим для других существующих URL. Современные `src/data-release`, `src/data-packages` и `scripts/build-data-release.js` берутся из принятой установленной поставки; обычный main checkout 1.3.1 пока не содержит эту prerequisite. Полную feature-ветку ради updater не сливаем.

Git-индекс имеет schema `apollo.git-data-index.v1`, runtimeId и snapshot с относительным path, bytes, sha256 и dataId. Архив содержит только переносимые контрактные данные. Не помещать knowledge Hub, credentials, SDK или исполняемый код в data snapshot.

Клиент проверяет commit identity, размер и SHA архива, safe tar members, отсутствие ссылок, совместимость runtime и actual reader. Затем штатный сборщик соединяет новые contracts с **текущими локальными** knowledge, а штатный installer переключает один pointer. Перед install проверяется, что current не изменился за время скачивания. Архивирование исключает AppleDouble; исходные контрактные bytes сохраняются.

Настройка `APOLLO_DATA_DESCRIPTOR_URL` продолжает использоваться миниаппом; для Git это URL индекса, отдельного сервера/канала нет. Публичный Git не требует токена; необязательный `APOLLO_DATA_TOKEN` используется только при наличии отдельного read-доступа. Commit читается через стандартный Git HTTPS info/refs, файлы — с raw.githubusercontent.com по точному commit, до 100 MiB. GitHub REST API и установленный git не требуются. Нынешняя единица обновления — полный контрактный архив, около 5.6 MB.

В installed runtime скрипт использует соседний producer. Для проверки из main checkout можно явно задать `APOLLO_DATA_PRODUCER_ROOT` на принятую portable установку. Все state-changing команды сначала проходят существующую валидацию store/runtime. Настройки, история и авторизация вне пакета данных.

Локальная подготовка архива не означает активацию в работающем сервере. Финальная проверка — actual API/reader после переключения: 12 contracts с PaymentMaskedNumber r1 Draft; rollback — 11; повторное обновление — 12. Engine runtimeId и knowledge hashes должны сохраниться. PMN format gap не закрывается доставкой.

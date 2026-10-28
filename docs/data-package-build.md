# Сборка npm-пакета данных

`data:prepare` — локальная утилита сборки, без агента и обращения к Figma.
Она объединяет существующие import/release/protected npm producers и проверяет
результат штатным загрузчиком. Приложение, установленный Proxy, Git-канал и
публикация при этом не меняются.

## Один раз настроить входы

Создайте личный JSON вне Git. Все пути разрешаются относительно этого файла;
папки `workplace` и установленного приложения не требуются.

```json
{
  "schemaVersion": "apollo.data-package-build.v1",
  "baseRelease": "./accepted/seed",
  "runtimeRoot": "./accepted/runtime",
  "designSystemRoot": "../design-system_ab",
  "activationFile": "./publisher/activation.json",
  "outputRoot": "./prepared",
  "tarballUrl": "https://github.com/OWNER/REPO/releases/download/DATA_TAG/apollo-data-{version}.tgz",
  "passwordCommand": ["swift", "/path/to/apollo-proxy/macos-app/scripts/data-publisher.swift", "password"]
}
```

`baseRelease` — принятый полный снимок данных с `manifest.json`, `contracts`,
`knowledge` и, если объявлены, `skills`. Он может быть извлечён из прежнего
принятого артефакта; работающий Proxy для этого не нужен.
`runtimeRoot` — проверенная переносимая сборка Apollo, а не произвольный checkout.
Если runtime меняется, укажите также `baseRuntimeRoot` для проверки старого
снимка. Утилита укажет `runtimeChanged: true`: перед доставкой такого пакета
потребуется совместимое обновление приложения/runtime.

`activationFile` содержит публичные параметры **существующей** активации.
Отсутствующий файл вызывает ошибку; новый ключ не создаётся. Команда
`passwordCommand` получает пароль из существующего Keychain издателя, передаёт
его внутри процесса и не помещает в argv, environment, отчёт или файл. Не
записывайте пароль литералом в эту команду. Без `passwordCommand` утилита читает
JSON `{"password":"…"}` из приватного stdin; это поддерживает CI/другой secret
store. Не помещайте пароль в shell history.

## Повседневная команда

```bash
npm run data:prepare -- --config /path/to/private-build.json --version 1.4.3-data.20261028.1
```

Утилита:

1. Проверяет baseline, runtime, canonical index, manual/facts и закреплённые ZIP.
2. Выбирает прежний состав по `contractId`; сопоставляет platform/component
   identity, обновляет изменившиеся контракты через существующий importer.
   Остальные записи, зависимости и mapping сохраняются. Устаревший mapping
   отклоняется штатным reader, автоматически не переписывается.
3. Собирает full release: контракты, знания и правила навыков. По умолчанию
   knowledge/skills берутся из baseline. Для их принятого обновления задаются
   `knowledgeRoot`/`skillsRoot`; знания предварительно готовятся существующим
   `knowledge:build`, runtime — `runtime:build-portable`. Нормы/факты утилита
   не придумывает; authoring и проверка контрактов остаются отдельной работой.
4. Шифрует данные прежним ключом, запускает настоящий `npm pack --ignore-scripts`
   и загружает архив штатным protected consumer в удаляемый временный store.
5. Оставляет только `.tgz`, кандидат `current.json` и `report.json` в папке
   `outputRoot/<version>`. Plaintext staging и дубли шифрованных файлов удаляются.

Повтор с теми же входами возвращает `UNCHANGED`, прежнюю версию и прежние байты;
пароль не запрашивается, новый архив не создаётся. Для изменённых данных нужна
новая явная npm-версия. Одновременные сборки в одном output блокируются lock-файлом.
Не удаляйте lock, пока сборщик работает.

В отчёте доступны contentVersion, runtimeId, обновлённые контракты и `excluded` —
позиции canonical index, ещё не входящие в baseline. Новые компоненты не
подключаются молча. Фиксированного лимита «36 контрактов» нет.
Текущий reader не поддерживает два контракта с одинаковым componentId, поэтому
desktop и mobile ButtonsGroup пока нельзя включать одновременно. BenefitsBlock
и PromoCard также не входят в текущую поставку; причина их прежнего исключения
не установлена. Добавление в поставку требует отдельного изменения состава.

`designSystemRoot` можно опустить для упаковки уже принятого полного снимка без
обновления контрактов. Данные frontend/SDK в профиль `checking-ask-figma-mcp`
не включаются. arui-private не читается и не упаковывается.

## После сборки

Проверенный кандидат ещё не опубликован. Публикуйте точный зашифрованный `.tgz`
отдельным действием, проверьте доступность и затем обновите соответствующий
совместимому runtime Git-индекс. Локальный `current.json` — кандидат, а
`last-build.json` — служебный кэш утилиты; не подменяйте ими рабочий канал
автоматически. Если серверное имя asset отличается от указанного в config,
исправьте config до сборки. Номер npm-пакета, версия данных и версия приложения
имеют разные назначения; сборка пакета данных не выпускает приложение.

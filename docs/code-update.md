# Обновление кода Proxy из Git

В меню AP пункт «Обновление кода прокси…» проверяет релиз и предлагает обновление
либо откат. Новый раздел настроек не добавляется. Применение требует завершить
активную работу. Ошибка проверки или загрузки оставляет текущую версию.

Это отдельная цепочка от обновления знаний/контрактов. Один доверенный источник:
`Ackedze/apollo-proxy`, `main`, `code-packages/current.json`. Ветка разрешается в
конкретный Git commit; индекс и архив скачиваются именно из этого commit.
Для закрытого репозитория поддержан `APOLLO_CODE_TOKEN` в существующей конфигурации.
Новый токен не требуется для публичного репозитория.

Версии JS-сервиса находятся в `~/Library/Application Support/ApolloProxyControl/code-releases/versions/<id>`.
Каждый пакет содержит только `server.js`, `src/`, `package.json` и необходимые
статические рецепты/CLI-данные и две используемые code schemas, с manifest/hash/bytes. Настройки, credentials,
история, token journal, знания, data-releases, runtime, Node и node_modules в
пакет не попадают. Рабочая папка и базовые asset/state roots остаются прежними.
Изменённая версия Node, зависимости или lockfile отклоняются как несовместимые;
`npm install` при обновлении не выполняется. Версия launcher должна совпадать.

Один раз текущий miniapp получает bootstrap: launcher и команды. Последующие
совместимые релизы JS не требуют замены `.app`. Нативный UI, авторизация CLI,
сам bootstrap, Node и зависимости этим механизмом не обновляются.

Код сначала проверяется и сохраняется как pending, без смены рабочей версии.
После managed restart отдельный supervisor запускает его с прежними состоянием
и зависимостями. `listen` + IPC ready и проверка `/health` с точным code id подтверждают старт; до фиксации указателя
новая версия не принимает рабочие запросы. При ошибке или 30-секундном timeout
старта запускается прежний код. Незавершённая попытка при следующем запуске
не повторяется автоматически. Завершённая версия остаётся в previous для отката.
Ошибка после подтверждённого старта остаётся обычной ошибкой процесса.

Локальный authenticated maintenance barrier проверяет активные HTTP-запросы,
навыки и генерацию и блокирует новые запросы до перезапуска. Нельзя обновить
отдельно запущенный сервер через miniapp. Откат использует локальную предыдущую
версию и доступен, даже если Git недоступен. Старые версии автоматически не удаляются.

## Подготовка релиза

Сначала проверить и закоммитить собственный код. Сборщик читает только указанный
commit, даже если в рабочем дереве есть другие изменения. Запускать тем же Node,
который входит в приложение; `--home` указывает совместимую базовую установку.

```sh
"/path/ApolloProxyControl.app/Contents/Resources/runtime/bin/node" scripts/build-code-release.js \
  --source /path/apollo-proxy --commit <full-source-commit> \
  --home "$HOME/Library/Application Support/ApolloProxyControl/proxy" \
  --version 1.4.1 --out /path/new-release
```

Результат: `new-release/code-packages/current.json` и
`new-release/code-packages/releases/<id>.tgz`, готовые для одного Git commit.
Индекс содержит явную совместимость, неизменный code id, source commit и
hash/bytes архива. Архив с существующим id не заменять другой сборкой.
Копирование этих двух файлов в доверенный репозиторий и push — отдельная
публикация после разрешения владельца. До публикации native check сообщает,
что пакет недоступен; рабочая версия продолжает работать.

CLI для сопровождения: bundled Node + `scripts/code-release-cli.js status|check|update|rollback`.
`update`/`rollback` подготавливают pending и возвращают `restartRequired`; managed
restart выполняет miniapp. CLI не убивает процессы самостоятельно.

Целевые проверки: `TMPDIR=/private/tmp node --test test/code-release*.test.js`.
Fake-проверки не обращаются к моделям/Figma: update/rollback, startup failure/
timeout/interrupted recovery, повреждённый/несовместимый пакет, Git commit pins,
idle barrier и сохранность состояния. UI использует стандартные macOS menu/alert
и проверенные варианты действий; полноценное интерактивное accessibility-тестирование отдельно.

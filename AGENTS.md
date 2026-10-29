# Apollo Proxy: инструкции агенту

- Начните с `README.md`, `docs/PROJECT_GUIDE.md`, `CONTRIBUTING.md` и применимых
  инструкций. Общий промпт для четырёх репозиториев хранится в Apollo:
  `docs/AGENT_START_PROMPT.md`.
- Proxy — отдельный локальный сервис. Figma native API и UI находятся в Apollo.
  Checkout, установленное приложение, runtime и пакет данных имеют разные версии.
  Проверяйте фактически выбранные корни и SHA; не используйте пути автора.
- Меняйте только область поручения. Сохраняйте API-совместимость, correlation,
  cancellation, source freshness, ownership и UNKNOWN/failed/passed.
  При общем source/build root нужен один writer; private output этого не заменяет.
- Не заменяйте код Proxy, portable runtime или данные файлами из другой версии.
  Обновление контрактов из Git не обновляет код; детали в `docs/git-data-update.md`.
- Проверки выбирайте по затронутому модулю в `test/`. Полный `npm test` требует
  принятых Apollo/DS/knowledge inputs. На macOS используйте `TMPDIR=/private/tmp`.
  Отсутствующие входы и известные отказы указывайте явно, не меняя guards или skip.
- Реальный агент, Figma и чужая установка не нужны fake-тестам. Не запускайте
  платные/внешние действия вне поручения. Не останавливайте активный чужой запрос.
- Внешние участники работают в своих ветках и PR; @Ackedze делает финальное
  ревью, merge и выпуск. Не меняйте branch protection и release metadata.
- Запрещено push-ить или публиковать `arui-private`, его копии, секреты,
  credentials, закрытые знания, реальные отчёты и историю пользователей.

Карта модулей, API, текущие функции и ограничения: `docs/PROJECT_GUIDE.md`.

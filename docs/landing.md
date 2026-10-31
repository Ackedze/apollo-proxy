# Лендинги в Apollo Proxy

Канонический навык: `design-system_ab/apollo/skills/ab-generate-custom-landing` 0.3.0.
Proxy читает его из совместимого установленного пакета данных; личный checkout или Python
не нужны. Официальный Figma workflow входит в portable runtime. Это отдельные входы:
новый код сам не добавляет навык в старый пакет. `GET /landing/status` сообщает версию и gaps.

Сценарий, сохранность и условия: [Apollo LANDING.md](https://github.com/Ackedze/apollo/blob/main/docs/LANDING.md).
Первый профиль: Desktop, Codex, собственный OAuth Figma MCP и существующий файл.

API: `/landing/chats` (GET/POST), `/landing/chats/:id` (GET), POST суффиксы
`messages`, `canvas`, `observation`, `cancel`, `failure`. Корреляция: chat ID, revision,
request ID, монотонный sequence. Native readback передаётся отдельным запросом.
История, spec, usage, источники и первая диагностика сохраняются в state root/landing.
После перезапуска незавершённый запуск не возобновляется автоматически.

Чтение данных ограничено закреплённым индексом JSON/Markdown; shell и произвольные файлы
недоступны агенту. Старые API генерации возвращают 410 без fallback. Публичные mappings,
контракты, проверка и «Спросить» сохраняются. Наличие readback не доказывает полное соответствие
DS: непроверенные визуальные/нормативные свойства остаются UNKNOWN; Ready=false.

Проверки: `node --test test/landing*.test.js test/skill-catalog.test.js
 test/portable-runtime.test.js test/portable-bundle.test.js test/data-packages.test.js
 test/frontend-authoring.test.js test/async-generation-health.test.js` (одной строкой).
Synthetic CLI и native bridge не заменяют ручную приёмку владельца.

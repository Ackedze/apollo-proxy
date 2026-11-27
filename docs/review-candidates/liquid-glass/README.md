# Liquid Glass — состав проверки по решению владельца

23 семейства по ключам: 22 безусловных и ResultScreen с условием. Удалённый `❌Switch` проверяется отдельным локальным правилом Apollo, без выдуманного ключа. Эти review-файлы не читаются runtime и не публикуют managed policy.

Решение владельца от 2026-11-27: все согласованные старые семейства отмечаются во всех сценариях миграции на Liquid Glass. Допустимость старых компонентов в прежних рекомендациях не создаёт исключений. Редкие макеты до iOS 26 разбираются индивидуально; автоматических исключений нет.

Все три поколения SexyOverlay временно исключены: в LG-аналоге обнаружены проблемы, поэтому переход сейчас не используется. Поиск исходных ID их наборов снят с задачи. Причина сохранена в `excludedFamilies` evidence.

ResultScreen: успешно прочитанный `👻 LiquidGlassEffect` имеет приоритет над записанным состоянием варианта (`valueSource: "instance-properties"`). Нет свойства — обновить компонент до актуальной версии и включить Liquid Glass; False — включить Liquid Glass; True — замечания нет. Ошибка чтения остаётся unknown. Это уточнение владельца заменяет прежнее предложение трактовать отсутствие свойства и записанный True как конфликт.

`❌Switch`: в библиотеке SelectionWrapper подтверждён вложенный INSTANCE с этим именем. Wrapper сохраняется; внутренний `.❌Switch` повторно не считается. При доступном источнике проверяется его имя, иначе имя экземпляра. Текущий компонент с другим именем источника не отмечается лишь из-за сохранённого имени экземпляра. Обнаружение по имени отмечается отдельно от проверки published key.

[Сверка Ackedze: свежие каталоги и все 36 состояний Result](https://github.com/Ackedze/apollo-proxy/pull/5#issuecomment-7215695925). Старые локальные catalog/index evidence сохранены с их датами; reviewer confirmation не выдаётся за новый экспорт. `allowLocalSupplement` сохранён для совместимости со старым индексом.

| Семейство | Область | Источник |
| --- | --- | --- |
| (n)Alert | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=64989-616) |
| (n)AlertMessage | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75413) |
| (n)AlertInput | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75536) |
| (n)AlertRating | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75697) |
| (n)AlertImage | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75942) |
| (n)Toast | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-76001) |
| (n)Keyboard | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=41974-7075) |
| (n)SegmentedControl | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-78424) |
| (n)SegmentedControlWrapper | всё семейство | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-78651) |
| NavigationBar / Default | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-266432) |
| NavigationBar / Modal | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-267494) |
| NavigationBar / MapHeader | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-268096) |
| NavigationBar / Template | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-268493) |
| TabBarV2 ABM | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=21128-11402) |
| TabBarV2 | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=15465-31462) |
| 🔁 (n)TabBar | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-320232) |
| (n)TabBar | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-28541) |
| (n)TabBar / ⚙ AM | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30163) |
| (n)TabBar / ⚙ ABM | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30267) |
| (n)TabBar / ⚙ Investments | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30347) |
| (n)SegmentedControl | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=12-203591) |
| (n)Toggle | всё семейство | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=5007-191886) |
| ResultScreen | состояние экземпляра | [Figma](https://www.figma.com/design/S1MywyqXOFripEsvMJ1zrz?node-id=110611-33476) |

Файлы: `liquid-glass.candidate.json` — вход compiler; `liquid-glass.evidence.json` — происхождение и решения; `selection-wrapper-switch.evidence.json` — read-only наблюдение Switch.

Публикация, включение в штатный пакет данных, установка и полевая приёмка выполняются отдельно. В этой задаче они не запускались.

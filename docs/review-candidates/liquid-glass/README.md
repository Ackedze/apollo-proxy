# Liquid Glass — кандидат для согласования

Материалы для согласования по запросу Ackedze в Proxy PR #5. Managed policy не опубликована и не активирована. Эти файлы не читаются runtime и не включены в штатный пакет данных.

`liquid-glass.candidate.json` — точный состав dev-реестра в формате `compileLegacyComponents`; `liquid-glass.evidence.json` — минимальные ключи, ссылки, условия и открытые вопросы без выгрузок структуры компонентов.

27 семейств: 10 совпадают по ключу/файлу с локальными iOS-каталогами, 17 пока подтверждены только исходным handoff. Каталоги подтверждают идентичность, но сами по себе не доказывают необходимость миграции.

26 семейств объявлены целиком старыми в исходном поручении. ResultScreen добавлен позднее: False или подтверждённое отсутствие свойства; True пропускается, непрочитанные данные остаются unknown. Сохранены 36 наблюдений вариантов (18 False / 18 True), не выполнена новая проверка Figma.

| Семейство | Проверка ключа | Условие | Источник |
| --- | --- | --- | --- |
| (n)Alert | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=64989-616) |
| (n)AlertMessage | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75413) |
| (n)AlertInput | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75536) |
| (n)AlertRating | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75697) |
| (n)AlertImage | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-75942) |
| (n)Toast | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-76001) |
| (n)Keyboard | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=41974-7075) |
| (n)SegmentedControl | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-78424) |
| (n)SegmentedControlWrapper | каталог | всё семейство — на согласование | [Figma](https://www.figma.com/design/wF80Fbm8qD9Htohy2tC6am?node-id=2181-78651) |
| NavigationBar / Default | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-266432) |
| NavigationBar / Modal | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-267494) |
| NavigationBar / MapHeader | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-268096) |
| NavigationBar / Template | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-268493) |
| TabBarV2 ABM | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=21128-11402) |
| TabBarV2 | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=15465-31462) |
| 🔁 (n)TabBar | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=13-320232) |
| (n)TabBar | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-28541) |
| (n)TabBar / ⚙ AM | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30163) |
| (n)TabBar / ⚙ ABM | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30267) |
| (n)TabBar / ⚙ Investments | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=16754-30347) |
| (n)SegmentedControl | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=12-203591) |
| (n)Toggle | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/JuM4aiP9jh5L06qCzPcTfI?node-id=5007-191886) |
| ❌Switch | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/12MXAS7FXcL9ZewkidiUZq?node-id=44-7667) |
| SexyOverlay | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/ge9dK3r7Rk31bhXUUpmsxd) |
| ❌ SexyOverlay | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/ge9dK3r7Rk31bhXUUpmsxd) |
| 🔄 SexyOverlay | handoff, нужна сверка | всё семейство — на согласование | [Figma](https://www.figma.com/design/ge9dK3r7Rk31bhXUUpmsxd) |
| ResultScreen | каталог | False / отсутствие свойства | [Figma](https://www.figma.com/design/S1MywyqXOFripEsvMJ1zrz?node-id=110611-33476) |

Перед публикацией: сверить 17 дополнений и три отсутствующих set ID, подтвердить актуальные варианты ResultScreen и нормативное основание состава; затем отдельно согласовать managed policy, поставку и установку. Отсутствующие данные не выдуманы.

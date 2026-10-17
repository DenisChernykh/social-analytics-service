# Проверка выпуска 0.3.0

17 октября 2026. Production deploy разрешён владельцем; проверка выполнялась
GET, SELECT и GraphQL queries. Ручной сбор, изменение расписания, искусственные
ошибки и включение invocation logs не использовались.

- `pre-release.json`: активная версия, bundle, bindings, счётчики и последние
  задания перед выпуском.
- `post-release.json`: версия и bundle сразу после deploy.
- `natural-progress.json`: задания и receipts после естественных alarms.
- `pre-preservation.json` и `post-preservation.json`: хеши 12 закреплённых
  исторических снимков, истории политики и настроек расписания.
- `api-read.json`: production GET, авторизация и точное совпадение OpenAPI
  с проверенным контрактом MCP.
- `metrics.json`: namespace/version-scoped DO invocations, namespace-scoped
  periodic metrics и Cron по времени выпуска. Последние минуты могут ещё
  поступать в аналитику; пустая выборка не доказывает отсутствие вызовов.
- `metric-definitions.json`: поля и единицы измерения из текущей GraphQL schema.

Повторное чтение без production mutations:

```sh
node docs/durable-collection-release/read.mjs tmp/durable-collection-release/current.json
node docs/collection-phase1-release/preservation-read.mjs tmp/durable-collection-release/preservation.json docs/durable-collection-release/pre-preservation.json
node docs/durable-collection-release/api-read.mjs tmp/durable-collection-release/api-read.json
node docs/durable-collection-release/metrics.mjs tmp/durable-collection-release/metrics.json tmp/durable-collection-release/current.json
```

Скрипты используют существующую локальную авторизацию только в памяти.
В JSON сохраняются разрешённые bindings и имена secrets, без их значений,
OAuth данных, cursors и текстов комментариев. Скачанный Worker остаётся
в игнорируемой `tmp/` и сверяется по SHA256.

`sum.cpuTime` в DO periodic dataset — микросекунды, сумма по periodic samples;
это не CPU отдельного alarm. `cpuTimeUs` Cron тоже измеряется в микросекундах.
Поля проверены через GraphQL introspection; описание datasets:
[Cloudflare DO metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/).
Первая проверка после выпуска не заменяет приёмку за 24–48 часов и два
ежедневных цикла.

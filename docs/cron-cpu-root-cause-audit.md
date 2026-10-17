# Независимый аудит CPU Cron Social Analytics

Дата: 9 октября 2026 года. Все production timestamps и окна ниже — UTC. Диагностический этап; исходники backend не изменены, оптимизации не внедрены. Deployment, push, remote migrations, ручной сбор Instagram, изменение расписания и включение журналов не выполнялись.

## 1. Заключение

**В текущем Cron нет вычислительно тяжёлой AI/ASR/video-работы. Измерения подтверждают существенную стоимость загрузки зависимостей и множества коротких операций вокруг одной полезной порции. Одновременно найдены запросы, стоимость которых растёт с историей. Но точное распределение production CPU по функциям и причина остановки каждого ошибочного вызова не установлены.**

- Активная версия — **0.2.16**, Cloudflare version `e659a098-741f-47ba-891f-ad25274efa70`, 100% трафика, deployment `2026-10-09T06:29:40.443513Z`. Все файлы source inventory предыдущего release совпадают с текущими. Dry-run bundle: 1676.64 KiB, gzip 288.36 KiB; SHA256 `a6034b1536f348711a692e9c9c5b16cfb7b01700e199faeb78a9444b6036eda8`. Live download в 08:19:03.055Z побайтно совпал с локальным bundle. Детали независимой live-сверки — в [inventory](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/cloudflare-inventory.json).
- Локально, **workerd на Apple M5 Pro**, n=12: загрузка exact bundle p50 **13.216 мс**; динамический холодный импорт + exact scheduled handler на пустой D1 **22.472 мс**, немедленный повтор **1.228 мс**. Это статистическая оценка active time, не billed CPU production. Cold import внутри диагностического fetch также не воспроизводит отдельный платформенный учёт startup глобального scope.
- Прогретая порция в workerd, n=30 на сценарий: Insights p50 **6.357 мс**, комментарии **5.239 мс**, discovery без новых публикаций **7.852 мс**, суточное перепланирование с одной порцией **13.314 мс**. Полные p95/max и wall time — §4. Контроль обнаружил ошибочную атрибуцию ожидания в отдельных samples; верхние хвосты этого профайлера нельзя считать точными значениями CPU.
- **Чистый календарный алгоритм дешёвый**: Node main-thread CPU p50 **0.431 мс** при 52 наблюдениях, **0.481 мс** при 520; отдельный workerd-опыт без D1 — примерно **0.40 / 0.45 мс** на план. Суточная порция делает **55 SQL statements / 46 вызовов D1 / 3 внешних запроса**. Большая часть её роста при 10x в Node относится к SQL, не к генерации дат.
- Production `0.2.15`: 168 Cron, 13 `exceededResources` (**7.74%**), CPU p50 **40.877 мс**, p95 **76.488 мс**. `0.2.16`: **19 Cron, 0 ошибок**, p50 **40.768 мс**, p95/max **155.473 мс**. Окно нового release меньше двух часов и не доказывает стабильность.

Наиболее обоснованный следующий шаг — **контролируемо сузить runtime graph Cron и отдельно измерить сохранённую функциональность**. Локальный диагностический bundle с одним scheduled export загружается за p50 **7.420 мс** против 13.216 мс у исходного bundle. Разница 5.796 мс доказывает наличие устранимой стоимости этого контрфактического bundle, но не обещает такую же экономию в единственном Worker с сохранённым HTTP API. Второй приоритет — запросы выбора due work и календарных наблюдений; их планы и рост подтверждены независимо на D1.

## 2. Runtime, действующие настройки и предел доказательств

| Параметр | Проверено |
|---|---|
| Worker / entry | один `api`, `backend/src/index.ts` |
| Runtime config | compatibility date `2026-08-28`, `nodejs_compat` |
| Cron | `*/5 * * * *`; remote schedules совпадают |
| Bindings / API | одна D1; Instagram Login, API `v26.0`; лимит приложения 6 HTTP attempts, deadline 90 с с резервом 15 с |
| Workers execution model | `usage_model: standard`; account default тоже `standard` |
| CPU override | локального `limits.cpu_ms` нет; прочитанные remote settings не вернули значение CPU override |
| Журналы | локальная observability/logs/invocation_logs выключена; remote Logpush выключен; ничего не включалось |
| Node / pnpm | `v24.18.0` / `11.15.1`, соответствует `.nvmrc`, engines, packageManager |
| Используемые библиотеки | Hono 4.13.12, Zod 4.6.5, Drizzle 0.45.3, Wrangler 4.127.1 |
| Локальный Workers runtime | workerd `1.20260828.1`, Miniflare `5.20260828.0-alpha`, macOS arm64, Apple M5 Pro |

Источники: [wrangler.jsonc:7–35](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/wrangler.jsonc:7), [createScheduledOperations:257–278](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/app/create-features.ts:257), inventory и [remote-sql.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/remote-sql.json).

Remote script-level observability вернулась `null`, tail consumers — `null`, Logpush — `false`; effective CPU limit в version/script responses не раскрыт.

Текущая официальная документация устанавливает для Workers Free **10 мс CPU на Cron**, для Paid при интервале менее часа — **30 с**; память **128 MB на isolate**, wall time Cron **15 минут**. Ожидание сети/D1 не является CPU. Есть документированная flexibility isolate для отдельных превышений; при регулярном достижении лимита выполнение прекращается. Startup глобального scope имеет отдельный предел **1 с**. Поэтому successful CPU >10 мс сам по себе не означает Paid и не является обещанием доступного бюджета. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

**Фактический billing plan не подтверждён.** Read-only subscriptions вернул HTTP 403; доступная browser-проверка потребовала login и не дала сведений о тарифе. `standard` — режим исполнения, а не доказательство Free. Настройки не раскрыли effective CPU limit. Повторяемый обрыв на 10.000 мс согласуется с номинальным Free-лимитом, но административное подтверждение тарифа/override остаётся необходимым. Документация объясняет возможность успеха выше лимита; она не позволяет определить, почему именно этот isolate получил/исчерпал запас и в какой функции произошла остановка.

Полученный outcome буквально `exceededResources`. Новая документация различает `exceededCpu` и `exceededMemory`; старый агрегированный outcome не переименован в более точный без доказательства. [Workers errors](https://developers.cloudflare.com/workers/observability/errors/).

## 3. Полный горячий путь и сложность

Обозначения: A — schedules/accounts; M — публикации аккаунта; S — snapshots; R — due running jobs; P — pending calendar periods; I — insight history; K — metrics; B — items одной страницы; H — HTTP receipts. В production сейчас R=4, а не все 230 jobs. Число публикаций/комментариев само по себе не доказывает расход JS CPU.

| Этап, функция и строки | Чтения, структуры, частота и сложность |
|---|---|
| [index.ts:1–15](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/index.ts:1), `scheduled` | На каждый Cron `ctx.waitUntil(createScheduledOperations(env).tick())`. HTTP `createApp` загружается dynamic import только из fetch; его promise хранится на isolate. Cron не создаёт Hono/OpenAPI router. |
| [create-features.ts:35–255,257–278](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/app/create-features.ts:35), `featureOptions`, `createScheduledOperations` | При инициализации isolate импортируются модули; на каждый tick создаются options/closures и request scope. Нет DI framework. Reader объявлен lazy, но вызов `options.analytics(env)` в [create-features.ts:93–99](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/app/create-features.ts:93) фактически получает его при композиции. Создаются MetaClient, policy, connections, cipher, Collection и D1 adapters. В конструкторах нет загрузки всей БД. |
| [instagram/index.ts:14–32](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/index.ts:14); [meta-client.ts:1–143](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/meta-client.ts:1) | Eager Zod schemas верхнего уровня; транзитивно Zod core/classic/locales/from-json-schema. Stores импортируют Drizzle root/D1 и общий [schema.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/platform/database/schema.ts). Инициализация schema objects на isolate; объектные factories повторяются на tick/вызов capability. |
| [Collect.tick:455–515](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/application/collect.ts:455) | Каждый tick: `nextSchedule`, `workHeads`; при eligible schedule — `dueAgeMedia`, `nextStoryExpiry`; если periodic work ещё не due — `dueMedia`; при доступных комментариях — список permissions и `nextCommentRefresh`. Зависит от schedule/job branches; не каждый запрос выполняется в каждом tick. Получает не более двух job heads и одного schedule candidate. |
| [D1Collection.workHeads:243–259](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:243); [selectWork:9–27](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/domain/selection.ts:9) | SQL дважды выбирает head из eligible R, проверяет JSON cursor[0], сортирует computed urgency/attempt/age. O(R·P) upper bound при разборе текстового cursor и O(R log R) для сортировки; SQLite LIMIT/top-N может уменьшать фактическую сортировку. В приложение — одна строка с двумя IDs, далее ≤2 jobs по PK. JS sort ≤3 кандидатов, O(1) при текущей границе. Archive reserve раз в 3 slots только при отсутствии urgent; `capacityDeficit` считает выбранные heads, а не весь backlog. |
| [Collect.tick:517–556](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/application/collect.ts:517) | Выбран existing job — один `advance`, без ежедневного replan. Для schedule — claim, recordPolicy, bounded sort четырёх periodic actions. Lease/fence/version проверки нельзя удалить ради CPU. |
| [Collect.tick:577–605](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/application/collect.ts:577); [periodObservations:13–27](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/infrastructure/d1-insights.ts:13) | Только due daily: activityPlan читает совместимые period observations за 90 дней через JSON predicates и GROUP BY; получает компактные from/to/observedAt, не весь payload history. Старую очередь разбирает и сливает с планом. SQL O(I·K²) upper bound для вложенных needed×saved metrics, плюс группировка. |
| [activityPeriodPlan:13–135](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/domain/periods.ts:13); [refreshActivityQueue:8–18](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/domain/activity-policy.ts:8) | 90 календарных дней, недели/месяцы, DST-aware midnight через Intl, cache Map внутри одного плана. В fixture 103 periods. latest observations Map O(I); сортировка periods O(P log P), merge через Set O(P+pending). Новое расписание ставит `nextInsightsAt = now + 24h`, не timezone midnight. Сохраняются pending head/operation identity, lease и очередь mature/early observations. |
| [Collect.advance:120–303](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/application/collect.ts:120) | На один tick одна полезная порция. Claim по PK; stable operation ID через SHA256. Activity: JSON.parse очереди, один period, slice/stringify остатка O(P); очередь также разбиралась при выборе deadline. Discovery: pageSize=1, уже известная публикация завершает поиск. Retries/backoff/checkpoint сохраняются. |
| [account-insights/index.ts:16–129](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/index.ts:16); [Insights.collect:51–175](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/application/insights.ts:51) | Повторные account lookups по PK перед source.read; profile и группы metrics, real MetaClient parse/validation. Обычно profile+2 insight requests в fixture; fallback может использовать общий budget до 6. Создаёт provenance/value arrays O(K+response points). Save через reserve/upsert с idempotency. Нет перерасчёта всех публикаций. |
| [bulk-comments.ts:9–149](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/application/bulk-comments.ts:9); [Comments.collect:42–165](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/community/application/comments.ts:42) | Ограниченная страница root/reply branches, до 5 root branches в текущей порции; cursor/probes/continuations. Два чтения savedCollection в разных слоях; отдельные parent checks. Fingerprint: sort IDs + SHA256 O(B log B), map/JSON O(B). Число всех 3791 comments не участвует в полном JS обходе. |
| [D1Comments.finish:64–106](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/community/infrastructure/d1-comments.ts:64) | JSON chunks по 25 items, json_each INSERT/UPSERT, lease fence, затем finish record. B=25 → 1 insert statement; B=250 → 10. Batch сохраняет атомарность; рост по размеру одной страницы и числу statement/chunks. |
| [MetaClient.json:269–647](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/meta-client.ts:269); [D1RequestPolicy:9–240](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/d1-request-policy.ts:9) | На HTTP attempt: quota/status, receipt begin/finish, parsing, safeParse, provenance; числовой sample ограничен. Cache status per invocation, unsupported metrics в D1. На первый завершённый attempt каждого нового scope — **две maintenance SQL** receipts, даже если очищать нечего. Их LIMIT ограничивает удаляемые строки, не full scan для поиска кандидатов. |
| [InstagramConnections:11–112](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/application/connections.ts:11); [TokenCipher:31–75](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/platform/crypto/secrets.ts:31) | Token Map на operation scope; AES-GCM decrypt и lazy import key. В одной operation запросы используют token cache; `forOperation` создаёт отдельный Map. Refresh conditional, не каждый tick. Fixture token expires через 60 дней и не измеряет refresh. Кэшировать credentials глобально между вызовами без отдельного анализа нельзя. |
| [SyncAccount:18–163](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/application/sync-account.ts:18); [D1Analytics.finish:462–575](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/infrastructure/d1-analytics.ts:462) | Profile fetch, одна media page, normalizeSearch/JSON metrics/provenance; fenced batch media+snapshots+account snapshot+run+lease. Работа O(B·K), не по общей истории S. |
| [D1Collection.save:323–391,finishSchedule:689–715](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:323) | Несколько SQL в batch, guard status/token/expiry; optimistic schedule update и release в finally. Это защита от повторов/параллельных claims, а не необязательные вычисления. Resource termination может оборвать выполнение до нормального catch/finally; expired lease обеспечивает последующее восстановление. |

`collectionOptions.analytics` получает scopedReader в create-features.ts:93; `createCollectionOperations` находится в [collection/index.ts:20–29](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/index.ts:20).

Runtime static graph после удаления type-only imports: **48 project files**, external imports `drizzle-orm`, `drizzle-orm/d1`, `drizzle-orm/sqlite-core`, `zod`. Полный список — `analysis.json.runtimeImports`. Hono/OpenAPI в этом graph отсутствуют; их код остаётся в single bundled file в deferred HTTP initialization. Content/reviews/webhooks options и соответствующие modules достижимы через общую factory; их прикладные jobs в Cron не выполняются. Bundle size сам по себе не измеряет CPU.

## 4. Методика, fixtures и профили

### 4.1. Что измерено

1. **workerd/Miniflare:** real source factories/application/domain/Drizzle/MetaClient/D1 policy, все 13 migrations в новой локальной D1. Отрезок Profiler.start→stop через CDP, requested interval 100 μs; active estimate = samples кроме `(idle)`, включая GC/native/program. Reset/seed/validate вне измеряемого отрезка. 3 warmups, 30 samples на каждую пару scenario×scale. Вызов через диагностический fetch добавляет сериализацию harness. HTTP external ответы синтетические; настоящий внешний транспорт заблокирован.
2. **Node:** тот же source harness, synchronous `node:sqlite`, `process.threadCpuUsage()` главного потока; 5 warmups +40 samples. Отдельно timed SQL и remainder main-thread CPU. Это включает локальное SQLite execution и не равно Worker billed CPU. Remainder включает WebCrypto callback/mock/ORM/JSON; background native crypto CPU вне main thread может недоучитываться. Process CPU тоже сохранён, но не используется как CPU Worker.
3. **Cold:** 12 свежих isolates на exact production bundle; import запущен после включения профайлера; minimal module control и отдельный Cron-only bundle, собранный тем же Wrangler/config. Ещё 12 isolates: exact scheduled handler на пустой D1, затем повтор. Динамическая обёртка нужна для захвата import; учёт этого import нельзя автоматически приравнять платформенному scheduled CPU.
4. **Pure calendar:** Node n=80 для 0/52/520/1030 observations. В workerd отдельный маленький Worker без D1/async внутри алгоритма: n=20 batches по 50 plans. Это даёт усреднённую стоимость плана, а не p95 отдельного плана.

На 07:50 UTC для fixtures были 247 media, 737 snapshots, 3791 comments, 5765 comment collections, около 226 завершённых jobs, 137 insights, 500 receipts, один account/schedule. В live cutoff **08:06:58.935Z** естественный сбор уже дал 738 snapshots, 230 jobs, 138 insights, 511 receipts; running jobs осталось 4. Синтетика сохраняет исходные размеры, а не выдаётся за точную копию приватной БД.

Fixture 1x: 247 media / 737 snapshots / 3791 comments / 5765 collections / 226 completed jobs / 137 insights (52 activity) / 500 receipts. 10x: все эти размеры ×10; account/schedule и размеры одной полезной страницы сохраняются. Все IDs, text, credentials и HTTP bodies синтетические. Media в fixture — REELS возрастом 60–359 дней; distribution Stories/permissions/deferred metrics и payloads не копируют production. Metrics JSON сопоставим по порядку размера; production среднее 1590 bytes, max insight payload 12816 bytes, active cursor max 4356 bytes, сохранённая comment page max 50. Comments fixture: 25 items; `comments_large` — стрессовая expanded page 250 items, не наблюдавшаяся в этой production-выборке.

`empty` выключает schedule и не имеет running jobs; `empty_enabled` имеет включённое eligible schedule, но нет due полезной работы; эта разница существенна. `selection` имеет 4 running jobs. `backlog` имеет **226/2260 due running activity jobs с JSON очередью 103 periods каждый** сверх completed history; это моделирование будущего backlog, не описание нынешних 4 jobs. Daily включает replan и одну настоящую порцию activity, создание supporting jobs, сохранение schedule. Это не CPU одного только calendar builder.

Frozen application clock делает `result.durationMs=0` в fixtures; реальные wall/CPU записаны внешним инструментом. Ни это поле, ни latency мгновенного mock не используются как production duration.

### 4.2. Погрешность instrumentation

Контроль Node, n=40 на вариант, p50 с wrappers → без wrappers: enabled empty **2.218→2.197**, Insights **1.788→1.330**, comments **1.661→1.301**, daily **5.912→5.465 мс**. Это последовательные, не paired замеры; на 10x некоторые разницы отрицательны из-за JIT/GC/order, поэтому точного универсального overhead или вычтенного «истинного CPU» нет. Mock response wrapper стоит примерно **0.020–0.036 мс на обычный вызов**, около **0.065 мс** для expanded comments; seed/reset вне измерения; генерация синтетических response bodies в transport() находится внутри invoke и входит в CPU. Отдельный контроль transport() (Node n=200): CPU p50/p95/max 0.018/0.023/0.485 мс для обычных bodies и 0.132/0.191/0.273 мс для expanded comments; wall 0.018/0.024/0.552 и 0.132/0.194/0.434 мс. Evidence — mock-overhead.json. Wrapper/drivers заметны относительно коротких Node операций.

Контроль workerd n=20: noop active p50 **0**, p95 **0.421 мс**; deliberate 50 ms wait active p50/p95 **0**, wall p50 **50.816 мс**. **Один wait sample ошибочно получил 50.665 мс active**; предыдущий независимый прогон также дал один 50.519 мс outlier. Сохранён raw `calibration-wait-outlier.cpuprofile`. Busy synchronous 10M sqrt: active p50 **5.701**, wall p50 **6.085 мс**. Следовательно, estimator обычно отделяет wait, но способен приписать длинный sample interval последнему frame. Особенно нельзя считать одиночное source attribution/максимум доказательством затрат этого frame. Выбросы не удалены, p95/max приведены как наблюдавшиеся. Результаты Node и live D1 независимо подтверждают направления масштабирования. Методические рекомендации — [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

### 4.3. Cold и warm без полезной работы

| Эксперимент | n | Active estimate p50 / p95 / max, мс | Wall p50 / p95 / max, мс |
|---|---:|---:|---:|
| Import exact production bundle | 12 | 13.216 / 14.700 / 14.700 | 14.111 / 24.790 / 24.790 |
| Import диагностического Cron-only bundle | 12 | 7.420 / 7.894 / 7.894 | 8.238 / 8.535 / 8.535 |
| Minimal module import/control | 12 | 1.067 / 1.274 / 1.274 | 1.601 / 1.891 / 1.891 |
| Cold import + exact scheduled, пустая D1 | 12 | 22.472 / 26.749 / 26.749 | 23.705 / 27.747 / 27.747 |
| Немедленный повтор exact scheduled | 12 | 1.228 / 2.294 / 2.294 | 1.895 / 3.257 / 3.257 |

Cron-only output: 1234.24 KiB / gzip 219.22 KiB. В нём отсутствует HTTP entry; его нельзя deployed как замену API. Cold modules загружаются только один раз на isolate, но isolate reuse не гарантирован. Первый вызов сценария в общей прогретой harness-сессии сохранён отдельно в `first-*`; это не независимый cold start каждой capability и не отдельное распределение.

Один import trace (14.271 мс): nearest source ancestor attribution Zod **8.107**, Drizzle **2.283**, application **0.769**, GC **0.643**, native/program **0.527**, helpers/unattributed **1.942 мс**. Есть инициализация Zod locales/from-json-schema и транзитивных Drizzle entities, не используемых как самостоятельные операции Cron. Это статистический профиль одного trace, не проценты production. Проверенная экономия counterfactual bundle важнее интерпретации каждого frame.

Прежняя одиночная пара 22.7→18.9 мс из production-verification не является текущим распределением, не сравнивается напрямую с новыми samples и не доказывает устранение ошибки.

### 4.4. Все сценарии и масштабирование

Все числа CPU в следующей таблице — **локальная статистическая оценка workerd**, с ограничением §4.2. Samples прогретые, cold imports исключены. Все значения в мс; n=30 на каждую ячейку CPU/wall.

| Local workerd scenario | 1x CPU p50 / p95 / max, ms | 10x CPU p50 / p95 / max, ms | 1x wall p50 / p95 / max, ms | 10x wall p50 / p95 / max, ms |
|---|---:|---:|---:|---:|
| noop (n=30) | 0.000 / 0.435 / 0.437 | 0.000 / 0.975 / 1.000 | 0.571 / 0.706 / 0.724 | 0.957 / 1.385 / 1.485 |
| empty (n=30) | 0.702 / 1.215 / 2.768 | 1.342 / 1.787 / 1.859 | 1.278 / 2.133 / 3.147 | 1.714 / 2.327 / 2.386 |
| empty_enabled (n=30) | 3.338 / 6.578 / 8.531 | 20.323 / 27.677 / 28.076 | 4.570 / 10.313 / 12.052 | 27.957 / 37.033 / 37.865 |
| selection (n=30) | 1.212 / 2.527 / 2.646 | 1.352 / 2.955 / 3.284 | 1.479 / 2.727 / 2.792 | 1.616 / 3.588 / 3.682 |
| discovery (n=30) | 7.852 / 15.258 / 15.306 | 11.606 / 17.488 / 24.991 | 8.775 / 15.854 / 15.977 | 12.200 / 18.660 / 27.403 |
| discovery_new (n=30) | 9.664 / 32.389 / 38.736 | 13.004 / 17.649 / 30.548 | 10.770 / 32.922 / 39.283 | 13.664 / 20.149 / 32.110 |
| insights (n=30) | 6.357 / 7.962 / 8.703 | 5.869 / 12.470 / 21.316 | 6.899 / 8.658 / 9.842 | 6.517 / 12.964 / 21.790 |
| comments (n=30) | 5.239 / 19.903 / 23.953 | 5.607 / 11.913 / 18.699 | 5.668 / 20.256 / 24.559 | 6.163 / 13.163 / 19.162 |
| comments_large (n=30) | 7.022 / 8.193 / 12.653 | 8.330 / 16.435 / 20.139 | 7.932 / 8.955 / 13.474 | 8.969 / 18.497 / 21.460 |
| daily (n=30) | 13.314 / 21.247 / 21.824 | 31.864 / 38.277 / 45.993 | 14.147 / 23.617 / 23.630 | 32.664 / 39.533 / 47.352 |
| backlog (n=30) | 2.265 / 6.781 / 13.210 | 11.512 / 12.817 / 14.796 | 2.608 / 7.418 / 13.772 | 12.000 / 15.773 / 17.725 |

**Node main-thread CPU**, n=40 на сценарий/scale, мс. SQL — синхронное выполнение адаптера SQLite; remainder — остальная работа главного потока. Медианы компонентов могут не складываться в медиану целого. SQL statements не равны binding calls или внешним subrequests.

| Node scenario | 1x CPU p50 / p95 / max | SQL p50 | Remaining main-thread CPU p50 | 10x CPU p50 / p95 / max | SQL p50 at 10x | SQL statements / returned rows 1x → 10x |
|---|---:|---:|---:|---:|---:|---:|
| noop (n=40) | 0.003 / 0.007 / 0.010 | 0.000 | 0.003 | 0.007 / 0.010 / 0.013 | 0.000 | 0 / 0 → 0 / 0 |
| empty (n=40) | 0.222 / 0.340 / 0.371 | 0.081 | 0.132 | 0.283 / 0.365 / 0.389 | 0.112 | 2 / 1 → 2 / 1 |
| empty_enabled (n=40) | 2.218 / 2.357 / 2.401 | 2.041 | 0.175 | 21.530 / 22.068 / 24.798 | 21.221 | 7 / 4 → 7 / 4 |
| selection (n=40) | 0.255 / 0.327 / 0.542 | 0.125 | 0.129 | 0.292 / 0.348 / 0.370 | 0.147 | 2 / 2 → 2 / 2 |
| discovery (n=40) | 3.163 / 4.493 / 6.613 | 1.457 | 1.652 | 5.763 / 6.303 / 9.153 | 4.420 | 44 / 13 → 44 / 13 |
| discovery_new (n=40) | 3.218 / 4.531 / 6.478 | 1.535 | 1.708 | 6.094 / 6.666 / 8.791 | 4.579 | 51 / 13 → 51 / 13 |
| insights (n=40) | 1.788 / 2.136 / 8.461 | 0.655 | 1.136 | 2.073 / 2.564 / 5.439 | 0.875 | 30 / 8 → 30 / 8 |
| comments (n=40) | 1.661 / 1.917 / 2.140 | 0.754 | 0.915 | 1.913 / 2.265 / 4.691 | 0.956 | 26 / 10 → 26 / 10 |
| comments_large (n=40) | 3.152 / 3.709 / 5.454 | 1.765 | 1.383 | 3.359 / 4.143 / 6.456 | 1.937 | 35 / 10 → 35 / 10 |
| daily (n=40) | 5.912 / 7.174 / 8.592 | 3.284 | 2.688 | 21.709 / 23.798 / 24.134 | 19.090 | 55 / 72 → 55 / 123 |
| backlog (n=40) | 0.595 / 0.691 / 0.721 | 0.458 | 0.132 | 5.429 / 6.854 / 7.402 | 5.206 | 2 / 2 → 2 / 2 |

Wall распределения Node для каждой строки сохранены в `node-results.json`; вывод дублируется в [tables.md](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/tables.md). Основные Node wall p50/p95/max: empty enabled **2.234/2.355/2.402**, Insights **1.812/2.171/9.493**, comments **1.678/1.933/2.156**, daily **5.992/7.720/8.717 мс**. Почти равны CPU из-за синхронного SQLite и отсутствия сетевого ожидания; это не модель production wall.

Чистый calendar Node (n=80): CPU p50/p95/max при 52 observations **0.431/0.479/0.568**, при 520 **0.481/0.537/1.470 мс**; wall **0.432/0.495/1.178** и **0.481/0.582/1.589**. В isolated workerd (20 batches×50) normalized batch CPU p50/p95/max: 52 observations **0.401/0.421/0.445**, 520 **0.448/0.520/0.945 мс/plan**; normalized wall **0.417/0.438/0.462** и **0.466/0.539/0.972**. Это amortized averages, не individual-plan quantiles. Наблюдения 1030: Node p50 **0.539**, workerd normalized p50 **0.489 мс**.

Атрибуция полного daily-10x trace назначает около 19.9 мс `activityPeriodPlan`, что не согласуется с isolated опытом и Node. Возможные sampling gaps/native attribution делают это **не доказательство тяжёлого календаря**. Прикладываются traces, чтобы независимый эксперт мог проверить этот предел метода.

### 4.5. Измеренные этапы

Node method wrappers — inclusive; содержат собственный SQL. Они не складываются в независимые CPU buckets. Значения p50; все n/calls/p95/max/wall есть в `node-results.json.stages`.

| Этап | 1x CPU p50, мс | 10x CPU p50, мс | Вывод |
|---|---:|---:|---|
| Dependency composition, daily | 0.018 | 0.021 | Повторное создание scope само по себе мало; cold dependencies — отдельная стоимость |
| `workHeads`, 4 running jobs | 0.077 | 0.103 | Completed history ×10 почти не влияет |
| `workHeads`, 226→2260 due jobs | 0.414 | 5.138 | JSON/priority SQL зависит от числа due jobs |
| `dueAgeMedia`, enabled empty | 0.133 | 1.047 | Перебор publication×7 targets в SQL |
| `dueMedia`, enabled empty | 1.447 | 15.307 | Основная причина роста локального пустого tick |
| `nextCommentRefresh`, enabled empty | 0.369 | 4.609 | Computed eligibility/order + correlated reads |
| `recordPolicy`, daily | 0.162 | 1.036 | Latest receipt выборка/ORDER BY масштабируется с H |
| `replanActivity` checkpoint SQL | 0.046 | 0.044 | Обновление одного job не зависит от total history |
| `claim` job, daily | 0.133 | 0.131 | PK + fence, не полный перебор |
| `save` collection checkpoint, daily | 0.046 | 0.043 | Bounded batch/serialization |

Точно разделить весь CPU JSON.parse, Zod validation, ORM building, AES/SHA и application transformations в production этим аудитом нельзя. Обычный Insights Node remainder p50 **1.136 мс**, comments **0.915**, daily **2.688**; это совместная локальная стоимость, не «чистое преобразование». В одном warm discovery_new trace D1 binding JS занял 4.377 мс, Drizzle 1.548, application 2.013, harness 0.713 — подтверждение накладных расходов, с оговоркой sampling и одного trace. Cold/warm flamegraphs и raw cpuprofiles позволяют перепроверить атрибуцию.

## 5. D1: планы, строки и повторные чтения

EXPLAIN получен **на настоящей production D1 read-only** в 07:59:40 UTC, параметры времени сдвинуты к текущему времени; connected account в сохранённом evidence обезличен. Query plans и executions — отдельные вызовы. SQL duration ниже — одиночный серверный замер D1, **не CPU вызывающего Worker**. Maintenance проверены только их SELECT subqueries; DELETE/UPDATE удалённо не запускались.

| Запрос и исходник | Ключевой EXPLAIN | Строк в приложение / D1 rows_read | D1 SQL ms |
|---|---|---:|---:|
| `nextSchedule`, [412–425](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:412) | SCAN schedules + TEMP ORDER BY | 1 / 2 | 0.7603 |
| `workHeads`, [243–259](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:243) | Два SEARCH `collection_due(status,next_attempt_at)`, два TEMP ORDER BY | 1 heads row / 20 | 0.6518 |
| `dueAgeMedia`, [436–459](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:436) | media_account_published по account ×7 targets; snapshots range; TEMP order | 0 / 1914 | 1.4185 |
| `nextStoryExpiry`, [606–614](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:606) | account index, correlated snapshot; product/time predicate не сокращает весь account range | 1 / 247 | 0.2882 |
| `dueMedia`, [427–435](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:427) | Account media index, latest snapshot subquery, json_each deferred metrics, TEMP order | 1 / 3985 | 4.2802 |
| `nextCommentRefresh`, [460–475](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:460) | Media/time, comment target/state/job indexes; correlated snapshots, TEMP sort | 1 / 549 | 1.5249 |
| `recordPolicy`, [177–220](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/collection/infrastructure/d1-collection.ts:177) | Previous policy и connection прочитаны дважды; latest receipt использует `(account,object,time)`, сортирует по `(time,id)` | 1 / 1010 | 1.9865 |
| `periodObservations`, [13–27](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/infrastructure/d1-insights.ts:13) | `(account,signature,time)` используется только по account; nested JSON needed×saved; TEMP GROUP BY | 56 / 5325 | 18.0992 |
| Receipt prune candidates, [173–187](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/d1-request-policy.ts:173) | SCAN instagram_http_attempts при `requested_at < cutoff LIMIT 100` | 0 / 503 | 0.3873 |
| Receipt sample prune candidates, тот же источник | SCAN instagram_http_attempts + JSON predicate, LIMIT 100 | 0 / 503 | 0.3256 |

`rows_read` — accounting D1, включает index/JSON traversal и не означает столько JS objects. Для dueMedia `LIMIT 1` не предотвращает чтение тысяч строк в БД. В application это один ID; вывод «Cron каждый раз загружает все 247 media и 3791 comments» неверен. Full scans точно есть в receipts и schedules; account-range scans есть в media/insights. Completed collection jobs исключены по индексному status predicate.

Повторные вычисления/чтения: одинаковые top-level schemas на fresh isolate; повторная account factory/lookup в capability closures; parse calendar queue при deadline и advance; два savedCollection reads; один recordPolicy с дублирующими scalar subqueries; receipts cleanup на каждом новом invocation scope. Их существование подтверждено кодом; кроме измеренных SQL/graph вариантов размер экономии от устранения каждого повтора неизвестен. Cache status/token внутри scope уже присутствует. Incremental state для next due и eligibility может убрать историю из горячего поиска, но должна сохранять consistency/fences и rules missing metrics.

Счётчик 1x:

| Scenario | SQL statements | D1 binding calls | External fetches |
|---|---:|---:|---:|
| enabled empty | 7 | 7 | 0 |
| discovery / discovery_new | 44 / 51 | 33 / 36 | 2 / 3 |
| Insights | 30 | 22 | 3 |
| comments / expanded comments | 26 / 35 | 20 / 20 | 1 / 1 |
| daily + одна порция | 55 | 46 | 3 |

Batch — один binding call с несколькими statements. Нельзя объявлять 55 statements доказанным превышением 50 subrequests. D1 docs указывают 50 queries/invocation Free и 1000 Paid; Workers docs отдельно дают 1000 internal subrequests на Free. Это требует проверки конкретного счётчика/ограничения D1 для приложения: daily уже делает 46 вызовов, fallback до 6 external attempts добавляет receipt/support calls. Ни Local Miniflare, ни число external subrequests не устанавливают соблюдение effective production D1 quota. Этот аудит не доказал D1-limit причиной 13 остановок. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 6. Независимые production Analytics

Query и raw responses сохранены в [production-analytics.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/production-analytics.json), вычисления — `analysis.json`. Cutoff выбран на три минуты раньше query time, чтобы снизить влияние ingestion lag. GraphQL limits 2000 не достигнуты. Число slots совпадает с расписанием в выбранных окнах. Scheduled dataset не содержит scriptVersion dimension: version определяется окнами активного deployment; adaptive dataset фильтруется exact version. Здесь deployment 100%, gradual смешения нет.

Percentiles raw Scheduled — nearest rank `sorted[ceil(n*p)-1]`; они могут отличаться от интерполированного GraphQL percentile прежнего отчёта. Failed CPU — обрезанный результат terminated invocation, не оценка CPU необходимого для успешного завершения.

| Вид / версия / окно [start,end) UTC | n | Ошибки | CPU p50 / p95 / max, мс |
|---|---:|---:|---:|
| Scheduled 0.2.15, 08 Oct 16:20 → 09 Oct 06:20 | 168 | 13, 7.74% | 40.877 / 76.488 / 116.736 |
| Только успешные Scheduled 0.2.15, то же окно | 155 | 0 | 42.249 / 77.442 / 116.736 |
| Failed Scheduled 0.2.15 | 13 | 13 | 12×10.000; один 48.584 |
| Scheduled 0.2.16, 09 Oct 06:30 → 08:03:58.935 | 19 | 0 | 40.768 / 155.473 / 155.473 |
| 0.2.16 без известного daily replan 06:30 | 18 | 0 | 40.677 / 96.552 / 96.552 |
| Известный daily 0.2.16, 06:30 | 1 | 0 | 155.473 (одно наблюдение) |

Факт daily 06:30 опирается на предыдущий production-verification и next_insights_at; прямой origin/type dimension в Analytics отсутствует. Все остальные Cron не размечены по capability. По 0.2.15 надёжной daily/ordinary разметки нет. Нельзя приписать первый пик только календарю: это также первый запуск версии, supporting jobs и полезная portion. Сопоставление окон 14 часов и 94 минут не является controlled before/after CPU experiment.

**Scheduled и HTTP разделены насколько позволяет read-only schema.** `workersInvocationsAdaptive` здесь не имеет eventType. Суммы mixed rows не названы HTTP. Для 156/168 старых и 18/19 новых Cron найдена однозначная singleton minute/status группа с ровно тем же CPU; только по ним извлечены wall/memory/subrequests. Чистые HTTP minute/status группы исключают любой matching Scheduled. Остальные mixed группы не дают HTTP percentiles.

| HTTP, отдельно по тем же окнам и версиям | 0.2.15 | 0.2.16 |
|---|---:|---:|
| Pure HTTP subset, requests / groups | 96 / 17 | 8 / 2 |
| Mean CPU pure HTTP subset, мс | 33.225 | 65.776 |
| Все HTTP count, вычисленное residual `total − Scheduled` | 189 | 44 |
| Mean CPU всех residual HTTP, мс | 30.907 | 32.962 |
| Точное p50/p95/max всех HTTP | недоступно | недоступно |

Residual — inference при полноте datasets и единственных entrypoints fetch/scheduled. Он не восстанавливает individual HTTP duration/memory/outcome в mixed группе. Pure subset не является репрезентативным HTTP percentile. Это предел доступной схемы; invocation logs/live tail не включались.

Units проверены live GraphQL introspection: `cpuTime/cpuTimeUs` и `wallTime/requestDuration` — μs; **adaptive `duration` — GB·s**, не milliseconds. MemoryUsageBytes — isolate high-water, не отдельный retained heap каждого invocation. Например у failed Cron 10 мс CPU, wall 1058.572 мс и `duration=0.1323215` GB·s; последнее нельзя сравнивать с CPU в мс. [Metrics and Analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).

Однозначные Cron matches:

| Метрика | 0.2.15 (n=156) | 0.2.16 (n=18) |
|---|---:|---:|
| Wall p50 / p95 / max, мс | 7023.304 / 10387.565 / 12151.404 | 5574.012 / 10003.557 / 10003.557 |
| Isolate memory p50 / max, MiB | 9.731 / 13.231 | 8.192 / 10.192 |
| External subrequests p50 / p95 / max | 3 / 6 / 6 | 2 / 6 / 6 |

Все 13 failed имеют однозначные matches. Первая ошибка 04:30:42: CPU 48.584 мс, wall 6525.347 мс, memory 9.989 MiB, external=1. Следующие 12, 04:35:42–05:30:42: CPU ровно 10.000 мс, wall **1058.039–1341.768 мс**, memory **9.230–9.238 MiB**, external=0. Это сильный признак CPU enforcement, не memory/wall saturation. External=0 исключает обработку уже полученного ответа Instagram в этих 12, но **не исключает D1, planner, imports и preflight**. Точное место аварии без trace неизвестно; «это обязательно router startup» не доказано.

Memory максимум по всем mixed types: 29.035 MiB на 0.2.15, 22.629 MiB на 0.2.16, существенно ниже 128 MB. Wall максимум matching Cron около 12 с, существенно ниже 15 минут. Нет признаков, что 13 errors вызваны этими пределами; это не полный heap/leak audit.

D1 account analytics за окно 0.2.16: 906 readQueries, 395 writeQueries, 466198 rowsRead, 815 rowsWritten; batch latency p50/p95/p99 **0.41/5.47/15.53 мс**. Они смешивают HTTP, Cron и audit SELECTs и не выдаются за CPU/latency одного Cron. База около 10 MB. Измерений ошибок SQL/D1 overload на каждый terminated Cron нет. Наличие долгих queries/драйверных преобразований подтверждено; D1 как непосредственная причина resource outcome не установлена.

## 7. Доказательства и гипотезы

| Подозреваемая причина | Доказательства в коде | Измерения | Категория / уверенность | Исправление или следующая проверка |
|---|---|---|---|---|
| Широкий runtime/bundle и eager schemas | Static Cron graph 48 files, Zod/Drizzle/global schema; общий featureOptions | Cold import p50 13.216; Cron-only 7.420; sample Zod/Drizzle заметен | **Подтверждено измерением**, высокая для local overhead; production share неизвестна | Узкий bootstrap и imports; paired одинаковый build/fixtures |
| Hono/OpenAPI router создаётся каждым Cron 0.2.16 | Dynamic createApp только fetch; worker-entry test | Runtime graph без Hono, тест прошёл | **Не подтверждено** для текущей версии | Не повторять уже сделанный fix как новую причину |
| Большой JS sort всех media/comments/jobs | В tick максимум 3 candidates, ≤2 job rows; page bounded | selection почти неизменен при completed history ×10 | **Не подтверждено** | Следить за SQL eligible set, не оптимизировать sort 3 элементов |
| SQL searches растут с историей | dueMedia/dueAge/comments computed predicates; LIMIT после обработки кандидатов | Remote rows_read 3985/1914/549; enabled empty Node 2.218→21.530 при 10x | **Подтверждено измерением**, высокая для D1/local total; Worker CPU share не измерена | Indexed/materialized due state; сохранять семантику refresh/age/deferred |
| Длинный running backlog | WorkHeads urgency JSON и две computed order | 226→2260 jobs: Node 0.595→5.429, workerd estimate 2.265→11.512 | **Подтверждено измерением** для стрессового будущего backlog | Incremental head/deadline fields; нынешние 4 jobs не объяснять этим stress alone |
| Ежедневное сканирование insight JSON | periodObservations nested NOT EXISTS/group + unsuitable index prefix | Remote 18.0992 ms/5325 reads, 56 app rows; daily SQL Node 3.284→19.090 | **Подтверждено измерением** | Normalized indexed eligibility/coverage; проверить schema compatibility/maturity |
| Calendar JS сам требует десятки мс | Fixed 90d plan, Map cache и DST normalization | Isolated ~0.4–0.5 ms; full trace имеет неоднозначный sample | **Не подтверждено** | Не использовать single frame gap как доказательство; cache formatter — второстепенно |
| Повторные scope lookups/JSON/receipts maintenance | Дубликаты account/savedCollection/policy reads; queue parse; prune once/scope | Composition <0.03 ms Node; maintenance full scans; общей causal delta нет | **Подтверждено исходным кодом, вклад в CPU не измерен** для каждого отдельного повтора | Eliminate same-scope duplicates; receipts index/maintenance cadence |
| CPU бюджет 10 мс + isolate flexibility | Документация и серии точных cutoffs | 12×10.000 CPU, низкие memory/wall, 155 success выше10 | **Вероятная гипотеза**, высокая для CPU enforcement, не административное подтверждение plan | Read billing/effective limits; не рассчитывать на flexibility |
| Cold/JIT/native/binding/fallback объясняют весь production gap | Возможные fresh isolates, Zod compile, real HTTP payloads, до 6 attempts | Local portion p50 5–13 vs production ~41; stage traces production нет | **Недостаточно информации** | Минимальный controlled experiment §9; не подгонять остаток под одну причину |
| Memory, wall или external quota вызывают 13 errors | Bounded pages, budget6; D1 может быть до external | Memory~9MB, wall~1–6s, external0/1 у ошибок | **Не подтверждено** как причина этих ошибок | Проверить D1 effective limits/fallback; heap growth отдельно при увеличении B |
| Вычислительно тяжёлая аналитика/ASR/video | В горячем пути нет этих jobs; reports не вызваны | Pure transforms/remainder малы локально | **Не подтверждено** | Не считать будущую AI работу причиной текущих Cron |

## 8. Приоритетные изменения — предложения, не внедрены

### 1. Сузить Cron bootstrap и runtime dependencies

Изменить `app/create-features.ts`, выделить узкую scheduled factory и обновить `index.ts`; пересмотреть imports MetaClient Zod, D1 stores Drizzle и общий schema graph. Исключить HTTP-only options/classes/schema machinery из eager Cron пути; HTTP API должен сохранить существующий контракт. Это остаётся одним Worker, не требует новой инфраструктуры.

Основание: controlled Cron-only bundle p50 cold 7.420 против 13.216 мс. Возможный local выигрыш существует; величина сохранённого HTTP+Cron варианта и production billed delta **неизвестны**. Одна лишь смена filename entry или lazy factory не гарантирует меньшую стоимость single bundle parsing.

Риски: забытая capability, изменение env/request scope, захват credentials/in-flight promises между вызовами, нарушение validation. Проверки: существующие worker-entry/Instagram/contract tests, runtime imports graph, два concurrent HTTP вызова, Cron без HTTP и после HTTP, cold/warm fixture matrix. Production: после отдельного разрешения release, unchanged schedule, сравнение same-type обычных Cron по exact version и fixed window, включая первый daily; никаких новых invocation logs.

### 2. Убрать history-dependent поиск due work из частого tick

Файлы: `collection/infrastructure/d1-collection.ts`, `platform/database/schema.ts`, новая миграция при согласовании; writers analytics/community для обновления derived eligibility. Начать с индексов под реальные predicates/order, затем при необходимости materialized next_due/latest_snapshot/refresh eligibility. `workHeads` должен читать нормализованный head deadline, а не разбирать cursor каждого eligible job.

Основание: enabled empty Node p50 2.218→21.530 мс при 10x; dueMedia одного результата читает 3985 rows. Эффект на D1 reads/latency обоснован; экономия billed Worker CPU количественно не установлена. Costestimates3/5 не являются реальным CPU budget.

Риски: пропуск age slot/Story deadline, stale deferred metrics, archive starvation, update races, write amplification. Проверки: age-snapshots, completeness/recovery/scheduling tests, 4/226/2260 due jobs, tie-breaks/lease expiration, property comparison старого и нового SELECT на synthetic fixtures. Production: read-only EXPLAIN/rows_read before-after и natural Cron distributions отдельно от SQL duration.

### 3. Индексировать календарную eligibility и делать обновление coverage инкрементально

Файлы: `account-insights/infrastructure/d1-insights.ts`, `application/insights.ts`, `domain/maturity.ts`, database schema/migration, `collection/application/collect.ts`. Хранить нормализованные compatibility/period/status/metric coverage поля либо компактное verified coverage projection при сохранении observation. SQL по account+kind/version/zone+period/time вместо JSON scan nested metrics на всей истории.

Основание: remote 5325 reads / 18.0992 ms; Node daily SQL 3.284→19.090 при 10x. Чистый календарь0.4–0.5 ms, поэтому оптимизировать Intl первым не обосновано. Quantitative Worker CPU effect нужен отдельно.

Риски: ошибочная зрелость, смешение API versions/time zones/metric sets, missing/null metrics, потеря pending head operation identity. Проверки: instagram-data-quality, collection-upgrades, DST/leap/month boundaries, mature/early/deferred observations, subset / superset metrics, сохранение старых provenance, replan while leased. Production: сверка saved coverage и естественного daily CPU/reads на следующих суточных циклах.

### 4. Сократить D1 preflight и receipt maintenance без потери evidence

Файлы: `instagram/infrastructure/d1-request-policy.ts`, `collection/infrastructure/d1-collection.ts`, account/analytics/community composition и database schema. Индекс `requested_at` для cleanup и `(account_id,requested_at,id)` для latest receipt, одно чтение connection/policy, переиспользование verified account/savedCollection в пределах invocation; maintenance с durable due marker и ограниченным cadence вместо безрезультатного поиска каждый tick. Аудиторские receipts и begin/finish попыток сохранять.

Основание: оба prune SELECT full scan 503 rows; recordPolicy latest receipt sort 1010 reads; daily46 D1 calls. Aggregate эффект каждого уменьшения вызова не измерен, проценты не назначаются. Риски: некорректные quotas/scopes после обновления, race cleanup, нарушенная retention, скрытая попытка API. Проверки: counters/timeout/fallback/recovery/privacy, duplicate collection, cleanup boundary/retention, stale lease. Production: natural call counts/reads/CPU с одинаковым числом external attempts, без дополнительного collection.

### 5. Разделить daily planning и полезную portion на существующие durable checkpoints

Файлы: `collection/application/collect.ts`, ports/store, account-insights projection; дополнительные phases в той же D1, при необходимости head+offset вместо полной перезаписи JSON очереди. Разложить supporting-job/replan bookkeeping на bounded шаги, затем выполнять source portion. Это может снизить maximum per invocation даже при том же total CPU.

Основание: текущий daily требует 55 SQL/46 D1 calls и local workerd p50 13.314 против 6.357 ordinary activity; 10x — 31.864. Нельзя обещать, что разность — чистый replan CPU: branches/SQL/save различаются. Эффект: меньший peak, возможно больше суммарных reads/invocations. Новая Queue не требуется.

Риски: потеря freshness SLA, deadline/head starvation, extra idempotency state и stale planner phase. Проверки: concurrency/recovery/replan-active-job, crash между phases, historical maturity, preservation of operation ID, достаточная пропускная способность. Production: daily peak и time-to-first-useful-observation, а не только падение CPU одного tick.

## 9. Free, Paid и архитектура; следующий минимальный эксперимент

**A. Остаться на Free:** текущую реализацию нельзя объявить устойчивой в 10 ms. Старый release уже имел13 resource aborts; новый имеет обычную measured production медиану ~41 ms, на которую flexibility не даёт гарантии. Уменьшение eager graph, числа D1 round trips, daily peak и history scans имеет основания; доказательства достижения бюджета с запасом пока нет. Нужны повторные cold/warm и natural production измерения, включая daily, fallback 6 attempts и representative expanded comments. Pure Node remainder 1–3 ms показывает, что полезная ограниченная работа не заведомо невозможна в 10 ms; он не доказывает Free suitability после исправлений.

**B. Частичная оптимизация и Paid:** переход оправдан, если после narrowing и bounded planning **минимально необходимая сохранённая portion** стабильно требует >10ms billed CPU на production или не имеет достаточного tail запаса на репрезентативных paths; нужны данные с устранёнными неэффективностями. Сейчас такого нижнего предела нет: cold estimator содержит отдельный startup и sampling overhead, daily содержит устранимый SQL/bookkeeping. Нынешние production CPU и aborts объясняют эксплуатационный риск, но сами по себе не доказывают неизбежность Paid. Сначала подтвердить actual billing/effective limits.

**C. Архитектура:** отдельная лёгкая scheduled composition внутри одного Worker обоснована; отдельный Worker или Queue **не доказаны необходимыми**. Durable jobs/leases/checkpoints уже выполняют роль очереди. При одной порции каждые 5 мин — максимум 288 portions/day на весь Worker; archive reserve даёт до 96 slots/day лишь без urgent demand. Один полный 103-period activity backlog при скорости одной activity portion/tick уже требует ~8 ч 35 мин без конкуренции. Несколько аккаунтов/Stories/comments/fallback могут исчерпать пропускную способность и 90d source deadlines раньше, чем общий объём comments создаст JS-memory проблему. Overload не исправляется исключительно меньшим CPU. Дополнительная инфраструктура станет обоснована измеренной нехваткой throughput/retry isolation после этих изменений, а не названием Cloudflare service.

Минимальный следующий causal experiment:

1. В отдельном согласованном patch сохранить HTTP/source/storage контракты и narrowed Cron factory. На одном компьютере сравнить старый/новый exact Wrangler bundles, в чередующемся порядке, ≥30 fresh isolates и ≥100 warm runs, identical fixtures; include code initialization отдельно от handler. Не суммировать sample CPU и D1 SQL duration.
2. На локальном fake D1 адаптере без SQLite измерить только source-side parse/build/serialize CPU с теми же returned rows; отдельно real local D1 и isolated calendar. Это снимет часть remaining ambiguity driver/native wait против JS работы. Реальный MetaClient остаётся с синтетическими payloads/unsupported/fallback 6.
3. После отдельного разрешения deployment наблюдать **существующие** natural Cron по exact version ≥24 ч, лучше48 ч и≥2 daily cycles; одинаковые schedule/accounts/attempt counts. Read-only D1 job/receipt checkpoints для subtype; никаких logs/tail или manual collection. Зафиксировать административный тариф/CPU override. Если CPU остаётся>10ms, анализировать minimal preserved portion и допускаемую задержку до выбора Paid/architecture.

Одна пара startup или19 success calls не отвечает на causal question. Exact total production CPU decomposition потребовал бы production profiling либо диагностической телеметрии; такие изменения не были разрешены и не выполнялись.

## 10. Воспроизведение и handoff

Все scripts и evidence — [docs/cron-cpu-audit](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit). Raw cpuprofiles открываются в DevTools Performance/JavaScript Profiler. Статические flamegraphs: [cold-empty](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/cold-empty-flamegraph.svg) и [daily-1x](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/cron-cpu-audit/daily-1x-flamegraph.svg); ширина — inclusive sampled active time, idle исключён. `node-daily.cpuprofile` включает fixture resets между portions и поэтому не используется как чистый production flamegraph.

Запускать последовательные performance experiments без concurrent tests/builds. Используются уже установленные workspace deps; install/version/config changes не нужны. Miniflare требует host-capable local context для loopback/inspector. Все его D1 bindings синтетические; external outbound заблокирован.

```sh
cd /Users/denischernykh/Documents/ChatGPT/social-analytics-service
node --version
pnpm --version
WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH="$PWD/tmp/cron-cpu-audit/wrangler-local.log" pnpm --dir backend deploy:dry-run
node docs/cron-cpu-audit/build.mjs
WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH="$PWD/tmp/cron-cpu-audit/wrangler-local.log" pnpm --dir backend exec wrangler deploy ../docs/cron-cpu-audit/operations-entry.ts --config wrangler.jsonc --dry-run --outdir ../tmp/cron-cpu-audit/operations-wrangler
node docs/cron-cpu-audit/node-profile.mjs
node docs/cron-cpu-audit/workerd-profile.mjs
node docs/cron-cpu-audit/calibrate.mjs
node docs/cron-cpu-audit/calibrate.mjs --calendar
node docs/cron-cpu-audit/count-queries.mjs
node docs/cron-cpu-audit/mock-overhead.mjs
node docs/cron-cpu-audit/analyze.mjs
```

Read-only live reproduction использует существующий локальный Wrangler OAuth profile `social-analytics`, читает credential внутри процесса, ничего не выводит. Token / scopes не копируются в evidence. SQL helper допускает SELECT/WITH/EXPLAIN и отклоняет mutations; GraphQL только queries. Не запускать `analytics.mjs` поверх сохранённого evidence, если требуется сохранить этот cutoff: новый запуск перезапишет JSON новыми текущими числами. `analyze.mjs` также потребует повторного обновления вставленных таблиц отчёта после новых замеров.

```sh
node docs/cron-cpu-audit/read-cloudflare.mjs inventory
node docs/cron-cpu-audit/read-cloudflare.mjs bundle
node docs/cron-cpu-audit/inspect-runtime.mjs
node docs/cron-cpu-audit/analytics.mjs
node docs/cron-cpu-audit/read-hot-sql.mjs
```

Исходные материалы изучены: AGENTS.md, collection-production-verification.md, instagram-data-implementation.md, cron-cpu-production-evidence.json, runtime/source/tests/build. Source data / private comments/OAuth secrets в fixtures не копировались; production aggregate/EXPLAIN results содержат counts, timings и обезличенные параметры. Только natural Cron продолжал изменять production counts.

**Проверки:** root `pnpm check` успешно: typegen/format/module boundaries/typecheck, **137 backend tests**, dry-run, **24 MCP tests** и MCP build. Проверен local migrations list: **No migrations to apply**; во всех свежих synthetic DB применены 13 существующих migrations. Новых migrations в аудит не добавлялось. Многочисленные предшествующие изменённые/untracked файлы workspace сохранены. Audit добавляет только docs/evidence/scripts; backend source/config не редактировались.

Предел итогового вывода: измерены local initialization overhead, bounded portion costs и D1 history scaling; live подтверждены версии,resource outcomes/CPU и отсутствие наблюдаемого memory/wall saturation. **Не измерены** точная billed production стоимость каждого этапа, индивидуальная CPU причина13 abort, actual billing plan/effective override, поведение cold isolates/fallback каждого production tick. Эти неизвестные нельзя заменить предположением о тяжёлой AI работе или утверждением о гарантированной достаточности Free.

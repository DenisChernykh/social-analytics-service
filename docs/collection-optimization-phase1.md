# Social Analytics — оптимизация сбора, этап 1

Проверено 9 октября 2026 года. Реализован core-first сбор и исправлено поведение `review_account`. Работа основана на [завершённом архитектурном аудите](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-architecture-review.md) и [его evidence](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-architecture-review-evidence.json); вариант B остаётся целевой архитектурой. Частоты, расписания, задания и курсоры этого этапа не менялись.

На идентичной смеси 12 fixtures, охватывающей 13 публикаций, основные числовые поля выросли **89 → 118 (+32.6%)**, а пригодные пары saves/reach и shares/reach вместе — **13 → 19**. Цена: HTTP **58 → 61 (+5,2%)**, D1 binding calls **377 → 388 (+2,9%)**. Это измеримый прирост пригодных данных, включая новые пары для анализа; число `not_supported` не использовалось как критерий успеха.

Поддерживаемые дополнительные поля сохраняются при достаточном остатке бюджета. Общий счётчик дополнительных чисел в этой смеси снизился **12 → 10**: две поддерживаемые метрики откладываются в fixture с жёстким budget=3. Эту потерю доступности в текущем наблюдении нельзя считать улучшением или скрывать за классификацией статусов. На остальных сравнительных fixtures с budget=6 дополнительных чисел **10 → 10**. Для полного устранения конкуренции с rich metadata нужен следующий этап.

**Реализация и файлы.**

- [ports.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/application/ports.ts) вводит узкий порт `additionalMetrics` и тип `MediaStatistics`. [sync-account.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/application/sync-account.ts) сначала получает основные данные всех публикаций страницы, затем выполняет продолжения. Сохранение происходит существующим атомарным `finish` с прежним fencing; ранних записей или чтения прошлых снимков для обогащения нет.
- [instagram-source.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/infrastructure/instagram-source.ts) выделяет Instagram scalar поля в основной запрос. В Reels там остаются обе watch-time метрики и skip rate. FEED/Story сохраняют прежнюю применимость; Story replies, navigation и FEED/Story profile_activity обрабатываются до cross-surface продолжения. `facebook_views` и применимый `crossposted_views` запрашиваются затем. Неполученные поля остаются null с причиной; saved/likes/comments не превращаются в неизвестные нули. Проверка saved backoff теперь даёт `request_deferred` и для structured Insights.
- [meta-client.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/meta-client.ts) сохраняет общий transport, HTTP budget, quota/backoff, receipts и capability scope. Для двух дополнительных полей при остатке не более двух attempts использует одиночные запросы без расхода слота на потенциально отвергаемый общий batch. Обычное продолжение ограничено одним batch и максимум двумя probes. Успешное дополнительное поле сохраняется при ошибке следующего. Ошибки параметров, source errors, права и исчерпание бюджета различаются; повреждённый ответ получает свой receipt. Отрицательный single-field probe кешируется по account/API/login/object/signature, без распространения отказа на другие публикации. TTL capability cache остаётся 24 часа.
- [review.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/reviews/application/review.ts) и [review HTTP](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/reviews/presentation/http.ts) явно отклоняют относительные review-режимы. [ApplicationError](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/shared/application/application-error.ts) и [Problem Details](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/platform/http/problem.ts) добавляют `FEATURE_UNAVAILABLE`/409.
- [roadmap-tools.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/roadmap-tools.ts) проверяет режим до обращения к backend. [server.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/server.ts) поясняет последовательное окно наблюдения и запрещает подстановку lastKnownGood в текущие поля. [OpenAPI](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/contract/openapi.json) заново получен из актуального backend; генерация MCP Zod выполнена, результирующие response-схемы остались совместимыми.
- Новые [fixtures](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1-fixtures.ts), [runner](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1-runner.ts) и [тесты](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1.spec.ts) проверяют настоящий MetaClient, policy, D1, HTTP API и отчёты. Обновлены ожидания порядка и стоимости в [instagram-data-quality.spec.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/instagram-data-quality.spec.ts) и [roadmap.spec.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/roadmap.spec.ts); добавлена MCP-проверка в [data-quality.test.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/data-quality.test.ts).

У каждой метрики остаются sourceField, unit, собственный receipt и время ответа. Продолжение расширяет окно **одной текущей операции** с семантикой `sequential_requests_lifetime`; оно не превращает последовательные ответы в единый момент измерения. Reach/saves/shares в улучшенных fixtures имеют один core receipt. Тест с новым sparse наблюдением после старого полного подтверждает: старый snapshot не изменён, новое facebookViews=null/deferred, lastKnownGood не подставлен в текущие metrics.

**Контракт review_account.**

`rankingMode` по умолчанию — `absolute`; явный absolute и отсутствие параметра сохраняют прежний разбор. `per_100_reach` и `per_100_views` возвращают `FEATURE_UNAVAILABLE`: backend HTTP 409, MCP isError с понятным объяснением и предложением `analyze_content` для saves/shares. Reach/reach не вычисляется. В backend отказ выполняется до evidence I/O; MCP не делает backend fetch даже к старой версии, которая игнорировала режим. Относительные режимы `analyze_content` сохранены и проверены существующими тестами. OpenAPI и tool description прямо описывают ограничение; enum оставлен для явного диагностического отказа прежним клиентам.

**Как сравнивалось поведение.**

Исходником «до» служит рабочее дерево в начале этапа, включая чужие незакоммиченные изменения, а не Git HEAD. Оно сохранено в [архиве исходников backend](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/baseline-backend-src.tar.gz) и проверяется по [SHA256 manifest](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/baseline-source-manifest.json). Обе версии используют одни fixtures, библиотеки, миграции, часы, token cipher, реальные repository/policy и одинаковый HTTP budget. Fixture latency=2 секунды двигает только часы наблюдений; реальные внешние запросы не выполняются.

Каждый запуск включает collection, один завершённый replay без повторного HTTP и чтение отчётов. Retry-after-failure включает повтор с тем же operationId и новым budget порции. Partial source error до исправления остаётся failed после двух попыток; после исправления сохраняет пригодное core-наблюдение. Миграции применены только к изолированным тестовым БД. Worker harness блокирует внешний outbound; production D1, API и active jobs не использовались.

«Основные числа» — количество Instagram scalar полей с известным числовым значением (`value !== null`), включая известные нули, Reels watch/skip и достоверный metadata fallback likes/comments. Это количество доступных полей, не сумма значений с разными единицами. Facebook/combined и structured поля считаются отдельно. Пригодная пара — настоящий `saveRate`/`shareRate` с известным числовым результатом из сохранённого наблюдения, совместимыми provenance и положительным reach. Нулевой числитель допустим; нулевой denominator исключает пару.

| Fixture | HTTP до → после | Основные числа | saves/reach пары | shares/reach пары | Deferred всего | Дополнительные числа |
|---|---:|---:|---:|---:|---:|---:|
| Reels: все поля поддерживаются | 3 → 4 | 11 → 11 | 1 → 1 | 1 → 1 | 0 → 0 | 2 → 2 |
| FEED: все применимые поля | 4 → 5 | 10 → 10 | 1 → 1 | 1 → 1 | 0 → 0 | 1 → 1 |
| Story: все применимые поля | 5 → 6 | 7 → 7 | 0 → 0 | 1 → 1 | 0 → 0 | 1 → 1 |
| Reels: отказ facebook_views + отказ alt_text | 6 → 6 | 2 → 11 | 0 → 1 | 0 → 1 | 9 → 0 | 1 → 1 |
| FEED: follows/profile_visits не поддержаны, profile_activity запрещён | 6 → 6 | 8 → 8 | 1 → 1 | 1 → 1 | 1 → 0 | 0 → 0 |
| Story: те же ограничения | 6 → 6 | 5 → 5 | 0 → 0 | 1 → 1 | 6 → 1 | 0 → 0 |
| Reels: facebook_views отказан, crossposted_views → 503 | 8 → 6 | 0 → 11 | 0 → 1 | 0 → 1 | 0 → 0 | 0 → 0 |
| Страница из двух Reels: общий budget=6 | 6 → 6 | 13 → 22 | 1 → 2 | 1 → 2 | 11 → 2 | 1 → 1 |
| Reels: первый core-запрос → 503, повтор того же operationId | 6 → 7 | 11 → 11 | 1 → 1 | 1 → 1 | 0 → 0 | 2 → 2 |
| Reels: реальные нули и отсутствующие значения | 3 → 4 | 9 → 9 | 1 → 1 | 0 → 0 | 0 → 0 | 2 → 2 |
| Reels: reach=views=0, budget=3 | 3 → 3 | 11 → 11 | 0 → 0 | 0 → 0 | 0 → 2 | 2 → 0 |
| Reels: budget=2 исчерпан до Insights | 2 → 2 | 2 → 2 | 0 → 0 | 0 → 0 | 11 → 11 | 0 → 0 |

Итого сохранённых media snapshots: **12 → 13**, structured числовых полей: **13 → 18**. Deferred основных scalar полей: **27 → 9**; всех учтённых scalar/structured полей: **38 → 16**. В строке partial_source_error «0 deferred до» означает отсутствие сохранённого наблюдения из-за failed операции, а не полное покрытие.

Причины оставшихся deferred после исправления:

- `story_restrictions`: 1 поле facebookViews — все 6 slots заняты профилем, каталогом, core fallback, navigation и profile_activity. Follows/profileVisits имеют object-scoped not_supported, profile_activity — permission_required.
- `page_budget_exhausted`: 2 cross-surface поля второй публикации — core получен для обеих; остаток потрачен на проверку и поддержанный crossposted_views первой. Основные пары второй публикации сохранены.
- `zero_denominator_deferred`: 2 cross-surface поля — 3 slots заняты profile/catalog/core. Reach и views равны настоящему нулю; save/share rate=null с zero_denominator.
- `pre_insights_budget`: 11 scalar полей (9 основных + 2 дополнительных) — 2 slots исчерпаны profile/catalog до Insights. Сохранены только известные like_count/comments_count; reach и пары отсутствуют. Здесь измеримого улучшения нет.

У `zero_missing` shares и average watch time=null/not_returned, а не resource-deferred; причина задержки источника не выдумана. У `partial_source_error` crosspostedViews=null/source_error со своим receipt, facebookViews=null/not_supported, core остаётся пригодным. Полный список полей и запросов есть в [comparison.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/comparison.json) и raw results.

**CPU и D1 на одинаковой нагрузке.**

Node: 5 прогревов + 40 измерений на fixture. Из main-thread CPU отдельно вычтен измеренный synchronous SQLite CPU; это дополнительная локальная проверка. Workerd: 3 прогрева + 20 измерений на fixture, V8 statistical profiler с requested interval 100 µs; sampled active time исключает `(idle)`. Начальная загрузка, создание app, seed и validation исключены. В измерение входят реальный collection/API/report путь, local D1 binding overhead и синтетический HTTP/JSON. MCP проверяется отдельно после CPU-замера, чтобы его код не маскировал стоимость backend.

| Fixture | workerd active CPU p50, мс до → после | p95 до → после | D1 calls до → после | SQL statements до → после |
|---|---:|---:|---:|---:|
| Reels: все поля поддерживаются | 10.82 → 10.01 | 21.27 → 11.78 | 24 → 27 | 37 → 42 |
| FEED: все применимые поля | 13.86 → 8.56 | 19.41 → 10.38 | 27 → 30 | 42 → 47 |
| Story: все применимые поля | 9.16 → 9.33 | 18.90 → 12.50 | 30 → 33 | 47 → 52 |
| Reels: отказ facebook_views + отказ alt_text | 9.36 → 9.27 | 14.50 → 14.52 | 34 → 35 | 55 → 56 |
| FEED: follows/profile_visits не поддержаны, profile_activity запрещён | 9.76 → 9.29 | 18.48 → 14.33 | 35 → 35 | 57 → 57 |
| Story: те же ограничения | 10.20 → 9.92 | 18.75 → 18.29 | 36 → 35 | 58 → 56 |
| Reels: facebook_views отказан, crossposted_views → 503 | 10.21 → 10.70 | 17.38 → 21.07 | 41 → 33 | 64 → 53 |
| Страница из двух Reels: общий budget=6 | 11.31 → 11.31 | 18.92 → 14.20 | 39 → 41 | 61 → 63 |
| Reels: первый core-запрос → 503, повтор того же operationId | 11.73 → 11.29 | 19.36 → 18.34 | 41 → 44 | 63 → 68 |
| Reels: реальные нули и отсутствующие значения | 8.27 → 7.72 | 16.37 → 15.44 | 24 → 27 | 37 → 42 |
| Reels: reach=views=0, budget=3 | 7.81 → 7.94 | 12.42 → 10.19 | 24 → 25 | 37 → 38 |
| Reels: budget=2 исчерпан до Insights | 6.42 → 6.70 | 15.13 → 8.84 | 22 → 23 | 33 → 34 |

Для одинаковой смеси, как сумма медиан отдельных случаев: workerd sampled active CPU **118.93 → 112.04 мс**; Node non-SQL CPU **20.30 → 17.95 мс**. D1 API calls **377 → 388**; SQL statements **591 → 608**. `batch` считается одним D1 call, даже если содержит несколько SQL statements; SQLite helper SELECT changes не включён в SQL count.

Эти CPU-числа не являются billed Cloudflare CPU или замером всего Cron. Sampling и локальные ожидания дают разброс; последовательный запуск вариантов может влиять на прогрев и состояние хоста. Снижение локального CPU не используется как доказательство экономии production. В частности, fully supported путь делает на один HTTP запрос больше. Дополнительный D1 read сохраняется даже при пустом HTTP остатке: он нужен для различения cached unsupported и deferred, а не отключён ради красивого CPU.

На этой смеси основных полей на HTTP attempt **1.534 → 1.934 (+26.1%)**; D1 calls на основное поле **4.236 → 3.288**. Смесь имеет равный вес fixtures и не является прогнозом реального распределения нагрузки.

Данные и повторение: [Node results](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/node-results.json), [workerd results](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/workerd-results.json), [build manifest](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/build-manifest.json), cpuprofiles в [каталоге evidence](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1). Из корня, с Node 24.18.0/pnpm 11.15.1:

```sh
node docs/collection-phase1/build.mjs
node docs/collection-phase1/node-profile.mjs
node docs/collection-phase1/workerd-profile.mjs
node docs/collection-phase1/summarize.mjs
pnpm check
```

Workerd profiler требует разрешённого локального loopback/inspector. Node shim служит безопасной независимой альтернативой проверки данных и D1 calls; оба способа выполнены. Build проверяет hashes архива, baseline-файлов и фиксирует SHA256 общего harness. Comparison script сверяет точные data/call counters между Node и workerd.

**Проверки и сохранение данных.**

Root `pnpm check` прошёл полностью: **161 backend tests / 14 files**, **25 MCP tests**, typegen check, Biome, module boundaries, TypeScript, Worker dry-run и MCP build. Backend/OpenAPI/MCP совместимость проверена, включая оба относительных отказа review и рабочий absolute. Настоящий MCP Client/StreamableHTTP adapter дополнительно проверил **25 отчётов** через локальный backend по **24 сравнениям fixture/version**: metrics, calculated, observation, structured provenance сохранены. Story replies сохраняет provenance; избыточный raw receipt нормализуется существующей Zod-схемой.

Новые сценарии проверяют failure/retry/replay, shared budget, metadata rejection, поддержанные watch/skip и cross-surface поля, single-object cache reuse и новый поддержанный объект, source/parameter/schema errors, нули, null, history retention и quota backoff для Reels/Story. Прежние scheduled-тесты уточнены: happy HTTP 3 → 4, repeated metadata rejection 5 → 6; **first useful core time остаётся 750/1250 ms**, profile сохраняет время собственного ответа. В последнем сценарии поддержанный crossposted_views откладывается, если rich metadata заняли четыре slots до core; это дополнительный подтверждённый предел текущего этапа.

[checks.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1/checks.json) фиксирует gate и hashes. Ни один из 276 исходных файлов не исчез. Незапланированных содержательных изменений вне области этапа не обнаружено. Параллельно изменившийся account-insights/application/insights.ts приведён к repository formatter; нормализованный JS до/после совпадает, его логика сохранена. Старые наблюдения, active jobs и курсоры не сбрасывались. Migrations/schema/dependencies, Cron/частоты и wrangler конфигурация не изменены; invocation logs отключены. Deployment был только `--dry-run`; remote migrations и push не выполнялись.

Документация Meta сверена через Context7: [media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) и [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog). Facebook/combined являются отдельными поверхностями; доступность зависит от конкретного media, поэтому отказ одного объекта не означает отсутствие поддержки у всех. Политика сохранения и fallback проверена кодом/fixtures, а не предположением о документации.

**Остаточные риски и выпуск.**

Код и контракты готовы к согласованному выпуску после отдельного разрешения. Результат доказан на воспроизводимых fixtures; production эффект и billed CPU не измерены, поскольку deploy не делался. При выпуске нужен новый release revision, smoke существующих backend/MCP инструментов и сравнение receipts/coverage на доступных Reels, FEED и Story. Новых миграций нет.

Цена полностью поддержанного сбора — дополнительный HTTP attempt и обычно три D1 calls. При очень малом budget, metadata fallback или близком deadline дополнительные поддержанные поля откладываются; неизвестные значения не заменяются нулями. Исчерпание бюджета до core остаётся нерешённым. Capability cache может удерживать object-scoped отрицательное доказательство до 24 часов после изменения crossposting. Completed partial операция при replay не добирает поля: для нового наблюдения нужен новый operationId/следующая разрешённая порция. Изменчивость реального Meta API, квоты и невозможность восстановить исчезнувшие Stories остаются ограничениями источника.

**Следующий этап — лёгкий discovery и отдельные метаданные.**

1. Добавить явный лёгкий каталог-порт с базовыми полями id/caption/media type/product type/permalink/timestamp. Из discovery исключить rich metadata probes и автоматический вызов Insights для каждого уже известного media. На странице одним bounded D1 чтением определить известные IDs и обновить базовые сведения, сохраняя firstDiscoveredAt и cursor.
2. Планировать Insights отдельно для новых media и существующих доказанных due-обязательств, используя текущие job identities, leases, selection и HTTP/quota budget. Сохранить явный manual full/refresh и совместимость MCP; не менять частоты на этом этапе.
3. Сделать отдельный ограниченный refresh rich metadata в существующей D1: собственный receipt/observedAt и capability signature, без создания metric snapshot. Отказ alt_text/media_audio_type не должен занимать slots до core. Не перезаписывать ручные title/duration/context и сохранённую ранее богатую metadata пустыми полями.
4. На той же fixture-проверке добавить known-only page, mixed new/known IDs, несколько metadata refusals, resume после interrupted discovery, quota/deadline и changed caption. Критерии: known-only discovery не вызывает Insights, новые/core-due публикации сохраняют пары, metadata failure не уменьшает core coverage, jobs/cursors/history остаются совместимыми. Повторить CPU/D1 измерение, затем отдельно согласовать выпуск.

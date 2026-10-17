# Social Analytics — подготовка production-выпуска этапа 1

Подготовлено 9 октября 2026 года. Backend остаётся в существующем Cloudflare Worker `api` и D1 `social-analytics-db`. Подготовлены backend **0.2.17** и совместимый MCP **0.4.1**. Deployment, push, remote migrations, ручной сбор и включение invocation logs не выполнялись. Этап 2 не начат.

Код прошёл все gates; известных блокеров в коде или схеме нет. **Суточная эксплуатационная приёмка 0.2.16 ещё не закончена.** Рекомендуемый порядок — дождаться полного окна и проверить его перед разрешённым выпуском. Высокий production CPU остаётся риском, который core-first не объявляет устранённым. Готовность к публикации условна: отдельное разрешение владельца и свежий read-only preflight обязательны.

**Git и изоляция выпуска.**

Исходный `main`/HEAD — `8ed0040c31c818e7331a991704a77e6870b94c6b`; index был пуст. В рабочем дереве уже находились изменения прежних production-выпусков и другие работы. Простое staging целых файлов поверх HEAD включило бы их в новый функциональный commit.

Создана отдельная локальная ветка `release/collection-phase1` с двумя технически раздельными точками:

- `f2266e001b34b6b7f94030d7e74251423cd26c2d` — восстановленная **подтверждённая production-база 0.2.16**. Все 85 source hashes из прежнего release evidence совпали с сохранённой базой. Недостающие исходные tests/OpenAPI восстановлены с точным совпадением первоначальных SHA256. Её новая Wrangler dry-run сборка побайтно совпала с повторно скачанным активным Worker: SHA256 `a6034b1536f348711a692e9c9c5b16cfb7b01700e199faeb78a9444b6036eda8`. MCP inputs совпали с manifest уже выпущенной 0.4.0.
- `474d7bafa3460eb62d747c68367d3be0b5268498` — **отдельный commit этапа 1**, сравниваемый с этой базой. В нём только core-first, отказ относительных review-режимов, необходимые contracts/tests/evidence, release revisions и одна обязательная formatter-only правка. Не следует cherry-pick этого commit непосредственно на старый `main`: сначала нужна подтверждённая база, которая уже работает в production.

Runbook и проверочные материалы добавлены следующим отдельным documentation commit на той же ветке. Источник для сборки выпуска фиксирован полным implementation SHA выше; документация не меняет runtime.

Использован отдельный Git index и создание ветки без checkout/stash/reset текущих файлов. Проверены **317 исходных файлов**, изменений или исчезновений нет; настоящий index и HEAD `main` сохранены. Чужие изменения остались на своих местах. В release trees нет `.dev.vars`, `.env`, credentials, локальной D1 или `node_modules`.

Проверенный экспорт: `/Users/denischernykh/Documents/ChatGPT/social-analytics-service/tmp/phase1-release/candidate`. Это экспорт файлов, а не отдельный Git checkout; для повторения используйте `git archive` точного SHA по командам ниже. Не запускайте production deploy из текущего грязного `main`.

**Файлы, входящие в релиз относительно production-базы.**

| Область | Файлы | Назначение |
|---|---|---|
| Основной сбор | [ports.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/application/ports.ts), [sync-account.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/application/sync-account.ts), [instagram-source.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/analytics/infrastructure/instagram-source.ts), [meta-client.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/instagram/infrastructure/meta-client.ts) | Core всех публикаций страницы до bounded cross-surface continuation; watch/skip, scoped cache, общий budget/backoff/quotas, отдельные receipts и причины null |
| Review/backend errors | [review.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/reviews/application/review.ts), [review HTTP](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/reviews/presentation/http.ts), [ApplicationError](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/shared/application/application-error.ts), [Problem Details](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/platform/http/problem.ts) | `absolute` сохраняется; относительные review-режимы дают `FEATURE_UNAVAILABLE`/409 до evidence I/O |
| MCP/contracts | [roadmap-tools.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/roadmap-tools.ts), [server.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/server.ts), [OpenAPI](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/contract/openapi.json) | Preflight review до fetch, честная семантика observation, MCP version 0.4.1; response Zod contract совместим и не изменён |
| Backend tests | [fixtures](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1-fixtures.ts), [runner](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1-runner.ts), [phase1.spec](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/collection-phase1.spec.ts), [data-quality.spec](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/instagram-data-quality.spec.ts), [roadmap.spec](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/test/roadmap.spec.ts) | Бюджет, fallback, provenance, cache scope, replay, история, нули, partial errors, порядок Story и расходы |
| MCP tests | [data-quality.test.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/src/data-quality.test.ts) | Relative review отказ и сохранение absolute/default |
| Release metadata | [wrangler.jsonc](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/wrangler.jsonc), [MCP package](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/package.json), [plugin.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/chatgpt/plugin/plugin.json) | В **release commit**, соответственно, только 0.2.17 и 0.4.1; текущие файлы main сохраняют прежние revisions |
| Formatter-only | [account-insights/application/insights.ts](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/backend/src/modules/account-insights/application/insights.ts) | Два переноса строк, без изменения нормализованного JS; нужны для formatter gate |
| Доказательства | [phase1 report](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-optimization-phase1.md), [phase1 evidence](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1), этот runbook и [release evidence](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release) | Воспроизводимая база, 12 fixtures, measurements, production reads, manifests и rollback check |

Всего **21 runtime/config/contract/test файл** в implementation diff плюс 37 файлов phase1 documentation/evidence. Проверены allowlist и отсутствие diff в migrations, schema и всём `modules/collection`. Repository dependencies/lockfile, scheduled composition, age/comment/activity policies, Cron и cursor formats не изменены. Никакой перенос инфраструктуры или дополнительное storage не включены.

**Проверки и миграции.**

Дважды успешно выполнен полный root `pnpm check`: в текущем проекте и в изолированном точном release-кандидате **0.2.17/0.4.1**. В каждом — **161 backend tests / 14 files + 25 MCP tests**, typegen, Biome, module boundaries, TypeScript, Worker dry-run и MCP build. Существующее информационное предупреждение Biome в export-sites не блокирует gate. Production credentials в изолированный экспорт не копировались; тесты используют собственные synthetic bindings.

Для изолированных каталогов выполнен обычный host-capable `pnpm install`: Node 24.18.0, pnpm 11.15.1, один root lockfile, 200 packages повторно использованы без скачивания и изменения lockfile. Переиспользование зависимости через symlink было отклонено pnpm проверкой соответствия workspace; политика не отключалась, основная установка не менялась.

Точная будущая upload-команда проверена с `--dry-run --no-bundle`; artifact не изменился. [release-manifest.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/release-manifest.json) фиксирует 175 input hashes и обе сборки:

- Worker `backend/dist/index.js`: **1 723 715 bytes**, SHA256 `ce31c1b0e39fd36646a17d5005ee2f66e72d2ac33fdd0bed5dcd523ccce43cf8`.
- MCP `chatgpt/dist/server/index.js`: SHA256 `3d3a3bbe7f8048d5c6a717ad83cb2aa415dc1e82c4d3c9a53ed4b8308d70a3ec`.

**Миграции не нужны.** Все 13 существующих SQL migrations `0000–0012` уже присутствуют в production `d1_migrations`; имена совпадают, локальные SQL hashes совпадают с опубликованным source inventory. Schema и migrations не менялись в этапе 1. Команда remote migrations в процедуру выпуска не входит.

[Rollback compatibility](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/rollback-compatibility.json): новый writer сохранил 13 отчётов на 12 fixtures; reader из immutable базы 0.2.16 прочитал точные metrics/calculated/observation/source/structured provenance. Replay завершённых операций старым кодом сделал **0 HTTP attempts** и сохранил hashes snapshots/receipts/sync checkpoints. Активные jobs используют тот же executor/store, schema, IDs, lease/fence и cursor formats; recovery проверяется существующими root tests. Это совместимость кода/данных на fixtures, не выполненный production rollback.

**Production 0.2.16: свежая read-only проверка.**

Основной свежий evidence — [production-latest.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/production-latest.json); первый независимый срез — [production.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/production.json). Выполнялись backend GET, Cloudflare GET/GraphQL queries и D1 SELECT. Первый Cloudflare read получил expired OAuth 401; существующая сессия обновлена штатным read-only `wrangler whoami`, затем все проверки прошли. Дополнительные неиспользуемые OAuth scopes не запрашивались, tail/logs не включались.

Активен **тот же** Worker version `e659a098-741f-47ba-891f-ad25274efa70`, 100%. `/health` — 200 / 0.2.16; неавторизованный accounts GET — 401. Скачанный активный bundle совпадает с подтверждённой базой. D1 binding, API v26.0, redirect, Cron `*/5 * * * *` и выключенные invocation logs сохранены. Settings: usageModel=standard, limits не возвращены; это не доказательство оплаченного тарифа или effective CPU override.

| Проверка | Фактический результат |
|---|---|
| Окно метрик | **[2026-10-09 06:30, 15:59 UTC)** — 9 ч 29 мин, не сутки; последним минутам дан запас на ingestion |
| Cron отдельно от HTTP | **114 / 114 ожидаемых слотов**, все success; errors/exceededResources, пропуски и дубли — 0 |
| Cron CPU | p50 **38,954 ms**, p95 **66,174**, p99 **96,552**, maximum **155,473** |
| Worker mixed, exact version | 455 invocations, 0 errors; включает диагностические GET, поэтому не используется как Cron CPU |
| HTTP receipts этого окна | **391 attempts / 391 responses**: 257 success, 131 not_supported, 2 invalid_breakdown, 1 object_unavailable; transport/source errors, pending, timeout, rate-limit — 0; actual/requested API v26.0 |
| D1 этой базы, то же окно | **4 549 read queries / 2 725 write queries**, 1 496 003 rows read / 5 626 rows written; batch p50/p99 **0,44/10 ms**; включает диагностику |
| Jobs на собственном API cutoff | **252**, полный обход трёх страниц без дублей, D1 COUNT на том же cutoff совпал; 245 completed, 4 running, 3 cancelled, failed 0 |
| Активные jobs | manual 72 pages; activity 73; comments 1 515 pages / 3 324 observations / 167 publications; новый comments_refresh 1 page; ошибок и failures нет |
| Данные | 247 media; **775 media snapshots**, 715 account snapshots, 173 account-insights, 3 791 comments; policy-history 1 |
| Исторический прогресс | Activity **52→74/103** относительно среза 06:47, missing **51→29**; manual **50→72**; comments **1 493→1 515 pages**, observations **3 187→3 324** |
| Quota | unknown_schema/unknown, usagePercent=null, blockedUntil=0; неизвестная квота не названа нулевой |
| Возрастные обязательства | 24h **2/2**, 720h **2/2**, recorded missed/open 0; legacy unknown history отдельно |
| Saved report | Реальный Reels: 10 основных числовых полей, пригодные saves/reach и shares/reach, SQL/API observedAt совпал. Receipts показывают старый смешанный core+crossposted запрос и fallback. FEED/Story в bounded последней выборке отсутствовали — live проверка этих типов не заявляется |

Сам факт success при CPU выше 10 ms не доказывает устойчивость или тариф. Ночные 13 exceededResources относились к прежней 0.2.15; на проверенной части 0.2.16 их нет. Это сильнее первоначальных трёх successful Cron, но полные сутки ещё не прошли.

Точка завершения первых суток от обычного Cron — **2026-10-10 06:30:42 UTC / 11:30:42 Asia/Yekaterinburg**. Скрипт оставляет 5 минут на ingestion: полный срез разумно получать после **11:36 по Екатеринбургу**. Окно остаётся неполным, если версия сменится раньше; суточное окно нельзя составлять из двух версий.

**Порядок выпуска после отдельного разрешения.**

1. Повторить read-only preflight, дождаться суточного gate по рекомендованному порядку. Проверить active version, DB binding, schedule/policy, активные IDs/cursor hashes и историю. При новых exceededResources или остановке due-прогресса сначала разбирать конкретную регрессию, не переносить сервис и не менять частоты. Сохранить текущий version ID как rollback target и pinned fingerprints по процедуре ниже; если он уже отличается от evidence, выпуск остановить до новой сверки.
2. Получить свежий экспорт exact implementation SHA; выполнить install/check/hash guard. Не переносить приватные файлы в этот экспорт.
3. После разрешения публикации MCP выпустить **0.4.1 в существующем private проекте** `appgprj_6abf85476cec8191928b2376b9e8626f`: source из этого release export, штатный `chatgpt/scripts/export-sites.mjs`, сохранённая версия и native deploy существующего проекта. Сохранить plugin ID, owner-only access и runtime env; D1/R2/automations не добавлять. Проверить оба relative review отказа до backend fetch, рабочий absolute/default и чтения старого backend 0.2.16. Backend остаётся Cloudflare; это обновление уже существующего adapter, не перенос инфраструктуры.
4. Загрузить только проверенный Worker artifact как новую **неактивную** version; записать возвращённый VERSION_ID, view/settings. Проверить BUILD_REVISION, тот же DB и неизменные compatibility flags. Затем отдельной командой переключить этот VERSION_ID на 100%. Не делать split между двумя реализациями stateful collection. Старые уже начатые Cron могут завершаться; их от дублирующих writes защищают прежние leases/fences.
5. Немедленно выполнить GET smoke и скачать активный module для сравнения с manifest. Затем наблюдать **существующие** natural Cron, без manual sync/advance/refresh или изменения schedule. Начало нового окна — первый полный пяти минутный слот после deployment; сохранить точный version ID и cutoff.

Команды подготовки из текущего корня (создают новый каталог, `mkdir` должен отказать при его наличии):

```sh
node --version
pnpm --version
mkdir tmp/phase1-release/publish-474d7ba
git archive 474d7bafa3460eb62d747c68367d3be0b5268498 | tar -x -C tmp/phase1-release/publish-474d7ba
cd tmp/phase1-release/publish-474d7ba
pnpm install
WRANGLER_SEND_METRICS=false pnpm check
node /Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/verify-manifest.mjs "$PWD"
```

**Только после разрешения upload/deploy**, из этого проверенного экспортного корня:

```sh
WRANGLER_SEND_METRICS=false pnpm --dir backend exec wrangler versions upload dist/index.js --no-bundle --tag collection-phase1-0.2.17 --message "Core-first Insights and explicit review ranking rejection; source 474d7bafa3460eb62d747c68367d3be0b5268498"
# VERSION_ID: точный UUID, возвращённый upload; заполнить перед следующими командами.
pnpm --dir backend exec wrangler versions view "$VERSION_ID"
pnpm --dir backend exec wrangler versions deploy "$VERSION_ID@100" --message "Release collection phase 1, backend 0.2.17" --yes
pnpm --dir backend exec wrangler deployments list
```

`versions upload` не активирует код; `versions deploy` — отдельная мутация. Эти команды **не выполнялись**. `triggers deploy`, secret upload и migrations apply не нужны: triggers/DB/secrets должны остаться прежними. Wrangler syntax сверена с локальной 4.127.1 и [официальной документацией commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [versions](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Push при необходимости — отдельное разрешённое действие: `git push origin release/collection-phase1`; main автоматически не merge/rebase. Git и Cloudflare публикация не выполняются неявно друг через друга.

**Как проверить core-first после выпуска на настоящих наблюдениях.**

Из исходного workspace, где уже находится приватная локальная конфигурация, выполнить сохранённый read-only скрипт. `RELEASE_WINDOW_START` — ISO UTC первого полного пяти минутного слота после deployment (например, вычисленный по фактическому created_on, а не выдуманный timestamp); start должен быть кратен пяти минутам.

```sh
node docs/collection-phase1-release/production-read.mjs tmp/phase1-release/post-release.json "$RELEASE_WINDOW_START" 0.2.17
```

До выпуска зафиксировать конкретные старые facts и active jobs, а после — сравнить именно те же IDs. Это проверяет сохранение данных точнее общего COUNT; наблюдаемая выборка истории ограничена 12 snapshots, полная immutable история проверена fixtures и отсутствием storage/schema diff.

```sh
node docs/collection-phase1-release/preservation-read.mjs tmp/phase1-release/pre-deploy-preservation.json
# После разрешённого выпуска:
node docs/collection-phase1-release/preservation-read.mjs tmp/phase1-release/post-deploy-preservation.json tmp/phase1-release/pre-deploy-preservation.json
```

Скрипт использует только SELECT, хранит hashes вместо приватных payloads/cursors, требует прежние snapshot facts и policy/settings, те же job IDs и отсутствие reset counters. Реальное продвижение cursor или completed status разрешено. Уже сохранённый первичный срез — [preservation-production.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/preservation-production.json). Повторное read-only сравнение тех же 12 facts, policy/settings и трёх job IDs уже прошло на текущей 0.2.16: [preservation-repeat.json](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/docs/collection-phase1-release/preservation-repeat.json). Если владелец отдельно менял policy/settings или отменял job, сравнение требует объяснения этой мутации; не объявлять её следствием release автоматически.

Скрипт проверяет revision, одну active version 100% и отсутствие pre-deploy времени в окне; сохраняет exact-version mixed analytics, отдельные Scheduled, D1/HTTP, jobs/cursor hashes и bounded saved reports/receipts. Он ограничивает окно первыми 24 часами и явно сообщает full24hAvailable. GET/SELECT не запускают сбор. Для полного baseline 0.2.16, пока она остаётся active:

```sh
node docs/collection-phase1-release/production-read.mjs tmp/phase1-release/baseline-24h.json
```

Приёмка core-first включает все следующие признаки:

- На новых Reels, FEED и естественно доступных Story проверить сохранённый report и историю. Нет живой Story — отметить этот live gate непроверенным; fixture не выдаётся за реальное наблюдение. Для каждого типа считать количество основных чисел, пригодных saves/reach и shares/reach, optional чисел, deferred с причинами и attempts. Сравнивать coverage/attempt при похожем типе и бюджете; рост самих lifetime значений не является эффектом оптимизации.
- В `savedReports.reports[].attempts` core scalar request не содержит facebook_views/crossposted_views; watch/skip остаются в Reels primary. По operationId полный core проход страницы идёт до дополнительных запросов. Explicit refusal одного object не превращает другие media в unsupported. При cached отрицательном доказательстве отдельного запроса может не быть — проверять reason/cache, не требовать искусственный probe.
- Reach/saves/shares с известным положительным reach дают настоящий рассчитанный rate. При null, нуле denominator, несовместимой provenance rate остаётся null с причиной. У optional полей свой receipt/time; observation — последовательное окно, без подстановки lastKnownGood и без переписывания старого snapshot. На error/deferred core остаётся пригодным, если был получен. Исторический sparse report остаётся sparse.
- На отказе cross-surface API убедиться, что core сохранён, другой поддерживаемый дополнительный field сохранён при бюджете, неполученный имеет явную причину. Нет подходящего реального отказа — live сценарий ещё не наблюдался; не создавать сбой или массовый сбор ради демонстрации.
- Проверить shared **6 attempts на порцию**, saved quota/backoff, pending/timeouts и не сбрасывающиеся epoch counters. Total attempts длинного job или logical retry может быть больше 6; это не превышение portion budget. Completed replay не добирает поля — новое наблюдение требует следующей естественной операции.
- HTTP GET review с обоими относительными режимами должен дать 409 FEATURE_UNAVAILABLE; absolute/default — 200 для допустимого периода. MCP relative review — isError с объяснением, absolute — прежний анализ, `analyze_content` relative — рабочий контракт. `/openapi.json` содержит новый query description. GET/report tools не создают Meta receipts; естественный Cron во время smoke учитывать отдельно.
- Сверить прежние active job UUIDs: cursor/queue продвигаются либо job корректно завершился; pages/collected не сбрасываются. Сохранить history IDs/hashes для конкретных старых snapshots: общий COUNT сам по себе не доказывает отсутствие удаления. Policy history/version/effectiveFrom, schedule и D1 binding не меняются из-за code deployment.
- Первый smoke и три Cron дают только раннюю проверку. После **24h той же exact version**, лучше 48h/два daily cycles, проверить ожидаемые slots, errors/exceededResources, CPU p50/p95/p99/max, HTTP receipt totals и D1 queries/rows, полезные новые observations и deadlines. D1/mixed включают диагностические reads; не объявлять production CPU улучшенным по локальному benchmark или одной удачной ночи.

Пределы известных расходов из fixtures: main numbers 89→118, пары 13→19 при HTTP 58→61 и D1 calls 377→388. Fully supported путь стоит дополнительного HTTP и обычно трёх D1 calls. Две поддерживаемые extras откладываются при budget=3; metadata refusals также могут занять остаток. Это принятый и явно видимый риск stage1, не обещание улучшить все workload.

**Откат кода при регрессии.**

Причины остановки/отката: новый resource error после выпуска, повторяемое падение core/watch/skip coverage при сопоставимом остатке бюджета, потеря пригодных пар из-за provenance, нарушение HTTP budget, повторные snapshots/replay writes или остановка ожидаемого due-прогресса без объясняющего backoff. Один ожидаемый provider not_supported, нет живой Story или отказ optional при исчерпании бюджета сами по себе не доказывают регрессию.

После разрешения отката использовать **точный сохранённый immutable version ID**, не «предыдущую upload version», поскольку между ними может быть неактивный upload:

```sh
pnpm --dir backend exec wrangler rollback e659a098-741f-47ba-891f-ad25274efa70 --message "Rollback collection phase 1 to verified 0.2.16; preserve D1 and jobs" --yes
pnpm --dir backend exec wrangler deployments list
```

Действие создаёт новый deployment прежнего кода на 100%; D1 данные не восстанавливать назад, migrations не откатывать, job IDs/cursors/leases/policy не reset. Проверить health=0.2.16, active module SHA исходной базы, прежний D1/Cron, чтение новых/старых reports и продвижение незавершённых jobs. Сохранённые stage1 snapshots/receipts остаются настоящей историей; старый reader совместим с ними.

MCP 0.4.1 можно оставить: он совместим с прежним backend и сохраняет явный relative review отказ. Откат backend возвращает прежний backend mismatch для прямого relative review — такие direct вызовы при откате не использовать. Только при отдельной регрессии adapter восстановить существующую private Sites version 13 (deployment `appgdep_6ac7b6a89a8081918ab53fb76730d986`, source `0bda71f779fff2ce07895bbf02f28b21481003bf`) с прежними owner access/runtime env; это отдельное разрешённое действие. Старый adapter теряет новый preflight, поэтому absolute-only review надо сохранить как эксплуатационное ограничение до исправления.

Необходимость разрешения исходит из [AGENTS.md](/Users/denischernykh/Documents/ChatGPT/social-analytics-service/AGENTS.md): «Deployment, remote migrations and push require explicit authorization». Этот документ готовит конкретный проверенный выпуск; разрешение на его выполнение в данной задаче не дано.

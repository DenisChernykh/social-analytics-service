# Остановка сбора 11 октября 2026

Проверка production только чтением. Начальный статус: 11:16:08 UTC; повторный: 11:20:03 UTC / 16:20:03 Asia/Yekaterinburg. Данные Cloudflare Analytics имеют cutoff 11:10 UTC для задержки ingestion. GET/GraphQL queries/SELECT не запускали сбор; код, расписание, миграции и production не изменялись. Invocation logs и tail не включались. Wrangler обновил существующую локальную OAuth-авторизацию во время чтения deployments.

**Сбор действительно остановился.** Последний сохранённый ответ Instagram: 11 октября **12:40:18.466 по Екатеринбургу** (07:40:18.466 UTC), HTTP 200/success. Последний снимок публикации: 12:35:22.759. Повторное чтение спустя четыре минуты подтвердило отсутствие прогресса.

## Подтверждённые факты

- Worker отвечает `/health` HTTP 200, revision `0.2.16`. Active version `e659a098-741f-47ba-891f-ad25274efa70`, 100%, deployment от 9 октября 06:29:40 UTC. Скачанный active bundle SHA256 `a6034b1536f348711a692e9c9c5b16cfb7b01700e199faeb78a9444b6036eda8` совпадает с ранее зафиксированным production bundle. Подготовленный candidate `0.2.17` не активен.
- Cron `*/5 * * * *` включён. В окне 10 октября 00:00 — 11 октября 11:10 UTC присутствуют все **422** ожидаемых пяти минутных слота: **372 success / 50 exceededResources (11.85%)**. Первая ошибка в окне: 10 октября 01:45:15 UTC; значит проблема повторялась уже вчера на той же версии.
- После 11 октября 07:45 UTC: **41 вызов / 16 exceededResources / 25 success** до cutoff. Для 40 однозначно сопоставленных singleton minute/status mixed groups число subrequests равно нулю. Один вызов не имеет однозначного singleton соответствия; его subrequests не приписываются Cron. После 07:40 UTC сохранённых Instagram HTTP receipts нет. Следовательно, `success` запуска не доказывает обновление данных.
- Из 50 ресурсных ошибок **34 имеют CPU ровно 10.000 мс**. 14 других — 10.183–14.557 мс; два начала серии — 36.854 и 46.224 мс. Для singleton resource-error groups память 8.59–10.96 MB, что не похоже на достижение документированного лимита памяти 128 MB. Wall time и CPU не смешиваются.
- Шесть due jobs: `manual`, `comments`, `activity`, `audience`, `scheduled`, `stories`. Каталог остановился на 161 странице/публикации, комментарии — 1604 страницы, 171 обработанная публикация, 3900 observations; статус сообщает ещё 65 публикаций для текущего прохода комментариев. Новые activity/audience/discovery jobs имеют 0 страниц. Повторное чтение не показало движения этих агрегатов.
- Истёкшие collection leases видны у manual/comments/activity/scheduled. Последняя попытка discovery: 11:00:17 UTC, lease истёк в 11:15:17 UTC. При этом pages=0, failures=0, errorCode=null. Обновление lastAttempt означает запись claim, а не выполненный сбор.
- Сохранено 249 media, 946 media snapshots, 3813 уникальных комментариев, 2043 HTTP receipts. Последние receipts показывают успешные ответы и ожидаемые отказы отдельных метрик `not_supported`, а не общий отказ авторизации. В API status: rateLimitedResponses=0, timeouts=0, failuresBeforeResponse=0, blockedUntil=0. Header schema неизвестна, usagePercent=null: свободная квота этим не доказана.
- Отдельно Stories: один failed job с `INSTAGRAM_UNAVAILABLE` после пяти неудач; текущий running Story job имеет четыре неудачи. Эта локальная проблема источника требует отдельного разбора; она сама по себе не объясняет остановку всех остальных видов работ.

## Вывод и предел уверенности

Ресурсные обрывы исполнения Worker подтверждены Cloudflare Analytics. Их порог и низкое использование памяти указывают прежде всего на CPU. Точное внутреннее место остановки не измерено: invocation logs выключены, production profiling не проводился.

В текущем коде claim сохраняет lease/lastAttempt до основной обработки, а save ошибок и счётчиков находится после обработки в try/catch. Принудительное завершение исполнения согласуется с сохранённым claim, истёкшим lease и отсутствием финальной записи. Это объяснение механизма, а не stack trace конкретного обрыва. После истечения lease выполнение должно снова пробоваться; сброс lease/курсоров вручную не устраняет ресурсную причину.

Remote settings показывают `usage_model=standard`, `limits=null`. Это не подтверждает Workers Paid или фактический CPU override. Account subscriptions возвращает 403 из-за недостаточных прав. По официальной [документации лимитов Cloudflare](https://developers.cloudflare.com/workers/platform/limits/) Workers Free имеет 10 мс CPU, а Paid Cron с интервалом меньше часа — 30 с. Наблюдаемые successful вызовы с CPU выше 10 мс не устанавливают тариф или гарантированный лимит. Выбирать платный тариф либо менять CPU setting без проверки нельзя.

Следующий шаг: подтвердить фактический Workers plan/CPU setting в панели владельца и сопоставить с характерным порогом; затем подготовить адресное снижение CPU в Cron/preflight/bookkeeping на подтверждённом production source. Подготовленный ранее core-first candidate не проверен как исправление текущих обрывов. Возобновление проверять на естественных Cron одновременно по отсутствию resource errors, новым receipts/snapshots и продвижению тех же jobs/cursors. Не считать HTTP health или единичный Cron success приёмкой. Времена и counts в этом документе — срез, не бессрочный мониторинг.

Первичные измерения: [collection-incident-2026-10-11-evidence.json](./collection-incident-2026-10-11-evidence.json). В evidence нет токенов, OAuth state/codes, текстов комментариев или непрозрачных курсоров.

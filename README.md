# Social Analytics

Личный backend для статистики соцсетей. Первая интеграция — официальный
Instagram API с Instagram Login. Один Cloudflare Worker, Hono, D1 и Drizzle;
фоновый сбор выполняет Durable Object с сохраняемыми alarms.
архитектура следует модульному backend проекта `planner`.

Social Analytics и его плагин предназначены для всех соцсетей владельца.
Сейчас реализован только Instagram; другие интеграции будут добавляться
в этот же проект.

Адрес backend: **https://api.social-insights.workers.dev**.
Контракт: `/openapi.json` (OpenAPI 3.1), доступность: `/health`.
`/health` проверяет Worker, а не соединение с Instagram.

Backend собирает публикации, Stories и снимки доступных метрик, ищет ролики,
сохраняет периодную статистику аккаунта и контекст публикаций. Сравнения на
одинаковом возрасте, бизнес-результаты, гипотезы и разборы периода сохраняют
источники, время сбора, формулы и пробелы данных. Реализация backend дорожной
карты #15 описана в [docs/backend-roadmap.md](docs/backend-roadmap.md).
Для ChatGPT добавлен отдельный MCP-адаптер на Sites:
[подключение Social Analytics](chatgpt/README.md).

Instagram `tanyastrelchuk` подключён. Первичный обход 2026-10-02 завершён:
сохранены 236 уникальных публикаций. Проверены реальные метрики и расчёты;
результаты проверки — в [docs/deployment.md](docs/deployment.md).

## Использование

Node 24, pnpm 11.15.1. Все команды выполняются из корня проекта.

```sh
pnpm install
pnpm setup:local
pnpm db:migrate:local
pnpm check
```

`setup:local` создаёт личный ключ API, ключ шифрования и verify token webhook в `backend/.dev.vars`
с правами `0600`, сохраняет существующие значения и не выводит секреты.
Instagram App ID и App Secret задаются в этом файле отдельно. Нужны именно
идентификатор и секрет Instagram-продукта, а не родительского Meta-приложения.
Переменные перечислены в `backend/.dev.vars.example`.

Для локального Worker выполните `pnpm dev`. При локальной проверке API задайте
`SOCIAL_ANALYTICS_URL=https://localhost:8787` в окружении команды.
Для локального OAuth также задайте `ENVIRONMENT=development` и
`INSTAGRAM_REDIRECT_URI=https://localhost:8787/api/instagram/oauth/callback`
в `.dev.vars` и зарегистрируйте тот же callback в Meta.

Для развёрнутого сервиса локальный помощник берёт адрес из конфигурации Worker,
а ключ — из `.dev.vars`; ключ не попадает в историю команд:

```sh
pnpm api connect
pnpm api accounts
pnpm api collect ACCOUNT_ID
pnpm api report 'Кино курьер' ACCOUNT_ID
```

`connect` открывает официальный экран согласия Instagram. `collect` создаёт
сохраняемое задание полного обхода, печатает его ID и продвигает страницы.
После обрыва: `pnpm api collect ACCOUNT_ID JOB_ID`. Задание также продолжает
Durable Object через alarms; Cron восстанавливает пропущенное пробуждение.
Новый UUID не нужен для возобновления. Старый `sync`
остаётся доступен для постраничного сбора.
Поиск читает сохранённый каталог. Повторный обход создаёт новый снимок.
Автоматическое расписание изначально выключено; включение требует явного
`enabled: true`. Полный сбор и включение расписания — отдельные действия.
«Кино курьер» в примерах — условное название; используйте подпись, ссылку или
локальное название нужной публикации.

Если название отсутствует в подписи, выберите публикацию по ссылке и задайте
локальный псевдоним. Он сохраняется при последующих синхронизациях:

```sh
pnpm api request PATCH /api/media/MEDIA_ID '{"title":"Кино курьер","durationSeconds":30}'
```

Длительность указывайте только если знаете её; она нужна для отношения среднего
времени просмотра к длине ролика. Instagram-публикация не изменяется.
Если поиск даёт несколько совпадений, API возвращает кандидатов, не выбирая
ролик автоматически.

## API

Все `/api/*`, кроме OAuth callback, требуют `Authorization: Bearer <API_KEY>`.
Это установка для одного владельца с несколькими подключёнными аккаунтами.
JSON-запросы ограничены 32 KiB. Ошибки — RFC 9457 с кодом и `requestId`.
Временные метки в ответах — миллисекунды UTC; фильтры `from`/`to` — ISO 8601.

| Метод и путь | Результат |
| --- | --- |
| `POST /api/instagram/oauth/start` | Ссылка подключения с одноразовым state на 10 минут |
| `GET /api/instagram/oauth/callback` | Завершение подключения; токен не возвращается |
| `GET /api/instagram/connections` | Срок действия и разрешения подключений |
| `DELETE /api/instagram/connections/{accountId}` | Удаление локального токена, сохранение истории |
| `GET /api/accounts` | Подключённые аккаунты с сохранёнными данными |
| `POST /api/accounts/{accountId}/sync` | Атомарный сбор одной страницы публикаций |
| `POST /api/media/{mediaId}/refresh` | Обновление именно выбранной публикации |
| `GET /api/sync-runs/{operationId}` | Состояние операции сбора |
| `GET/POST /api/accounts/{accountId}/collection` | Состояние сбора / запуск полного обхода или Stories |
| `GET/PATCH /api/collection-jobs/{jobId}` | Прогресс / возобновление или отмена |
| `POST /api/collection-jobs/{jobId}/advance` | Следующая безопасная страница задания |
| `PATCH /api/accounts/{accountId}/collection/schedule` | Явное включение/выключение расписания |
| `GET /api/media?q=...` | Поиск и фильтры публикаций с пагинацией |
| `PATCH /api/media/{mediaId}` | Локальное название и известная длительность |
| `GET /api/reports/media?query=Кино%20курьер` | Поиск и полный отчёт по названию |
| `GET /api/media/{mediaId}/statistics` | Метрики API, расчёты, полнота и свежесть данных |
| `GET /api/media/{mediaId}/history` | История снимков и прирост просмотров |
| `GET /api/media/{mediaId}/benchmark` | Сравнение с медианой публикаций того же типа |
| `GET /api/accounts/{accountId}/summary` | Суммы по группе публикаций и покрытие данных |
| `GET /api/accounts/{accountId}/history` | История числа подписчиков и чистое изменение |
| `POST /api/accounts/{accountId}/insights/collect` | Сбор официальных Account Insights за заданный интервал |
| `GET /api/accounts/{accountId}/activity` | Активность аккаунта и сравнение собранных периодов |
| `GET /api/accounts/{accountId}/insights/history` | Сохранённая периодная статистика и демография |
| `POST /api/accounts/{accountId}/audience/collect` | Демография в доступном Meta timeframe |
| `GET /api/accounts/{accountId}/audience` | Сохранённые разбивки подписчиков / вовлечённой аудитории |
| `GET /api/media/{mediaId}/context` | Подтверждённый контекст и предложения отдельно |
| `PATCH /api/media/context/batch` | Локальный контекст явно выбранных публикаций |
| `GET /api/accounts/{accountId}/content-analysis` | Сравнение на возрасте 1/7/30 дней, группы и эффективность |
| `POST /api/accounts/{accountId}/business/import` | Ручные/внешние затраты и результаты с источником |
| `GET /api/media/{mediaId}/business` | Известные результаты и формулы эффективности |
| `GET/POST /api/accounts/{accountId}/experiments` | Журнал / неизменяемый план гипотезы |
| `GET /api/experiments/{experimentId}` | Сопоставимые варианты и достаточность наблюдений |
| `PATCH /api/experiments/{experimentId}/publications` | Публикации вариантов после создания плана |
| `PATCH /api/experiments/{experimentId}/conclusion` | Вывод владельца и следующая проверка |
| `POST /api/accounts/{accountId}/story-sequences` | Явно заданный порядок Stories |
| `GET /api/story-sequences/{sequenceId}` | Метрики последовательности без выдуманного досмотра |
| `POST /api/media/{mediaId}/comments/collect` | Страница комментариев/ответов с отдельным разрешением |
| `GET/DELETE /api/media/{mediaId}/comments` | Чтение/удаление сохранённых текстов |
| `POST /api/accounts/{accountId}/comments/webhook/subscribe` | Подписка аккаунта; доставка проверяется отдельно |
| `GET/POST /webhooks/instagram/comments` | Callback Meta: verify token / подписанное уведомление |
| `GET /api/comment-collections/{operationId}` | Статус сбора комментариев |
| `GET /api/insight-collections/{operationId}` | Статус сбора Account Insights |
| `GET /api/accounts/{accountId}/review` | Объяснимый разбор периода по сохранённым данным |
| `GET /api/metrics` | Источники, единицы и применимость метрик |

Тело синхронизации: `{"operationId":"UUID","cursor":null,"pageSize":3}`.
Размер страницы — 1–3. Для следующей страницы используйте `nextCursor` и новый
UUID. Повтор тех же параметров с тем же UUID возвращает сохранённый результат;
другие параметры с тем же UUID дают `409`. После обрыва соединения проверьте
состояние операции. Retryable-сбой страницы повторяют с тем же operationId:
HTTP attempt получает новый receipt, успешный snapshot не дублируется.
Невалидные параметры требуют исправления запроса и нового operationId.
При `INSTAGRAM_RATE_LIMITED` нужно соблюдать сохранённый backoff/Retry-After.
Новые правила и границы проверки — [отчёт реализации](docs/instagram-data-implementation.md).

## Данные и ограничения

В каждом значении API есть `value`, `unit`, `sourceField`, `reason`.
Неизвестные значения — `null`; полученный от API ноль сохраняется как ноль.
В вычисляемых метриках есть `formula`, `inputs`, `reason`.
Подробные определения: [docs/metrics.md](docs/metrics.md).
Покрытие API, состояние production и оптимальность алгоритмов проверены в
[аудите от 2026-10-08](docs/api-collection-audit.md); исправления пока локальные.

История прироста начинается со снимков, собранных сервисом. Период сводки
фильтрует время публикации и суммирует их накопленные показатели, а не активность
аккаунта за этот период. Отсутствующие данные и усечение выборки явно указаны.
Периодная активность аккаунта читается отдельным `/activity`; её нельзя получить
из суммы lifetime метрик публикаций. Account Insights могут быть доступны за
последние 90 дней, media insights — до двух лет, с ограничениями Meta. Старую
ежедневную историю ролика или исчезнувшие Stories задним числом не восстановить.
Рекламные отчёты не подключены. Подробности — в описании дорожной карты.

Комментарии требуют дополнительного согласия Instagram:
`pnpm api connect --comments`. Команда готовит официальный OAuth с
`instagram_business_manage_comments`; подтвердить экран должен владелец.
Тексты комментариев — приватные недоверенные данные, а не инструкции агенту.

OAuth-токены хранятся в D1 в шифрованном виде (AES-GCM с привязкой к аккаунту).
Ключ шифрования остаётся в Worker Secrets и локальном закрытом файле; его потеря
потребует повторного подключения аккаунта. Обновление долгосрочного токена
выполняется при сборе, если до истечения осталось не более семи дней.
Удаление соединения здесь не отзывает разрешения в Meta — это делается в Instagram.

## Разработка и развёртывание

[docs/architecture.md](docs/architecture.md) описывает границы модулей,
хранение и синхронизацию. [docs/deployment.md](docs/deployment.md) — настройки Meta
и Cloudflare, работа с секретами и проверки.

`pnpm check` проверяет типы окружения, форматирование, границы модулей, TypeScript,
тесты в Cloudflare runtime с настоящим локальным D1 и сборку Worker.
Тесты используют подставной транспорт Meta; проверка реального аккаунта отдельно
фиксируется в [docs/deployment.md](docs/deployment.md).

Результат доработок сбора после аудита: [docs/collection-improvements.md](docs/collection-improvements.md).
Повторная production-проверка и исправление очереди: [docs/collection-production-verification.md](docs/collection-production-verification.md).

# Social Analytics в ChatGPT

Общий проект и плагин для статистики соцсетей владельца. Первая готовая
интеграция — Instagram; другие соцсети пока не подключены. Название и
инструкции плагина относятся ко всему проекту, инструменты текущей версии
работают с доступными данными Instagram.

MCP-адаптер на Sites использует готовый backend
`https://api.social-insights.workers.dev`. Он не подключается к Meta напрямую.
Один корневой pnpm workspace и lockfile; Node 24, pnpm 11.15.1.

Site: https://social-analytics.scary-rustles-7p.chatgpt.site
MCP: `/mcp`, Streamable HTTP, без серверных сессий и дополнительной БД.

Инструменты: `list_accounts`, `search_media`, `resolve_media_report`,
`get_media_report`, `get_media_history`, `compare_media`, `get_account_summary`,
`get_account_history`, `describe_metrics`, `set_media_metadata`,
`sync_account_page`, `get_sync_status`.

Запрос по названию вызывает `resolve_media_report`: `matched`, `ambiguous`
или `not_found`. Неоднозначность требует выбора кандидата. Поиск работает
по сохранённому каталогу; отчёт показывает время сбора и возраст снимка.
Значения, формулы и причины отсутствия проходят валидацию по контракту API.
`null` не заменяется нулём. Определения — в [метриках](../docs/metrics.md).

Локальные метаданные и постраничный сбор — инструменты записи с отдельными
аннотациями. Один sync собирает 1–3 публикации; новый UUID для новой страницы,
тот же UUID для повтора тех же параметров. После неопределённого ответа сначала
проверяют статус. Backend не имеет отдельного обновления одной публикации.

## Доступ

Sites сохраняется приватным для владельца. Runtime-секреты `SOCIAL_API_KEY`
и `SOCIAL_OWNER_EMAIL` находятся в Sites; в hosting.json их нет.
Sites ingress аутентифицирует пользователя и передаёт доверенную identity
`oai-authenticated-user-email`; каждый инструмент проверяет её совпадение
с владельцем до обращения к backend. Прямое размещение этого bundle вне
Sites ingress не поддерживается: обычный заголовок сам по себе не доказывает
личность. Bypass-токен не заменяет identity владельца.

Клиент обращается только к фиксированному backend через HTTPS, не следует
редиректам и не возвращает upstream payload ошибок. Схемы удаляют неизвестные
поля ответов. Request body ограничен 64 KiB, ответ backend — 4 MiB.
Приложение не пишет invocation logs, токены и статистику в консоль.

## Подключение

После успешной публикации владельцем Sites создаёт связанный плагин.
В ChatGPT откройте **Плагины → Личные → Созданные вами → Social Analytics**,
нажмите **Установить**, затем **Подключить** под тем же аккаунтом ChatGPT.
Упомяните Social Analytics в новом чате и передайте подпись или ссылку ролика.
Не вставляйте ключ backend в чат или настройки клиентского MCP.

Portable-пакет находится в `plugin/`: `plugin.json`, `mcp.json` и skill.
Это исходный пакет для локальной/командной установки, а не публикация
в общедоступный каталог. Для обычного ChatGPT используйте созданный Sites
плагин; OAuth connection и точный resource берите из Sites get_site.

Официальные инструкции: [Sites plugin](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites),
[plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Проверка и публикация

Из корня: `pnpm check`. Реальное чтение без записей и вывода личных данных:
`node chatgpt/scripts/verify-live.mjs`. Оно использует локальную `.dev.vars`
внутри процесса; опубликованный адаптер использует только Sites secrets.
Контракт в `contract/openapi.json` прочитан из рабочего API 2026-10-02.
После изменения контракта генератор `scripts/generate-contract.mjs`
создаёт `src/contract.ts`; затем выполните форматирование и проверки.

`scripts/export-sites.mjs` создаёт отдельную служебную копию исходников
в свежем `/private/tmp/social-analytics-sites-*`. Экспорт сохраняет общий
lockfile, исключает backend, данные, секреты и зависимости. Канонические
исходники остаются в этом workspace. Служебную копию проверяют, фиксируют
Git-коммитом и отправляют в выданный Sites remote без force push.
Архив содержит `.openai/hosting.json` и `server/index.js` из корневого `dist`.
Сохранённая версия привязана к точному отправленному SHA; публикация приватная.
Новые секреты вступают в силу только при публикации версии.

# Структура проекта — Система учёта оборудования КДЛ

Версия 1.0 · Ноябрь 2025

---

## 1. Общая карта проекта

Проект — SPA на Vue + Node.js API + MySQL 8.0, деплой через docker-compose.

**Ключевые потоки:**
- Пользователь → Nginx → Node.js (API или SPA fallback) → MySQL.
- Статика и скриншоты — в `frontend/public` и `docs/screenshots`.
- Логи и дампы БД — вне контейнера (тома `logs/`, `backups/`).

**Стек:**
- Frontend: Vue 3, Pinia, TypeScript, Vuetify/Tailwind (по выбору), UI-тесты.
- Backend: Node.js, Express, asyncHandler-обёртка, middleware аутентификации и прав.
- БД: MySQL 8.0, пул соединений, идемпотентная схема, seed-данные.
- Инфраструктура: docker-compose, graceful shutdown, планировщик задач.

---

## 2. Backend — Node.js + Express

### Папки и ключевые файлы

- `routes/` — роуты API:
  - `auth.js` — вход, смена пароля, impersonation.
  - `import.js`, `export.js` — импорт/экспорт.
  - `barcodes.js`, `barcode-printers.js` — штрихкоды и принтеры.
  - `help.js`, `view-templates.js`, `equipment-templates.js` — справочные данные и шаблоны.
- `db/` — работа с БД:
  - `pool.js` — пул соединений; контроль `FOREIGN_KEY_CHECKS`.
  - `schema.js` — `initSchema()`: создание таблиц, колонок, индексов; идемпотентно.
  - `seed.js` — начальные данные: админ, роли, отделы, демо-пипетки, help-docs.
  - `index.js` — экспорт `pool`, `query`, `getConnection`, `safeParse`, `generatePipetteId`.
- `middleware/` — перехватчики:
  - `auth.js` — проверка сессии, валидация прав, обработка `must_change_password`.
  - `wrapRouter.js` — обёртка всех async-роутов в `asyncHandler` (защита от unhandled rejection).
- `utils/` — утилиты:
  - `cleanup.js` — планировщик (например, очистка `audit_log` раз в сутки).
  - `graceful-shutdown.js` — обработка SIGTERM/SIGINT, закрытие сервера и пула за 10 сек.

### Важные особенности

- **SPA-fallback**: всё, что не `/api/*` и не `/help-defaults/*`, отдаёт `frontend/index.html`.
- **Ожидание БД**: при старте делается до 90 попыток подключения (с интервалом 2 сек).
- **Генерация ID пипеток**: `generatePipetteId()` — единый источник истины.
- **Поиск**: колонка `search_text` в `pipettes` (CONCAT_WS) — при добавлении полей для поиска обновляй эту колонку в `ensureColumns`.

---

## 3. Frontend — Vue 3 + Pinia

### Ключевые папки

- `src/components/` — модальные окна и формы:
  - `PipetteFormModal.vue`, `UserEditModal.vue`, `QuickCalModal.vue` — редактирование.
  - `BulkSendModal.vue`, `BulkReturnModal.vue` — массовые операции.
  - `BarcodePrintModal.vue` — печать этикеток.
  - `ChangePasswordModal.vue` — смена пароля.
- `src/stores/` — Pinia-сторы:
  - `pipettes.ts` — состояние списка пипеток, фильтры, пагинация.
  - `auth.ts` — сессия, права, роль, отдел.
  - `filters.ts` — текущие фильтры (в т.ч. по ответственным).
  - `export.ts` — настройки экспорта (PDF/XLSX), очереди экспорта.
- `src/composables/` — хуки:
  - `useFormModals.ts` — открытие/закрытие модальных окон.
  - `useExport.ts` — логика экспорта, стили футера и таблиц.
- `src/router/` — маршрутизация SPA.
- `public/` — статика, скриншоты для документации.

### Важные особенности

- **Автокомплит**: поля `v-model` с атрибутами `name` и семантическим `autocomplete` (для браузеров и тестов).
- **Оптимистичные блокировки**: `edit_locks` и `edit_drafts` в БД; фронтенд показывает «заблокировано пользователем».
- **Экспорт**: PDF/XLSX — сервер генерирует, фронтенд скачивает; стили таблиц и футеров — в `useExport.ts`.

---

## 4. Деплой и инфраструктура

### docker-compose

Сервисы:
- `app` (Node.js) — порт 3000.
- `db` (MySQL 8.0) — том для данных.
- `nginx` — прокси, статика, SPA-fallback.

Тома:
- `logs/` — логи контейнеров.
- `backups/` — дампы БД.
- `frontend/public/help-defaults/` — исходные файлы справки.

### Запуск и инициализация

1. Ожидание БД (до 90×2 сек).
2. Инициализация схемы (`initSchema`).
3. Seed-данные (`seedInitialData`, `seedHelpDocs`).
4. Запуск планировщика очистки (`cleanup`).
5. Graceful shutdown на SIGTERM/SIGINT.

---

## 5. Таблица «симптом → где искать»

| Симптом | Где искать |
|---|---|
| «Нет прав на действие» | `middleware/auth.js`, права роли в БД (`permission_presets`, `roles`). |
| Фильтр по ответственным не подтягивает пользователей | `stores/filters.ts`, запрос к `/api/users` с фильтром по отделу, автокомплит в модалках. |
| Тест падает после правок | `tests/ui/` (ChangePasswordModal, BulkSendModal и др.), проверить `actSend`, `actReturn`. |
| Пустая таблица | Фильтры (кнопка «Сбросить»), отдел пользователя, статусы приборов. |
| Не печатаются этикетки | `BarcodePrintModal.vue`, настройки принтера в `/api/barcode-printers`, шрифт с кириллицей. |
| Ошибка «Прибор заблокирован» | Таблица `edit_locks`; блокировка снимается автоматически через 30 минут. |

---

## 6. Потоки данных

- **Создание/редактирование пипетки**: Vue → POST /pipettes → middleware → DB → `audit_log`.
- **Массовые операции**: Vue (чекбоксы) → POST /bulk-send, /bulk-return → валидация → DB → `audit_log`.
- **Импорт/экспорт**: Vue → POST /import → валидация строк → DB → отчёт импорта; экспорт — аналогично.
- **Печать этикеток**: Vue → GET /barcodes → генерация → PDF/принтер.
- **Аудит**: Vue → GET /audit_log → фильтрация → таблица + экспорт PDF/XLSX.

---

## 7. Что где менять

| Задача | Файлы |
|---|---|
| Добавить новое поле в пипетку и включить в поиск | `db/schema.js` (ensureColumns + search_text), `frontend/src/stores/pipettes.ts`, `PipetteFormModal.vue`. |
| Правка прав доступа | `middleware/auth.js`, таблица `permission_presets` в БД. |
| Исправить фильтр по ответственным | `stores/filters.ts`, запрос пользователей, автокомплит в `UserEditModal.vue`, `PipetteFormModal.vue`. |
| Починить экспорт PDF | `useExport.ts`, CSS-стили таблицы и футера, серверный роут экспорта. |
| Обновить начальные данные | `db/seed.js`. |
| Добавить новую массовую операцию | Роут в `routes/` (CRUD bulk), модалка в `src/components/`, вызов в тулбаре. |
| Настроить планировщик очистки | `utils/cleanup.js`. |

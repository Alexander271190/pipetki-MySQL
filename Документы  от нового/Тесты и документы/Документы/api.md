# API-ДОКУМЕНТАЦИЯ

**Система учёта оборудования КДЛ**

Версия: 1.0 · Base URL: https://<адрес>/api · Формат: JSON · Дата: ноябрь 2025

---

## Оглавление

1. Общая информация
2. Аутентификация (/auth)
3. Оборудование (/pipettes)
4. Массовые операции
5. Пользователи и роли
6. Настройки (/settings)
7. Штрихкоды и печать
8. Импорт и экспорт
9. Справка и шаблоны
10. Журналы
11. Служебное
12. Модели данных
13. Коды ошибок

---

## 1. Общая информация

**Base URL:** https://<адрес>/api

**Формат данных:** JSON (Content-Type: application/json, UTF-8).

**Авторизация:** JWT в заголовке Authorization: Bearer <token>. Токен выдаётся POST /auth/login, живёт 24 часа.

**Коды ответов:**

| Код | Значение |
|---|---|
| 200 | Успех |
| 201 | Создано |
| 400 | Неверные данные |
| 401 | Нет/просрочен токен |
| 403 | Нет прав / требуется смена пароля |
| 404 | Объект не найден |
| 409 | Конфликт (дубль, race, draft) |
| 429 | Слишком много запросов (rate limit) |
| 500 | Ошибка сервера |
| 503 | Сервис недоступен (сбой кеша ролей) |

**Формат ошибок:** стандартный — { "error": "Текст" }; расширенный — { "error": "Текст", "code": "машинный_код", "details": {...}, "affected": 5 }. Полный список кодов — раздел 13.

**Пагинация** (для всех списочных): page, limit (макс. 500), sort, dir, search, filters.

## 2. Аутентификация (/auth)

### POST /auth/login

- Права: публичный. Rate limit: 30/мин с одного IP.
- Параметры: login, password.
- Особенность: при must_set_password = 1 (первый вход админа) пароль должен быть пустым. Иначе 401.
- Возвращает: token + объект user.
- Ошибки: 400 (пустые поля), 401 (неверные креды), 429 (rate limit).

### GET /auth/verify

- Права: токен.
- Возвращает: { user }.
- Особенность: работает даже при must_change_password = 1 (чтобы фронт показал модалку смены пароля). Все остальные защищённые эндпоинты в это время возвращают 403 password_change_required.

### GET /auth/password-policy

- Права: токен.
- Возвращает: объект политики (minLength, maxLength, requireLower, requireUpper, requireDigit, requireSpecial, forbidSpaces).

### POST /auth/change-password

- Права: токен.
- Параметры: currentPassword, newPassword, confirmPassword.
- Возвращает: message + новый token (старый инвалидируется).
- Ошибки: 400 (текущий неверен / новый совпадает с текущим / не соответствует политике).

### POST /auth/setup-password

- Права: токен, must_set_password = 1.
- Параметры: newPassword, confirmPassword.
- Возвращает: message + новый token.
- Ошибки: 400 (пароль уже установлен / не соответствует политике).

### POST /auth/impersonate/:userId

- Права: полные права администратора + режим impersonation_mode не off.
- Возвращает: новый token (с impersonatedBy, impersonatedByName) + user целевого.
- Ошибки: 403 (режим off / не admin при mode=admin), 400 (уже под ним), 404 (не найден).

### POST /auth/stop-impersonate

- Права: токен + impersonatedBy.
- Возвращает: { message }.
- Особенность: если админ, под которым работали, был удалён — возвращает { forceLogout: true }. Фронт должен сделать logout.

## 3. Оборудование (/pipettes)

### GET /pipettes/paged

- Права: токен.
- Query: page, limit (макс. 500), sort, dir, search, filters.
- Поля сортировки: id, equipmentType, model, volume, department, lastCalibration, nextCalibration, responsible, status, serial, manufacturer, cert, interval, location, notes, barcode, barcodeSource, lastResult, active + кастомные.
- Фильтры: status, equipmentType, department, active, responsible, model, manufacturer, last_calibration (объект с period и опционально from/to).
- Возвращает: items[], total, page, limit, totalPages, counters (ok/warn/danger/sent/wip/fail/unknownDate/inactive/total).
- Особенность: для каждого прибора пересчитывается computed_status (единый источник статусов — функция sqlComputedStatus). Возвращается history_count и связанные замены (replacement, replacedFor).

### GET /pipettes/all

- Права: токен.
- Query: те же, что у /paged, без page/limit.
- Возвращает: items[], total, truncated (если более 50000), limit.
- Используется: для экспорта в Excel/PDF.

### GET /pipettes/ids

- Права: токен.
- Query: как у /paged.
- Возвращает: { ids: string[] }.
- Используется: для печати этикеток и массовых операций.

### GET /pipettes/stats

- Права: токен.
- Возвращает: counters (как у /paged) + reminders (danger[], warn[]).

### GET /pipettes/:id

- Права: токен + доступ к отделу прибора.
- Возвращает: полный объект прибора + history[] + draft (если есть) + replacement/replacedFor.
- Ошибки: 404 (не найден), 403 (нет доступа к отделу).

### POST /pipettes

- Права: add_pipette или manage_pipettes.
- Параметры: все поля прибора (model, equipmentType, serial, manufacturer, volume, department, responsible, lastCalibration, interval, cert, result, active, location, notes, barcode, кастомные).
- ID: если не передан — генерируется по префиксу типа.
- Возвращает: message, id.
- Ошибки: 400 (валидация, дата в будущем, неизвестный тип, превышение длины), 403 (создание в чужом отделе при only_own_department), 409 (дубль ID).

### PUT /pipettes/:id

- Права: edit_pipette или manage_pipettes.
- Параметры: те же, что при создании + updatedAt (для оптимистичной блокировки).
- Возвращает: message, idChanged, newId, oldId. Если сменился тип — idChanged: true и новый ID.
- Ошибки: 409 draft_conflict (чужой черновик), 409 conflict (race-условие по updatedAt), 403 (смена отдела не админом).
- Особенность: при смене типа (equipmentType) ID автоматически перегенерируется (P-001 → A-001), история поверок переносится.

### DELETE /pipettes/:id

- Права: delete_pipette или manage_pipettes.
- Возвращает: { message }.
- Ошибки 400 (защиты): прибор на поверке; прибор заменяет кого-то; за прибором закреплена замена; прибор используется как замена; прибор был заменён.
- 409 — чужой лок.

### POST /pipettes/batch

- Права: токен.
- Параметры: { ids: string[] } (макс. 500).
- Возвращает: { items[] }.

### GET /pipettes/next-id

- Права: токен.
- Query: ?type=pipette.
- Возвращает: { nextId }.

### GET /pipettes/audit

- Права: view_log.
- Query: limit, search, category, from, to.
- Возвращает: items[], total, counters.

### GET /pipettes/:id/audit

- Права: view_audit или view_history.
- Query: limit, search, from, to.
- Возвращает: equipment ({ id, model }) + items[].
- Ошибки: 404, 403 (нет доступа к отделу).

### GET /pipettes/:id/calibration

- Права: токен.
- Возвращает: массив записей поверок (date, cert, result, org, note).

### POST /pipettes/:id/calibration

- Права: quick_calibration или manage_pipettes.
- Параметры: date, cert, result (pass/fail/wip), org, note.
- Ошибки: 400 (дата в будущем, некорректный формат).

### PUT /pipettes/:id/draft

- Права: токен.
- Параметры: произвольный объект (состояние формы).
- Возвращает: { message }.
- Особенность: UPSERT по pipette_id (один черновик на прибор).

### DELETE /pipettes/:id/draft

- Права: токен. Возвращает: { message }.

### GET /pipettes/:id/lock

- Права: токен.
- Возвращает: { locked, mine, lockedBy?, lockedByPosition?, pipetteId? }.
- Особенность: при locked && mine — продлевает locked_at (heartbeat). Удаляет просроченные локи (старше 30 минут).

### POST /pipettes/:id/lock

- Права: токен.
- Возвращает: { locked: true, mine: true } или 409 (lockedBy).
- Ошибки: 404 (прибор не найден), 409 (чужой лок), 429 (deadlock/lock timeout).

### DELETE /pipettes/:id/lock

- Права: токен.
- Query: ?force=true — снять чужой лок.
- Возвращает: { message }.
- Ошибки: 409 (чужой лок без force).

### POST /pipettes/:id/transfer

- Права: transfer_pipette или manage_pipettes.
- Параметры: department, responsible.
- Возвращает: message, oldDepartment, newDepartment, newResponsible.
- Ошибки: 400 (тот же отдел, несуществующий отдел), 409 (чужой лок).

### POST /pipettes/:id/cancel-send

- Права: bulk_send или manage_pipettes.
- Возвращает: message, replacementReturned (был ли возврат замены).
- Ошибки: 400 (прибор не на поверке), 409 (чужой лок).

## 4. Массовые операции

### POST /pipettes/bulk-create

- Права: add_pipette или manage_pipettes.
- Параметры: { rows: object[] } — до max_batch_size строк.
- Возвращает: message, count, ids[].
- Ошибки: 400 (валидация любой строки — атомарно), 409 (race по ID).

### POST /pipettes/bulk-send

- Права: bulk_send или manage_pipettes.
- Параметры: ids, sentDate, note, replacements (объект { [origId]: replacementId }).
- Возвращает: message, successful, skipped, skippedIds, notFound, notFoundIds, skippedReplacements.
- Валидации: замена не может быть из списка отправляемых; одна единица не может заменить несколько; замена не может быть самой собой.
- Логика: для каждого прибора — проверка типа (external), лока, статуса. Обновляет sent_for_calibration, active = 0. Если указана замена — активирует её, ставит replacing.

### POST /pipettes/bulk-return

- Права: bulk_return или manage_pipettes.
- Параметры: items ({ id, cert, result }[]), date, org, note, returnReplacements (массив ID оригиналов, чьи замены нужно вернуть).
- Возвращает: message, successful, skipped, missingReplacements.
- Логика: для каждого — проверка лока, статуса. Добавляет запись в calibration_history, обновляет last_calibration, active = 1. Возвращает замену на склад (если отмечена).

### POST /pipettes/bulk-change-responsible

- Права: bulk_change_responsible или manage_pipettes.
- Параметры: ids, newResponsible.
- Возвращает: message, successful, skipped.

### POST /pipettes/bulk-delete

- Права: delete_pipette или manage_pipettes.
- Параметры: { ids: string[] }.
- Возвращает: message, successful, successfulIds, skipped, skippedDetails[] (с причиной), notFound, notFoundIds.
- Защиты (skip): на поверке, заменяет кого-то, за ним закреплена замена, на него ссылается другой.

### POST /pipettes/bulk-lock

- Права: любая из: add_pipette, edit_pipette, bulk_send, bulk_return, bulk_change_responsible, manage_pipettes.
- Параметры: { ids } (макс. 200).
- Возвращает: locked[], busy[] (с lockedBy, lockedByPosition), notFound[].
- Особенность: массовый INSERT IGNORE — быстрее, чем N вызовов одиночного лока.

### POST /pipettes/bulk-unlock

- Права: токен. Параметры: { ids }. Возвращает: { ok: true }.

### GET /pipettes/available-for-replacement

- Права: токен.
- Query: type, department, exclude.
- Возвращает: складские того же типа (для одиночной замены).

### POST /pipettes/available-for-replacement-batch

- Права: токен.
- Параметры: items: [{ id, type, department }] (макс. 200).
- Возвращает: { [id]: ReplacementOption[] } — сгруппировано по типу+отделу для минимума запросов.

## 5. Пользователи и роли

### GET /users

- Права: manage_users.
- Возвращает: FullUser[] (id, login, fullName, position, department, role, roleName, isAdmin, onlyOwnDepartment, isActing, actingForId, actingForName, extraPermissions, mustChangePassword, viewTemplateId).

### POST /users

- Права: manage_users.
- Параметры: login, fullName, position, department, role, onlyOwnDepartment, extraPermissions, isActing, actingForId.
- Возвращает: message, id, login, tempPassword (разовый).
- Ошибки: 400 (валидация), 403 (создание админа не-админом), 409 (логин занят).
- Особенность: пароль генерируется автоматически, must_change_password = 1.

### PUT /users/:id

- Права: manage_users.
- Параметры: те же + login (можно менять, но только админу и не для built-in admin).
- Возвращает: { message }.
- Ошибки: 400 (валидация, попытка понизить последнего админа или себя), 403 (не-админ меняет логин, built-in admin меняет логин), 409 (логин занят).
- Аудит: записывает diff изменений (логин, ФИО, должность, отдел, роль, права, и.о.).

### DELETE /users/:id

- Права: manage_users.
- Возвращает: { message }.
- Ошибки: 400 (себя / built-in admin / последнего админа), 403 (не-админ удаляет админа).

### POST /users/:id/reset-password

- Права: manage_users.
- Возвращает: message, tempPassword, login, fullName.
- Ошибки: 400 (сброс себе), 403 (не-админ сбрасывает админу).

### GET /users/responsibles

- Права: transfer_pipette / bulk_change_responsible / manage_pipettes / senior_lab / админ.
- Возвращает: [{ id, fullName, login, department }].

### GET /users/acting-targets

- Права: manage_users.
- Возвращает: список активных пользователей (без и.о.) для выбора «за кого исполняет».

### GET/POST /users/presets, DELETE /users/presets/:id

- Права: manage_users. Пресеты прав. POST принимает name, permissions[].

### GET /roles

- Права: токен.
- Возвращает: Role[] (id, name, value, permissions, isAdmin, isSystem).
- Особенность: кеш 60 секунд, инвалидируется при POST/PUT/DELETE.

### POST /roles

- Права: requireAdmin.
- Параметры: name, permissions[], isAdmin.
- Ошибки: 400 (валидация), 409 (дубль названия).

### PUT /roles/:id

- Права: requireAdmin.
- Параметры: те же.
- Ошибки: 400 (системная роль — изменить нельзя), 409 (дубль названия).
- Особенность: для системных user/senior_lab поле is_admin игнорируется.

### DELETE /roles/:id

- Права: requireAdmin.
- Ошибки: 400 (системная / назначена пользователям).

## 6. Настройки (/settings)

### GET /settings/system, PUT /settings/system

- Права: GET — токен, PUT — manage_settings.
- Особенности PUT:
  - whitelist — только известные ключи (ALLOWED_SETTINGS);
  - критичные ключи (пароли, impersonation) — только для админов;
  - валидация: page_sizes (JSON-массив 10..5000), default_page_size (10..5000), table_density (compact/normal/loose), impersonation_mode (off/admin/all_admins), bulk_identity_fields и barcode_label_fields (непустые массивы), reminders_for_roles (непустой массив);
  - инвалидация кешей после сохранения: equipmentTypes, warnDays, barcodes, barcodeMaxLen, passwordPolicy, equipmentSettings.

### GET /settings/fields, PUT /settings/fields

- Права: GET — токен, PUT — manage_settings.
- Особенность PUT: защита от удаления поля с данными. При попытке — 409 field_has_data с affected и fields. С ?confirmDelete=true — удаляет принудительно (данные стираются в custom_data).

### GET /settings/departments, PUT /settings/departments

- Права: GET — токен, PUT — manage_settings.
- Особенность PUT: при переименовании (oldName) обновляются pipettes.department и users.department. При удалении используемого отдела — 400.

### GET /settings/departments-full

- Права: requireAdmin. Возвращает: [{ name, enabled }].

### GET /settings/filters, PUT /settings/filters

- Права: GET — токен, PUT — manage_settings.

### GET /settings/export, PUT /settings/export

- Права: GET — токен, PUT — manage_settings.
- Возвращает: fields[], exportEnabled, actSendEnabled, actSendFields[], actReturnEnabled, actReturnFields[], historyEnabled, historyFields[], headerEnabled, headerText, headerAlign.

### GET /settings/print-documents/effective

- Права: токен.
- Возвращает: hasPermission, export, actSend, actReturn, history, поля каждого документа, headerEnabled, headerText, headerAlign, source (individual / global / no_permission).
- Особенность: если у пользователя нет export_data — возвращает всё false и source: 'no_permission'.

### GET/PUT /settings/equipment-types

- Права: GET — токен, PUT — manage_settings.
- Особенность PUT: валидация value (a-z, цифры, _); префикс 1–10 символов, A-Z и 0-9, уникален; МПИ 1..120; calibrationPlace — external / internal; запрет удаления используемого типа (проверка по pipettes.equipment_type).

### GET/PUT /settings/my-preferences

- Права: токен.
- Особенность: GET возвращает {}, если у пользователя нет сохранённых prefs. PUT — UPSERT.

### GET /settings/my-preferences/effective

- Права: токен.
- Возвращает: эффективный вид: visibleFields[] + метаданные (_loaded, _source — individual / template / default).
- Логика: индивидуальные → шаблон (из view_template_id) → дефолт (все активные поля + виртуальные status, nextCalibration).

### GET/PUT/DELETE /settings/user-preferences/:userId

- Права: requireAdmin.
- Особенность: PUT — UPSERT, DELETE — сброс prefs пользователя.

### GET /settings/user-preferences/:userId/effective

- Права: requireAdmin. Возвращает: { source, visibleFields }.

### POST /settings/apply-fields-to-all

- Права: requireAdmin.
- Параметры: visibleFields[], mode (missing / add / all).
- Возвращает: message, updated, mode.

### POST /settings/reset-data

- Права: requireAdmin.
- Особенность: удаляет calibration_history, pipettes, audit_log в транзакции. Необратимо.

## 7. Штрихкоды и печать

### GET /barcodes/fonts

- Права: токен.
- Возвращает: [{ value, label }] — доступные шрифты (проверка наличия .ttf в frontend/fonts/).

### GET /barcodes/:id/png

- Права: токен.
- Query: ?type=code128 / ?type=qr.
- Возвращает: PNG (Content-Type: image/png, Cache-Control: 300с).
- Особенность: barcode_max_length применяется из настроек (кеш 60с, инвалидируется при смене).

### POST /barcodes/lookup

- Права: scan_barcode.
- Параметры: barcode.
- Логика поиска (по очереди): barcode → id → serial → custom_data.inventorynumber / inventoryNumber / inventory_no.
- Ошибки: 404 (не найдено).

### POST /barcodes/manual

- Права: manage_barcodes.
- Параметры: id, barcode.
- Ошибки: 400 (пустой / превышение barcode_max_length), 404 (прибор не найден), 409 (уже используется другим прибором).
- Особенность: ставит barcode_source = 'manual'.

### POST /barcodes/reset

- Права: manage_barcodes.
- Параметры: id.
- Особенность: сбрасывает barcode = NULL, barcode_source = NULL (при следующем сохранении пересчитается авто).

### GET /barcodes/labels.pdf

- Права: print_labels.
- Query: ids (через запятую, макс. 2000), copies (1..50), layout (a4 / zebra), type (code128 / qr), fields (через запятую).
- Возвращает: PDF.
- Особенность: шрифт с кириллицей — из настроек (barcode_font). Fallback: выбранный → DejaVu → любой доступный → Helvetica.

### POST /barcodes/print

- Права: print_labels.
- Параметры: ids[] (макс. 2000), copies, printerId (опционально).
- Логика: если printerId — берём этот принтер; иначе — принтер отдела пользователя (с учётом и.о.); иначе — глобальный is_default.
- Режимы:
  - zebra-ip — отправка по TCP, при ошибке (если barcode_fallback_to_pdf=1) — возврат mode: 'pdf-a4-fallback';
  - zebra-agent — возврат ZPL + порт для локального агента;
  - pdf-zebra / pdf-a4 — возврат layout для скачивания PDF.
- Возвращает: mode, printed, printer, message / zpl / agentPort / layout / reason.

### POST /barcodes/printer-status

- Права: requireAdmin.
- Параметры: ip, port.
- Возвращает: { ok, message } (TCP-проверка, timeout 4с).

### CRUD /barcode-printers

- Права: manage_printers.
- GET: список всех (для админки); GET /available: список для модалки печати (для всех, с учётом отдела); POST/PUT/DELETE: стандартные CRUD.
- Особенность is_default: при установке is_default = 1 для глобального принтера (department = NULL) — сбрасывает у всех остальных глобальных. Для принтера отдела — только у своего отдела.
- Валидация: mode — один из 4; zebra-ip требует ip.

## 8. Импорт и экспорт

### POST /import

- Права: import_data.
- Параметры: file (base64), filename.
- Форматы: .xlsx, .csv, .json, .txt. .xls — 400.
- Логика: парсинг (XLSX через ExcelJS, CSV с автоопределением разделителя, JSON — массив); автоопределение строки заголовков (по максимальному совпадению с HEADER_MAP); батчи по 50 строк в транзакциях; при ошибке батча — fallback на построчную обработку.
- Валидации: модель обязательна; дата — ДД.ММ.ГГГГ / ДД.ММ.ГГ / ГГГГ-ММ-ДД; максимальные длины (model/serial 255, notes 65535); дубли ID → skip; ошибочные строки → skip с указанием.
- Возвращает: message, added, skipped, errors, skippedDetails, errorDetails, recognizedFields, totalColumns.

### POST /export/xlsx

- Права: export_data.
- Параметры: mode (registry / history), meta (title, date, recordCount, user, userPosition, period), headers[], rows[], fields[].
- Возвращает: XLSX (Content-Type: spreadsheetml).
- Особенности: шапка из export_settings (если header_enabled = 1); заголовок по центру 14pt; зебра; подвал: слева «Документ сформировал», справа «Подпись»; fitToWidth: 1, fitToHeight: 0, A4 landscape.
- При mode = history — проверка history_enabled, при mode = registry — export_enabled.

## 9. Справка и шаблоны

### GET /help/visible

- Права: токен.
- Возвращает: список разделов, доступных пользователю по правам.

### GET /help

- Права: requireAdmin.
- Возвращает: все разделы с filePath, requiredPermissions, sortOrder, enabled.

### POST /help/upload

- Права: requireAdmin.
- Параметры (multipart): file (.pdf/.docx/.doc, макс. 20 МБ), title, slug (опционально, иначе автогенерация), requiredPermissions (JSON-массив), sortOrder, enabled.
- Особенность: при загрузке файл переименовывается в <slug>.<ext>, старые файлы с другим расширением удаляются.

### DELETE /help/:slug

- Права: requireAdmin.
- Особенность: удаляет файл с диска (по file_path из БД + сканирует <slug>.pdf/.docx/.doc).

### POST /help/reset

- Права: requireAdmin.
- Логика: DELETE FROM help_docs → seedHelpDocs() (сканирует frontend/help-defaults/).

### POST /help/apply-defaults

- Права: requireAdmin.
- Логика: проставляет дефолтные права из HELP_PERMISSIONS для всех стандартных разделов.

### CRUD /equipment-templates

- Права: requireAdmin.
- Шаблоны единиц оборудования. POST — name, data (объект с полями). Уникальность name.

### CRUD /view-templates

- Права: токен.
- Шаблоны вида. POST — name, visibleFields[] (непустой), isDefault.
- Специальные: POST /:id/apply-to-user/:userId — применить шаблон пользователю; DELETE /apply-to-user/:userId — сбросить шаблон.

## 10. Журналы

### GET /log

- Права: view_log.
- Query: limit.
- Возвращает: AuditItem[] (из audit_log).

### DELETE /log

- Права: view_log. Логика: DELETE FROM audit_log.

### GET /log/errors

- Права: view_log.
- Query: limit, search, level, from, to.
- Возвращает: items[], total, counters (по уровням).

### DELETE /log/errors

- Права: view_log. Логика: DELETE FROM app_logs.

## 11. Служебное

### GET /health

- Права: публичный (без авторизации).
- Возвращает: { status: 'ok' }.
- Используется: Docker healthcheck, Nginx (healthcheck без логов).
- Особенность: не логируется в Nginx (access_log off).

## 12. Модели данных

**User:** id, login, password (hash), full_name, position, department, role, only_own_department, is_acting, acting_for_id, extra_permissions (JSON), must_change_password, must_set_password, password_changed_at, view_template_id, created_at, updated_at.

**Pipette:** id, serial, manufacturer, model, equipment_type, volume, department, interval, last_calibration, cert, last_result, active, responsible, location, notes, sent_for_calibration, sent_note, replaced_by, replacing, custom_data (JSON), barcode, barcode_source, search_text (generated), created_at, updated_at.

**Role:** id, name, value, permissions (JSON), is_system, is_admin, created_at.

**CalibrationRecord:** id, pipette_id, date, cert, result, org, note, created_at.

**AuditItem:** id, user_id, user_full_name, action, details, pipette_id, category, timestamp.

**SystemSetting:** setting_key (PK), setting_value, updated_at.

**ExportSettings:** id (1), fields (JSON), export_enabled, act_send_enabled, act_send_fields (JSON), act_return_enabled, act_return_fields (JSON), history_enabled, history_fields (JSON), header_enabled, header_text, header_align, updated_at.

## 13. Коды ошибок

| Код | HTTP | Что делать |
|---|---|---|
| unauthorized | 401 | Токен истёк/невалиден → логин заново |
| password_change_required | 403 | Требуется смена пароля → открыть модалку |
| password_setup_required | 403 | Первый вход → установить пароль |
| rate_limit | 429 | Подождать (rate limit) |
| critical_setting_forbidden | 403 | Настройка только для админа |
| data_error | 400 | Некорректные данные (длина, формат) |
| race | 409 | ID занят / race-условие → повторить |
| draft_conflict | 409 | Чужой черновик → подтверждение |
| field_has_data | 409 | Поле с данными → подтверждение (?confirmDelete=true) |
| invalid_equipment_type | 400 | Неизвестный тип → выбрать из списка |
| duplicate_role | 409 | Роль с таким именем уже есть |
| rolecache_unavailable | 503 | Сбой кеша ролей → повторить через секунду |
| http_400 / http_403 / http_404 / http_409 / http_422 / http_500 / http_502 / http_503 | — | Стандартные подсказки (см. errorHints.ts) |

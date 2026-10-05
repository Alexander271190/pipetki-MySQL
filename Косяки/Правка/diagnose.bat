@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM ============================================================
REM  KDL Diagnostic — BUG-2025-001 (Race condition на POST /pipettes)
REM ============================================================
REM  Проект:  P:\
REM  База:    C:\ (MySQL)
REM  Сервис:  pipette_app (NSSM)
REM ============================================================

set "PROJECT_DIR=P:\"
set "LOG_DIR=P:\pipette_logs"
set "REPORT_FILE=P:\diagnostic_report.txt"
set "SERVICE_NAME=pipette_app"
set "API_URL=http://localhost:3000/api"
set "TEST_ID=RACE_DIAG_%RANDOM%"

echo.
echo ============================================================
echo   KDL Diagnostic - BUG-2025-001 (Race condition)
echo ============================================================
echo   Проект:   %PROJECT_DIR%
echo   Логи:     %LOG_DIR%
echo   Сервис:   %SERVICE_NAME%
echo   Отчёт:    %REPORT_FILE%
echo ============================================================
echo.

REM Очищаем старый отчёт
if exist "%REPORT_FILE%" del "%REPORT_FILE%"

call :header "ДИАГНОСТИКА BUG-2025-001"
call :log "Дата запуска: %DATE% %TIME%"
call :log ""

REM ============================================================
REM  1. ПРОВЕРКА ПРОЕКТА
REM ============================================================
call :section "1. ПРОЕКТ И КОД"
call :log "PROJECT_DIR = %PROJECT_DIR%"

if not exist "%PROJECT_DIR%" (
    call :error "Диск P: не найден!"
    goto :end
)

if not exist "%PROJECT_DIR%routes\pipettes.js" (
    call :error "Не найден файл %PROJECT_DIR%routes\pipettes.js"
    goto :end
)

call :ok "routes\pipettes.js существует"

REM Ищем RACE_CODES в файле
findstr /C:"RACE_CODES" "%PROJECT_DIR%routes\pipettes.js" >nul 2>&1
if errorlevel 1 (
    call :error "RACE_CODES НЕ НАЙДЕН в pipettes.js - патч не применён!"
) else (
    call :ok "RACE_CODES найден в pipettes.js (патч применён)"
)

REM Ищем trimmedModel
findstr /C:"trimmedModel" "%PROJECT_DIR%routes\pipettes.js" >nul 2>&1
if errorlevel 1 (
    call :error "trimmedModel НЕ НАЙДЕН - патч 4.8 не применён!"
) else (
    call :ok "trimmedModel найден (патч 4.8 применён)"
)

REM Версия файла
for %%F in ("%PROJECT_DIR%routes\pipettes.js") do (
    call :log "Размер файла: %%~zF байт"
    call :log "Изменён:      %%~tF"
)
call :log ""

REM ============================================================
REM  2. NSSM
REM ============================================================
call :section "2. NSSM И СЕРВИС"

REM Ищем nssm.exe
set "NSSM_EXE="
for %%P in (
    "P:\nssm\win64\nssm.exe"
    "P:\nssm\nssm.exe"
    "P:\tools\nssm\win64\nssm.exe"
    "C:\nssm\win64\nssm.exe"
    "C:\nssm\nssm.exe"
    "C:\tools\nssm\win64\nssm.exe"
    "C:\Program Files\nssm\win64\nssm.exe"
) do (
    if exist %%P (
        set "NSSM_EXE=%%~P"
        goto :nssm_found
    )
)

:nssm_found
if "!NSSM_EXE!"=="" (
    call :warn "nssm.exe не найден в стандартных местах - ищем через реестр..."
    
    REM Ищем через реестр
    for /f "tokens=3*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Services\%SERVICE_NAME%" /v ImagePath 2^>nul ^| findstr /I "ImagePath"') do (
        set "RAW=%%B"
        REM Убираем кавычки и параметры
        set "RAW=!RAW:"=!"
        for /f "tokens=1" %%C in ("!RAW!") do set "NSSM_EXE=%%C"
    )
)

if "!NSSM_EXE!"=="" (
    call :error "nssm.exe не найден нигде!"
    call :log "Укажи путь вручную в переменной NSSM_EXE в этом bat-файле"
    goto :skip_nssm
)

call :ok "nssm.exe найден: !NSSM_EXE!"

REM Проверяем статус сервиса
call :log "Проверка статуса сервиса..."
"!NSSM_EXE!" status %SERVICE_NAME% > "%TEMP%\_nssm_status.txt" 2>&1
set /p SERVICE_STATUS=<"%TEMP%\_nssm_status.txt"
call :log "Статус сервиса: %SERVICE_STATUS%"
del "%TEMP%\_nssm_status.txt" 2>nul

REM AppDirectory
call :log "AppDirectory сервиса:"
"!NSSM_EXE!" get %SERVICE_NAME% AppDirectory > "%TEMP%\_nssm_dir.txt" 2>&1
type "%TEMP%\_nssm_dir.txt" | more +1
del "%TEMP%\_nssm_dir.txt" 2>nul
call :log ""

REM Сравниваем с PROJECT_DIR
"!NSSM_EXE!" get %SERVICE_NAME% AppDirectory > "%TEMP%\_nssm_dir.txt" 2>&1
set "APP_DIR_RAW="
for /f "usebackq skip=1 tokens=*" %%A in ("%TEMP%\_nssm_dir.txt") do set "APP_DIR_RAW=%%A"
del "%TEMP%\_nssm_dir.txt" 2>nul

if not "!APP_DIR_RAW!"=="" (
    REM Убираем кавычки и пробелы
    set "APP_DIR_RAW=!APP_DIR_RAW:"=!"
    for /f "tokens=*" %%A in ("!APP_DIR_RAW!") do set "APP_DIR_RAW=%%A"
    call :log "APP_DIR (очищено): !APP_DIR_RAW!"
    
    if /I "!APP_DIR_RAW!"=="P:\" (
        call :ok "AppDirectory совпадает с PROJECT_DIR (P:\)"
    ) else (
        if /I "!APP_DIR_RAW!"=="P:" (
            call :ok "AppDirectory = P: (совпадает с P:\)"
        ) else (
            call :warn "AppDirectory (!APP_DIR_RAW!) ≠ PROJECT_DIR (P:\)"
            call :log "  ^> Сервис запускает код ИЗ ДРУГОЙ ПАПКИ!"
            call :log "  ^> Это может быть причиной что патчи не применились!"
        )
    )
)
call :log ""

:skip_nssm

REM ============================================================
REM  3. ЛОГИ NSSM
REM ============================================================
call :section "3. ЛОГИ NSSM"

if not exist "%LOG_DIR%" (
    call :warn "Папка %LOG_DIR% не существует - создаю..."
    mkdir "%LOG_DIR%" 2>nul
)

if "!NSSM_EXE!"=="" (
    call :warn "NSSM не найден - пропускаю настройку логов"
    goto :skip_logs_setup
)

REM Устанавливаем пути логов
"!NSSM_EXE!" set %SERVICE_NAME% AppStdout "%LOG_DIR%\out.log" >nul 2>&1
"!NSSM_EXE!" set %SERVICE_NAME% AppStderr "%LOG_DIR%\err.log" >nul 2>&1
"!NSSM_EXE!" set %SERVICE_NAME% AppRotateFiles 1 >nul 2>&1
"!NSSM_EXE!" set %SERVICE_NAME% AppRotateBytes 10485760 >nul 2>&1

call :ok "Пути логов настроены:"
call :log "  stdout: %LOG_DIR%\out.log"
call :log "  stderr: %LOG_DIR%\err.log"

REM Перезапуск сервиса
call :log "Перезапуск сервиса..."
"!NSSM_EXE!" restart %SERVICE_NAME% >nul 2>&1
timeout /t 4 /nobreak >nul
call :ok "Сервис перезапущен"

REM Ждём, пока сервер стартует
call :log "Ожидание старта сервера (5 сек)..."
timeout /t 5 /nobreak >nul

:skip_logs_setup
call :log ""

REM ============================================================
REM  4. ПРОЦЕССЫ NODE
REM ============================================================
call :section "4. ПРОЦЕССЫ NODE"

tasklist /FI "IMAGENAME eq node.exe" /FO CSV > "%TEMP%\_node_proc.txt" 2>&1
set /a NODE_COUNT=0
for /f "skip=1 tokens=*" %%A in ('type "%TEMP%\_node_proc.txt"') do (
    if not "%%A"=="" set /a NODE_COUNT+=1
)
del "%TEMP%\_node_proc.txt" 2>nul

call :log "Запущено node.exe процессов: %NODE_COUNT%"

if %NODE_COUNT% LSS 1 (
    call :error "Ни одного node.exe не запущено - сервис упал!"
) else if %NODE_COUNT% EQU 1 (
    call :ok "Ровно 1 процесс node.exe - отлично"
) else (
    call :warn "Больше 1 процесса node.exe - возможно, лишние!"
    call :log "  ^> tasklist /FI ^"IMAGENAME eq node.exe^" /V — покажет детали"
)
call :log ""

REM ============================================================
REM  5. ПОРТ 3000
REM ============================================================
call :section "5. ПОРТ 3000"

netstat -ano | findstr ":3000" | findstr "LISTENING" > "%TEMP%\_port.txt" 2>&1
if errorlevel 1 (
    call :error "Порт 3000 не слушается!"
) else (
    call :ok "Порт 3000 слушается:"
    type "%TEMP%\_port.txt"
)
del "%TEMP%\_port.txt" 2>nul
call :log ""

REM ============================================================
REM  6. ПРОВЕРКА API (health)
REM ============================================================
call :section "6. API HEALTH"

curl -s -m 5 "%API_URL%/health" > "%TEMP%\_health.txt" 2>&1
if errorlevel 1 (
    call :error "API не отвечает на /health"
) else (
    set /p HEALTH_RESPONSE=<"%TEMP%\_health.txt"
    call :log "Ответ /health: !HEALTH_RESPONSE!"
)
del "%TEMP%\_health.txt" 2>nul
call :log ""

REM ============================================================
REM  7. СТРЕСС-ТЕСТ ГОНКИ
REM ============================================================
call :section "7. СТРЕСС-ТЕСТ ГОНКИ (8 параллельных POST)"

call :log "Готовлю тест..."
call :log "ID для гонки: %TEST_ID%"
call :log ""

REM Получаем токен через тестовый скрипт
echo.
echo   ВАЖНО: нужно скопировать токен из браузера!
echo.
echo   1. Открой приложение в браузере (залогинен как admin)
echo   2. F12 - Console - выполни:
echo      copy(JSON.parse(sessionStorage.getItem('pipette_session')).token)
echo   3. Вставь токен сюда
echo.
set /p TOKEN="Токен: "

if "%TOKEN%"=="" (
    call :warn "Токен не введён - стресс-тест пропущен"
    goto :skip_stress
)

REM Пишем токен в файл (без кавычек)
echo %TOKEN% > "%TEMP%\_token.txt"

REM JSON payload
set "PAYLOAD={\"id\":\"%TEST_ID%\",\"model\":\"RaceProbe\",\"lastCalibration\":\"2025-01-01\",\"responsible\":\"Diag\"}"
echo %PAYLOAD% > "%TEMP%\_payload.txt"

call :log "Запускаю 8 параллельных POST..."

REM Запускаем 8 параллельных curl'ов
for /l %%I in (1,1,8) do (
    start /B cmd /c "curl -s -m 10 -X POST -H \"Authorization: Bearer %TOKEN%\" -H \"Content-Type: application/json\" -d @%TEMP%\_payload.txt -o %TEMP%\_resp_%%I.txt -w \"%%{http_code}\" %API_URL%/pipettes > %TEMP%\_code_%%I.txt 2>&1"
)

call :log "Ждём завершения (10 сек)..."
timeout /t 10 /nobreak >nul

REM Собираем результаты
call :log ""
call :log "Результаты 8 запросов:"
set /a CNT_201=0
set /a CNT_409=0
set /a CNT_500=0
set /a CNT_OTHER=0

for /l %%I in (1,1,8) do (
    if exist "%TEMP%\_code_%%I.txt" (
        set /p CODE=<"%TEMP%\_code_%%I.txt"
        call :log "  Запрос %%I: HTTP !CODE!"
        if "!CODE!"=="201" set /a CNT_201+=1
        if "!CODE!"=="409" set /a CNT_409+=1
        if "!CODE!"=="500" set /a CNT_500+=1
        if not "!CODE!"=="201" if not "!CODE!"=="409" if not "!CODE!"=="500" set /a CNT_OTHER+=1
    ) else (
        call :log "  Запрос %%I: файл кода не создан"
    )
)

call :log ""
call :log "СВОДКА:"
call :log "  201 (создано):       %CNT_201%"
call :log "  409 (конфликт):      %CNT_409%"
call :log "  500 (ошибка сервера): %CNT_500%"
call :log "  Прочие:              %CNT_OTHER%"

if %CNT_500% GTR 0 (
    call :warn "BUG-2025-001 ПОДТВЕРЖДЁН: %CNT_500% × 500"
) else (
    call :ok "BUG-2025-001 не воспроизвёлся: 500 нет!"
)

REM Cleanup
curl -s -m 5 -X DELETE -H "Authorization: Bearer %TOKEN%" "%API_URL%/pipettes/%TEST_ID%" >nul 2>&1

:skip_stress

REM ============================================================
REM  8. ЧИТАЕМ ЛОГ ОШИБОК
REM ============================================================
call :section "8. ЛОГ ОШИБОК NSSM"

if not exist "%LOG_DIR%\err.log" (
    call :warn "Файл %LOG_DIR%\err.log не существует"
    goto :skip_errlog
)

call :log "Последние 30 строк err.log со словом 'Create pipette':"
call :log "------------------------------------------------------------"
powershell -NoProfile -Command "Get-Content '%LOG_DIR%\err.log' -Tail 500 | Select-String -Pattern 'Create pipette|Race on create|Error:|code:|errno:|sqlMessage:' | Select-Object -Last 30 | ForEach-Object { $_.Line }" 2>nul
call :log "------------------------------------------------------------"

call :log ""
call :log "Полные последние 50 строк err.log:"
call :log "------------------------------------------------------------"
powershell -NoProfile -Command "Get-Content '%LOG_DIR%\err.log' -Tail 50" 2>nul
call :log "------------------------------------------------------------"

:skip_errlog
call :log ""

REM ============================================================
REM  9. ФИНАЛЬНАЯ СВОДКА
REM ============================================================
call :section "9. ИТОГ"

call :log "Что делать дальше:"
call :log ""
call :log "1. Если AppDirectory != P:\ -> сервис запускает код из другой папки!"
call :log "   Решение:"
call :log "      \"!NSSM_EXE!\" stop %SERVICE_NAME%"
call :log "      \"!NSSM_EXE!\" set %SERVICE_NAME% AppDirectory \"P:\""
call :log "      \"!NSSM_EXE!\" start %SERVICE_NAME%"
call :log ""
call :log "2. Если node.exe процессов > 1:"
call :log "      tasklist /FI \"IMAGENAME eq node.exe\" /V"
call :log "      taskkill /PID <лишний_pid> /F"
call :log ""
call :log "3. Если 500-х >= 1 в стресс-тесте -> смотри лог err.log"
call :log "   Найди строку 'Create pipette error:' - там точный e.code"
call :log "   Скинь эту строку - разработчик даст финальный патч"
call :log ""

:end
call :log ""
call :log "Отчёт сохранён: %REPORT_FILE%"
call :log "Диагностика завершена: %DATE% %TIME%"
echo.
echo ============================================================
echo   Отчёт сохранён в: %REPORT_FILE%
echo ============================================================
echo.
pause
endlocal
exit /b 0

REM ============================================================
REM  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
REM ============================================================

:header
call :log ""
call :log "############################################################"
call :log "#  %~1"
call :log "############################################################"
exit /b

:section
call :log ""
call :log "============================================================"
call :log "  %~1"
call :log "============================================================"
exit /b

:ok
call :log "[OK]   %~1"
exit /b

:error
call :log "[ERR]  %~1"
exit /b

:warn
call :log "[WARN] %~1"
exit /b

:log
echo %~1
echo %~1 >> "%REPORT_FILE%"
exit /b

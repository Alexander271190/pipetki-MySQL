@echo off
chcp 65001 >nul
title Диагностика автозапуска
echo ==================================================
echo   ДИАГНОСТИКА АВТОЗАПУСКА PM2 и MariaDB
echo ==================================================
echo.

echo [1] Проверка "Быстрого запуска" (Fast Startup)...
for /f "tokens=3" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled 2^>nul') do set HiberbootEnabled=%%a
if "%HiberbootEnabled%"=="0x0" (
    echo   [OK] "Быстрый запуск" ОТКЛЮЧЕН.
) else (
    echo   [!!] "Быстрый запуск" ВКЛЮЧЕН. Это может мешать автозапуску.
)
echo.

echo [2] Проверка автозапуска PM2 в реестре...
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v PM2 >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] PM2 найден в автозапуске.
) else (
    echo   [!!] PM2 НЕ найден в автозапуске.
)
echo.

echo [3] Проверка файла dump.pm2...
if exist "%USERPROFILE%\.pm2\dump.pm2" (
    echo   [OK] Файл dump.pm2 существует.
) else (
    echo   [!!] Файл dump.pm2 НЕ найден. Возможно, не выполнен 'pm2 save'.
)
echo.

echo [4] Проверка службы MariaDB...
sc query MariaDB | find "STATE" | find "RUNNING" >nul
if %errorlevel% equ 0 (
    echo   [OK] Служба MariaDB ЗАПУЩЕНА.
) else (
    echo   [!!] Служба MariaDB ОСТАНОВЛЕНА.
)
sc qc MariaDB | find "START_TYPE" | find "AUTO_START" >nul
if %errorlevel% equ 0 (
    echo   [OK] Тип запуска MariaDB: АВТО.
) else (
    echo   [!!] Тип запуска MariaDB НЕ АВТО.
)
echo.

echo [5] Проверка статуса PM2...
pm2 list >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] PM2 работает. Список процессов:
    pm2 list
) else (
    echo   [!!] PM2 не запущен или не найден в PATH.
)
echo.

echo ==================================================
echo   ДИАГНОСТИКА ЗАВЕРШЕНА
echo ==================================================
pause
@echo off
chcp 65001 >nul
title Настройка автозапуска

:: --- Проверка прав администратора ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ОШИБКА] Этот скрипт нужно запускать от имени администратора.
    pause
    exit /b 1
)

echo ==================================================
echo   НАСТРОЙКА АВТОЗАПУСКА PM2 и MariaDB
echo ==================================================
echo.

echo [1/5] Отключение "Быстрого запуска"...
powercfg /h off
if %errorlevel% equ 0 (
    echo   [OK] "Быстрый запуск" отключен.
) else (
    echo   [!!] Не удалось отключить "Быстрый запуск".
)
echo.

echo [2/5] Настройка автозапуска службы MariaDB...
sc config MariaDB start= auto
if %errorlevel% equ 0 (
    echo   [OK] Служба MariaDB настроена на автоматический запуск.
) else (
    echo   [!!] Не удалось настроить службу MariaDB.
)
echo.

echo [3/5] Настройка автозапуска PM2...
call pm2 unstartup >nul 2>&1
call pm2-startup install
call pm2 save
if %errorlevel% equ 0 (
    echo   [OK] Автозапуск PM2 настроен и состояние сохранено.
) else (
    echo   [!!] Не удалось настроить автозапуск PM2.
)
echo.

echo [4/5] Проверка настроек...
echo   - "Быстрый запуск":
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled | find "0x0" >nul && echo     [OK] Отключен || echo     [!!] Включен
echo   - Служба MariaDB:
sc qc MariaDB | find "AUTO_START" >nul && echo     [OK] Автозапуск включен || echo     [!!] Автозапуск выключен
echo   - PM2 в реестре:
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v PM2 >nul 2>&1 && echo     [OK] Найден || echo     [!!] Не найден
echo.

echo [5/5] Готово!
echo.
echo ==================================================
echo   НАСТРОЙКА ЗАВЕРШЕНА
echo ==================================================
echo.
echo   ЧТО ДЕЛАТЬ ДАЛЬШЕ:
echo   1. Выключите компьютер (не перезагружайте).
echo   2. Включите компьютер и войдите в систему.
echo   3. Подождите 1 минуту и проверьте работу сайта.
echo.
pause
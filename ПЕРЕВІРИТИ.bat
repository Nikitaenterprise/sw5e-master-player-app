@echo off
chcp 65001 >nul
cd /d "%~dp0"
node tools\check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo.
  echo   Спершу запусти ВСТАНОВИТИ.bat
  echo.
  pause
  exit /b 1
)
echo.
echo   Перевірка: типи, тести, золотий тест.
echo.
call npm run check
if errorlevel 1 (
  echo.
  echo   ЧЕРВОНЕ. Щось зламано - текст вище каже, що саме.
  echo   Якщо це сталося після чиїхось змін: docs\\ЯК-ВІДКАТИТИ.md
  echo.
) else (
  echo.
  echo   ЗЕЛЕНЕ. Усе ціле.
  echo.
)
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "apps\\server\\src\\index.ts" (
  echo.
  echo   Сервера ще немає. Це фіча F-010 у docs\\ФІЧІ.md
  echo   Поточний стан проєкту: docs\\ПРОГРЕС.md
  echo.
  pause
  exit /b 0
)
if not exist "node_modules" (
  echo   Спершу запусти ВСТАНОВИТИ.bat
  pause
  exit /b 1
)
call npm run dev
pause

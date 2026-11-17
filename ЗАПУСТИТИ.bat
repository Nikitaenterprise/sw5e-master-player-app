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
if not exist "node_modules\@holotable\protocol" (
  echo.
  echo   Внутрішні пакети не підключені, і сервер не стартує.
  echo   Лікується одним: запусти ВСТАНОВИТИ.bat, тоді спробуй ще раз.
  echo.
  pause
  exit /b 1
)
set HOLOTABLE_DEMO=
set HOLOTABLE_OPEN=/?as=gm
call npm start
pause

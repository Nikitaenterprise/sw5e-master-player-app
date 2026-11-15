@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  echo.
  echo   Спершу запусти ВСТАНОВИТИ.bat
  echo.
  pause
  exit /b 1
)
set HOLOTABLE_OPEN=/?as=gm
call npm start
pause

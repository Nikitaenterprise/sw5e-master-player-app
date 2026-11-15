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
echo.
echo   Відкриється одне вікно, сітка 2x2: майстер і три гравці.
echo   Усі на тому самому сервері. Тисни "відключити" в будь-якій панелі -
echo   решта має це побачити одразу.
echo.
set HOLOTABLE_OPEN=/demo.html
call npm start
pause

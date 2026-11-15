@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "apps\\web\\src\\demo.html" (
  echo.
  echo   Демо на чотирьох екранах ще немає. Це фіча F-011 у docs\\ФІЧІ.md
  echo.
  echo   Коли буде: відкриється одне вікно, сітка 2x2 -
  echo   екран майстра і три екрани гравців, усі живі.
  echo   Міняєш ХП у гравця - бачиш зміну в майстра.
  echo.
  pause
  exit /b 0
)
call npm run demo
pause

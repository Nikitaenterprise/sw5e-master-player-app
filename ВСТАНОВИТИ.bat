@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Не знайдено Node. Візьми його на nodejs.org, кнопка LTS, і запусти цей файл ще раз.
  echo.
  pause
  exit /b 1
)
node tools\check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo   Встановлення залежностей. Один раз, хвилина-дві.
echo.
if exist "node_modules" (
  echo   Спершу прибираю старе node_modules і ставлю начисто.
  echo   Так треба: залишки від іншого комп'ютера дають помилки,
  echo   у яких нічого не зрозуміло.
  echo.
  rmdir /s /q "node_modules"
)
call npm install
if errorlevel 1 (
  echo.
  echo   ПОМИЛКА. Найчастіша причина: не встановлений Node 22.12 або новіший.
  echo   Візьми його на nodejs.org, кнопка LTS, і запусти цей файл ще раз.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\@holotable\protocol" (
  echo.
  echo   ПОМИЛКА: внутрішні пакети не підключились.
  echo   Запусти цей файл ще раз. Якщо не допоможе - покажи мені цей текст.
  echo.
  pause
  exit /b 1
)
echo.
echo   Готово. Далі: ПЕРЕВІРИТИ.bat, щоб побачити, що все ціле.
echo.
pause

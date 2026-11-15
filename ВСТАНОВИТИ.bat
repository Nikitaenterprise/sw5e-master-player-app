@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Встановлення залежностей. Один раз, хвилина-дві.
echo.
call npm install
if errorlevel 1 (
  echo.
  echo   ПОМИЛКА. Найчастіша причина: не встановлений Node 22 або новіший.
  echo   Візьми його на nodejs.org, кнопка LTS, і запусти цей файл ще раз.
  echo.
  pause
  exit /b 1
)
echo.
echo   Готово. Далі: ПЕРЕВІРИТИ.bat, щоб побачити, що все ціле.
echo.
pause

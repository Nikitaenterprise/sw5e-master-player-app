#!/bin/bash
# Mac twin of ВСТАНОВИТИ.bat. A .command file opens in Terminal on double-click,
# which is what a .bat does on Windows; a .sh would open in a text editor instead.
cd "$(dirname "$0")" || exit 1
# A Terminal window may start without Homebrew's folders on PATH.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

pause() {
  echo
  read -r -p "  Натисни Enter, щоб закрити вікно. " _ || true
}

if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'

  Не знайдено Node. Візьми його на nodejs.org, кнопка LTS, і запусти цей файл ще раз.

EOF
  pause
  exit 1
fi
if ! node tools/check-node.mjs; then
  pause
  exit 1
fi
cat <<'EOF'

  Встановлення залежностей. Один раз, хвилина-дві.

EOF
if [ -e node_modules ]; then
  cat <<'EOF'
  Спершу прибираю старе node_modules і ставлю начисто.
  Так треба: залишки від іншого комп'ютера дають помилки,
  у яких нічого не зрозуміло.

EOF
  rm -rf node_modules
fi
if ! npm install; then
  cat <<'EOF'

  ПОМИЛКА. Найчастіша причина: не встановлений Node 22.12 або новіший.
  Візьми його на nodejs.org, кнопка LTS, і запусти цей файл ще раз.

EOF
  pause
  exit 1
fi
if [ ! -e node_modules/@holotable/protocol ]; then
  cat <<'EOF'

  ПОМИЛКА: внутрішні пакети не підключились.
  Запусти цей файл ще раз. Якщо не допоможе - покажи мені цей текст.

EOF
  pause
  exit 1
fi
cat <<'EOF'

  Готово. Далі: ПЕРЕВІРИТИ.command, щоб побачити, що все ціле.

EOF
pause

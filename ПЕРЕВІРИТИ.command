#!/bin/bash
# Mac twin of ПЕРЕВІРИТИ.bat. A .command file opens in Terminal on double-click,
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
if [ ! -d node_modules ]; then
  cat <<'EOF'

  Спершу запусти ВСТАНОВИТИ.command

EOF
  pause
  exit 1
fi
cat <<'EOF'

  Перевірка: типи, тести, золотий тест.

EOF
if npm run check; then
  cat <<'EOF'

  ЗЕЛЕНЕ. Усе ціле.

EOF
  pause
else
  cat <<'EOF'

  ЧЕРВОНЕ. Щось зламано - текст вище каже, що саме.
  Якщо це сталося після чиїхось змін: docs/ЯК-ВІДКАТИТИ.md

EOF
  pause
  exit 1
fi

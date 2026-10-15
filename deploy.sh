#!/usr/bin/env bash
set -euo pipefail
REPO="${1:-https://github.com/HPAINH/As-Sarir.git}"
MSG="${2:-Обновление игры}"
cd "$(dirname "$0")"
if [ ! -d .git ]; then
  git init -b main
  git remote add origin "$REPO"
fi
git add -A
git commit -m "$MSG" || echo "Нет изменений для коммита"
git push -u origin main
echo "Готово: https://$(echo "$REPO" | sed -E 's#https://github.com/([^/]+)/([^/.]+).*#\1.github.io/\2#')/"

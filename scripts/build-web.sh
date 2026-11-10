#!/usr/bin/env bash
# Единая сборка веб-части. Использование: scripts/build-web.sh [web|apk]
#  web — для сайта: добавляет строгую политику безопасности (CSP) в index.html;
#  apk — для приложения: без CSP (внутри Android WebView мост Capacitor вставляет свой скрипт).
# Результат (dist/) собирается из одних и тех же файлов.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-web}"
rm -rf dist && mkdir dist
cp ./*.js index.html style.css manifest.webmanifest dist/
cp -r icons dist/
python3 - "$TARGET" <<'PY'
import sys
target = sys.argv[1]
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
p = 'dist/index.html'
s = open(p, encoding='utf-8').read()
assert '<!--CSP-->' in s, 'в index.html нет метки <!--CSP-->'
s = s.replace('<!--CSP-->', f'<meta http-equiv="Content-Security-Policy" content="{CSP}">' if target == 'web' else '')
open(p, 'w', encoding='utf-8').write(s)
PY
echo "dist/ ($TARGET): $(find dist -type f | wc -l) файлов"

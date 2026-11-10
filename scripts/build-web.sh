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
import sys, os, json, hashlib
target = sys.argv[1]
# Адрес сервера синхронизации: переменная окружения важнее файла config/sync.json.
server = os.environ.get('LIFEOS_SERVER_URL')
if server is None:
    try: server = json.load(open('config/sync.json', encoding='utf-8')).get('url', '')
    except Exception: server = ''
server = (server or '').strip().rstrip('/')
if server and not (server.startswith('https://') or server.startswith('http://localhost') or server.startswith('http://127.0.0.1')):
    raise SystemExit('Адрес сервера в config/sync.json должен начинаться с https://')
# Если сервер известен — разрешаем обращения только к нему; иначе к любому https-адресу (его вводят вручную).
connect = "'self' " + (server if server else 'https:')
extra = os.environ.get('LIFEOS_CSP_CONNECT', '').strip()          # только для автотестов
if extra: connect += ' ' + extra
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
       f"connect-src {connect}; object-src 'none'; base-uri 'none'; form-action 'none'")
p = 'dist/index.html'
s = open(p, encoding='utf-8').read()
assert '<!--CSP-->' in s, 'в index.html нет метки <!--CSP-->'
s = s.replace('<!--CSP-->', f'<meta http-equiv="Content-Security-Policy" content="{CSP}">' if target == 'web' else '')
open(p, 'w', encoding='utf-8').write(s)

cfg = open('dist/config.js', encoding='utf-8').read()
assert "/*DEFAULT_SERVER*/ ''" in cfg, 'в config.js нет метки'
open('dist/config.js', 'w', encoding='utf-8').write(cfg.replace("/*DEFAULT_SERVER*/ ''", json.dumps(server)))

# Офлайн-кэш: полный список файлов и версия, зависящая от содержимого (любое изменение -> новый кэш).
files = sorted(os.path.relpath(os.path.join(d, f), 'dist') for d, _, fs in os.walk('dist') for f in fs)
shell = ['./'] + [f for f in files if f != 'sw.js']
h = hashlib.sha256()
for f in shell[1:]:
    h.update(f.encode()); h.update(open(os.path.join('dist', f), 'rb').read())
sw = open('dist/sw.js', encoding='utf-8').read()
assert "/*SHELL_LIST*/ ['./']" in sw and "/*BUILD_HASH*/ 'dev'" in sw, 'в sw.js нет меток сборки'
sw = sw.replace("/*SHELL_LIST*/ ['./']", json.dumps(shell, ensure_ascii=False)).replace("/*BUILD_HASH*/ 'dev'", "'" + h.hexdigest()[:12] + "'")
open('dist/sw.js', 'w', encoding='utf-8').write(sw)
PY
echo "dist/ ($TARGET): $(find dist -type f | wc -l) файлов"

#!/usr/bin/env bash
# Единая сборка веб-части. Её результат (dist/) идёт и на сайт, и внутрь APK.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp index.html style.css app.js events.js db.js platform.js sw.js manifest.webmanifest dist/
cp -r icons dist/
echo "dist/: $(find dist -type f | wc -l) файлов"

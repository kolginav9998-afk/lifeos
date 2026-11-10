#!/usr/bin/env python3
"""Правки созданного Capacitor Android-проекта (запускается в CI после `cap add android`).
1) Запрещает автоматическое облачное резервирование данных приложения (приватность).
2) Прописывает постоянный ключ подписи из signing/debug.keystore, чтобы новую версию можно было ставить поверх старой."""
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'android')

manifest = root / 'app/src/main/AndroidManifest.xml'
s = manifest.read_text(encoding='utf-8')
if 'android:allowBackup="true"' in s:
    s = s.replace('android:allowBackup="true"', 'android:allowBackup="false"')
assert 'android:allowBackup="false"' in s, 'allowBackup не удалось выключить'
manifest.write_text(s, encoding='utf-8')

gradle = root / 'app/build.gradle'
s = gradle.read_text(encoding='utf-8')
if 'signing/debug.keystore' not in s:
    block = (
        'android {\n'
        '    signingConfigs {\n'
        '        debug {\n'
        '            storeFile file("../../signing/debug.keystore")\n'
        '            storePassword "android"\n'
        '            keyAlias "androiddebugkey"\n'
        '            keyPassword "android"\n'
        '        }\n'
        '    }\n'
    )
    s, n = re.subn(r'^android \{\n', block, s, count=1, flags=re.M)
    assert n == 1, 'не найден блок android { в app/build.gradle'
    gradle.write_text(s, encoding='utf-8')
print('patched:', manifest, gradle)

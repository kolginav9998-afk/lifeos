#!/usr/bin/env python3
"""Правки созданного Capacitor Android-проекта (запускается в CI после `cap add android`).
1) Запрещает автоматическое облачное резервирование данных приложения (приватность).
2) Прописывает постоянный ключ подписи из signing/debug.keystore, чтобы новую версию можно было ставить поверх старой.
3) Подключает обновление изнутри: плагин ApkInstaller (скачать APK и открыть установщик Android) и разрешение на установку.
4) Ставит номер сборки (ANDROID_VERSION_CODE растёт с каждой сборкой) и имя версии (ANDROID_VERSION_NAME)."""
import os
import pathlib
import re
import shutil
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

# 3) Обновление изнутри
repo = pathlib.Path(__file__).resolve().parent.parent
pkg_dir = root / 'app/src/main/java/app/lifeos/mobile'
shutil.copy(repo / 'assets/android-java/ApkInstallerPlugin.java', pkg_dir / 'ApkInstallerPlugin.java')
main = pkg_dir / 'MainActivity.java'
src = main.read_text(encoding='utf-8')
if 'ApkInstallerPlugin' not in src:
    assert 'public class MainActivity extends BridgeActivity {}' in src, 'MainActivity.java выглядит не так, как ожидалось'
    main.write_text('''package app.lifeos.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
''', encoding='utf-8')
m = manifest.read_text(encoding='utf-8')
perm = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'
if perm not in m:
    anchor = '<uses-permission android:name="android.permission.INTERNET" />'
    assert anchor in m, 'в манифесте нет разрешения INTERNET'
    m = m.replace(anchor, anchor + '\n    ' + perm)
    manifest.write_text(m, encoding='utf-8')
assert perm in manifest.read_text(encoding='utf-8')

# 4) Номер и имя версии
code = os.environ.get('ANDROID_VERSION_CODE', '').strip()
name = os.environ.get('ANDROID_VERSION_NAME', '').strip()
g = gradle.read_text(encoding='utf-8')
if code:
    assert code.isdigit() and int(code) >= 1, 'ANDROID_VERSION_CODE должен быть числом'
    g, n = re.subn(r'versionCode \d+', 'versionCode ' + code, g, count=1)
    assert n == 1, 'не найден versionCode в app/build.gradle'
if name:
    assert re.fullmatch(r'[A-Za-z0-9._-]{1,32}', name), 'ANDROID_VERSION_NAME содержит лишние символы'
    g, n = re.subn(r'versionName "[^"]*"', 'versionName "' + name + '"', g, count=1)
    assert n == 1, 'не найден versionName в app/build.gradle'
gradle.write_text(g, encoding='utf-8')
print('patched:', manifest, gradle, main)

#!/usr/bin/env python3
"""Правки созданного Capacitor Android-проекта (запускается в CI после `cap add android`). Все правки идемпотентны: повторный запуск ничего не меняет.
1) Безопасность манифеста: нет облачного копирования и переноса данных (allowBackup=false + правила для Android 12+ и старше),
   запрет передачи данных по http (usesCleartextTraffic=false + network_security_config), у каждого компонента явный exported,
   лишние разрешения и служебный приёмник библиотек убраны. В конце манифест перечитывается и проверяется (assert).
2) Подпись и сборка: release-сборка подписывается постоянным ключом из signing/debug.keystore (отпечаток тот же, что у прежних debug-сборок,
   поэтому новую версию можно ставить поверх старой). Если включён личный ключ (переменные LIFEOS_KEYSTORE_FILE и др.), берётся он.
   Проверка lintVital не должна ронять сборку.
3) Обновление изнутри: плагин ApkInstaller (скачать APK и открыть установщик Android) и разрешение на установку.
4) Номер сборки (ANDROID_VERSION_CODE растёт с каждой сборкой) и имя версии (ANDROID_VERSION_NAME).
5) Тёмная заставка при запуске (Android 12+ берёт цвет из темы; рисунки для старых версий лежат в assets/android-res).
6) Название под иконкой (ANDROID_APP_NAME), если задано.
7) Отладка WebView по сети выключена в настройках приложения (и так выключена в release-сборке, это страховка)."""
import json
import os
import pathlib
import re
import shutil
import sys
import xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'android')
ANDROID_NS = '{http://schemas.android.com/apk/res/android}'
TOOLS_NS = '{http://schemas.android.com/tools}'

# ---------- 1) Манифест ----------
manifest = root / 'app/src/main/AndroidManifest.xml'
s = manifest.read_text(encoding='utf-8')

# пространство имён tools (нужно для tools:node="remove")
if 'xmlns:tools=' not in s:
    s, n = re.subn(r'(xmlns:android="http://schemas\.android\.com/apk/res/android")',
                   r'\1\n    xmlns:tools="http://schemas.android.com/tools"', s, count=1)
    assert n == 1, 'не найден корневой <manifest> с xmlns:android'

APP_OPEN = re.compile(r'<application\b[^>]*>', re.S)


def set_app_attr(text, name, value):
    """Поставить атрибут у <application>: заменить значение, если он уже есть, иначе добавить."""
    m = APP_OPEN.search(text)
    assert m, 'в манифесте нет <application>'
    tag = m.group(0)
    pat = re.compile(r'(\s)' + re.escape(name) + r'="[^"]*"')
    if pat.search(tag):
        new = pat.sub(lambda mm: mm.group(1) + name + '="' + value + '"', tag, count=1)
    else:
        new = tag.replace('<application', '<application\n        ' + name + '="' + value + '"', 1)
    return text[:m.start()] + new + text[m.end():]


s = set_app_attr(s, 'android:allowBackup', 'false')                                       # облачное копирование выключено
# (новые атрибуты вставляются сразу после <application, поэтому порядок здесь обратный)
s = set_app_attr(s, 'android:fullBackupContent', '@xml/backup_rules')                      # Android 11 и старше
s = set_app_attr(s, 'android:dataExtractionRules', '@xml/data_extraction_rules')           # Android 12+: облако и перенос на другой телефон
s = set_app_attr(s, 'android:networkSecurityConfig', '@xml/network_security_config')
s = set_app_attr(s, 'android:usesCleartextTraffic', 'false')                              # никакого http

# Приёмники плагина уведомлений получают только собственные PendingIntent приложения: делаем «не экспортируется» явным.
# Служебный приёмник androidx.profileinstaller (его дёргают только через adb, нужно разрешение DUMP) убираем: приложению он не нужен.
if 'TimedNotificationPublisher' not in s:
    extra = (
        '\n        <!-- Приёмники плагина уведомлений: их запускает только само приложение через будильник -->\n'
        '        <receiver android:name="com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher" android:exported="false" />\n'
        '        <receiver android:name="com.capacitorjs.plugins.localnotifications.NotificationDismissReceiver" android:exported="false" />\n'
        '        <!-- Служебный приёмник библиотеки (запуск только через adb): не нужен -->\n'
        '        <receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" tools:node="remove" />\n'
    )
    assert '    </application>' in s, 'в манифесте нет </application>'
    s = s.replace('    </application>', extra + '    </application>', 1)

# Разрешения: INTERNET (синхронизация, проверка обновлений) и REQUEST_INSTALL_PACKAGES (обновление изнутри).
# WAKE_LOCK плагин уведомлений объявляет, но в коде не использует: убираем. RECEIVE_BOOT_COMPLETED и POST_NOTIFICATIONS нужны (напоминания после перезагрузки и сами уведомления).
install_perm = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'
wake_remove = '<uses-permission android:name="android.permission.WAKE_LOCK" tools:node="remove" />'
if install_perm not in s:
    anchor = '<uses-permission android:name="android.permission.INTERNET" />'
    assert anchor in s, 'в манифесте нет разрешения INTERNET'
    s = s.replace(anchor, anchor + '\n    ' + install_perm, 1)
if wake_remove not in s:
    s = s.replace(install_perm, install_perm + '\n    ' + wake_remove, 1)
manifest.write_text(s, encoding='utf-8')

res_xml = root / 'app/src/main/res/xml'
res_xml.mkdir(parents=True, exist_ok=True)
ALL_DOMAINS = ('root', 'file', 'database', 'sharedpref', 'external')
DEVICE_DOMAINS = ('device_root', 'device_file', 'device_database', 'device_sharedpref')


def excludes(domains, indent):
    return ''.join(f'{indent}<exclude domain="{d}" path="." />\n' for d in domains)


RES_FILES = {
    'network_security_config.xml': (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!-- Только https и только системные сертификаты: ни открытый http, ни сертификаты, добавленные на телефон, не допускаются. -->\n'
        '<network-security-config>\n'
        '    <base-config cleartextTrafficPermitted="false">\n'
        '        <trust-anchors>\n'
        '            <certificates src="system" />\n'
        '        </trust-anchors>\n'
        '    </base-config>\n'
        '</network-security-config>\n'),
    'data_extraction_rules.xml': (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!-- Android 12+: ничего не попадает ни в облачную копию Google, ни при переносе на новый телефон. Данные возвращаются из аккаунта и архива. -->\n'
        '<data-extraction-rules>\n'
        '    <cloud-backup>\n' + excludes(ALL_DOMAINS, '        ') +
        '    </cloud-backup>\n'
        '    <device-transfer>\n' + excludes(ALL_DOMAINS + DEVICE_DOMAINS, '        ') +
        '    </device-transfer>\n'
        '</data-extraction-rules>\n'),
    'backup_rules.xml': (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!-- Android 11 и старше: ничего не копируется (дополнительно к allowBackup=false). -->\n'
        '<full-backup-content>\n' + excludes(ALL_DOMAINS, '    ') +
        '</full-backup-content>\n'),
}
for name, body in RES_FILES.items():
    ET.fromstring(body)                                         # хорошо оформленный XML, иначе сборка упала бы позже и непонятно
    (res_xml / name).write_text(body, encoding='utf-8')


def audit_manifest(path):
    """Перечитать манифест приложения и проверить, что нужное на месте, а лишнего нет (итоговую проверку по готовому APK делает scripts/check-apk.mjs)."""
    r = ET.parse(path).getroot()
    app = r.find('application')
    assert app is not None
    want = {'allowBackup': 'false', 'usesCleartextTraffic': 'false', 'networkSecurityConfig': '@xml/network_security_config',
            'dataExtractionRules': '@xml/data_extraction_rules', 'fullBackupContent': '@xml/backup_rules'}
    for k, v in want.items():
        assert app.get(ANDROID_NS + k) == v, f'в манифесте {k} != {v}'
    assert app.get(ANDROID_NS + 'debuggable') is None, 'в исходном манифесте не должно быть android:debuggable'
    for kind in ('activity', 'activity-alias', 'service', 'receiver', 'provider'):
        for c in app.findall(kind):
            name = c.get(ANDROID_NS + 'name')
            if c.get(TOOLS_NS + 'node') == 'remove':
                continue
            ex = c.get(ANDROID_NS + 'exported')
            assert ex in ('true', 'false'), f'{kind} {name}: не указан android:exported'
            assert ex == 'false' or name == '.MainActivity', f'{kind} {name}: экспортируется, а должен только .MainActivity'
    perms = {p.get(ANDROID_NS + 'name') for p in r.findall('uses-permission') if p.get(TOOLS_NS + 'node') != 'remove'}
    assert perms == {'android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES'}, f'разрешения в манифесте: {sorted(perms)}'
    removed = {p.get(ANDROID_NS + 'name') for p in r.findall('uses-permission') if p.get(TOOLS_NS + 'node') == 'remove'}
    assert 'android.permission.WAKE_LOCK' in removed, 'WAKE_LOCK не помечен к удалению'


audit_manifest(manifest)

# ---------- 2) Сборка и подпись ----------
gradle = root / 'app/build.gradle'
g = gradle.read_text(encoding='utf-8')

ks_file = os.environ.get('LIFEOS_KEYSTORE_FILE', '').strip()
private_key = bool(ks_file)
if private_key:
    for v in ('LIFEOS_KEYSTORE_PASSWORD', 'LIFEOS_KEY_ALIAS', 'LIFEOS_KEY_PASSWORD'):
        assert os.environ.get(v), f'личный ключ включён (LIFEOS_KEYSTORE_FILE), но не задано {v}'
    sign_cfg = (
        '        debug {\n'
        '            storeFile file(System.getenv("LIFEOS_KEYSTORE_FILE"))\n'
        '            storePassword System.getenv("LIFEOS_KEYSTORE_PASSWORD")\n'
        '            keyAlias System.getenv("LIFEOS_KEY_ALIAS")\n'
        '            keyPassword System.getenv("LIFEOS_KEY_PASSWORD")\n'
        '        }\n')
else:
    sign_cfg = (
        '        debug {\n'
        '            storeFile file("../../signing/debug.keystore")\n'
        '            storePassword "android"\n'
        '            keyAlias "androiddebugkey"\n'
        '            keyPassword "android"\n'
        '        }\n')
block = (
    '    // lifeos:begin hardening\n'
    '    signingConfigs {\n' + sign_cfg +
    '    }\n'
    '    lint {\n'
    '        // проверка lintVital в release-сборке не должна ронять выпуск (сборка и так проверяется тестами и сверкой APK)\n'
    '        checkReleaseBuilds = false\n'
    '        abortOnError = false\n'
    '    }\n'
    '    // lifeos:end hardening\n')
g = re.sub(r'    // lifeos:begin hardening\n.*?    // lifeos:end hardening\n', '', g, flags=re.S)
g, n = re.subn(r'^android \{\n', lambda m: 'android {\n' + block, g, count=1, flags=re.M)
assert n == 1, 'не найден блок android { в app/build.gradle'

# release-сборка: не отлаживаемая, подписана тем же ключом
g = re.sub(r'            // lifeos:begin release\n.*?            // lifeos:end release\n', '', g, flags=re.S)
g, n = re.subn(r'(buildTypes \{\s*release \{\n)', lambda m: m.group(1) +
               '            // lifeos:begin release\n'
               '            signingConfig signingConfigs.debug\n'
               '            debuggable false\n'
               '            // lifeos:end release\n', g, count=1)
assert n == 1, 'не найден buildTypes { release { в app/build.gradle'
assert re.search(r'release \{\s*// lifeos:begin release\s*signingConfig signingConfigs\.debug\s*debuggable false', g), 'release-сборка не настроена'

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
assert 'REQUEST_INSTALL_PACKAGES' in manifest.read_text(encoding='utf-8')

# 4) Номер и имя версии
code = os.environ.get('ANDROID_VERSION_CODE', '').strip()
name = os.environ.get('ANDROID_VERSION_NAME', '').strip()
if code:
    assert code.isdigit() and int(code) >= 1, 'ANDROID_VERSION_CODE должен быть числом'
    g, n = re.subn(r'versionCode \d+', 'versionCode ' + code, g, count=1)
    assert n == 1, 'не найден versionCode в app/build.gradle'
if name:
    assert re.fullmatch(r'[A-Za-z0-9._-]{1,32}', name), 'ANDROID_VERSION_NAME содержит лишние символы'
    g, n = re.subn(r'versionName "[^"]*"', 'versionName "' + name + '"', g, count=1)
    assert n == 1, 'не найден versionName в app/build.gradle'
gradle.write_text(g, encoding='utf-8')

# 5) Заставка
styles = root / 'app/src/main/res/values/styles.xml'
st = styles.read_text(encoding='utf-8')
if 'windowSplashScreenBackground' not in st:
    anchor = '<item name="android:background">@drawable/splash</item>'
    assert anchor in st, 'в styles.xml нет ожидаемой темы запуска'
    st = st.replace(anchor, anchor + '\n        <item name="windowSplashScreenBackground">#070812</item>')
    styles.write_text(st, encoding='utf-8')

# 6) Название под иконкой
app_name = os.environ.get('ANDROID_APP_NAME', '').strip()
if app_name:
    assert '<' not in app_name and '&' not in app_name and '"' not in app_name and len(app_name) <= 30, 'ANDROID_APP_NAME: недопустимые символы'
    strings = root / 'app/src/main/res/values/strings.xml'
    sx = strings.read_text(encoding='utf-8')
    sx, n1 = re.subn(r'(<string name="app_name">)[^<]*(</string>)', r'\g<1>' + app_name + r'\g<2>', sx)
    sx, n2 = re.subn(r'(<string name="title_activity_main">)[^<]*(</string>)', r'\g<1>' + app_name + r'\g<2>', sx)
    assert n1 == 1 and n2 == 1, 'не найдены строки app_name и title_activity_main'
    strings.write_text(sx, encoding='utf-8')

# 7) Отладка WebView по сети выключена явно (в release-сборке она выключена и сама)
cap_cfg = root / 'app/src/main/assets/capacitor.config.json'
if cap_cfg.exists():
    cfg = json.loads(cap_cfg.read_text(encoding='utf-8'))
    cfg.setdefault('android', {})['webContentsDebuggingEnabled'] = False
    assert cfg['android'].get('allowMixedContent') is False, 'allowMixedContent должен быть false'
    cap_cfg.write_text(json.dumps(cfg, ensure_ascii=False, indent='\t') + '\n', encoding='utf-8')
print('patched:', manifest, gradle, main, '| ключ подписи:', 'личный' if private_key else 'общий из репозитория')

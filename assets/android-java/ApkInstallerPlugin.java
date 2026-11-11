package app.lifeos.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Обновление приложения изнутри: скачать новый APK в кэш приложения и открыть системный установщик Android.
 * Подтверждение установки всегда остаётся за пользователем (так устроен Android). Файл ставится поверх старого приложения только
 * если подписан тем же ключом, поэтому подменить приложение чужим файлом нельзя. Данные приложения при этом сохраняются.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {
    private static final String DIR = "updates";
    private static final String FILE = "update.apk";
    private volatile boolean cancelled = false;
    private volatile boolean busy = false;

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** Адрес можно скачивать только с GitHub и только по https. */
    static boolean trusted(URL u) {
        if (!"https".equals(u.getProtocol())) return false;
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
        return h.equals("github.com") || h.endsWith(".github.com") || h.equals("githubusercontent.com") || h.endsWith(".githubusercontent.com");
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    private void emit(long received, long total) {
        JSObject p = new JSObject();
        p.put("received", received);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    /** Версия установленного приложения и можно ли ему ставить обновления. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        String name = "";
        long code = 0;
        try {
            Context c = getContext();
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            if (pi.versionName != null) name = pi.versionName;
            code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception ignored) {
            // версия не прочиталась: остальное всё равно полезно
        }
        r.put("versionName", name);
        r.put("versionCode", code);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("canInstall", canInstall());
        call.resolve(r);
    }

    /** Открыть настройку «Установка неизвестных приложений» для этого приложения. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Не удалось открыть настройки" : e.getMessage());
        }
    }

    /** Скачать файл по адресу url в кэш приложения; во время загрузки приходят события progress {received, total}. */
    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null) {
            call.reject("Не указан адрес обновления");
            return;
        }
        if (busy) {
            call.reject("Загрузка уже идёт");
            return;
        }
        busy = true;
        cancelled = false;
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                File out = null;
                try {
                    URL cur = new URL(url);
                    if (!trusted(cur)) throw new Exception("Адрес обновления не разрешён");
                    File dir = new File(getContext().getCacheDir(), DIR);
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Не удалось создать папку для загрузки");
                    File[] old = dir.listFiles();
                    if (old != null) for (File f : old) f.delete();
                    out = new File(dir, FILE);

                    // Переходы вручную: каждый следующий адрес тоже должен быть на GitHub и по https.
                    int code = 0;
                    for (int hop = 0; hop < 6; hop++) {
                        conn = (HttpURLConnection) cur.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("Accept", "application/octet-stream");
                        code = conn.getResponseCode();
                        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                            String loc = conn.getHeaderField("Location");
                            conn.disconnect();
                            conn = null;
                            if (loc == null) throw new Exception("Сервер не указал, где лежит файл");
                            URL next = new URL(cur, loc);
                            if (!trusted(next)) throw new Exception("Адрес перенаправления не разрешён");
                            cur = next;
                            continue;
                        }
                        break;
                    }
                    if (conn == null || code != 200) throw new Exception("Сервер ответил кодом " + code);

                    long total = conn.getContentLength();
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    long got = 0;
                    long lastEmit = 0;
                    InputStream in = conn.getInputStream();
                    OutputStream os = new FileOutputStream(out);
                    try {
                        byte[] buf = new byte[32768];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            if (cancelled) throw new Exception("Загрузка отменена");
                            os.write(buf, 0, n);
                            md.update(buf, 0, n);
                            got += n;
                            long now = System.currentTimeMillis();
                            if (now - lastEmit > 250) {
                                lastEmit = now;
                                emit(got, total);
                            }
                        }
                    } finally {
                        try { os.close(); } catch (Exception ignored) { }
                        try { in.close(); } catch (Exception ignored) { }
                    }
                    if (total > 0 && got != total) throw new Exception("Файл скачался не полностью");
                    emit(got, total);
                    JSObject r = new JSObject();
                    r.put("path", out.getAbsolutePath());
                    r.put("size", got);
                    r.put("sha256", hex(md.digest()));
                    call.resolve(r);
                } catch (Exception e) {
                    if (out != null) out.delete();
                    call.reject(e.getMessage() == null ? "Не удалось скачать обновление" : e.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                    busy = false;
                }
            }
        }).start();
    }

    /** Остановить идущую загрузку. */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    /** Открыть системный установщик для скачанного файла. Если разрешения ещё нет, вернёт needsPermission. */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("Не указан файл обновления");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), DIR);
            File f = new File(path);
            if (!f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator) || !f.isFile()) {
                call.reject("Файл обновления не найден");
                return;
            }
            JSObject r = new JSObject();
            if (!canInstall()) {
                r.put("started", false);
                r.put("needsPermission", true);
                call.resolve(r);
                return;
            }
            Context c = getContext();
            Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            r.put("started", true);
            r.put("needsPermission", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Не удалось открыть установщик" : e.getMessage());
        }
    }
}

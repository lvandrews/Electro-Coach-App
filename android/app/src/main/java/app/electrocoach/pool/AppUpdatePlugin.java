package app.electrocoach.pool;

import android.content.Intent;
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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates: downloads the new APK from GitHub into the app's own cache (with progress),
 * then hands it to Android's installer. Avoids the browser's download screen, which can stall
 * at 100% with nothing to tap. The first time, Android asks the user to allow Electro-Coach
 * to install apps; install() opens that setting and reports needsPermission.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private File updatesDir() { return new File(getContext().getCacheDir(), "updates"); }

    /** Download {url} (a github.com release asset) as electro-coach-{version}.apk. Emits "progress" {received, total}. */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String version = call.getString("version", "new");
        if (url == null || !url.startsWith("https://github.com/")) { call.reject("Not a GitHub download link"); return; }
        new Thread(() -> {
            HttpURLConnection c = null;
            File part = null;
            try {
                File dir = updatesDir();
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("can't create the download folder");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                String safe = version.replaceAll("[^0-9.]", "");
                File out = new File(dir, "electro-coach-" + (safe.isEmpty() ? "new" : safe) + ".apk");
                part = new File(dir, out.getName() + ".part");

                // GitHub answers with a redirect to its file host; follow it (https only).
                URL u = new URL(url);
                for (int hop = 0; ; hop++) {
                    c = (HttpURLConnection) u.openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && hop < 5) {
                        String loc = c.getHeaderField("Location");
                        c.disconnect(); c = null;
                        if (loc == null) throw new IOException("redirect without a location");
                        u = new URL(u, loc);
                        if (!"https".equals(u.getProtocol())) throw new IOException("insecure redirect");
                        continue;
                    }
                    if (code != 200) throw new IOException("GitHub answered " + code);
                    break;
                }

                long total = c.getContentLengthLong();
                long received = 0, lastSent = 0;
                byte[] buf = new byte[64 * 1024];
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        received += n;
                        long now = System.currentTimeMillis();
                        if (now - lastSent > 250) {
                            lastSent = now;
                            JSObject p = new JSObject();
                            p.put("received", received);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                if (total > 0 && received != total) throw new IOException("the download was cut short");
                if (!part.renameTo(out)) throw new IOException("can't save the file");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("bytes", received);
                call.resolve(r);
            } catch (Exception e) {
                if (part != null) part.delete();
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    /** Open Android's installer for a downloaded update. {needsPermission: true} when the user must first allow installs. */
    @PluginMethod
    public void install(PluginCall call) {
        JSObject r = new JSObject();
        try {
            File f = new File(call.getString("path", ""));
            if (!f.isFile() || !f.getCanonicalPath().startsWith(updatesDir().getCanonicalPath() + File.separator)) {
                call.reject("No downloaded update to install"); return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
                r.put("needsPermission", true);
                call.resolve(r);
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            r.put("started", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Couldn't open the installer: " + e.getMessage());
        }
    }
}

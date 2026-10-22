package app.electrocoach.pool;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Receives CSV files sent to Electro-Coach from other apps (Share or Open with), so a
 * Railbird export can be imported without saving it and picking it again. The file's
 * text is handed to the web app, which imports it like any other export.
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private JSObject pending = null;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        JSObject file = read(intent);
        if (file != null) {
            pending = file;
            // Consumed: a rotation or a return to the app mustn't import it again.
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject file = read(intent);
        if (file != null) {
            pending = null;
            notifyListeners("fileReceived", file, true);
        }
    }

    /** The file that opened the app, if any (returned once). */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject out = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(out);
    }

    @SuppressWarnings("deprecation")
    private JSObject read(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(action)) {
            Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (extra instanceof Uri) uri = (Uri) extra;
            if (uri == null) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null && text.length() > 0) {
                    JSObject o = new JSObject();
                    o.put("name", "shared.csv");
                    o.put("text", text.toString());
                    return o;
                }
            }
        } else if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        }
        if (uri == null) return null;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[65536];
            int n, total = 0;
            while ((n = in.read(chunk)) != -1) {
                total += n;
                if (total > MAX_BYTES) return error("The file is too large to import (over 50 MB).");
                buf.write(chunk, 0, n);
            }
            JSObject o = new JSObject();
            o.put("name", displayName(uri));
            o.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            return o;
        } catch (Exception e) {
            return error("Could not read the shared file: " + e.getMessage());
        }
    }

    private JSObject error(String message) {
        JSObject o = new JSObject();
        o.put("error", message);
        return o;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last != null ? last : "shared.csv";
    }
}

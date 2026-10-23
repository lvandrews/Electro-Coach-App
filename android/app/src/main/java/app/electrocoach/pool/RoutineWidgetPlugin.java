package app.electrocoach.pool;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge between the web app and the routine widget: stores the routine text and the
 * chosen text size where the widget can read them, and reports when the widget opened
 * the app so the web app can show the routine page.
 */
@CapacitorPlugin(name = "RoutineWidget")
public class RoutineWidgetPlugin extends Plugin {
    private static final String PREFS = "ec_widget";
    private String pendingOpen = null;

    static String items(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("items", "[]"); }
    static float scale(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getFloat("scale", 1f); }

    @Override
    public void load() {
        String open = openTarget(getActivity().getIntent());
        if (open != null) {
            pendingOpen = open;
            getActivity().getIntent().removeExtra(RoutineWidgetProvider.EXTRA_OPEN);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String open = openTarget(intent);
        if (open != null) {
            pendingOpen = null;
            JSObject o = new JSObject();
            o.put("open", open);
            notifyListeners("open", o, true);
        }
    }

    private static String openTarget(Intent intent) {
        return intent == null ? null : intent.getStringExtra(RoutineWidgetProvider.EXTRA_OPEN);
    }

    /** Save the routine (a list of {k, t} rows) and the text size, then redraw the widgets. */
    @PluginMethod
    public void update(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        Double scale = call.getDouble("scale", 1.0);
        SharedPreferences.Editor e = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putString("items", items.toString());
        e.putFloat("scale", scale == null ? 1f : scale.floatValue());
        e.apply();
        RoutineWidgetProvider.refresh(getContext());
        call.resolve();
    }

    /** The page the widget asked to open when it launched the app, if any (returned once). */
    @PluginMethod
    public void takeOpen(PluginCall call) {
        JSObject o = new JSObject();
        if (pendingOpen != null) o.put("open", pendingOpen);
        pendingOpen = null;
        call.resolve(o);
    }
}

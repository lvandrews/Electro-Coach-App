package app.electrocoach.pool;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.TypedValue;
import android.widget.RemoteViews;

/**
 * Home-screen widget with the pre-shot routine: the quick card first, then the full
 * notes, in a scrolling list. The app writes the routine text with RoutineWidgetPlugin
 * whenever it is edited; tapping the widget opens the app on the routine page.
 */
public class RoutineWidgetProvider extends AppWidgetProvider {
    public static final String EXTRA_OPEN = "ec_open";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
    }

    static RemoteViews build(Context context, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_routine);

        Intent service = new Intent(context, RoutineWidgetService.class);
        service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));   // one adapter per widget
        views.setRemoteAdapter(R.id.widget_list, service);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        float scale = RoutineWidgetPlugin.scale(context);
        views.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, 16f * scale);
        views.setTextViewTextSize(R.id.widget_empty, TypedValue.COMPLEX_UNIT_SP, 14f * scale);

        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.putExtra(EXTRA_OPEN, "routine");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int immutable = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        views.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(context, 7300, open, immutable));
        views.setOnClickPendingIntent(R.id.widget_empty, PendingIntent.getActivity(context, 7301, open, immutable));

        // List rows fill in this template, so it has to stay mutable on Android 12+.
        int template = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, 7302, open, template));
        return views;
    }

    /** Redraw every routine widget (after the app saves new text or a new size). */
    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, RoutineWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}

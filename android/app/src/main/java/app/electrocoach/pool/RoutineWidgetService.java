package app.electrocoach.pool;

import android.content.Context;
import android.content.Intent;
import android.util.TypedValue;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Supplies the rows of the routine widget's list: headings, quick-card steps and notes. */
public class RoutineWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Row { final String kind; final String text; Row(String k, String t) { kind = k; text = t; } }

    static class Factory implements RemoteViewsFactory {
        private final Context context;
        private final List<Row> rows = new ArrayList<>();
        private float scale = 1f;

        Factory(Context context) { this.context = context; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { rows.clear(); }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            scale = RoutineWidgetPlugin.scale(context);
            try {
                JSONArray items = new JSONArray(RoutineWidgetPlugin.items(context));
                for (int i = 0; i < items.length(); i++) {
                    JSONObject o = items.getJSONObject(i);
                    rows.add(new Row(o.optString("k", "p"), o.optString("t", "")));
                }
            } catch (Exception ignored) { }
        }

        @Override public int getCount() { return rows.size(); }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= rows.size()) return null;
            Row r = rows.get(position);
            boolean heading = "h".equals(r.kind);
            RemoteViews v = new RemoteViews(context.getPackageName(), heading ? R.layout.widget_item_heading : R.layout.widget_item_text);
            v.setTextViewText(R.id.widget_item, r.text);
            float sp = heading ? 15f : "q".equals(r.kind) ? 15f : 14f;
            v.setTextViewTextSize(R.id.widget_item, TypedValue.COMPLEX_UNIT_SP, sp * scale);
            v.setOnClickFillInIntent(R.id.widget_item, new Intent());
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}

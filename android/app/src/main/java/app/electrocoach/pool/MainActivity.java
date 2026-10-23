package app.electrocoach.pool;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Receives Railbird CSV exports shared to the app (see IncomingFilePlugin).
        registerPlugin(IncomingFilePlugin.class);
        // Keeps the home-screen routine widget up to date (see RoutineWidgetPlugin).
        registerPlugin(RoutineWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

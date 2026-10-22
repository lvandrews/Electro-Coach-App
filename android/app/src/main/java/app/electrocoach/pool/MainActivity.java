package app.electrocoach.pool;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Receives Railbird CSV exports shared to the app (see IncomingFilePlugin).
        registerPlugin(IncomingFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

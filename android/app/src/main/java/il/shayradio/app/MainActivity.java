package il.shayradio.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    private String keepPlayingScript;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        keepPlayingScript = readRawResource(R.raw.keep_playing);
        WebView webView = getBridge().getWebView();

        // The page tells us when the radio starts/stops, so we can keep the app
        // alive in the background (with a "now playing" notification).
        webView.addJavascriptInterface(new RadioBridge(), "ShayRadioNative");
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                view.evaluateJavascript(keepPlayingScript, null);
            }
        });

        // Android 13+: needed so the "now playing" notification is visible.
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }

        // Back button: go back inside the site; on the first page, send the app
        // to the background instead of closing it so the radio keeps playing.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewRunning();
    }

    @Override
    public void onDestroy() {
        RadioService.stop(this);
        super.onDestroy();
    }

    // Keep the WebView (and its audio) running while the app is in the background.
    private void keepWebViewRunning() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        }
    }

    private String readRawResource(int id) {
        try (InputStream in = getResources().openRawResource(id)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "";
        }
    }

    private class RadioBridge {
        @JavascriptInterface
        public void setPlaying(boolean playing) {
            runOnUiThread(() -> {
                if (playing) {
                    RadioService.start(MainActivity.this);
                } else {
                    RadioService.stop(MainActivity.this);
                }
            });
        }
    }
}

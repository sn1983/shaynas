package il.shayradio.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.lifecycle.Lifecycle;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Connects the site's radio player to Android. Capacitor loads plugins before
 * it loads the site, so everything here is in place before the page runs.
 */
@CapacitorPlugin(name = "ShayRadio")
public class ShayRadioPlugin extends Plugin implements RadioService.Controller {

    private String script = "";

    @SuppressLint({ "JavascriptInterface", "AddJavascriptInterface" })
    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        script = readScript();

        // Allow the few stations that still stream over plain http (e.g. ECO99FM).
        webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // Keep the page's audio at full priority while the app is in the background.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }

        webView.addJavascriptInterface(new NativeBridge(), "ShayRadioNative");
        // Fetch problem streams (e.g. ECO99FM) natively; see StreamFixClient.
        getBridge().setWebViewClient(new StreamFixClient(getBridge()));

        // Run our script before the site's own scripts on every page load...
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, script, Collections.singleton("*"));
            } catch (Exception ignored) {
                // fall back to injecting after load (below)
            }
        }
        // ...and again after load, for older WebViews (the script ignores repeats).
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                view.evaluateJavascript(script, null);
            }
        });

        RadioService.controller = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (RadioService.controller == this) RadioService.controller = null;
        super.handleOnDestroy();
    }

    // ----- Commands from the notification / lock screen / headphones -----

    @Override
    public void play() {
        runJs("window.__shayRadio && window.__shayRadio.play()");
    }

    @Override
    public void stop() {
        runJs("window.__shayRadio && window.__shayRadio.stop()");
    }

    @Override
    public void exit() {
        stop();
        getActivity().runOnUiThread(() -> getActivity().finishAndRemoveTask());
    }

    private void runJs(String js) {
        getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    // ----- Messages from the page -----

    private class NativeBridge {
        @JavascriptInterface
        public void setPlaying(boolean isPlaying, String stationName) {
            getActivity().runOnUiThread(() -> {
                boolean inForeground = getActivity().getLifecycle().getCurrentState()
                    .isAtLeast(Lifecycle.State.STARTED);
                RadioService.update(getContext(), isPlaying, stationName, inForeground);
                if (isPlaying && inForeground) askToIgnoreBatteryOptimizationOnce();
            });
        }
    }

    /**
     * Some phones (Samsung, Xiaomi, ...) still stop background apps after a few
     * minutes. Ask once, the first time the radio plays, to exclude this app.
     */
    @SuppressLint("BatteryLife")
    private void askToIgnoreBatteryOptimizationOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) return;
        SharedPreferences prefs = ctx.getSharedPreferences("shay_radio", Context.MODE_PRIVATE);
        if (prefs.getBoolean("asked_battery", false)) return;
        prefs.edit().putBoolean("asked_battery", true).apply();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + ctx.getPackageName()));
            getActivity().startActivity(intent);
        } catch (Exception ignored) {
            // Settings screen not available on this phone.
        }
    }

    private String readScript() {
        try (InputStream in = getContext().getResources().openRawResource(R.raw.keep_playing)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "";
        }
    }
}

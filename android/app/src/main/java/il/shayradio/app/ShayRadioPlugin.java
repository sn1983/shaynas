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
import org.json.JSONObject;

/**
 * Connects the site's radio player to the native player (RadioService).
 * Capacitor loads plugins before it loads the site, so the bridge and the
 * page script are in place before the page runs.
 */
@CapacitorPlugin(name = "ShayRadio")
public class ShayRadioPlugin extends Plugin implements RadioService.Listener {

    private String script = "";

    @SuppressLint({ "JavascriptInterface", "AddJavascriptInterface" })
    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        script = readScript();

        webView.addJavascriptInterface(new NativeBridge(), "ShayRadioNative");

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

        RadioService.listener = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (RadioService.listener == this) RadioService.listener = null;
        super.handleOnDestroy();
    }

    // ----- Native player -> page -----

    @Override
    public void onState(String state) {
        String js = "window.__shayRadio && window.__shayRadio._native(" + JSONObject.quote(state) + ")";
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    @Override
    public void exit() {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> getActivity().finishAndRemoveTask());
    }

    // ----- Page -> native player -----

    private boolean appInForeground() {
        return getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED);
    }

    private class NativeBridge {
        @JavascriptInterface
        public void playStream(String url, String title, double volume) {
            getActivity().runOnUiThread(() -> {
                boolean foreground = appInForeground();
                RadioService.setVolume((float) volume);
                RadioService.playStream(getContext(), url, title, foreground);
                if (foreground) askToIgnoreBatteryOptimizationOnce();
            });
        }

        @JavascriptInterface
        public void stopStream() {
            RadioService.stopStream();
        }

        @JavascriptInterface
        public void setVolume(double volume) {
            RadioService.setVolume((float) volume);
        }

        // ----- Now-playing helpers (window.electronAPI on the page) -----

        @JavascriptInterface
        public void fetchRaw(String id, String url) {
            ifFromSite(id, () -> NowPlaying.fetchRaw(url, result -> deliver(id, result)));
        }

        @JavascriptInterface
        public void icyTitle(String id, String url) {
            ifFromSite(id, () -> NowPlaying.icyTitle(url, result -> deliver(id, result)));
        }

        @JavascriptInterface
        public void scrapeGlz(String id, String url) {
            ifFromSite(id, () -> NowPlaying.scrapeGlz(getContext(), url, result -> deliver(id, result)));
        }
    }

    private static final String SITE_ORIGIN = "https://shay-radio-il.netlify.app";

    /** Only serve requests while the radio site itself is the loaded page. */
    private void ifFromSite(String id, Runnable action) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            String pageUrl = getBridge().getWebView().getUrl();
            if (pageUrl != null && (pageUrl.equals(SITE_ORIGIN) || pageUrl.startsWith(SITE_ORIGIN + "/"))) {
                action.run();
            } else {
                deliver(id, null);
            }
        });
    }

    /** Send a helper's result back to the page (window.__shayNP resolves the promise). */
    private void deliver(String id, Object result) {
        String json;
        if (result == null) json = "null";
        else if (result instanceof JSONObject) json = result.toString();
        else json = JSONObject.quote(String.valueOf(result));
        String js = "window.__shayNP && window.__shayNP(" + JSONObject.quote(id) + "," + json + ")";
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
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

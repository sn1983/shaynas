package il.shayradio.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Now-playing helpers for the site, the Android twin of
 * electron/electron-nowplaying-main.js (exposed to the page as window.electronAPI).
 * The app does these requests natively, so browser CORS limits don't apply.
 *
 *   fetchRaw(url)   -> { ok, status, text }
 *   icyTitle(url)   -> String or null   (ICY StreamTitle of an Icecast/SHOUTcast stream)
 *   scrapeGlz(url)  -> String or null   (glz.co.il value, read after the page's own JS ran)
 */
final class NowPlaying {

    interface Callback {
        void done(Object result); // JSONObject, String or null
    }

    private static final String USER_AGENT = "Mozilla/5.0 (RadioApp)";
    private static final int MAX_TEXT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ICY_BYTES = 600 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final List<String> GLZ_HOSTS = Arrays.asList("glz.co.il", "www.glz.co.il");

    private static final ExecutorService pool = Executors.newFixedThreadPool(3);
    private static final Handler main = new Handler(Looper.getMainLooper());

    private NowPlaying() {}

    private static boolean isHttpUrl(String url) {
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private static HttpURLConnection open(String url, int timeoutMs) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", USER_AGENT);
        return conn;
    }

    // ---- Generic raw GET: { ok, status, text }, follows redirects ----
    static void fetchRaw(String url, Callback cb) {
        pool.execute(() -> {
            JSONObject result = new JSONObject();
            try {
                String current = url;
                for (int hop = 0; ; hop++) {
                    if (!isHttpUrl(current)) throw new Exception("Only http(s) URLs are allowed");
                    HttpURLConnection conn = open(current, 10000);
                    int status = conn.getResponseCode();
                    String location = conn.getHeaderField("Location");
                    if (status >= 300 && status < 400 && location != null && hop < MAX_REDIRECTS) {
                        conn.disconnect();
                        current = new URL(new URL(current), location).toString();
                        continue;
                    }
                    InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    String text = in != null ? readText(in) : "";
                    conn.disconnect();
                    result.put("ok", status >= 200 && status < 300);
                    result.put("status", status);
                    result.put("text", text);
                    break;
                }
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("status", 0);
                    result.put("text", "");
                    result.put("error", String.valueOf(e.getMessage()));
                } catch (Exception ignored) {
                    // JSONObject.put with plain values does not fail
                }
            }
            cb.done(result);
        });
    }

    private static String readText(InputStream in) throws Exception {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > MAX_TEXT_BYTES) throw new Exception("response too large");
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    // ---- ICY StreamTitle reader ----
    private static final Pattern STREAM_TITLE = Pattern.compile("StreamTitle='([^']*)'");

    static void icyTitle(String url, Callback cb) {
        pool.execute(() -> {
            String title = null;
            HttpURLConnection conn = null;
            try {
                if (!isHttpUrl(url)) throw new Exception("bad url");
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Icy-MetaData", "1");
                int metaInt = 0;
                try {
                    metaInt = Integer.parseInt(conn.getHeaderField("icy-metaint").trim());
                } catch (Exception ignored) {
                    // no ICY metadata on this stream
                }
                if (metaInt > 0 && metaInt < MAX_ICY_BYTES) {
                    InputStream in = conn.getInputStream();
                    readFully(in, metaInt); // skip the audio before the first metadata block
                    int lenByte = in.read();
                    int metaLen = lenByte > 0 ? lenByte * 16 : 0;
                    if (metaLen > 0) {
                        byte[] meta = readFully(in, metaLen);
                        String metaStr = new String(meta, StandardCharsets.UTF_8).replaceAll("\u0000+$", "");
                        Matcher m = STREAM_TITLE.matcher(metaStr);
                        if (m.find() && !m.group(1).isEmpty()) title = m.group(1);
                    }
                }
            } catch (Exception ignored) {
                title = null;
            } finally {
                if (conn != null) conn.disconnect();
            }
            cb.done(title);
        });
    }

    private static byte[] readFully(InputStream in, int length) throws Exception {
        byte[] buf = new byte[length];
        int off = 0;
        while (off < length) {
            int n = in.read(buf, off, length - off);
            if (n < 0) throw new Exception("stream ended");
            off += n;
        }
        return buf;
    }

    // ---- glz.co.il: hidden WebView that runs the page's own JS ----
    private static final String GLZ_SCRIPT =
        "(function(){var el=document.querySelector('[data-live-fallback]');"
            + "var v=el?el.getAttribute('data-live-fallback'):null;return v&&v.trim()?v:null;})()";

    @SuppressLint("SetJavaScriptEnabled")
    static void scrapeGlz(Context context, String url, Callback cb) {
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
            || !GLZ_HOSTS.contains(uri.getHost().toLowerCase())) {
            cb.done(null);
            return;
        }
        main.post(() -> {
            WebView web;
            try {
                web = new WebView(context);
            } catch (Exception e) {
                cb.done(null);
                return;
            }
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setMediaPlaybackRequiresUserGesture(true); // never play audio
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String host = request.getUrl().getHost();
                    return host == null || !GLZ_HOSTS.contains(host.toLowerCase()); // stay on glz.co.il
                }
            });
            web.loadUrl(url);

            // The page fills the value in after load; check every 500 ms for up to ~10 s.
            final int[] attempts = { 0 };
            final boolean[] finished = { false };
            Runnable[] poll = new Runnable[1];
            poll[0] = () -> {
                if (finished[0]) return;
                web.evaluateJavascript(GLZ_SCRIPT, value -> {
                    if (finished[0]) return;
                    String result = null;
                    try {
                        Object v = new JSONArray("[" + value + "]").get(0);
                        if (v instanceof String && !((String) v).trim().isEmpty()) result = (String) v;
                    } catch (Exception ignored) {
                        // not ready yet
                    }
                    if (result != null || ++attempts[0] >= 20) {
                        finished[0] = true;
                        web.stopLoading();
                        web.destroy();
                        cb.done(result);
                    } else {
                        main.postDelayed(poll[0], 500);
                    }
                });
            };
            main.postDelayed(poll[0], 1000);
        });
    }
}

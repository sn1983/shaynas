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
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
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
 *   scrapeGlz(url)  -> String or null   (glz.co.il current song, or the program during talk)
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
    private static final Pattern JUNK_TITLE = Pattern.compile("(?i)powered by|^cdn\\b|^[\\s\\-–]*$");

    private static final Charset WINDOWS_1255 = Charset.forName("windows-1255");
    private static final Pattern LATIN1_ONLY = Pattern.compile("^[\\u0000-\\u00ff]*$");
    private static final Pattern MANGLED_HEBREW = Pattern.compile("[\\u00e0-\\u00fa]{2,}");

    /**
     * Hebrew titles often arrive in the old Windows-1255 encoding, either as raw
     * bytes (not valid UTF-8) or already mangled into Latin-1 letters ("ùéø" for
     * "שיר"). Turn both back into proper Hebrew.
     */
    private static String decodeTitleBytes(byte[] bytes) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, WINDOWS_1255);
        }
        if (LATIN1_ONLY.matcher(text).matches() && MANGLED_HEBREW.matcher(text).find()) {
            return new String(text.getBytes(StandardCharsets.ISO_8859_1), WINDOWS_1255);
        }
        return text;
    }

    /** Titles some stream providers send instead of the song (e.g. "CDN - Powered By ..."). */
    private static boolean isJunkTitle(String title) {
        return JUNK_TITLE.matcher(title).find();
    }

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
                    // Metadata blocks repeat every metaInt audio bytes; the first ones may
                    // be empty, so keep scanning until a real title shows up.
                    InputStream in = conn.getInputStream();
                    int read = 0;
                    while (title == null && read < MAX_ICY_BYTES) {
                        readFully(in, metaInt); // audio before the next metadata block
                        int lenByte = in.read();
                        if (lenByte < 0) break;
                        int metaLen = lenByte * 16;
                        read += metaInt + 1 + metaLen;
                        if (metaLen == 0) continue;
                        String metaStr = decodeTitleBytes(readFully(in, metaLen)).replaceAll("\u0000+$", "");
                        Matcher m = STREAM_TITLE.matcher(metaStr);
                        if (m.find()) {
                            String t = m.group(1).trim();
                            if (!t.isEmpty() && !isJunkTitle(t)) title = t;
                        }
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

    // ---- On-demand audio pages: the audio URL a program's web page plays ----
    // Loads the page in a hidden WebView (no sound), lets its own player set up and
    // returns the first real audio URL: <audio>/<source>, common data-* attributes,
    // or an audio file the page requested. Checks every 500 ms for up to ~10 s.
    private static final String PAGE_AUDIO_SCRIPT = "(function () { var AUDIO = /\\.(mp3|m4a|aac|m3u8|ogg|wav|opus)(\\?|$)/i; var LIVE = /icecast|livestream|live-redirect|\\/live(hls)?\\/|\\.livx|streamtheworld|glzwizzlv|\\/live[_-]|_(mp3|aac)$|\\/stream\\/[^\\/.]*\\/?$/i; var isHttp = function (u) { return typeof u === 'string' && /^https?:\\/\\//i.test(u); }; var picked = window.__shayPicked || []; if (picked.length) return { url: picked[0], exact: true }; var found = []; var add = function (u, fromPlayer) { try { if (!u) return; var h = new URL(u, location.href).href; if (!isHttp(h) || LIVE.test(h) || (!fromPlayer && !AUDIO.test(h))) return; if (found.indexOf(h) < 0) found.push(h); } catch (e) {} }; document.querySelectorAll('audio, video').forEach(function (a) { add(a.currentSrc || a.src, true); }); document.querySelectorAll('audio source, video source').forEach(function (s) { add(s.src, true); }); document.querySelectorAll('*').forEach(function (el) { for (var i = 0; i < el.attributes.length; i++) { var at = el.attributes[i]; if (at.name.indexOf('data-') === 0 && AUDIO.test(at.value)) add(at.value, false); } }); performance.getEntriesByType('resource').forEach(function (e) { add(e.name, false); }); if (!found.length) return null; var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, ''); }; var hints = []; var q = new URLSearchParams(location.search); q.forEach(function (v) { if (norm(v).length >= 4) hints.push(norm(v)); }); var seg = location.pathname.split('/').filter(Boolean).pop(); if (seg && norm(decodeURIComponent(seg)).length >= 4) hints.push(norm(decodeURIComponent(seg))); var match = null; for (var h = 0; h < hints.length && !match; h++) { for (var j = 0; j < found.length; j++) { var file = decodeURIComponent(found[j].split('?')[0].split('/').pop()); var path = decodeURIComponent(found[j].split('?')[0]); if (norm(file).indexOf(hints[h]) >= 0 || norm(path).indexOf(hints[h]) >= 0) { match = found[j]; break; } } } return { url: match || found[0], exact: !!match || !hints.length }; })()";
    // Some pages load the audio only after pressing play: press it once, with the
    // page's player intercepted so it only reports the file and never plays.
    private static final String CLICK_PLAY_SCRIPT = "(function () { if (window.__shayHooked) return 0; window.__shayHooked = true; window.__shayPicked = []; var LIVE = /icecast|livestream|live-redirect|\\/live(hls)?\\/|\\.livx|streamtheworld|glzwizzlv|\\/live[_-]|_(mp3|aac)$|\\/stream\\/[^\\/.]*\\/?$/i; var live = [].map.call(document.querySelectorAll('[data-live-url]'), function (e) { try { return new URL(e.getAttribute('data-live-url'), location.href).href; } catch (x) { return ''; } }); var rec = function (u) { try { var h = new URL(u, location.href).href; if (/^https?:/i.test(h) && !LIVE.test(h) && live.indexOf(h) < 0 && window.__shayPicked.indexOf(h) < 0) window.__shayPicked.push(h); } catch (e) {} }; var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src'); Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get: function () { return d.get.call(this); }, set: function (v) { rec(v); } }); var setAttr = Element.prototype.setAttribute; Element.prototype.setAttribute = function (n, v) { if (this instanceof HTMLMediaElement && String(n).toLowerCase() === 'src') { rec(v); return; } return setAttr.apply(this, arguments); }; HTMLMediaElement.prototype.play = function () { if (this.currentSrc) rec(this.currentSrc); return Promise.resolve(); }; var RealAudio = window.Audio; window.Audio = function (u) { var a = new RealAudio(); if (u) rec(u); return a; }; var n = 0; [].slice.call(document.querySelectorAll('button, a, [role=button]')).forEach(function (e) { if (n >= 6) return; var label = (e.getAttribute('class') || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '').slice(0, 30); if (!/play|\u05d4\u05d0\u05d6\u05e0\u05d4|\u05e0\u05d2\u05df|listen/i.test(label) || /youtube/i.test(e.outerHTML.slice(0, 300))) return; var href = e.tagName === 'A' ? (e.getAttribute('href') || '') : ''; if (href && !/^(#|javascript:)/i.test(href)) return; n++; try { e.click(); } catch (x) {} }); return n; })()";

    @SuppressLint("SetJavaScriptEnabled")
    static void scrapePageAudio(Context context, String url, Callback cb) {
        if (!isHttpUrl(url)) {
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
            web.getSettings().setMediaPlaybackRequiresUserGesture(true); // never play sound
            final boolean[] loaded = { false };
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return loaded[0]; // stay on this page once it has loaded
                }

                @Override
                public void onPageFinished(WebView view, String u) {
                    loaded[0] = true;
                }
            });
            web.loadUrl(url);

            final int[] attempts = { 0 };
            final boolean[] finished = { false };
            final String[] best = { null };
            Runnable[] poll = new Runnable[1];
            poll[0] = () -> {
                if (finished[0]) return;
                if (attempts[0] == 4) web.evaluateJavascript(CLICK_PLAY_SCRIPT, null);
                web.evaluateJavascript(PAGE_AUDIO_SCRIPT, value -> {
                    if (finished[0]) return;
                    boolean exact = false;
                    try {
                        JSONObject r = new JSONObject(value); // {url, exact} or "null"
                        String u = r.optString("url", null);
                        if (u != null && isHttpUrl(u)) {
                            best[0] = u;
                            exact = r.optBoolean("exact", false);
                        }
                    } catch (Exception ignored) {
                        // nothing yet
                    }
                    // A page can list many episodes: wait for the one its address names,
                    // otherwise settle for the first audio file found.
                    if (exact || ++attempts[0] >= 20) {
                        finished[0] = true;
                        web.stopLoading();
                        web.destroy();
                        cb.done(best[0]);
                    } else {
                        main.postDelayed(poll[0], 500);
                    }
                });
            };
            main.postDelayed(poll[0], 1000);
        });
    }

    // ---- glz.co.il: hidden WebView that runs the page's own JS ----
    // In .playLiveText the page shows the program (.title) and the current song
    // (.talent = "artist - title"), filled in by the page's own JS.
    private static final String GLZ_SCRIPT =
        "(function(){var box=document.querySelector('.playLiveText')||document;"
            + "function read(s){var el=box.querySelector(s);if(!el)return '';"
            + "return (el.textContent||'').trim()||(el.getAttribute('data-live-fallback')||'').trim();}"
            + "return JSON.stringify({song:read('.talent'),program:read('.title')});})()";

    private static String emptyToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

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
            final String[] lastProgram = { null };
            Runnable[] poll = new Runnable[1];
            poll[0] = () -> {
                if (finished[0]) return;
                web.evaluateJavascript(GLZ_SCRIPT, value -> {
                    if (finished[0]) return;
                    String song = null;
                    try {
                        // value is a JSON string literal holding our JSON object
                        JSONObject found = new JSONObject(new JSONArray("[" + value + "]").getString(0));
                        song = emptyToNull(found.optString("song"));
                        String program = emptyToNull(found.optString("program"));
                        if (program != null) lastProgram[0] = program;
                    } catch (Exception ignored) {
                        // page not ready yet
                    }
                    // Prefer the song; during talk segments fall back to the program name.
                    if (song != null || ++attempts[0] >= 20) {
                        finished[0] = true;
                        web.stopLoading();
                        web.destroy();
                        cb.done(song != null ? song : lastProgram[0]);
                    } else {
                        main.postDelayed(poll[0], 500);
                    }
                });
            };
            main.postDelayed(poll[0], 1000);
        });
    }
}

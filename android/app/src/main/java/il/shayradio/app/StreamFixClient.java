package il.shayradio.app;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Some stations (e.g. ECO99FM) stream over plain http:// or with headers that
 * Android's in-app browser refuses to play. For those, the app downloads the
 * stream itself and hands it to the player with standard headers, so the
 * browser never makes the blocked request.
 */
public class StreamFixClient extends BridgeWebViewClient {

    /** Stations known to need this, in addition to any http:// audio. */
    private static final String[] FIX_HOSTS = { "eco01.mediacast.co.il" };

    public StreamFixClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (needsFix(request)) {
            WebResourceResponse fixed = fetchStream(request);
            if (fixed != null) return fixed;
        }
        return super.shouldInterceptRequest(view, request);
    }

    private static boolean needsFix(WebResourceRequest request) {
        if (request.isForMainFrame() || !"GET".equalsIgnoreCase(request.getMethod())) return false;
        Uri url = request.getUrl();
        String host = url.getHost() != null ? url.getHost().toLowerCase(Locale.ROOT) : "";
        for (String h : FIX_HOSTS) {
            if (host.equals(h)) return true;
        }
        // Plain-http media (not the site itself, which is https).
        return "http".equalsIgnoreCase(url.getScheme()) && looksLikeMedia(request);
    }

    private static boolean looksLikeMedia(WebResourceRequest request) {
        Map<String, String> headers = request.getRequestHeaders();
        String accept = headers != null ? headers.get("Accept") : null;
        String range = headers != null ? headers.get("Range") : null;
        String path = request.getUrl().getPath() != null ? request.getUrl().getPath().toLowerCase(Locale.ROOT) : "";
        return range != null
            || (accept != null && (accept.contains("audio") || accept.contains("video")))
            || path.endsWith(".mp3") || path.endsWith(".aac") || path.endsWith(".audio")
            || path.contains("stream") || path.contains("live");
    }

    private static WebResourceResponse fetchStream(WebResourceRequest request) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) ShayRadio");
            conn.setRequestProperty("Icy-MetaData", "0");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                conn.disconnect();
                return null;
            }
            String type = conn.getContentType();
            String mime = type != null ? type.split(";")[0].trim().toLowerCase(Locale.ROOT) : "audio/mpeg";
            // "audio/aacp" (HE-AAC) is the same format as audio/aac; use the standard name.
            if (mime.equals("audio/aacp") || mime.equals("audio/x-aac")) mime = "audio/aac";
            InputStream body = conn.getInputStream();

            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, null, 200, "OK", headers, body);
        } catch (Exception e) {
            return null; // let the WebView try normally
        }
    }
}

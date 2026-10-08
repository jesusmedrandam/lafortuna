package com.jdmedranda.sgb;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Auth cookies stay in Android's cookie store; JavaScript never receives them. */
final class NativeAuthentication {
    private static final String API = "https://appsgb.onrender.com";
    private static final ExecutorService REQUESTS = Executors.newSingleThreadExecutor();

    static void request(MainActivity activity, String id, String path, String body) {
        if (id == null || !id.matches("[a-zA-Z0-9-]{1,80}")) return;
        if (!("/auth/login".equals(path) || "/auth/refresh".equals(path) || "/auth/logout".equals(path))
                || body != null && body.length() > 16384) return;
        REQUESTS.execute(() -> {
            JSONObject result = new JSONObject();
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(API + path).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(25000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "SGBAndroid/" + BuildConfig.VERSION_NAME);
                String cookie = CookieManager.getInstance().getCookie(API + "/auth/");
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                if (body != null && !body.isEmpty()) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    connection.setRequestProperty("Content-Type", "application/json");
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                }
                int status = connection.getResponseCode();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if ("set-cookie".equalsIgnoreCase(header.getKey())) {
                        for (String value : header.getValue()) CookieManager.getInstance().setCookie(API + path, value);
                    }
                }
                CookieManager.getInstance().flush();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                if (stream != null) try (InputStream input = stream) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (bytes.size() + count > 1048576) throw new java.io.IOException("Response too large");
                        bytes.write(buffer, 0, count);
                    }
                }
                result.put("status", status).put("body", bytes.toString("UTF-8"));
            } catch (Exception ignored) {
                try { result.put("status", 0).put("body", ""); } catch (Exception invalid) { }
            } finally { if (connection != null) connection.disconnect(); }
            try { result.put("id", id); } catch (Exception ignored) { }
            activity.deliverAuthentication(result.toString());
        });
    }
}

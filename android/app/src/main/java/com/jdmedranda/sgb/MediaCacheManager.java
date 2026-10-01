package com.jdmedranda.sgb;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Private, user-scoped cache for images and videos used by the bundled web UI.
 *
 * The original URL remains the identity of an item even when the bytes are
 * downloaded from an optimized Cloudinary URL. WebView requests are resolved
 * from this cache before Android attempts a network request.
 */
final class MediaCacheManager {
    private static final String SIGNED_OUT_SCOPE = "signed-out";
    private static final long MAX_SINGLE_FILE_BYTES = 1024L * 1024L * 1024L;

    private final Context context;
    private final File rootDirectory;
    private final SharedPreferences index;
    private final ConnectivityManager connectivityManager;
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final AtomicInteger pending = new AtomicInteger();
    private final AtomicInteger failed = new AtomicInteger();
    private final AtomicInteger generation = new AtomicInteger();

    private volatile String activeScope = SIGNED_OUT_SCOPE;
    private volatile boolean automaticDownloads;

    MediaCacheManager(Context context) {
        this.context = context.getApplicationContext();
        rootDirectory = new File(this.context.getFilesDir(), "offline_media_v2");
        if (!rootDirectory.exists()) rootDirectory.mkdirs();
        index = this.context.getSharedPreferences("sgb_media_cache_v2", Context.MODE_PRIVATE);
        connectivityManager = (ConnectivityManager) this.context.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    void setUserScope(String userId) {
        String normalized = userId == null ? "" : userId.trim();
        activeScope = normalized.isEmpty() ? SIGNED_OUT_SCOPE : digest("user:" + normalized);
        automaticDownloads = index.getBoolean(automaticKey(activeScope), false);
        directory(activeScope);
    }

    void setAutomaticDownloads(boolean enabled) {
        automaticDownloads = enabled;
        index.edit().putBoolean(automaticKey(activeScope), enabled).apply();
    }

    void downloadJson(String requestsJson) {
        final String scope = activeScope;
        try {
            JSONArray values = new JSONArray(requestsJson);
            failed.set(0);
            for (int index = 0; index < values.length(); index++) {
                MediaRequest request = parseRequest(values.opt(index));
                if (request == null) continue;
                enqueue(request, scope);
            }
        } catch (Exception ignored) {
            // The web UI reports the current pending/failed counters.
        }
    }

    private void enqueue(MediaRequest request, String scope) {
        String taskKey = scope + ':' + digest(request.source);
        CacheReference cached = cachedReference(request.source, scope);
        if (cached != null) {
            rememberAliases(scope, cached.metadata, request.aliases);
            return;
        }
        if (!inFlight.add(taskKey)) return;
        int expectedGeneration = generation.get();
        pending.incrementAndGet();
        executor.execute(() -> {
            try {
                if (!download(request, scope, expectedGeneration)) failed.incrementAndGet();
            } finally {
                inFlight.remove(taskKey);
                pending.decrementAndGet();
            }
        });
    }

    private boolean download(MediaRequest request, String scope, int expectedGeneration) {
        for (int attempt = 0; attempt < 3; attempt++) {
            if (generation.get() != expectedGeneration) return false;
            if (downloadOnce(request, scope, expectedGeneration)) return true;
            try {
                Thread.sleep(400L * (attempt + 1));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private boolean downloadOnce(MediaRequest request, String scope, int expectedGeneration) {
        CacheReference cached = cachedReference(request.source, scope);
        if (cached != null) {
            rememberAliases(scope, cached.metadata, request.aliases);
            return true;
        }
        HttpURLConnection connection = null;
        File directory = directory(scope);
        String deliveryKey = digest(request.deliveryUrl);
        File temporary = new File(directory, deliveryKey + '-' + UUID.randomUUID() + ".part");
        try {
            connection = (HttpURLConnection) new URL(request.deliveryUrl.replace(" ", "%20")).openConnection();
            connection.setConnectTimeout(45_000);
            connection.setReadTimeout(3 * 60_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "SGB-Android/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept", "image/*,video/*,*/*;q=0.5");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return false;
            long declaredBytes = connection.getContentLengthLong();
            if (declaredBytes > MAX_SINGLE_FILE_BYTES) return false;
            String mime = normalizedMime(connection.getContentType());
            File target = new File(directory, deliveryKey + extensionFor(mime, request.deliveryUrl));
            long written = 0;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    written += read;
                    if (written > MAX_SINGLE_FILE_BYTES) throw new IOException("Archivo demasiado grande");
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            if (written == 0 || declaredBytes > 0 && written != declaredBytes
                    || generation.get() != expectedGeneration) {
                temporary.delete();
                return false;
            }
            if (target.exists() && !target.delete()) return false;
            if (!temporary.renameTo(target)) return false;
            String metadata = target.getName() + "\n" + mime;
            remember(scope, request.source, metadata);
            remember(scope, request.deliveryUrl, metadata);
            rememberAliases(scope, metadata, request.aliases);
            return true;
        } catch (Exception ignored) {
            temporary.delete();
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    WebResourceResponse responseOrDownload(String source, String rangeHeader) {
        String scope = activeScope;
        WebResourceResponse existing = responseFor(source, rangeHeader, scope);
        if (existing != null) return existing;
        if (!automaticDownloads || !isMediaUrl(source) || !hasValidatedNetwork()) return null;
        MediaRequest request = new MediaRequest(source, source, Collections.emptyList());
        enqueue(request, scope);
        return null;
    }

    private WebResourceResponse responseFor(String source, String rangeHeader, String scope) {
        CacheReference cached = cachedReference(source, scope);
        if (cached == null) return null;
        try {
            long total = cached.file.length();
            long start = 0;
            long end = total - 1;
            boolean partial = rangeHeader != null && rangeHeader.startsWith("bytes=");
            if (partial) {
                String range = rangeHeader.substring("bytes=".length()).split(",", 2)[0];
                String[] bounds = range.split("-", 2);
                if (bounds[0].trim().isEmpty()) {
                    long suffix = Long.parseLong(bounds[1]);
                    if (suffix <= 0) return rangeNotSatisfiable(total);
                    start = Math.max(0, total - suffix);
                } else {
                    start = Long.parseLong(bounds[0]);
                    if (bounds.length > 1 && !bounds[1].trim().isEmpty()) end = Long.parseLong(bounds[1]);
                }
                if (start < 0 || start >= total || end < start) return rangeNotSatisfiable(total);
                end = Math.min(end, total - 1);
            }
            long length = end - start + 1;
            FileInputStream input = new FileInputStream(cached.file);
            skipFully(input, start);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(length));
            headers.put("Cache-Control", "private, max-age=31536000, immutable");
            if (partial) headers.put("Content-Range", "bytes " + start + '-' + end + '/' + total);
            return new WebResourceResponse(cached.mime, null, partial ? 206 : 200,
                    partial ? "Partial Content" : "OK", headers, new LimitedInputStream(input, length));
        } catch (Exception ignored) {
            return null;
        }
    }

    private WebResourceResponse rangeNotSatisfiable(long total) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Range", "bytes */" + total);
        return new WebResourceResponse("application/octet-stream", null, 416,
                "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
    }

    String information() {
        String scope = activeScope;
        Set<String> filenames = new HashSet<>();
        long bytes = 0;
        for (Map.Entry<String, ?> item : index.getAll().entrySet()) {
            if (!item.getKey().startsWith(entryPrefix(scope)) || !(item.getValue() instanceof String)) continue;
            filenames.add(filePart((String) item.getValue()));
        }
        File directory = directory(scope);
        int count = 0;
        for (String filename : filenames) {
            File file = new File(directory, filename);
            if (file.isFile()) {
                count++;
                bytes += file.length();
            }
        }
        try {
            return new JSONObject().put("count", count).put("bytes", bytes)
                    .put("pending", pending.get()).put("failed", failed.get())
                    .put("automatic", automaticDownloads).toString();
        } catch (Exception ignored) {
            return "{\"count\":0,\"bytes\":0,\"pending\":0,\"failed\":0}";
        }
    }

    void clear() {
        generation.incrementAndGet();
        String scope = activeScope;
        File[] files = directory(scope).listFiles();
        if (files != null) for (File file : files) file.delete();
        SharedPreferences.Editor editor = index.edit();
        for (String key : index.getAll().keySet()) {
            if (key.startsWith(entryPrefix(scope))) editor.remove(key);
        }
        editor.apply();
    }

    void shutdown() {
        executor.shutdownNow();
    }

    String userScope() { return activeScope; }

    void exportTo(Uri destination, String source, String delivery, String scope, Consumer<Boolean> completed) {
        executor.execute(() -> {
            boolean success = false;
            try {
                CacheReference cached = cachedReference(source, scope);
                if (cached == null && hasValidatedNetwork()) {
                    download(new MediaRequest(source, delivery, Collections.emptyList()), scope, generation.get());
                    cached = cachedReference(source, scope);
                }
                if (cached != null) {
                    try (InputStream input = new FileInputStream(cached.file);
                         OutputStream output = context.getContentResolver().openOutputStream(destination)) {
                        if (output == null) throw new IOException("No se pudo abrir el destino");
                        byte[] buffer = new byte[32 * 1024];
                        int read;
                        while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                        success = true;
                    }
                }
            } catch (Exception ignored) { }
            completed.accept(success);
        });
    }

    private CacheReference cachedReference(String source, String scope) {
        if (source == null || source.trim().isEmpty()) return null;
        String metadata = index.getString(entryKey(scope, source), null);
        if (metadata == null) return null;
        File file = new File(directory(scope), filePart(metadata));
        if (!file.isFile()) {
            index.edit().remove(entryKey(scope, source)).apply();
            return null;
        }
        return new CacheReference(file, mimePart(metadata), metadata);
    }

    private void remember(String scope, String source, String metadata) {
        if (source == null || source.trim().isEmpty()) return;
        index.edit().putString(entryKey(scope, source), metadata).apply();
    }

    private void rememberAliases(String scope, String metadata, List<String> aliases) {
        if (aliases.isEmpty()) return;
        SharedPreferences.Editor editor = index.edit();
        for (String alias : aliases) {
            if (alias != null && !alias.trim().isEmpty()) editor.putString(entryKey(scope, alias), metadata);
        }
        editor.apply();
    }

    private File directory(String scope) {
        File directory = new File(rootDirectory, scope);
        if (!directory.exists()) directory.mkdirs();
        return directory;
    }

    private boolean hasValidatedNetwork() {
        try {
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(
                    connectivityManager.getActiveNetwork());
            return capabilities != null
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static MediaRequest parseRequest(Object raw) {
        if (raw instanceof String) {
            String source = ((String) raw).trim();
            return isHttp(source) ? new MediaRequest(source, source, Collections.emptyList()) : null;
        }
        if (!(raw instanceof JSONObject)) return null;
        JSONObject object = (JSONObject) raw;
        String delivery = object.optString("url", "").trim();
        String source = object.optString("source", delivery).trim();
        if (!isHttp(source) || !isHttp(delivery)) return null;
        List<String> aliases = new ArrayList<>();
        JSONArray values = object.optJSONArray("aliases");
        if (values != null) for (int index = 0; index < values.length(); index++) {
            String alias = values.optString(index, "").trim();
            if (isHttp(alias)) aliases.add(alias);
        }
        return new MediaRequest(source, delivery, aliases);
    }

    private static boolean isMediaUrl(String source) {
        if (!isHttp(source)) return false;
        String value = source.toLowerCase(Locale.ROOT);
        return value.contains("/image/upload/") || value.contains("/video/upload/")
                || value.matches(".*\\.(jpg|jpeg|png|webp|gif|avif|heic|mp4|m4v|mov|webm)([?#].*)?$");
    }

    private static boolean isHttp(String value) {
        return value != null && (value.startsWith("https://") || value.startsWith("http://"));
    }

    private static String normalizedMime(String value) {
        if (value == null || value.trim().isEmpty()) return "application/octet-stream";
        return value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    }

    private static String extensionFor(String mime, String url) {
        if (mime.contains("jpeg")) return ".jpg";
        if (mime.contains("png")) return ".png";
        if (mime.contains("webp")) return ".webp";
        if (mime.contains("gif")) return ".gif";
        if (mime.contains("avif")) return ".avif";
        if (mime.contains("heic")) return ".heic";
        if (mime.contains("mp4")) return ".mp4";
        if (mime.contains("quicktime")) return ".mov";
        if (mime.contains("webm")) return ".webm";
        String lower = url.toLowerCase(Locale.ROOT);
        for (String extension : new String[]{".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif",
                ".heic", ".mp4", ".m4v", ".mov", ".webm"}) {
            if (lower.matches(".*\\" + extension + "([?#].*)?$")) return extension;
        }
        return ".bin";
    }

    private static String entryPrefix(String scope) { return "entry:" + scope + ':'; }
    private static String entryKey(String scope, String source) { return entryPrefix(scope) + digest(source); }
    private static String automaticKey(String scope) { return "automatic:" + scope; }

    private static String filePart(String metadata) {
        int separator = metadata.indexOf('\n');
        return separator < 0 ? metadata : metadata.substring(0, separator);
    }

    private static String mimePart(String metadata) {
        int separator = metadata.indexOf('\n');
        return separator < 0 ? "application/octet-stream" : metadata.substring(separator + 1);
    }

    private static void skipFully(InputStream input, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = input.skip(remaining);
            if (skipped > 0) remaining -= skipped;
            else if (input.read() < 0) throw new IOException("Fin de archivo inesperado");
            else remaining--;
        }
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (Exception ignored) {
            return Integer.toHexString(value.hashCode());
        }
    }

    private static final class MediaRequest {
        final String source;
        final String deliveryUrl;
        final List<String> aliases;
        MediaRequest(String source, String deliveryUrl, List<String> aliases) {
            this.source = source;
            this.deliveryUrl = deliveryUrl;
            this.aliases = aliases;
        }
    }

    private static final class CacheReference {
        final File file;
        final String mime;
        final String metadata;
        CacheReference(File file, String mime, String metadata) {
            this.file = file;
            this.mime = mime;
            this.metadata = metadata;
        }
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long remaining;
        LimitedInputStream(InputStream input, long remaining) {
            super(input);
            this.remaining = remaining;
        }
        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = super.read();
            if (value >= 0) remaining--;
            return value;
        }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int read = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }
    }
}

package com.jdmedranda.sgb;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class OfflineSyncWorker extends Worker {
    private final NativeMutationStore store;

    public OfflineSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
        store = new NativeMutationStore(context);
    }

    @NonNull
    @Override
    public Result doWork() {
        NativeMutationStore.SyncConfig config = store.config();
        if (!config.ready()) return Result.success();
        JSONArray queue = store.queue();
        if (queue.length() == 0) return Result.success();

        String serverProperty = config.propertyId;
        String serverRole = config.roleId;
        try {
            for (int index = 0; index < queue.length(); index++) {
                JSONObject entry = queue.optJSONObject(index);
                if (entry == null || !"PENDING".equals(entry.optString("state", "PENDING"))) continue;
                JSONObject scope = entry.optJSONObject("scope");
                String userId = scope == null ? "" : scope.optString("userId", "");
                if (!config.userId.equals(userId)) continue;
                String propertyId = scope == null ? "" : scope.optString("propertyId", "");
                String roleId = scope == null ? "" : scope.optString("roleId", "");
                if (!propertyId.trim().isEmpty() && !roleId.trim().isEmpty()
                        && (!propertyId.equals(serverProperty) || !roleId.equals(serverRole))) {
                    HttpResult contextResult = changeContext(config, propertyId, roleId);
                    if (contextResult.status == 401 || contextResult.status == 403) return Result.success();
                    if (!contextResult.success()) return Result.retry();
                    serverProperty = propertyId;
                    serverRole = roleId;
                }

                Map<String, String> replacements = store.replacements();
                String path = replace(entry.optString("path"), replacements);
                String bodyType = entry.optString("bodyType", "none");
                String body = null;
                if ("json".equals(bodyType) && entry.has("jsonBody") && !entry.isNull("jsonBody")) {
                    body = replace(entry.get("jsonBody").toString(), replacements);
                }
                HttpResult response = request(config, entry.optString("method", "POST"), path, body,
                        entry.optString("idempotencyKey", ""));
                if (response.success()) {
                    String temporaryId = entry.optString("temporaryId", "");
                    String actualId = responseDataId(response.body);
                    if (!temporaryId.trim().isEmpty() && !actualId.trim().isEmpty())
                        store.saveReplacement(temporaryId, actualId);
                    store.remove(entry.optString("id"));
                    continue;
                }
                String code = responseErrorCode(response.body);
                if (response.status == 409 && "IDEMPOTENCY_IN_PROGRESS".equals(code)) return Result.retry();
                if (response.status == 401) return Result.success();
                if (response.status == 0 || response.status >= 500) return Result.retry();
                // A deterministic validation/permission/conflict error is left in IndexedDB for review.
                store.remove(entry.optString("id"));
            }
        } catch (IOException error) {
            return Result.retry();
        } catch (Exception error) {
            return Result.failure();
        } finally {
            if (!config.propertyId.trim().isEmpty() && !config.roleId.trim().isEmpty()
                    && (!config.propertyId.equals(serverProperty) || !config.roleId.equals(serverRole))) {
                try { changeContext(config, config.propertyId, config.roleId); }
                catch (IOException ignored) { }
            }
        }
        return Result.success();
    }

    private HttpResult changeContext(NativeMutationStore.SyncConfig config, String propertyId,
                                     String roleId) throws IOException {
        JSONObject body = new JSONObject();
        try { body.put("propertyId", propertyId).put("roleId", roleId); }
        catch (Exception ignored) { }
        return request(config, "POST", "/auth/context", body.toString(), "");
    }

    private HttpResult request(NativeMutationStore.SyncConfig config, String method, String path,
                               String body, String idempotencyKey) throws IOException {
        String base = config.apiUrl.endsWith("/")
                ? config.apiUrl.substring(0, config.apiUrl.length() - 1) : config.apiUrl;
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(25_000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + config.accessToken);
        connection.setRequestProperty("User-Agent", "SGB-Android-Offline/" + BuildConfig.VERSION_NAME);
        if (!idempotencyKey.trim().isEmpty())
            connection.setRequestProperty("X-Idempotency-Key", idempotencyKey);
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String response = read(stream);
        connection.disconnect();
        return new HttpResult(status, response);
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String replace(String value, Map<String, String> replacements) {
        String result = value;
        for (Map.Entry<String, String> item : replacements.entrySet())
            result = result.replace(item.getKey(), item.getValue());
        return result;
    }

    private static String responseDataId(String body) {
        try { return new JSONObject(body).optJSONObject("data").optString("id", ""); }
        catch (Exception ignored) { return ""; }
    }

    private static String responseErrorCode(String body) {
        try { return new JSONObject(body).optJSONObject("error").optString("code", ""); }
        catch (Exception ignored) { return ""; }
    }

    private static final class HttpResult {
        final int status;
        final String body;

        HttpResult(int status, String body) { this.status = status; this.body = body; }
        boolean success() { return status >= 200 && status < 300; }
    }
}

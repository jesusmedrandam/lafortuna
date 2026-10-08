package com.jdmedranda.sgb;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

final class NativeMutationStore {
    private static final String PREFERENCES = "sgb_offline_sync";
    private static final String QUEUE = "mutation_queue";
    private static final String REPLACEMENTS = "temporary_ids";
    private static final Object LOCK = new Object();
    private final SharedPreferences preferences;

    NativeMutationStore(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    void configure(String apiUrl, String token, String userId, String propertyId, String roleId) {
        preferences.edit().putString("api_url", apiUrl).putString("access_token", token)
                .putString("user_id", userId).putString("property_id", propertyId)
                .putString("role_id", roleId).apply();
    }

    void clearSession() {
        preferences.edit().remove("api_url").remove("access_token").remove("user_id")
                .remove("property_id").remove("role_id").apply();
    }

    SyncConfig config() {
        return new SyncConfig(preferences.getString("api_url", ""),
                preferences.getString("access_token", ""), preferences.getString("user_id", ""),
                preferences.getString("property_id", ""), preferences.getString("role_id", ""));
    }

    void upsert(String mutationJson) throws JSONException {
        JSONObject mutation = new JSONObject(mutationJson);
        String id = mutation.getString("id");
        synchronized (LOCK) {
            JSONArray current = readQueue();
            JSONArray next = new JSONArray();
            boolean replaced = false;
            for (int index = 0; index < current.length(); index++) {
                JSONObject item = current.getJSONObject(index);
                if (id.equals(item.optString("id"))) {
                    if (item.optString("idempotencyKey").equals(mutation.optString("idempotencyKey"))
                            && !item.optString("nativeState").isEmpty()) return;
                    next.put(mutation);
                    replaced = true;
                } else next.put(item);
            }
            if (!replaced) next.put(mutation);
            writeQueue(next);
        }
    }

    void remove(String id) {
        synchronized (LOCK) {
            JSONArray current = readQueue();
            JSONArray next = new JSONArray();
            for (int index = 0; index < current.length(); index++) {
                JSONObject item = current.optJSONObject(index);
                if (item != null && (!id.equals(item.optString("id"))
                        || !item.optString("nativeState").isEmpty())) next.put(item);
            }
            writeQueue(next);
        }
    }

    // Retain receipts until IndexedDB confirms them, so editing cannot duplicate an upload.
    boolean reserveForEditing(String id, String key) {
        synchronized (LOCK) {
            JSONArray queue = readQueue();
            for (int index = 0; index < queue.length(); index++) {
                JSONObject item = queue.optJSONObject(index);
                if (item != null && id.equals(item.optString("id"))
                        && (!key.equals(item.optString("idempotencyKey"))
                        || !item.optString("nativeState").isEmpty())) return false;
            }
            remove(id);
            return true;
        }
    }

    JSONObject claim(String id, String key) throws JSONException {
        synchronized (LOCK) {
            JSONArray queue = readQueue();
            for (int index = 0; index < queue.length(); index++) {
                JSONObject item = queue.getJSONObject(index);
                if (!id.equals(item.optString("id")) || !key.equals(item.optString("idempotencyKey"))) continue;
                if ("SENT".equals(item.optString("nativeState"))) return null;
                item.put("nativeState", "IN_FLIGHT");
                if (!preferences.edit().putString(QUEUE, queue.toString()).commit()) return null;
                return item;
            }
            return null;
        }
    }

    void finish(String id, String key, boolean sent) {
        synchronized (LOCK) {
            JSONArray queue = readQueue();
            JSONArray next = new JSONArray();
            for (int index = 0; index < queue.length(); index++) {
                JSONObject item = queue.optJSONObject(index);
                if (item == null) continue;
                if (id.equals(item.optString("id")) && key.equals(item.optString("idempotencyKey"))) {
                    if (!sent) continue;
                    try { item.put("nativeState", "SENT"); } catch (JSONException ignored) { }
                }
                next.put(item);
            }
            writeQueue(next);
        }
    }

    JSONArray queue() {
        synchronized (LOCK) {
            try {
                JSONArray queue = new JSONArray(readQueue().toString());
                java.util.List<JSONObject> ordered = new java.util.ArrayList<>();
                for (int index = 0; index < queue.length(); index++) ordered.add(queue.getJSONObject(index));
                ordered.sort(java.util.Comparator.comparingLong(item -> item.optLong("createdAt")));
                return new JSONArray(ordered);
            }
            catch (JSONException ignored) { return new JSONArray(); }
        }
    }

    Map<String, String> replacements() {
        Map<String, String> result = new LinkedHashMap<>();
        try {
            JSONObject object = new JSONObject(preferences.getString(REPLACEMENTS, "{}"));
            JSONArray names = object.names();
            if (names != null) for (int index = 0; index < names.length(); index++) {
                String key = names.getString(index);
                result.put(key, object.getString(key));
            }
        } catch (JSONException ignored) { }
        return result;
    }

    void saveReplacement(String temporaryId, String actualId) {
        synchronized (LOCK) {
            try {
                JSONObject object = new JSONObject(preferences.getString(REPLACEMENTS, "{}"));
                object.put(temporaryId, actualId);
                preferences.edit().putString(REPLACEMENTS, object.toString()).apply();
            } catch (JSONException ignored) { }
        }
    }

    private JSONArray readQueue() {
        try { return new JSONArray(preferences.getString(QUEUE, "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    private void writeQueue(JSONArray value) {
        preferences.edit().putString(QUEUE, value.toString()).apply();
    }

    static final class SyncConfig {
        final String apiUrl;
        final String accessToken;
        final String userId;
        final String propertyId;
        final String roleId;

        SyncConfig(String apiUrl, String accessToken, String userId, String propertyId, String roleId) {
            this.apiUrl = apiUrl;
            this.accessToken = accessToken;
            this.userId = userId;
            this.propertyId = propertyId;
            this.roleId = roleId;
        }

        boolean ready() { return !apiUrl.trim().isEmpty() && !accessToken.trim().isEmpty()
                && !userId.trim().isEmpty(); }
    }
}

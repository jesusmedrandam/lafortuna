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
                if (item != null && !id.equals(item.optString("id"))) next.put(item);
            }
            writeQueue(next);
        }
    }

    JSONArray queue() {
        synchronized (LOCK) {
            try { return new JSONArray(readQueue().toString()); }
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

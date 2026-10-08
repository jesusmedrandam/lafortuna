package com.jdmedranda.sgb;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONException;

final class SgbJavascriptBridge {
    private static final String SYNC_CHANNEL = "sgb_sync";
    private static final String DOWNLOAD_CHANNEL = "sgb_downloads";
    private final MainActivity activity;
    private final NativeMutationStore mutationStore;
    private final MediaCacheManager mediaCache;

    SgbJavascriptBridge(MainActivity activity, MediaCacheManager mediaCache) {
        this.activity = activity;
        this.mediaCache = mediaCache;
        mutationStore = new NativeMutationStore(activity);
        createNotificationChannels();
    }

    @JavascriptInterface
    public String getAppVersion() { return BuildConfig.VERSION_NAME; }

    @JavascriptInterface
    public boolean isOnline() { return activity.isOnline(); }

    @JavascriptInterface
    public void requestAuthentication(String id, String path, String body) {
        NativeAuthentication.request(activity, id, path, body);
    }

    @JavascriptInterface
    public void setOfflineUserScope(String userId) { mediaCache.setUserScope(userId); }

    @JavascriptInterface
    public boolean isWifiConnected() { return activity.isWifiConnected(); }

    @JavascriptInterface
    public void retryHome() { activity.loadHome(); }

    @JavascriptInterface
    public void setAuthenticatedSession(boolean active) {
        activity.getPreferences(Context.MODE_PRIVATE).edit().putBoolean("authenticated", active).apply();
        activity.finishAppLoading();
    }

    @JavascriptInterface
    public void configureOfflineSync(String apiUrl, String accessToken, String userId,
                                     String propertyId, String roleId) {
        mediaCache.setUserScope(userId);
        mutationStore.configure(apiUrl, accessToken, userId, propertyId, roleId);
    }

    @JavascriptInterface
    public void clearOfflineSyncSession() {
        mutationStore.clearSession();
        mediaCache.setUserScope("");
    }

    @JavascriptInterface
    public void setAutomaticMediaDownloads(boolean enabled) {
        mediaCache.setAutomaticDownloads(enabled);
    }

    @JavascriptInterface
    public void downloadMedia(String requestsJson) { mediaCache.downloadJson(requestsJson); }

    @JavascriptInterface
    public String getMediaCacheInfo() { return mediaCache.information(); }

    @JavascriptInterface
    public String getMediaCacheDetails() { return mediaCache.details(); }

    @JavascriptInterface
    public void removeMediaCacheFiles(String idsJson) { mediaCache.removeFiles(idsJson); }

    @JavascriptInterface
    public void clearMediaCache() { mediaCache.clear(); }

    @JavascriptInterface
    public boolean saveOptimizedMedia(String originalUrl, String optimizedUrl, String filename, String mimeType) {
        activity.exportMedia(originalUrl, optimizedUrl, filename, mimeType);
        return true;
    }

    @JavascriptInterface
    public boolean saveMedia(String url, String filename, String mimeType) {
        return saveOptimizedMedia(url, url, filename, mimeType);
    }

    @JavascriptInterface
    public void mirrorOfflineMutation(String mutationJson) {
        try { mutationStore.upsert(mutationJson); }
        catch (JSONException ignored) { }
    }

    @JavascriptInterface
    public void removeMirroredMutation(String mutationId) { mutationStore.remove(mutationId); }

    @JavascriptInterface
    public boolean reservePendingMutation(String id, String key) { return mutationStore.reserveForEditing(id, key); }

    @JavascriptInterface
    public void confirmMirroredMutation(String id, String key) { mutationStore.finish(id, key, false); }

    @JavascriptInterface
    public void setSystemBarColors(String primary, String background) {
        activity.runOnUiThread(() -> {
            try {
                activity.getWindow().setStatusBarColor(Color.parseColor(primary));
                activity.getWindow().setNavigationBarColor(Color.parseColor(background));
            } catch (IllegalArgumentException ignored) { }
        });
    }

    @JavascriptInterface
    public void setTransientSystemBarColors(String primary, String background) {
        setSystemBarColors(primary, background);
    }

    @JavascriptInterface
    public void showLocalNotification(String channel, String title, String message, int id,
                                      boolean ongoing) {
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        String channelId = "downloads".equals(channel) ? DOWNLOAD_CHANNEL : SYNC_CHANNEL;
        NotificationCompat.Builder notification = new NotificationCompat.Builder(activity, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title).setContentText(message).setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(message)).setOnlyAlertOnce(true).setOngoing(ongoing)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        NotificationManagerCompat.from(activity).notify(id, notification.build());
    }

    @JavascriptInterface
    public void cancelLocalNotification(int id) { NotificationManagerCompat.from(activity).cancel(id); }

    private void createNotificationChannels() {
        NotificationManager manager = activity.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(SYNC_CHANNEL, "Sincronización",
                NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel(DOWNLOAD_CHANNEL, "Descargas sin conexión",
                NotificationManager.IMPORTANCE_LOW));
    }
}

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

    SgbJavascriptBridge(MainActivity activity) {
        this.activity = activity;
        mutationStore = new NativeMutationStore(activity);
        createNotificationChannels();
    }

    @JavascriptInterface
    public String getAppVersion() { return BuildConfig.VERSION_NAME; }

    @JavascriptInterface
    public boolean isOnline() { return activity.isOnline(); }

    @JavascriptInterface
    public boolean isWifiConnected() { return activity.isWifiConnected(); }

    @JavascriptInterface
    public void retryHome() { activity.loadHome(); }

    @JavascriptInterface
    public void setPendingMutations(int count) { activity.runOnUiThread(() -> activity.setPendingCount(count)); }

    @JavascriptInterface
    public void setAuthenticatedSession(boolean active) {
        activity.getPreferences(Context.MODE_PRIVATE).edit().putBoolean("authenticated", active).apply();
    }

    @JavascriptInterface
    public void configureOfflineSync(String apiUrl, String accessToken, String userId,
                                     String propertyId, String roleId) {
        mutationStore.configure(apiUrl, accessToken, userId, propertyId, roleId);
    }

    @JavascriptInterface
    public void clearOfflineSyncSession() { mutationStore.clearSession(); }

    @JavascriptInterface
    public void mirrorOfflineMutation(String mutationJson) {
        try { mutationStore.upsert(mutationJson); }
        catch (JSONException ignored) { }
    }

    @JavascriptInterface
    public void removeMirroredMutation(String mutationId) { mutationStore.remove(mutationId); }

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

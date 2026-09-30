package com.jdmedranda.sgb;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4002;
    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";
    private static final String WEB_APP_HOST = Uri.parse(BuildConfig.WEB_APP_URL).getHost();
    private WebView webView;
    private ProgressBar pageProgress;
    private TextView offlineBanner;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private ValueCallback<Uri[]> fileCallback;
    private int pendingCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        getWindow().setStatusBarColor(Color.parseColor("#0C1210"));
        getWindow().setNavigationBarColor(Color.parseColor("#0C1210"));
        webView = findViewById(R.id.web_view);
        pageProgress = findViewById(R.id.page_progress);
        offlineBanner = findViewById(R.id.offline_banner);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        configureWebView();
        registerConnectivity();
        requestNotificationPermission();
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            Uri deepLink = getIntent().getData();
            webView.loadUrl(isTrusted(deepLink == null ? "" : deepLink.toString())
                    ? deepLink.toString() : BuildConfig.WEB_APP_URL);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SGBAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setBackgroundColor(Color.parseColor("#0C1210"));
        webView.addJavascriptInterface(new SgbJavascriptBridge(this), "SGBAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                pageProgress.setProgress(progress);
                pageProgress.setVisibility(progress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent;
                try { intent = params.createIntent(); }
                catch (Exception error) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*")
                            .addCategory(Intent.CATEGORY_OPENABLE);
                }
                try { startActivityForResult(intent, FILE_CHOOSER_REQUEST); }
                catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No hay una aplicación para elegir el archivo.",
                            Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse bundled = bundledWebResponse(request);
                return bundled == null ? super.shouldInterceptRequest(view, request) : bundled;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (isTrusted(url)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !isOnline() && !OFFLINE_PAGE.equals(view.getUrl()))
                    view.loadUrl(OFFLINE_PAGE);
            }
        });
        webView.setDownloadListener(downloadListener());
    }

    private WebResourceResponse bundledWebResponse(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"GET".equalsIgnoreCase(request.getMethod()) || !"https".equalsIgnoreCase(url.getScheme())
                || WEB_APP_HOST == null || !WEB_APP_HOST.equalsIgnoreCase(url.getHost())) return null;
        String path = url.getPath();
        path = path == null ? "" : path.replaceFirst("^/+", "");
        if (path.contains("..") || path.contains("\\")) return null;
        if (path.isEmpty()) path = "index.html";
        try { return assetResponse(path); }
        catch (IOException missing) {
            if (!path.substring(path.lastIndexOf('/') + 1).contains(".")) {
                try { return assetResponse("index.html"); }
                catch (IOException ignored) { return null; }
            }
            return null;
        }
    }

    private WebResourceResponse assetResponse(String path) throws IOException {
        InputStream content = getAssets().open(path);
        String mimeType;
        if (path.endsWith(".html")) mimeType = "text/html";
        else if (path.endsWith(".js")) mimeType = "application/javascript";
        else if (path.endsWith(".css")) mimeType = "text/css";
        else if (path.endsWith(".webmanifest")) mimeType = "application/manifest+json";
        else if (path.endsWith(".svg")) mimeType = "image/svg+xml";
        else if (path.endsWith(".woff2")) mimeType = "font/woff2";
        else {
            String extension = MimeTypeMap.getFileExtensionFromUrl(path);
            mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            if (mimeType == null) mimeType = "application/octet-stream";
        }
        String encoding = mimeType.startsWith("text/") || mimeType.contains("javascript")
                || mimeType.contains("json") || mimeType.contains("manifest") ? "UTF-8" : null;
        return new WebResourceResponse(mimeType, encoding, content);
    }

    private DownloadListener downloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                        "SGB-" + System.currentTimeMillis() + (extension == null ? "" : "." + extension));
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Descarga iniciada", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "No se pudo iniciar la descarga.", Toast.LENGTH_LONG).show();
            }
        };
    }

    private boolean isTrusted(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        if (value.startsWith("file:///android_asset/")) return true;
        try {
            URI target = URI.create(value);
            URI home = URI.create(BuildConfig.WEB_APP_URL);
            return "https".equalsIgnoreCase(target.getScheme())
                    && home.getHost().equalsIgnoreCase(target.getHost());
        } catch (Exception error) { return false; }
    }

    private void openExternal(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No se puede abrir este enlace.", Toast.LENGTH_LONG).show();
        }
    }

    private void registerConnectivity() {
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { dispatchConnectivity(isOnline()); }
            @Override public void onLost(Network network) { dispatchConnectivity(isOnline()); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                dispatchConnectivity(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            }
        };
        connectivityManager.registerDefaultNetworkCallback(networkCallback);
        dispatchConnectivity(isOnline());
    }

    private void dispatchConnectivity(boolean online) {
        runOnUiThread(() -> {
            updateOfflineBanner(online);
            if (online && OFFLINE_PAGE.equals(webView.getUrl())) webView.loadUrl(BuildConfig.WEB_APP_URL);
            String script = "window.dispatchEvent(new Event('" + (online ? "online" : "offline") + "'));";
            webView.evaluateJavascript(script, null);
        });
    }

    boolean isOnline() {
        Network network = connectivityManager.getActiveNetwork();
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    boolean isWifiConnected() {
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(
                connectivityManager.getActiveNetwork());
        return capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    void setPendingCount(int count) {
        pendingCount = Math.max(0, count);
        updateOfflineBanner(isOnline());
    }

    void loadHome() { runOnUiThread(() -> webView.loadUrl(BuildConfig.WEB_APP_URL)); }

    private void updateOfflineBanner(boolean online) {
        if (!online) {
            offlineBanner.setText(pendingCount > 0 ? "Sin conexión · " + pendingCount + " cambio(s) pendiente(s)"
                    : "Sin conexión · usando datos descargados");
            offlineBanner.setVisibility(View.VISIBLE);
        } else offlineBanner.setVisibility(View.GONE);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && isTrusted(data.toString())) webView.loadUrl(data.toString());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onResume() {
        super.onResume();
        OfflineSyncScheduler.cancel(this);
        webView.onResume();
        dispatchConnectivity(isOnline());
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (pendingCount > 0) OfflineSyncScheduler.schedule(this);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (networkCallback != null) connectivityManager.unregisterNetworkCallback(networkCallback);
        webView.removeJavascriptInterface("SGBAndroid");
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}

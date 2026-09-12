/// <reference types="vite/client" />

interface Window {
  SGBAndroid?: {
    getAppVersion?: () => string;
    downloadAppUpdate?: (url: string, filename: string) => 'DOWNLOAD_STARTED' | 'INSTALL_STARTED' | 'PERMISSION_REQUIRED' | 'ERROR';
    isAppUpdateDownloaded?: (filename: string) => boolean;
    getPushToken?: () => string;
    requestPushToken?: () => void;
    isOnline?: () => boolean;
    isWifiConnected?: () => boolean;
    setPendingMutations?: (count: number) => void;
    downloadMedia?: (urlsJson: string) => void;
    saveOptimizedMedia?: (originalUrl: string, optimizedUrl: string, filename: string, mimeType: string) => boolean;
    saveMedia?: (url: string, filename: string, mimeType: string) => boolean;
    saveBase64File?: (dataUrl: string, filename: string, mimeType: string) => boolean;
    shareText?: (title: string, text: string, url: string) => boolean;
    shareOfflineBackup?: (dataJson: string, filename: string, password: string) => boolean;
    shareOfflineBackupSelected?: (dataJson: string, filename: string, password: string, mediaUrlsJson: string) => boolean;
    getPreparedOfflineBackupInfo?: () => string;
    sharePreparedOfflineBackup?: () => boolean;
    deletePreparedOfflineBackup?: () => void;
    requestOfflineBackupImport?: (password: string) => boolean;
    getPendingOfflineBackup?: () => string;
    confirmOfflineBackupImport?: () => void;
    confirmOfflineBackupImportSelected?: (mediaUrlsJson: string) => void;
    discardOfflineBackupImport?: () => void;
    setSystemBarColors?: (primary: string, background: string) => void;
    clearMediaCache?: () => void;
    getMediaCacheInfo?: () => string;
    setChartFullscreen?: (enabled: boolean) => void;
    showLocalNotification?: (channel: 'sync' | 'downloads', title: string, message: string, id: number, ongoing: boolean) => void;
    cancelLocalNotification?: (id: number) => void;
    requestLocalDevice?: (requestId: string, baseUrl: string, method: string, path: string, formBody: string) => void;
  };
}

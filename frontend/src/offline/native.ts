export type NativeNotificationChannel = 'sync' | 'downloads';

export function isWifiConnected() {
  try { return window.SGBAndroid?.isWifiConnected?.() ?? false; }
  catch { return false; }
}

export function showLocalNotification(
  channel: NativeNotificationChannel,
  title: string,
  message: string,
  id: number,
  ongoing = false,
) {
  try { window.SGBAndroid?.showLocalNotification?.(channel, title, message, id, ongoing); }
  catch { /* Las notificaciones son una mejora nativa; no deben bloquear la operación. */ }
}

export function cancelLocalNotification(id: number) {
  try { window.SGBAndroid?.cancelLocalNotification?.(id); }
  catch { /* Sin puente nativo (sitio web). */ }
}

export const SYNC_NOTIFICATION_ID = 2101;
export const DOWNLOAD_NOTIFICATION_ID = 2102;

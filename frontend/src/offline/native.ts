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
export function scheduleAgendaReminder(key:string,title:string,message:string,triggerAt:number,notificationId:number){try{window.SGBAndroid?.scheduleAgendaReminder?.(key,title,message,triggerAt,notificationId);}catch{/* Solo Android. */}}
export function scheduleLocalReminder(key:string,title:string,message:string,triggerAt:number,notificationId:number,route:string){try{window.SGBAndroid?.scheduleLocalReminder?.(key,title,message,triggerAt,notificationId,route);}catch{/* Solo Android. */}}
export function cancelAgendaReminder(key:string,notificationId:number){try{window.SGBAndroid?.cancelAgendaReminder?.(key,notificationId);}catch{/* Solo Android. */}}

export const SYNC_NOTIFICATION_ID = 2101;
export const DOWNLOAD_NOTIFICATION_ID = 2102;

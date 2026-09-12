import { apiRequest } from '../api/client';

interface RegisteredDevice {
  id_dispositivo: string;
}

const storageKey = (userId: string) => `sgb-push-device:${userId}`;

function nativeToken() {
  try { return window.SGBAndroid?.getPushToken?.().trim() ?? ''; }
  catch { return ''; }
}

export function requestNativePushToken() {
  try { window.SGBAndroid?.requestPushToken?.(); }
  catch { /* Firebase volverá a intentarlo al abrir la app. */ }
}

export async function registerPushDevice(userId: string) {
  if (!window.SGBAndroid) return false;
  const token = nativeToken();
  if (!token) {
    requestNativePushToken();
    return false;
  }
  const device = await apiRequest<RegisteredDevice>('/notificaciones/dispositivos',{
    method:'POST',
    body:{
      token,
      plataforma:'ANDROID',
      nombre_dispositivo:'Android SGB',
      version_app:window.SGBAndroid.getAppVersion?.() ?? null,
    },
  });
  localStorage.setItem(storageKey(userId),device.id_dispositivo);
  return true;
}

export async function unregisterPushDevice(userId: string) {
  const id = localStorage.getItem(storageKey(userId));
  if (!id) return;
  await apiRequest(`/notificaciones/dispositivos/${encodeURIComponent(id)}`,{method:'DELETE'});
  localStorage.removeItem(storageKey(userId));
}

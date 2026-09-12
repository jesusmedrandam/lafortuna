export interface DeviceStatus {
  ok: boolean;
  device_id: string;
  device_name: string;
  firmware_version: string;
  protocol_version: number;
  ip: string;
  time_valid: boolean;
  time_source: string;
  pending_readings: number;
  animals_count: number;
  containers_count: number;
  remote_control?: boolean;
  monitoring?: boolean;
  monitor_stable?: boolean;
  monitor_progress?: number;
  monitor_required?: number;
}

export interface DeviceAnimal { id: string; name: string }

export interface CalibrationPoint { distance_cm: number; liters: number }
export interface DeviceContainer {
  id: number;
  name: string;
  type: 'BUCKET' | 'TANK';
  active: boolean;
  capacity_liters: number;
  calibrated: boolean;
  points: CalibrationPoint[];
}
export interface DeviceReading {
  id: number;
  reading_key: string;
  target_type: 'ANIMAL' | 'TANK';
  target_id: string;
  target_name: string;
  container_id: number;
  distance_cm: number;
  liters: number;
  epoch: number;
  session: number;
  session_name: string;
  legacy: boolean;
}
export interface DeviceMeasure {
  ok: boolean;
  sensor: 'BUCKET' | 'TANK';
  valid: boolean;
  stable: boolean;
  distance_cm: number | null;
  valid_samples: number;
  requested_samples: number;
  spread_cm: number | null;
  container_id: number | null;
  liters: number | null;
}

export interface DeviceControlMeasure extends DeviceMeasure {
  saved: boolean;
  replaced?: boolean;
  reading?: DeviceReading | null;
  target_type: 'ANIMAL' | 'TANK';
  target_id: string;
  target_name: string;
  session: number;
  session_name: string;
  monitoring?: boolean;
  monitor_stable?: boolean;
  monitor_progress?: number;
  monitor_required?: number;
}

export interface DeviceMonitorStatus {
  ok: boolean;
  monitoring: boolean;
  stable: boolean;
  progress: number;
  required: number;
  tolerance_cm: number;
  range_cm: number | null;
  valid: boolean;
  sample_stable: boolean;
  distance_cm: number | null;
  liters: number | null;
  valid_samples: number;
  requested_samples: number;
  target_type: 'ANIMAL' | 'TANK' | null;
  target_id: string | null;
  target_name: string | null;
}

const DEVICE_IP_KEY = 'sgb.milk-meter.ip';
const DEVICE_SESSIONS_KEY = 'sgb.milk-meter.sessions.v1';
const DEVICE_ACTIVE_SESSION_KEY = 'sgb.milk-meter.active-session';
export const DEVICE_AP_ADDRESS = 'http://192.168.4.1';

export interface DeviceSession {
  id: string;
  name: string;
  address: string;
  mode: 'AP' | 'LAN';
  deviceId?: string;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) throw new Error('Ingresa la IP mostrada por el medidor.');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function loadDeviceAddress() {
  return localStorage.getItem(DEVICE_IP_KEY) || 'http://192.168.4.1';
}

export function saveDeviceAddress(value: string) {
  const normalized = normalizeBaseUrl(value);
  localStorage.setItem(DEVICE_IP_KEY, normalized);
  return normalized;
}

export function loadDeviceSessions(): DeviceSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVICE_SESSIONS_KEY) || '[]') as DeviceSession[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.address).slice(0, 2) : [];
  } catch { return []; }
}

export function saveDeviceSession(session: DeviceSession) {
  const normalized = { ...session, address: normalizeBaseUrl(session.address) };
  const current = loadDeviceSessions();
  const position = current.findIndex((item) => item.id === normalized.id);
  const next = position >= 0 ? current.map((item, index) => index === position ? normalized : item) : [...current, normalized].slice(-2);
  localStorage.setItem(DEVICE_SESSIONS_KEY, JSON.stringify(next));
  localStorage.setItem(DEVICE_ACTIVE_SESSION_KEY, normalized.id);
  saveDeviceAddress(normalized.address);
  return next;
}

export function loadActiveDeviceSessionId() {
  return localStorage.getItem(DEVICE_ACTIVE_SESSION_KEY) || '';
}

export function saveActiveDeviceSessionId(id: string) {
  localStorage.setItem(DEVICE_ACTIVE_SESSION_KEY, id);
}

function nativeRequest(baseUrl: string, method: string, path: string, body: URLSearchParams) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('sgb-device-response', listener as EventListener);
      reject(new Error('El medidor no respondió. Verifica la IP y la conexión Wi-Fi.'));
    }, 50_000);
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; status: number; body: string; error: string }>).detail;
      if (detail.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('sgb-device-response', listener as EventListener);
      if (detail.error) reject(new Error(detail.error));
      else resolve({ status: detail.status, body: detail.body });
    };
    window.addEventListener('sgb-device-response', listener as EventListener);
    window.SGBAndroid!.requestLocalDevice!(id, baseUrl, method, path, body.toString());
  });
}

export async function deviceRequest<T>(address: string, path: string, options: { method?: string; body?: Record<string, string | number | boolean | null | undefined> } = {}): Promise<T> {
  const baseUrl = normalizeBaseUrl(address);
  const method = (options.method || 'GET').toUpperCase();
  const body = new URLSearchParams();
  Object.entries(options.body || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) body.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  });
  let status: number;
  let raw: string;
  if (window.SGBAndroid?.requestLocalDevice) {
    const response = await nativeRequest(baseUrl, method, path, body);
    status = response.status;
    raw = response.body;
  } else {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: method === 'GET' ? undefined : body,
      cache: 'no-store',
    });
    status = response.status;
    raw = await response.text();
  }
  let payload: unknown;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('El medidor devolvió una respuesta que la app no pudo interpretar.'); }
  if (status < 200 || status >= 300 || (payload as { ok?: boolean }).ok === false) {
    const message = (payload as { error?: string | { message?: string } }).error;
    throw new Error(typeof message === 'string' ? message : message?.message || `El medidor respondió con estado ${status}.`);
  }
  return payload as T;
}

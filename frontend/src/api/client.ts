import { clearSession, loadSession, saveSession } from './storage';
import type { ApiFailure, ApiSuccess, AuthTokens } from '../types/api';

export const API_URL = (import.meta.env.VITE_API_URL || 'https://lafortuna.onrender.com/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
  retryAuth?: boolean;
};

let refreshPromise: Promise<AuthTokens | null> | null = null;

async function parseResponse<T>(response: Response): Promise<ApiSuccess<T> | null> {
  if (response.status === 204 || response.status === 304) return null;
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) return null;
  return (await response.json()) as ApiSuccess<T>;
}

async function refreshSession(): Promise<AuthTokens | null> {
  const current = loadSession();
  if (!current?.refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as ApiSuccess<AuthTokens>;
        saveSession(payload.data);
        window.dispatchEvent(new CustomEvent('mm-session-updated'));
        return payload.data;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, retryAuth = true, body, headers, ...rest } = options;
  const session = loadSession();
  const isFormData = body instanceof FormData;
  const requestHeaders = new Headers(headers);
  if (!isFormData && body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (auth && session?.accessToken) requestHeaders.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: requestHeaders,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (response.status === 401 && auth && retryAuth) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, retryAuth: false });
    clearSession();
    window.dispatchEvent(new CustomEvent('mm-session-expired'));
  }

  if (!response.ok) {
    let payload: ApiFailure | null = null;
    try {
      payload = (await response.json()) as ApiFailure;
    } catch {
      // Respuesta no JSON.
    }
    throw new ApiError(
      response.status,
      payload?.error.code ?? 'HTTP_ERROR',
      payload?.error.message ?? `Error HTTP ${response.status}`,
      payload?.error.details,
    );
  }

  const payload = await parseResponse<T>(response);
  return payload?.data as T;
}

export async function apiRequestWithMeta<T>(path: string, options: RequestOptions = {}) {
  const session = loadSession();
  const requestHeaders = new Headers(options.headers);
  if (options.auth !== false && session?.accessToken) requestHeaders.set('Authorization', `Bearer ${session.accessToken}`);
  if (options.body !== undefined && !(options.body instanceof FormData)) requestHeaders.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: requestHeaders,
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });
  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequestWithMeta<T>(path, { ...options, retryAuth: false });
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiFailure | null;
    throw new ApiError(response.status, payload?.error.code ?? 'HTTP_ERROR', payload?.error.message ?? `Error HTTP ${response.status}`, payload?.error.details);
  }
  return (await response.json()) as ApiSuccess<T>;
}

interface CatalogCache<T> {
  etag: string | null;
  data: T;
}

export async function cachedCatalogRequest<T>(catalog: string): Promise<T> {
  const key = `mm.catalog.${catalog}`;
  let cached: CatalogCache<T> | null = null;
  try {
    const raw = localStorage.getItem(key);
    cached = raw ? (JSON.parse(raw) as CatalogCache<T>) : null;
  } catch {
    localStorage.removeItem(key);
  }

  const session = loadSession();
  const headers = new Headers();
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (cached?.etag) headers.set('If-None-Match', cached.etag);

  let response = await fetch(`${API_URL}/catalogos/${catalog}`, { headers });
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
      response = await fetch(`${API_URL}/catalogos/${catalog}`, { headers });
    }
  }
  if (response.status === 304 && cached) return cached.data;
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiFailure | null;
    throw new ApiError(response.status, payload?.error.code ?? 'HTTP_ERROR', payload?.error.message ?? `Error HTTP ${response.status}`);
  }
  const payload = (await response.json()) as ApiSuccess<T>;
  const next: CatalogCache<T> = { etag: response.headers.get('etag'), data: payload.data };
  localStorage.setItem(key, JSON.stringify(next));
  return payload.data;
}

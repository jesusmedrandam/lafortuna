import type { AuthTokens } from '../types/api';

const KEY = 'mm.session';

export function loadSession(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthTokens;
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}

export function saveSession(session: AuthTokens) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, ApiError, wakeServer } from '../api/client';
import { clearSession, loadSession, saveSession } from '../api/storage';
import type { AuthTokens, AuthUser } from '../types/api';
import { registerPushDevice, requestNativePushToken, unregisterPushDevice } from '../notifications/push';

interface AuthContextValue {
  session: AuthTokens | null;
  user: AuthUser | null;
  ready: boolean;
  login: (correo: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthTokens | null>(() => loadSession());
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => setSession(loadSession()), []);

  useEffect(() => {
    const updated = () => sync();
    const expired = () => {
      clearSession();
      setSession(null);
    };
    window.addEventListener('mm-session-updated', updated);
    window.addEventListener('mm-session-expired', expired);
    return () => {
      window.removeEventListener('mm-session-updated', updated);
      window.removeEventListener('mm-session-expired', expired);
    };
  }, [sync]);

  const refreshUser = useCallback(async () => {
    const current = loadSession();
    if (!current) {
      setReady(true);
      return;
    }
    try {
      const profile = await apiRequest<{ auth: AuthUser | null }>('/auth/me');
      if (!profile.auth) throw new Error('No se pudo recuperar la sesión.');
      const next = { ...current, user: profile.auth };
      saveSession(next);
      setSession(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        setSession(null);
      } else {
        setSession(current);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!ready || !userId || !window.SGBAndroid) return;
    const register = () => { void registerPushDevice(userId).catch(() => undefined); };
    const tokenReady = () => register();
    requestNativePushToken();
    register();
    window.addEventListener('sgb-push-token',tokenReady);
    window.addEventListener('online',register);
    const timer = window.setInterval(register,5 * 60_000);
    return () => {
      window.removeEventListener('sgb-push-token',tokenReady);
      window.removeEventListener('online',register);
      window.clearInterval(timer);
    };
  },[ready,session?.user?.id]);

  const login = useCallback(async (correo: string, password: string) => {
    const reachable = await wakeServer(true);
    if (!reachable) {
      throw new ApiError(0, 'SERVER_STARTING', 'No se pudo activar el servidor de SGB. Comprueba la conexión y vuelve a intentarlo.');
    }
    const tokens = await apiRequest<AuthTokens>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { correo, password },
    });
    saveSession(tokens);
    setSession(tokens);
  }, []);

  const logout = useCallback(async () => {
    const current = loadSession();
    try {
      if (current?.user?.id && window.SGBAndroid) {
        try {
          await Promise.race([
            unregisterPushDevice(current.user.id),
            new Promise<void>((resolve)=>window.setTimeout(resolve,3000)),
          ]);
        } catch { /* El identificador inválido será depurado por el servidor. */ }
      }
      if (current?.refreshToken) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          auth: false,
          body: { refreshToken: current.refreshToken },
        });
      }
    } finally {
      clearSession();
      setSession(null);
    }
  }, []);

  const hasPermission = useCallback(
    (...permissions: string[]) => {
      const user = session?.user;
      if (!user) return false;
      return user.roles.includes('ADMINISTRADOR') || permissions.some((permission) => user.permissions.includes(permission));
    },
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, ready, login, logout, refreshUser, hasPermission }),
    [session, ready, login, logout, refreshUser, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}

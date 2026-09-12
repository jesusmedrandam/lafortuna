import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getConnectionQuality, refreshOfflineCoreCache, syncOfflineMutations, verifyServerConnection, type ConnectionQuality } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getOfflineStats, type OfflineStats } from './database';
import { runAutomaticDownloadIfEnabled } from './downloads';

interface OfflineContextValue extends OfflineStats {
  online: boolean;
  quality: ConnectionQuality;
  waking: boolean;
  syncing: boolean;
  syncProgress: { current: number; total: number; completed: number; remaining: number; description: string | null } | null;
  refresh: () => Promise<void>;
  sync: () => Promise<{ synced: number; failed: number }>;
}

const emptyStats: OfflineStats = {
  cachedRequests: 0, pending: 0, failed: 0, lastDownload: null, lastSync: null,
  structuredBytes: 0, localMediaBytes: 0, nativeMediaBytes: 0, downloadedBytes: 0,
};
const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [quality, setQuality] = useState<ConnectionQuality>(getConnectionQuality);
  const qualityRef = useRef(quality);
  const [waking, setWaking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<OfflineContextValue['syncProgress']>(null);
  const syncingRef = useRef(false);
  const [stats, setStats] = useState<OfflineStats>(emptyStats);

  const refresh = useCallback(async () => {
    setStats(user ? await getOfflineStats(user.id) : emptyStats);
  }, [user]);

  const verify = useCallback(async (force = false) => {
    const reachable = await verifyServerConnection(force);
    const next = getConnectionQuality();
    qualityRef.current = next;
    setQuality(next);
    return reachable;
  }, []);

  const performSync = useCallback(async (force = false) => {
    if (!user || !(await verify(true))) return { synced: 0, failed: 0 };
    if (syncingRef.current) return syncOfflineMutations(force);
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await syncOfflineMutations(force);
      await refreshOfflineCoreCache();
      await queryClient.invalidateQueries();
      const nextStats = await getOfflineStats(user.id);
      setStats(nextStats);
      if (getConnectionQuality() === 'stable' && nextStats.pending + nextStats.failed === 0) void runAutomaticDownloadIfEnabled(user);
      return result;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [queryClient, refresh, user, verify]);
  const sync = useCallback(() => performSync(true), [performSync]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const update = () => {
      if (syncingRef.current) {
        void refresh();
        return;
      }
      const next = getConnectionQuality();
      qualityRef.current = next;
      setQuality(next);
      void refresh();
    };
    const connected = () => { if (!syncingRef.current) void verify(true); };
    const verified = (event: Event) => {
      const next = (event as CustomEvent<{ quality?: ConnectionQuality }>).detail?.quality ?? getConnectionQuality();
      const recovered = next === 'stable' && qualityRef.current !== 'stable';
      qualityRef.current = next;
      setQuality(next);
      void refresh();
      if (recovered && !syncingRef.current) void performSync(false);
    };
    const wakingChanged = (event: Event) => {
      const nextWaking = Boolean((event as CustomEvent<{ waking?: boolean }>).detail?.waking);
      setWaking(nextWaking);
      if (nextWaking && qualityRef.current !== 'offline') {
        qualityRef.current = 'unstable';
        setQuality('unstable');
      }
    };
    const progressChanged = (event: Event) => {
      setSyncProgress((event as CustomEvent<OfflineContextValue['syncProgress']>).detail ?? null);
      void refresh();
    };
    window.addEventListener('online', connected);
    window.addEventListener('offline', update);
    window.addEventListener('sgb-connectivity-verified', verified);
    window.addEventListener('sgb-server-waking', wakingChanged);
    window.addEventListener('sgb-offline-change', update);
    window.addEventListener('sgb-sync-progress', progressChanged);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', update);
      window.removeEventListener('sgb-connectivity-verified', verified);
      window.removeEventListener('sgb-server-waking', wakingChanged);
      window.removeEventListener('sgb-offline-change', update);
      window.removeEventListener('sgb-sync-progress', progressChanged);
    };
  }, [performSync, refresh, verify]);
  useEffect(() => {
    if (!user) return;
    void verify(true).then((reachable) => { if (reachable) void performSync(false); });
    const timer = window.setInterval(() => {
      if (syncingRef.current) return;
      void verify(false).then((reachable) => { if (reachable) void runAutomaticDownloadIfEnabled(user); });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [performSync, user, verify]);

  const online = quality === 'stable';
  const value = useMemo(() => ({ ...stats, online, quality, waking, syncing, syncProgress, refresh, sync }), [stats, online, quality, waking, syncing, syncProgress, refresh, sync]);
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const value = useContext(OfflineContext);
  if (!value) throw new Error('useOffline debe usarse dentro de OfflineProvider.');
  return value;
}

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import type { DataVersion } from '../types/api';

const queryKeys: Record<string, string[]> = {
  animales: ['animals', 'animal'],
  grupos: ['groups'],
  ubicaciones: ['locations', 'pastures', 'corrals'],
  catalogos: ['catalog'],
  usuarios: ['users', 'roles', 'profile'],
  movimientos: ['movements'],
  sanidad: ['sanitary', 'treatments'],
  produccion: ['dashboard', 'productions', 'lactations'],
  imagenes: ['animal'],
};

export function VersionSync() {
  const queryClient = useQueryClient();
  const previous = useRef<Record<string, number>>({});
  const versions = useQuery({
    queryKey: ['data-versions'],
    queryFn: () => apiRequest<DataVersion[]>('/versiones', { auth: false }),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  useEffect(() => {
    if (!versions.data) return;
    for (const item of versions.data) {
      const prior = previous.current[item.modulo];
      if (prior !== undefined && prior !== Number(item.version)) {
        for (const key of queryKeys[item.modulo] ?? []) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
        if (item.modulo === 'catalogos') {
          Object.keys(localStorage)
            .filter((key) => key.startsWith('mm.catalog.'))
            .forEach((key) => localStorage.removeItem(key));
        }
      }
      previous.current[item.modulo] = Number(item.version);
    }
  }, [versions.data, queryClient]);

  return null;
}

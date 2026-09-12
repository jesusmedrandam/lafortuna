import { useQuery } from '@tanstack/react-query';
import { cachedCatalogRequest } from '../api/client';
import type { CatalogItem } from '../types/api';

export function useCatalog(name: string, enabled = true) {
  return useQuery({
    queryKey: ['catalog', name],
    queryFn: () => cachedCatalogRequest<CatalogItem[]>(name),
    select: (value) => Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
        ? (value as { data: CatalogItem[] }).data
        : [],
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    enabled,
  });
}

export function itemId(item: CatalogItem): string {
  const keys = Object.keys(item).filter((name) => name.startsWith('id_'));
  const key = keys.find((name) => String(item[name] ?? '').startsWith('offline-')) ?? keys[0];
  return key ? String(item[key]) : '';
}

export function itemLabel(item: CatalogItem): string {
  return String(item.nombre ?? item.nombre_comercial ?? item.codigo ?? 'Sin nombre');
}

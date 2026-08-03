import { useQuery } from '@tanstack/react-query';
import { cachedCatalogRequest } from '../api/client';
import type { CatalogItem } from '../types/api';

export function useCatalog(name: string, enabled = true) {
  return useQuery({
    queryKey: ['catalog', name],
    queryFn: () => cachedCatalogRequest<CatalogItem[]>(name),
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    enabled,
  });
}

export function itemId(item: CatalogItem): string {
  const key = Object.keys(item).find((name) => name.startsWith('id_'));
  return key ? String(item[key]) : '';
}

export function itemLabel(item: CatalogItem): string {
  return String(item.nombre ?? item.nombre_comercial ?? item.codigo ?? 'Sin nombre');
}

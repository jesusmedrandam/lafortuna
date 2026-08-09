import { useEffect, useMemo, useState } from 'react';

export type ListOrder = 'NEWEST' | 'OLDEST' | 'AZ' | 'ZA';

interface Options<T> {
  items: T[];
  storageKey: string;
  searchText: (item: T) => string;
  dateValue?: (item: T) => string | null | undefined;
  nameValue: (item: T) => string;
  defaultOrder?: ListOrder;
}

export function useListControls<T>({ items, storageKey, searchText, dateValue, nameValue, defaultOrder = 'NEWEST' }: Options<T>) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<ListOrder>(() => {
    const saved = window.localStorage.getItem(`lafortuna:list-order:${storageKey}`);
    return saved === 'NEWEST' || saved === 'OLDEST' || saved === 'AZ' || saved === 'ZA' ? saved : defaultOrder;
  });

  useEffect(() => {
    window.localStorage.setItem(`lafortuna:list-order:${storageKey}`, order);
  }, [order, storageKey]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    const filtered = term
      ? items.filter((item) => searchText(item).toLocaleLowerCase('es').includes(term))
      : [...items];
    return filtered.sort((a, b) => {
      if (order === 'AZ' || order === 'ZA') {
        const result = nameValue(a).localeCompare(nameValue(b), 'es', { sensitivity: 'base' });
        return order === 'AZ' ? result : -result;
      }
      const aTime = dateValue?.(a) ? new Date(dateValue!(a)!).getTime() : 0;
      const bTime = dateValue?.(b) ? new Date(dateValue!(b)!).getTime() : 0;
      return order === 'OLDEST' ? aTime - bTime : bTime - aTime;
    });
  }, [dateValue, items, nameValue, order, search, searchText]);

  return { search, setSearch, order, setOrder, visible };
}

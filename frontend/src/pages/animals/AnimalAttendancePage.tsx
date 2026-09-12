import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, Check, ClipboardCheck, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequestAllPages } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, EmptyState, ErrorState, IconButton, LoadingState, SearchBox, Select } from '../../components/ui';
import type { Animal } from '../../types/api';

type AttendanceMap = Record<string, number>;
interface AttendanceFilters { search: string; groupId: string }

function loadAttendanceFilters(key: string): AttendanceFilters {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}') as Partial<AttendanceFilters>;
    return { search: stored.search ?? '', groupId: stored.groupId ?? '' };
  } catch {
    return { search: '', groupId: '' };
  }
}

export function AnimalAttendancePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const filtersStorageKey = `sgb.attendance.filters.${user?.id || 'local'}`;
  const initialFilters = useMemo(() => loadAttendanceFilters(filtersStorageKey), [filtersStorageKey]);
  const [search, setSearch] = useState(initialFilters.search);
  const [groupId, setGroupId] = useState(initialFilters.groupId);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef({ x: 0, y: 0 });
  const openedByHold = useRef(false);
  const storageKey = `sgb.attendance.${user?.id || 'local'}`;
  const [marked, setMarked] = useState<AttendanceMap>(() => JSON.parse(localStorage.getItem(`sgb.attendance.${user?.id || 'local'}`) || '{}'));
  const query = useQuery({ queryKey: ['animals', 'attendance'], queryFn: () => apiRequestAllPages<Animal>('/animales?estado=ACTIVO&limit=100', 100) });

  useEffect(() => {
    localStorage.setItem(filtersStorageKey, JSON.stringify({ search, groupId } satisfies AttendanceFilters));
  }, [filtersStorageKey, groupId, search]);

  const groups = useMemo(() => {
    const unique = new Map<string, string>();
    for (const animal of query.data?.data || []) {
      if (animal.id_grupo_actual && animal.grupo) unique.set(animal.id_grupo_actual, animal.grupo);
    }
    return [...unique].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [query.data]);
  const toggle = (id: string) => {
    const next = { ...marked };
    if (next[id]) delete next[id]; else next[id] = Date.now();
    setMarked(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const cancelHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const beginHold = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    cancelHold();
    openedByHold.current = false;
    holdStart.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = window.setTimeout(() => {
      openedByHold.current = true;
      holdTimer.current = null;
      navigate(`/animales/${id}`);
    }, 600);
  };
  const moveHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (Math.hypot(event.clientX - holdStart.current.x, event.clientY - holdStart.current.y) > 10) cancelHold();
  };
  const selectAnimal = (id: string) => {
    cancelHold();
    if (openedByHold.current) {
      openedByHold.current = false;
      return;
    }
    toggle(id);
  };
  const animals = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const filtered = (query.data?.data || []).filter((animal) => {
      if (groupId && animal.id_grupo_actual !== groupId) return false;
      return !term || `${animal.nombre} ${animal.codigo_arete || ''} ${animal.descripcion || ''} ${animal.grupo || ''}`.toLocaleLowerCase().includes(term);
    });
    return filtered.sort((a, b) => {
      const aTime = marked[a.id_animal] || 0;
      const bTime = marked[b.id_animal] || 0;
      if (Boolean(aTime) !== Boolean(bTime)) return aTime ? 1 : -1;
      return aTime && bTime ? bTime - aTime : a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [query.data, search, groupId, marked]);
  const visibleMarked = animals.filter((animal) => Boolean(marked[animal.id_animal])).length;

  return <div className="attendance-page">
    <div className="attendance-sticky-controls"><div className="attendance-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Buscar animal…" /><Select aria-label="Filtrar asistencia por grupo" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Todos los grupos</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select><IconButton label="Reiniciar asistencia" disabled={!Object.keys(marked).length} onClick={() => { setMarked({}); localStorage.removeItem(storageKey); }}><RotateCcw size={18} /></IconButton></div>
    <div className="attendance-summary"><Badge tone="warning">Faltan {Math.max(0, animals.length - visibleMarked)}</Badge><Badge tone="success">Presentes {visibleMarked}</Badge><Badge tone="info">Total {animals.length}</Badge></div></div>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : !animals.length ? <EmptyState icon={ClipboardCheck} title="No hay animales" description="No se encontraron animales activos con estos filtros." /> : <div className="attendance-list">{animals.map((animal) => {
      const present = Boolean(marked[animal.id_animal]);
      return <button key={animal.id_animal} type="button" className={`attendance-row ${present ? 'present' : ''}`} title="Toca para marcar. Mantén pulsado para ver el perfil." onPointerDown={(event) => beginHold(event, animal.id_animal)} onPointerMove={moveHold} onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold} onContextMenu={(event) => event.preventDefault()} onClick={() => selectAnimal(animal.id_animal)}><span className="attendance-check">{present ? <Check size={20} /> : null}</span><span className="attendance-photo">{animal.foto_perfil ? <img src={animal.foto_perfil} alt="" /> : <Beef size={22} />}</span><span><strong>{animal.nombre}</strong><small>{animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Sin arete'} · {animal.grupo || 'Sin grupo'}</small></span></button>;
    })}</div>}
  </div>;
}

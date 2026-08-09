import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, CalendarClock, ChevronLeft, ChevronRight, MapPin, Paintbrush, Plus, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestWithMeta } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, PageHeader, SearchBox, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { Animal, AnimalFilterOptions } from '../../types/api';
import { formatAgeCompact, humanizeCode } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';

const pageSize = 20;
const filterKeys = ['sexo', 'estado', 'id_especie', 'id_grupo', 'id_ubicacion', 'id_propietario', 'id_raza', 'id_color', 'id_marquilla', 'nacimiento_desde', 'nacimiento_hasta'] as const;
const advancedFilterKeys = ['id_ubicacion', 'id_propietario', 'id_raza', 'id_color', 'id_marquilla', 'nacimiento_desde', 'nacimiento_hasta'] as const;

export function AnimalsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedFilterKeys.some((key) => params.has(key)));
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(search);
  const filters = Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? ''])) as Record<(typeof filterKeys)[number], string>;
  const activeFilterCount = filterKeys.filter((key) => Boolean(filters[key])).length;

  const options = useQuery({
    queryKey: ['animal-filter-options'],
    queryFn: () => apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),
    staleTime: 10 * 60_000,
  });
  const query = useQuery({
    queryKey: ['animals', page, debounced, filters],
    queryFn: () => {
      const queryParams = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (debounced) queryParams.set('q', debounced);
      filterKeys.forEach((key) => {
        if (filters[key]) queryParams.set(key, filters[key]);
      });
      return apiRequestWithMeta<Animal[]>(`/animales?${queryParams}`);
    },
    placeholderData: (previous) => previous,
  });
  const total = Number(query.data?.meta?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    filterKeys.forEach((key) => next.delete(key));
    next.set('page', '1');
    setParams(next);
  };
  const updateSpecies = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('id_especie', value); else next.delete('id_especie');
    const selectedRace = options.data?.razas.find((race) => race.id_raza === filters.id_raza);
    if (selectedRace && value && selectedRace.id_especie && selectedRace.id_especie !== value) next.delete('id_raza');
    next.set('page', '1');
    setParams(next);
  };
  const visibleRaces = options.data?.razas.filter((item) => !filters.id_especie || !item.id_especie || item.id_especie === filters.id_especie) ?? [];

  return <div>
    <PageHeader title="Animales" description="Listado general. Selecciona una fila para abrir el resumen actual del animal." action={hasPermission('ANIMAL_CREAR') ? <IconButton label="Agregar animal" onClick={() => setCreating(true)}><Plus size={20} /></IconButton> : undefined} />
    <div className="toolbar animal-search-toolbar">
      <SearchBox value={search} onChange={(value) => { setSearch(value); updateParam('q', value); }} placeholder="Buscar por nombre, arete o descripción…" />
      <div className="toolbar-filters">
        <Select aria-label="Filtrar por sexo" value={filters.sexo} onChange={(event) => updateParam('sexo', event.target.value)}><option value="">Todos los sexos</option><option value="HEMBRA">Hembras</option><option value="MACHO">Machos</option></Select>
        <Select aria-label="Filtrar por estado" value={filters.estado} onChange={(event) => updateParam('estado', event.target.value)}><option value="">Todos los estados</option>{['ACTIVO', 'INACTIVO', 'VENDIDO', 'TRASLADADO', 'DESAPARECIDO', 'MUERTO'].map((item) => <option key={item} value={item}>{humanizeCode(item)}</option>)}</Select>
        <Select aria-label="Filtrar por especie" value={filters.id_especie} onChange={(event) => updateSpecies(event.target.value)}><option value="">Todas las especies</option>{options.data?.especies.map((item) => <option key={item.id_especie} value={item.id_especie}>{item.nombre}</option>)}</Select>
        <Select aria-label="Filtrar por grupo" value={filters.id_grupo} onChange={(event) => updateParam('id_grupo', event.target.value)}><option value="">Todos los grupos</option>{options.data?.grupos.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select>
        <IconButton label="Filtros avanzados" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}><SlidersHorizontal size={18} />{activeFilterCount ? <span className="filter-count">{activeFilterCount}</span> : null}</IconButton>
      </div>
    </div>

    {advancedOpen ? <section className="advanced-filters" aria-label="Búsqueda avanzada de animales">
      <div className="advanced-filters-heading"><div><h2>Búsqueda avanzada</h2><p>Combina varios criterios para encontrar animales específicos.</p></div><div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!activeFilterCount} onClick={clearFilters}><Paintbrush size={17} /></IconButton><IconButton label="Cerrar filtros" onClick={() => setAdvancedOpen(false)}><X size={18} /></IconButton></div></div>
      {options.isError ? <p className="form-alert form-alert-error">No se pudieron cargar las opciones de los filtros.</p> : null}
      <div className="advanced-filters-grid">
        <Field label="Corral o potrero"><Select value={filters.id_ubicacion} onChange={(event) => updateParam('id_ubicacion', event.target.value)}><option value="">Todas las ubicaciones</option>{options.data?.ubicaciones.map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {humanizeCode(item.tipo)}</option>)}</Select></Field>
        <Field label="Propietario"><Select value={filters.id_propietario} onChange={(event) => updateParam('id_propietario', event.target.value)}><option value="">Todos los propietarios</option>{options.data?.propietarios.map((item) => <option key={item.id_usuario} value={item.id_usuario}>{item.nombre}</option>)}</Select></Field>
        <Field label="Raza"><Select value={filters.id_raza} onChange={(event) => updateParam('id_raza', event.target.value)}><option value="">Todas las razas</option>{visibleRaces.map((item) => <option key={item.id_raza} value={item.id_raza}>{item.nombre}</option>)}</Select></Field>
        <Field label="Color"><Select value={filters.id_color} onChange={(event) => updateParam('id_color', event.target.value)}><option value="">Todos los colores</option>{options.data?.colores.map((item) => <option key={item.id_color} value={item.id_color}>{item.nombre}</option>)}</Select></Field>
        <Field label="Fierro"><Select value={filters.id_marquilla} onChange={(event) => updateParam('id_marquilla', event.target.value)}><option value="">Todos los fierros</option>{options.data?.marquillas.map((item) => <option key={item.id_marquilla} value={item.id_marquilla}>{item.nombre} · {item.codigo}</option>)}</Select></Field>
        <Field label="Nacimiento desde"><Input type="date" value={filters.nacimiento_desde} max={filters.nacimiento_hasta || undefined} onChange={(event) => updateParam('nacimiento_desde', event.target.value)} /></Field>
        <Field label="Nacimiento hasta"><Input type="date" value={filters.nacimiento_hasta} min={filters.nacimiento_desde || undefined} onChange={(event) => updateParam('nacimiento_hasta', event.target.value)} /></Field>
      </div>
      <div className="advanced-filters-footer"><span>{activeFilterCount ? `${activeFilterCount} filtro${activeFilterCount === 1 ? '' : 's'} activo${activeFilterCount === 1 ? '' : 's'}` : 'Sin filtros aplicados'}</span></div>
    </section> : null}

    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.data.length === 0 ? <EmptyState icon={Beef} title="No hay animales" description="Registra el primer animal o modifica los filtros de búsqueda." action={hasPermission('ANIMAL_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar animal</Button> : undefined} /> : <>
      <div className="animal-list" role="table" aria-label="Listado de animales">
        <div className="animal-list-head" role="row"><span>Animal</span><span>Propietario</span><span>Clasificación</span><span>Corral o potrero</span><span>Edad</span><span>Estado</span></div>
        {query.data?.data.map((animal) => <button type="button" className="animal-list-row" role="row" key={animal.id_animal} onClick={() => navigate(`/animales/${animal.id_animal}`)}>
          <span className="animal-list-identity"><span className="animal-list-photo">{animal.foto_perfil ? <img src={animal.foto_perfil} alt="" /> : <Beef size={24} />}</span><span><strong>{animal.nombre}</strong><small>{animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Sin arete'}</small></span></span>
          <span className="animal-list-cell"><UserRound size={16} /><span>{animal.propietario_principal || 'Sin propietario'}</span></span>
          <span className="animal-list-cell"><span>{animal.especie}</span><small>{animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'} · {animal.grupo || 'Sin grupo'}</small></span>
          <span className="animal-list-cell"><MapPin size={16} /><span>{animal.ubicacion || 'Sin corral o potrero'}</span></span>
          <span className="animal-list-cell animal-list-age"><CalendarClock size={16} /><span>{formatAgeCompact(animal.fecha_nacimiento)}</span></span>
          <span><Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{humanizeCode(animal.estado)}</Badge></span>
        </button>)}
      </div>
      <div className="pagination"><span>{total} animales · página {page} de {pages}</span><div><Button variant="ghost" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}><ChevronLeft size={18} />Anterior</Button><Button variant="ghost" disabled={page >= pages} onClick={() => updateParam('page', String(page + 1))}>Siguiente<ChevronRight size={18} /></Button></div></div>
    </>}
    {creating ? <AnimalFormModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); if (id) navigate(`/animales/${id}`); }} /> : null}
  </div>;
}

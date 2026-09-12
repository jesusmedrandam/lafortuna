import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, CalendarClock, ClipboardCheck, CloudOff, MapPin, Mars, Paintbrush, Plus, SlidersHorizontal, UserRound, Venus, VenusAndMars, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestAllPages } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, SearchBox, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { Animal, AnimalFilterOptions } from '../../types/api';
import { formatDate, humanizeCode } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';

const pageSize = 100;
const filterKeys = ['sexo', 'estado', 'categoria_codigo', 'id_categoria_animal', 'clasificacion', 'propiedad_principal', 'id_especie', 'id_grupo', 'id_ubicacion', 'id_propietario', 'id_raza', 'id_color', 'id_marquilla', 'nacimiento_desde', 'nacimiento_hasta'] as const;
const classifications = [
  { code: 'VACA', label: 'Vacas' },
  { code: 'VACONA', label: 'Vaconas' },
  { code: 'TERNERA', label: 'Terneras' },
  { code: 'TORO', label: 'Toros' },
  { code: 'TORETE', label: 'Toretes' },
  { code: 'TERNERO', label: 'Terneros' },
] as const;

export function AnimalsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  // Los enlaces del panel pueden traer filtros avanzados ya aplicados, pero la
  // sección debe permanecer cerrada hasta que el usuario decida abrirla.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(search);
  const filters = Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? (key === 'categoria_codigo' && !params.has('id_categoria_animal') ? 'EN_PROPIEDAD' : '')])) as Record<(typeof filterKeys)[number], string>;
  const activeFilterCount = filterKeys.filter((key) => key === 'categoria_codigo'
    ? Boolean(filters[key] && filters[key] !== 'EN_PROPIEDAD' && filters[key] !== 'TODAS')
    : Boolean(filters[key])).length;

  const options = useQuery({
    queryKey: ['animal-filter-options'],
    queryFn: () => apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),
    staleTime: 10 * 60_000,
  });
  const query = useQuery({
    queryKey: ['animals', 'all', debounced, filters],
    queryFn: () => {
      const queryParams = new URLSearchParams({ page: '1', limit: String(pageSize) });
      if (debounced) queryParams.set('q', debounced);
      filterKeys.forEach((key) => {
        if (filters[key] && !(key === 'categoria_codigo' && filters[key] === 'TODAS')) queryParams.set(key, filters[key]);
      });
      return apiRequestAllPages<Animal>(`/animales?${queryParams}`, pageSize);
    },
    placeholderData: (previous) => previous,
  });

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  const updateCategory = (value: string) => {
    const next = new URLSearchParams(params);
    next.delete('id_categoria_animal');
    next.set('categoria_codigo', value || 'TODAS');
    next.delete('id_ubicacion');
    next.delete('page');
    setParams(next);
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    filterKeys.forEach((key) => next.delete(key));
    next.delete('page');
    setParams(next);
  };
  const updateSpecies = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('id_especie', value); else next.delete('id_especie');
    const selectedRace = options.data?.razas.find((race) => race.id_raza === filters.id_raza);
    if (selectedRace && value && selectedRace.id_especie && selectedRace.id_especie !== value) next.delete('id_raza');
    next.delete('page');
    setParams(next);
  };
  const visibleRaces = options.data?.razas.filter((item) => !filters.id_especie || !item.id_especie || item.id_especie === filters.id_especie) ?? [];
  const selectedCategoryCode = filters.id_categoria_animal
    ? options.data?.categorias.find((item) => item.id_categoria_animal === filters.id_categoria_animal)?.codigo ?? 'TODAS'
    : filters.categoria_codigo;
  const selectedCategoryId = filters.id_categoria_animal
    || options.data?.categorias.find((item) => item.codigo === selectedCategoryCode)?.id_categoria_animal
    || '';
  const cycleSex = () => updateParam('sexo', filters.sexo === '' ? 'HEMBRA' : filters.sexo === 'HEMBRA' ? 'MACHO' : '');
  const sexLabel = filters.sexo === 'HEMBRA' ? 'Solo hembras' : filters.sexo === 'MACHO' ? 'Solo machos' : 'Todos los sexos';

  return <div className="module-no-header animals-page">
    <div className="animal-controls-sticky">
      <div className="animal-primary-controls">
        <SearchBox value={search} onChange={(value) => { setSearch(value); updateParam('q', value); }} placeholder="Buscar animal, propietario, fierro…" />
        <IconButton className={`quick-icon-filter ${filters.sexo ? 'active' : ''}`} label={`${sexLabel}. Pulsa para cambiar.`} onClick={cycleSex}>{filters.sexo === 'HEMBRA' ? <Venus size={20} /> : filters.sexo === 'MACHO' ? <Mars size={20} /> : <VenusAndMars size={20} />}</IconButton>
        <IconButton className={`advanced-filter-trigger ${advancedOpen ? 'active' : ''}`} label="Filtros avanzados" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}><SlidersHorizontal size={20} />{activeFilterCount ? <span className="filter-count">{activeFilterCount}</span> : null}</IconButton>
        <span className="animal-visible-count" aria-label={`${query.data?.data.length ?? 0} animales visibles`}><Beef size={16} /><strong>{query.data?.data.length ?? 0}</strong></span>
      </div>
      <div className="animal-secondary-filters">
        <Select aria-label="Filtrar por grupo" value={filters.id_grupo} onChange={(event) => updateParam('id_grupo', event.target.value)}><option value="">Todos los grupos</option>{options.data?.grupos.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select>
        <Select aria-label="Filtrar por situación de propiedad" value={selectedCategoryCode} onChange={(event) => updateCategory(event.target.value)}><option value="TODAS">Dentro y fuera de propiedad</option>{options.data?.categorias.map((item) => <option key={item.id_categoria_animal} value={item.codigo}>{item.nombre}</option>)}</Select>
      </div>
    </div>

    {advancedOpen ? <section className="advanced-filters" aria-label="Búsqueda avanzada de animales">
      <div className="advanced-filters-heading"><div><h2>Búsqueda avanzada</h2><p>Combina varios criterios para encontrar animales específicos.</p></div><div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!activeFilterCount} onClick={clearFilters}><Paintbrush size={17} /></IconButton><IconButton label="Cerrar filtros" onClick={() => setAdvancedOpen(false)}><X size={18} /></IconButton></div></div>
      {options.isError ? <p className="form-alert form-alert-error">No se pudieron cargar las opciones de los filtros.</p> : null}
      <div className="advanced-filters-grid">
        <Field label="Condición del animal"><Select value={filters.estado} onChange={(event) => updateParam('estado', event.target.value)}><option value="">Todas las condiciones</option>{options.data?.condiciones.map((item) => <option key={item.id_condicion_animal} value={item.codigo}>{item.nombre}{item.activo ? '' : ' · Inactiva'}</option>)}</Select></Field>
        <Field label="Clasificación"><Select value={filters.clasificacion} onChange={(event) => updateParam('clasificacion', event.target.value)}><option value="">Todas las clasificaciones</option>{classifications.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</Select></Field>
        <Field label="Propietario"><Select value={filters.id_propietario} onChange={(event) => updateParam('id_propietario', event.target.value)}><option value="">Todos los propietarios</option>{options.data?.propietarios.map((item) => <option key={item.id_usuario} value={item.id_usuario}>{item.nombre}</option>)}</Select></Field>
        <Field label="Ubicación"><Select value={filters.id_ubicacion} onChange={(event) => updateParam('id_ubicacion', event.target.value)}><option value="">Todas las ubicaciones</option>{options.data?.ubicaciones.filter((item) => !selectedCategoryId || item.id_categoria_animal === selectedCategoryId).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {item.tipo === 'OTRO' ? 'Otra propiedad' : humanizeCode(item.tipo)}</option>)}</Select></Field>
        <Field label="Especie"><Select value={filters.id_especie} onChange={(event) => updateSpecies(event.target.value)}><option value="">Todas las especies</option>{options.data?.especies.map((item) => <option key={item.id_especie} value={item.id_especie}>{item.nombre}</option>)}</Select></Field>
        <Field label="Raza"><Select value={filters.id_raza} onChange={(event) => updateParam('id_raza', event.target.value)}><option value="">Todas las razas</option>{visibleRaces.map((item) => <option key={item.id_raza} value={item.id_raza}>{item.nombre}</option>)}</Select></Field>
        <Field label="Color"><Select value={filters.id_color} onChange={(event) => updateParam('id_color', event.target.value)}><option value="">Todos los colores</option>{options.data?.colores.map((item) => <option key={item.id_color} value={item.id_color}>{item.nombre}</option>)}</Select></Field>
        <Field label="Fierro"><Select value={filters.id_marquilla} onChange={(event) => updateParam('id_marquilla', event.target.value)}><option value="">Todos los fierros</option>{options.data?.marquillas.map((item) => <option key={item.id_marquilla} value={item.id_marquilla}>{item.nombre} · {item.codigo}</option>)}</Select></Field>
        <Field label="Nacimiento desde"><Input type="date" value={filters.nacimiento_desde} max={filters.nacimiento_hasta || undefined} onChange={(event) => updateParam('nacimiento_desde', event.target.value)} /></Field>
        <Field label="Nacimiento hasta"><Input type="date" value={filters.nacimiento_hasta} min={filters.nacimiento_desde || undefined} onChange={(event) => updateParam('nacimiento_hasta', event.target.value)} /></Field>
      </div>
      <div className="advanced-filters-footer"><span>{activeFilterCount ? `${activeFilterCount} filtro${activeFilterCount === 1 ? '' : 's'} activo${activeFilterCount === 1 ? '' : 's'}` : 'Sin filtros aplicados'}</span></div>
    </section> : null}

    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.data.length === 0 ? <EmptyState icon={Beef} title="No hay animales" description="Registra el primer animal o modifica los filtros de búsqueda." action={hasPermission('ANIMAL_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar animal</Button> : undefined} /> : <>
      <div className="animal-list animal-compact-list" role="list" aria-label="Listado de animales">
        {query.data?.data.map((animal) => {const pending=Boolean((animal as Animal&{__offline?:boolean;__sync_state?:string}).__offline||(animal as Animal&{__sync_state?:string}).__sync_state==='PENDING');return <button type="button" className="animal-list-row" role="row" key={animal.id_animal} onClick={() => navigate(`/animales/${animal.id_animal}`)}>
          <span className="animal-list-photo">{animal.foto_perfil ? <img src={animal.foto_perfil} alt="" /> : <Beef size={24} />}</span>
          <span className="animal-compact-content"><span className="animal-compact-heading"><strong>{animal.nombre}</strong><span className="record-status-with-sync"><Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{animal.condicion || humanizeCode(animal.estado)}</Badge>{pending?<span className="inline-sync-pending" title="Cambio pendiente de sincronizar"><CloudOff size={15}/></span>:null}</span></span>
          <small className="animal-compact-description">{animal.descripcion || 'Sin descripción'}</small>
          <span className="animal-compact-facts"><span>{humanizeCode(animal.clasificacion_codigo ?? 'SIN_CLASIFICAR')}</span><span>{animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'} · {animal.grupo || 'Sin grupo'}</span><span><MapPin size={14} />{animal.ubicacion || 'Sin ubicación'}</span></span>
          <span className="animal-compact-footer"><span><CalendarClock size={15} />{formatDate(animal.fecha_nacimiento)}</span><span><UserRound size={15} />{animal.propietario_principal || 'Sin propietario'}</span></span></span>
        </button>;})}
      </div>
    </>}
    <div className="animal-floating-actions">{hasPermission('ANIMAL_CREAR') ? <IconButton label="Agregar animal" onClick={() => setCreating(true)}><Plus size={23} /></IconButton> : null}<IconButton label="Asistencia de animales" onClick={() => navigate('/animales/asistencia')}><ClipboardCheck size={22} /></IconButton></div>
    {creating ? <AnimalFormModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); if (id) navigate(`/animales/${id}`); }} /> : null}
  </div>;
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, ChevronLeft, ChevronRight, MapPin, Plus, SlidersHorizontal, UserRound, Weight } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequestWithMeta } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, SearchBox, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { Animal } from '../../types/api';
import { formatNumber } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';

export function AnimalsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(search);
  const sexo = params.get('sexo') ?? '';
  const estado = params.get('estado') ?? '';
  const query = useQuery({
    queryKey: ['animals', page, debounced, sexo, estado],
    queryFn: () => {
      const queryParams = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) queryParams.set('q', debounced);
      if (sexo) queryParams.set('sexo', sexo);
      if (estado) queryParams.set('estado', estado);
      return apiRequestWithMeta<Animal[]>(`/animales?${queryParams}`);
    },
    placeholderData: (previous) => previous,
  });
  const total = Number(query.data?.meta?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / 20));
  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  };

  return <div>
    <PageHeader title="Animales" description="Listado general. Selecciona una fila para abrir el resumen actual del animal." action={hasPermission('ANIMAL_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Nuevo animal</Button> : undefined} />
    <div className="toolbar"><SearchBox value={search} onChange={(value) => { setSearch(value); updateParam('q', value); }} placeholder="Buscar por nombre o arete…" /><div className="toolbar-filters"><SlidersHorizontal size={18} /><Select value={sexo} onChange={(event) => updateParam('sexo', event.target.value)}><option value="">Todos los sexos</option><option value="HEMBRA">Hembras</option><option value="MACHO">Machos</option></Select><Select value={estado} onChange={(event) => updateParam('estado', event.target.value)}><option value="">Todos los estados</option>{['ACTIVO', 'INACTIVO', 'VENDIDO', 'TRASLADADO', 'DESAPARECIDO', 'MUERTO'].map((item) => <option key={item}>{item}</option>)}</Select></div></div>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.data.length === 0 ? <EmptyState icon={Beef} title="No hay animales" description="Registra el primer animal o modifica los filtros de búsqueda." action={hasPermission('ANIMAL_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar animal</Button> : undefined} /> : <>
      <div className="animal-list" role="table" aria-label="Listado de animales">
        <div className="animal-list-head" role="row"><span>Animal</span><span>Propietario</span><span>Clasificación</span><span>Corral o potrero</span><span>Peso</span><span>Estado</span></div>
        {query.data?.data.map((animal) => <button type="button" className="animal-list-row" role="row" key={animal.id_animal} onClick={() => navigate(`/animales/${animal.id_animal}`)}>
          <span className="animal-list-identity"><span className="animal-list-photo">{animal.foto_perfil ? <img src={animal.foto_perfil} alt="" /> : <Beef size={24} />}</span><span><strong>{animal.nombre}</strong><small>{animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Sin arete'}</small></span></span>
          <span className="animal-list-cell"><UserRound size={16} /><span>{animal.propietario_principal || 'Sin propietario'}</span></span>
          <span className="animal-list-cell"><span>{animal.especie}</span><small>{animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'} · {animal.grupo || 'Sin grupo'}</small></span>
          <span className="animal-list-cell"><MapPin size={16} /><span>{animal.ubicacion || 'Sin corral o potrero'}</span></span>
          <span className="animal-list-cell"><Weight size={16} /><span>{animal.ultimo_pesaje ? `${formatNumber(animal.ultimo_pesaje.peso_kg)} kg` : 'Sin pesaje'}</span></span>
          <span><Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{animal.estado}</Badge></span>
        </button>)}
      </div>
      <div className="pagination"><span>{total} animales · página {page} de {pages}</span><div><Button variant="ghost" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}><ChevronLeft size={18} />Anterior</Button><Button variant="ghost" disabled={page >= pages} onClick={() => updateParam('page', String(page + 1))}>Siguiente<ChevronRight size={18} /></Button></div></div>
    </>}
    {creating ? <AnimalFormModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); if (id) navigate(`/animales/${id}`); }} /> : null}
  </div>;
}

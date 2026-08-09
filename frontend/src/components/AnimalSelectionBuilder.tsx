import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCheck, ListChecks, RefreshCw, Search, Users } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client';
import { useToast } from './ToastContext';
import { Badge, Button, Card, Field, Input, LoadingState, Select } from './ui';
import type { Group, SelectableAnimal, SelectionMode } from '../types/api';

export interface AnimalSelectionValue {
  mode: SelectionMode;
  groupId: string;
  animals: SelectableAnimal[];
}

interface Props {
  value: AnimalSelectionValue;
  onChange: (value: AnimalSelectionValue) => void;
  allowDose?: boolean;
  doseUnitId?: string;
  operationCode?: string | string[];
  excludeLocationId?: string;
  ownershipScope?: 'EN_PROPIEDAD' | 'FUERA_PROPIEDAD';
}

export function AnimalSelectionBuilder({ value, onChange, allowDose = false, doseUnitId, operationCode, excludeLocationId, ownershipScope }: Props) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const groups = useQuery({
    queryKey: ['groups', 'selection'],
    queryFn: () => apiRequest<Group[]>('/grupos?limit=100'),
  });
  const preview = useMutation({
    mutationFn: async () => {
      const response = await apiRequest<SelectableAnimal[]>('/selecciones/animales/preview', {
        method: 'POST',
        body: {
          modo: value.mode === 'SELECCION_MANUAL' ? 'TODOS' : value.mode,
          id_grupo: value.mode === 'GRUPO' ? value.groupId || null : null,
          ids: [],
          filtros: {
            excluir_id_ubicacion: excludeLocationId || undefined,
            situacion_propiedad: ownershipScope,
          },
          operaciones: operationCode ? (Array.isArray(operationCode) ? operationCode : [operationCode]) : [],
        },
      });
      return response.map((animal) => ({
        ...animal,
        seleccionado: value.mode === 'SELECCION_MANUAL' ? false : true,
        dosis_aplicada: null,
        id_unidad_dosis: doseUnitId || null,
        observaciones: null,
      }));
    },
    onSuccess: (animals) => onChange({ ...value, animals }),
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return value.animals;
    return value.animals.filter((item) => `${item.nombre} ${item.codigo_arete ?? ''} ${item.grupo ?? ''} ${item.ubicacion ?? ''}`.toLowerCase().includes(term));
  }, [search, value.animals]);

  const selectedCount = value.animals.filter((item) => item.seleccionado).length;
  const updateAnimal = (id: string, changes: Partial<SelectableAnimal>) => {
    onChange({ ...value, animals: value.animals.map((item) => item.id_animal === id ? { ...item, ...changes } : item) });
  };
  const setAll = (selected: boolean) => {
    onChange({ ...value, animals: value.animals.map((item) => ({ ...item, seleccionado: selected })) });
  };

  return <div className="selection-builder">
    <Card className="selection-config-card">
      <div className="selection-mode-grid">
        {([
          ['TODOS', 'Todos los animales', CheckCheck],
          ['GRUPO', 'Un grupo completo', Users],
          ['SELECCION_MANUAL', 'Selección manual', ListChecks],
        ] as const).map(([mode, label, Icon]) => (
          <button
            type="button"
            key={mode}
            className={`selection-mode ${value.mode === mode ? 'active' : ''}`}
            onClick={() => onChange({ mode, groupId: mode === 'GRUPO' ? value.groupId : '', animals: [] })}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="selection-config-row">
        {value.mode === 'GRUPO' ? <Field label="Grupo" required>
          <Select value={value.groupId} onChange={(event) => onChange({ ...value, groupId: event.target.value, animals: [] })}>
            <option value="">Selecciona un grupo</option>
            {groups.data?.filter((group) => {
              if (excludeLocationId && group.id_ubicacion_actual === excludeLocationId) return false;
              if (ownershipScope === 'EN_PROPIEDAD') return group.categoria_codigo === 'EN_PROPIEDAD';
              if (ownershipScope === 'FUERA_PROPIEDAD') return group.categoria_codigo !== 'EN_PROPIEDAD';
              return true;
            }).map((group) => <option value={group.id_grupo} key={group.id_grupo}>{group.nombre} · {group.categoria} · {group.ubicacion || 'Sin ubicación'} · {group.total_animales ?? 0} animales</option>)}
          </Select>
        </Field> : <div className="selection-mode-note">
          {value.mode === 'TODOS'
            ? 'Se cargarán todos los animales activos. Luego podrás desmarcar excepciones.'
            : 'Se cargará el listado completo sin marcar para que elijas uno o varios animales.'}
        </div>}
        <Button
          type="button"
          onClick={() => preview.mutate()}
          loading={preview.isPending}
          disabled={value.mode === 'GRUPO' && !value.groupId}
        >
          <RefreshCw size={17} />Cargar animales
        </Button>
      </div>
    </Card>

    {preview.isPending ? <LoadingState text="Cargando animales…" /> : null}
    {value.animals.length ? <Card className="selection-list-card">
      <div className="selection-toolbar">
        <div className="search-box selection-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, arete, grupo o ubicación" /></div>
        <div className="selection-actions">
          <Badge tone={selectedCount ? 'success' : 'warning'}>{selectedCount} de {value.animals.length} seleccionados</Badge>
          <Button type="button" variant="ghost" onClick={() => setAll(true)}>Marcar todos</Button>
          <Button type="button" variant="ghost" onClick={() => setAll(false)}>Desmarcar todos</Button>
        </div>
      </div>
      <div className="selection-table-wrap">
        <table className="data-table selection-table">
          <thead><tr><th>Incluir</th><th>Animal</th><th>Sexo</th><th>Grupo</th><th>Ubicación</th>{allowDose ? <th>Dosis individual</th> : null}</tr></thead>
          <tbody>{filtered.map((animal) => <tr key={animal.id_animal} className={animal.seleccionado ? 'selected-row' : ''}>
            <td><input type="checkbox" checked={animal.seleccionado} onChange={(event) => updateAnimal(animal.id_animal, { seleccionado: event.target.checked })} /></td>
            <td><strong>{animal.nombre}</strong><small>{animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Sin arete'}</small></td>
            <td>{animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'}</td>
            <td>{animal.grupo || 'Sin grupo'}</td>
            <td>{animal.ubicacion || 'Sin ubicación'}</td>
            {allowDose ? <td><Input type="number" min="0.0001" step="0.0001" disabled={!animal.seleccionado} value={animal.dosis_aplicada ?? ''} placeholder="Usar dosis general" onChange={(event) => updateAnimal(animal.id_animal, { dosis_aplicada: event.target.value ? Number(event.target.value) : null, id_unidad_dosis: doseUnitId || null })} /></td> : null}
          </tr>)}</tbody>
        </table>
      </div>
    </Card> : null}
  </div>;
}

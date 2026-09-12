import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, Check, Search } from 'lucide-react';
import { apiRequestAllPages } from '../api/client';
import type { Animal } from '../types/api';
import { Button, EmptyState, LoadingState, Modal, SearchBox } from './ui';

export interface AnimalPickerOption {
  id: string;
  name: string;
  subtitle?: string | null;
  photoUrl?: string | null;
}

export function useAnimalDirectory(enabled = true) {
  const query = useQuery({
    queryKey: ['animals', 'directory-all'],
    queryFn: () => apiRequestAllPages<Animal>('/animales?limit=100', 100),
    enabled,
    staleTime: 5 * 60_000,
  });
  const animals = query.data?.data ?? [];
  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id_animal, animal])), [animals]);
  return { ...query, animals, byId };
}

export function AnimalThumb({ photoUrl, name, size = 'normal' }: { photoUrl?: string | null; name: string; size?: 'small' | 'normal' }) {
  return <span className={`animal-thumb animal-thumb-${size}`} title={name} aria-hidden="true">{photoUrl ? <img src={photoUrl} alt="" /> : <Beef size={size === 'small' ? 15 : 19} />}</span>;
}

export function AnimalIdentity({ option, secondary }: { option: AnimalPickerOption; secondary?: string | null }) {
  return <span className="animal-identity-inline"><AnimalThumb photoUrl={option.photoUrl} name={option.name} /><span><strong>{option.name}</strong>{secondary || option.subtitle ? <small>{secondary || option.subtitle}</small> : null}</span></span>;
}

export function AnimalSelect({ value, options, onChange, placeholder = 'Selecciona un animal', emptyLabel, disabled = false }: {
  value: string;
  options: AnimalPickerOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((item) => item.id === value);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return term ? options.filter((item) => `${item.name} ${item.subtitle ?? ''}`.toLocaleLowerCase('es').includes(term)) : options;
  }, [options, search]);
  const choose = (id: string) => { onChange(id); setOpen(false); setSearch(''); };

  return <>
    <button type="button" className="animal-select-trigger" disabled={disabled} onClick={() => setOpen(true)}>
      {selected ? <AnimalIdentity option={selected} /> : <span className="animal-select-placeholder"><Search size={18} />{placeholder}</span>}
    </button>
    {open ? <Modal title="Seleccionar animal" wide onClose={() => setOpen(false)} footer={<Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>}>
      <div className="animal-select-dialog">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nombre, arete, grupo o ubicación…" />
        {emptyLabel ? <button type="button" className={!value ? 'animal-select-option selected' : 'animal-select-option'} onClick={() => choose('')}><span className="animal-select-empty"><Beef size={18} /><strong>{emptyLabel}</strong></span>{!value ? <Check size={18} /> : null}</button> : null}
        {!options.length ? <LoadingState text="Cargando animales…" /> : visible.length ? <div className="animal-select-options">{visible.map((item) => <button type="button" className={item.id === value ? 'animal-select-option selected' : 'animal-select-option'} key={item.id} onClick={() => choose(item.id)}><AnimalIdentity option={item} />{item.id === value ? <Check size={18} /> : null}</button>)}</div> : <EmptyState icon={Search} title="Sin coincidencias" description="Prueba con otro nombre, arete, grupo o ubicación." />}
      </div>
    </Modal> : null}
  </>;
}

export function animalOption(animal: Pick<Animal, 'id_animal' | 'nombre' | 'codigo_arete' | 'grupo' | 'ubicacion' | 'foto_perfil'>): AnimalPickerOption {
  return { id: animal.id_animal, name: animal.nombre, subtitle: [animal.codigo_arete ? `Arete ${animal.codigo_arete}` : null, animal.grupo || animal.ubicacion].filter(Boolean).join(' · '), photoUrl: animal.foto_perfil };
}

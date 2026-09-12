import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { apiRequestAllPages } from '../api/client';
import type { Animal } from '../types/api';
import { AnimalThumb } from './AnimalPicker';
import { Badge, LoadingState } from './ui';

export function AnimalMultiPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [search,setSearch]=useState('');
  const animals=useQuery({queryKey:['animals','multimedia-picker'],queryFn:()=>apiRequestAllPages<Animal>('/animales?limit=100',100)});
  const visible=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase('es');
    if(!term) return animals.data?.data??[];
    return (animals.data?.data??[]).filter((animal)=>`${animal.nombre} ${animal.codigo_arete??''} ${animal.grupo??''} ${animal.ubicacion??''}`.toLocaleLowerCase('es').includes(term));
  },[animals.data,search]);
  const toggle=(id:string,checked:boolean)=>onChange(checked?[...new Set([...value,id])]:value.filter((item)=>item!==id));
  return <div className="animal-multi-picker">
    <div className="selection-toolbar"><div className="search-box selection-search"><Search size={18}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar por nombre, arete, grupo o ubicación"/></div><Badge tone={value.length?'success':'warning'}>{value.length} relacionados</Badge></div>
    {animals.isLoading?<LoadingState text="Cargando animales…"/>:<div className="animal-multi-list">{visible.map((animal)=><label key={animal.id_animal} className={value.includes(animal.id_animal)?'selected':''}><input type="checkbox" checked={value.includes(animal.id_animal)} onChange={(event)=>toggle(animal.id_animal,event.target.checked)}/><AnimalThumb photoUrl={animal.foto_perfil} name={animal.nombre} size="small"/><span><strong>{animal.nombre}</strong><small>{animal.codigo_arete?`Arete ${animal.codigo_arete}`:'Sin arete'} · {animal.grupo||animal.ubicacion||'Sin ubicación'}</small></span></label>)}</div>}
  </div>;
}

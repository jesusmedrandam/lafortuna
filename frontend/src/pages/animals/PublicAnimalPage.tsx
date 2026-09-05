import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, CalendarDays, Download, FileImage, FileText, HeartPulse, Scale, Tag, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import type { PublicAnimal } from '../../types/api';
import { formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';
import { downloadAnimalFicha, type AnimalFichaData } from './animalFicha';

function fichaData(animal:PublicAnimal):AnimalFichaData{return{nombre:animal.nombre,codigoArete:animal.codigo_arete,descripcion:animal.descripcion,fotoPerfil:animal.foto_perfil,especie:animal.especie,sexo:animal.sexo,fechaNacimiento:animal.fecha_nacimiento,estado:animal.estado,origen:animal.origen,razas:animal.razas,colores:animal.colores,peso:animal.ultimo_pesaje,madre:animal.madre,padre:animal.padre,totalPartos:animal.total_partos,totalCrias:animal.total_crias,prenezConfirmada:animal.prenez_confirmada,marquilla:animal.marquilla_codigo};}

export function PublicAnimalPage(){
  const {token=''}=useParams();const [downloading,setDownloading]=useState<'png'|'pdf'|null>(null);
  const query=useQuery({queryKey:['public-animal',token],queryFn:()=>apiRequest<PublicAnimal>(`/publico/animales/${token}`,{auth:false}),enabled:Boolean(token),retry:false});
  const download=async(format:'png'|'pdf')=>{if(!query.data)return;setDownloading(format);try{await downloadAnimalFicha(fichaData(query.data),format);}finally{setDownloading(null);}};
  if(query.isLoading)return <div className="public-animal-state"><LoadingState text="Abriendo ficha del animal…"/></div>;
  if(query.isError)return <div className="public-animal-state"><ErrorState message={(query.error as Error).message}/></div>;
  const animal=query.data!;const breeds=animal.razas.map((item)=>`${item.nombre}${item.porcentaje!=null?` ${formatNumber(item.porcentaje)}%`:''}`).join(', ');
  return <main className="public-animal-page">
    <header className="public-animal-brand"><img src="/branding/logo-sgb-full.png" alt="SGB"/><span>Ficha pública verificada</span></header>
    <Card className="public-animal-card">
      <section className="public-animal-hero">{animal.foto_perfil?<img src={animal.foto_perfil} alt={animal.nombre}/>:<span><Beef size={70}/></span>}<div><Badge tone={animal.estado==='ACTIVO'?'success':'neutral'}>{humanizeCode(animal.estado)}</Badge><h1>{animal.nombre}</h1><p>{animal.codigo_arete?`Arete ${animal.codigo_arete}`:'Sin arete registrado'}</p></div></section>
      {animal.descripcion?<p className="public-animal-description">{animal.descripcion}</p>:null}
      <section className="public-animal-info">
        <PublicFact icon={Beef} label="Especie y sexo" value={`${animal.especie} · ${animal.sexo==='HEMBRA'?'Hembra':'Macho'}`}/>
        <PublicFact icon={CalendarDays} label="Nacimiento" value={animal.fecha_nacimiento?`${formatDate(animal.fecha_nacimiento)} · ${formatAge(animal.fecha_nacimiento)}`:'Sin registrar'}/>
        <PublicFact icon={Tag} label="Raza" value={breeds||'Sin registrar'}/>
        <PublicFact icon={Tag} label="Color" value={animal.colores.map((item)=>item.nombre).join(', ')||'Sin registrar'}/>
        <PublicFact icon={Scale} label="Último peso" value={animal.ultimo_pesaje?`${formatNumber(animal.ultimo_pesaje.peso_kg)} kg · ${formatDate(animal.ultimo_pesaje.fecha)}`:'Sin registrar'}/>
        <PublicFact icon={Users} label="Padres" value={[animal.madre?`Madre: ${animal.madre}`:null,animal.padre?`Padre: ${animal.padre}`:null].filter(Boolean).join(' · ')||'Sin registrar'}/>
        <PublicFact icon={HeartPulse} label="Resumen reproductivo" value={[animal.prenez_confirmada?'Preñez confirmada':null,`${animal.total_partos} parto${animal.total_partos===1?'':'s'}`,`${animal.total_crias} cría${animal.total_crias===1?'':'s'}`].filter(Boolean).join(' · ')}/>
      </section>
      <section className="public-animal-download"><div><Download size={20}/><span><strong>Descargar ficha</strong><small>Guarda esta información para verla o compartirla.</small></span></div><div><Button variant="secondary" loading={downloading==='png'} disabled={Boolean(downloading)} onClick={()=>void download('png')}><FileImage size={17}/>PNG</Button><Button loading={downloading==='pdf'} disabled={Boolean(downloading)} onClick={()=>void download('pdf')}><FileText size={17}/>PDF</Button></div></section>
    </Card>
    <footer>La ficha fue compartida desde SGB. No incluye información interna de la finca.</footer>
  </main>;
}

function PublicFact({icon:Icon,label,value}:{icon:typeof Beef;label:string;value:string}){return <div><Icon size={20}/><span><small>{label}</small><strong>{value}</strong></span></div>;}

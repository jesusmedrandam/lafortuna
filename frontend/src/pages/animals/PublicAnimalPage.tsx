import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beef, CalendarDays, ChevronLeft, ChevronRight, Download, FileImage, FileText, HeartPulse, Images, Maximize2, Scale, Tag, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { ImageLightbox } from '../../components/ImageLightbox';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import type { PublicAnimal } from '../../types/api';
import { formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';
import { downloadAnimalFicha, type AnimalFichaData } from './animalFicha';

function fichaData(animal:PublicAnimal):AnimalFichaData{return{nombre:animal.nombre,codigoArete:animal.codigo_arete,descripcion:animal.descripcion,fotoPerfil:animal.foto_perfil,fotoPortada:(animal.fotos_portada??[])[0]?.secure_url??null,especie:animal.especie,sexo:animal.sexo,fechaNacimiento:animal.fecha_nacimiento,estado:animal.estado,origen:animal.origen,razas:animal.razas,colores:animal.colores,peso:animal.ultimo_pesaje,madre:animal.madre,padre:animal.padre,totalPartos:animal.total_partos,totalCrias:animal.total_crias,prenezConfirmada:animal.prenez_confirmada,marquilla:animal.marquilla_codigo,generatedBy:animal.compartido_por};}

export function PublicAnimalPage(){
  const {token=''}=useParams();const [downloading,setDownloading]=useState<'png'|'pdf'|null>(null);const [coverIndex,setCoverIndex]=useState(0);const [viewerIndex,setViewerIndex]=useState<number|null>(null);
  const query=useQuery({queryKey:['public-animal',token],queryFn:()=>apiRequest<PublicAnimal>(`/publico/animales/${token}`,{auth:false}),enabled:Boolean(token),retry:false});
  const download=async(format:'png'|'pdf')=>{if(!query.data)return;setDownloading(format);try{await downloadAnimalFicha(fichaData(query.data),format);}finally{setDownloading(null);}};
  if(query.isLoading)return <div className="public-animal-state"><LoadingState text="Abriendo ficha del animal…"/></div>;
  if(query.isError)return <div className="public-animal-state"><ErrorState message={(query.error as Error).message}/></div>;
  const animal=query.data!;const coverPhotos=animal.fotos_portada??[];const currentCover=coverPhotos[coverIndex]??coverPhotos[0];const breeds=animal.razas.map((item)=>`${item.nombre}${item.porcentaje!=null?` ${formatNumber(item.porcentaje)}%`:''}`).join(', ');
  return <main className="public-animal-page">
    <header className="public-animal-brand"><img src="/branding/logo-sgb-full.png" alt="SGB"/><span>Ficha compartida por {animal.compartido_por}</span></header>
    <Card className="public-animal-card">
      <section className="public-animal-hero">
        {currentCover?<button type="button" className="public-animal-cover" onClick={()=>setViewerIndex(coverIndex)}><img src={currentCover.secure_url} alt={`Portada de ${animal.nombre}`}/><Maximize2 size={20}/></button>:<div className="public-animal-cover public-animal-cover-empty"><Beef size={72}/></div>}
        {coverPhotos.length>1?<div className="public-cover-controls"><button type="button" aria-label="Portada anterior" onClick={()=>setCoverIndex((value)=>(value-1+coverPhotos.length)%coverPhotos.length)}><ChevronLeft size={20}/></button><div>{coverPhotos.map((photo,index)=><button type="button" key={photo.id_imagen} className={index===coverIndex?'selected':''} onClick={()=>setCoverIndex(index)}><img src={photo.secure_url} alt=""/></button>)}</div><button type="button" aria-label="Portada siguiente" onClick={()=>setCoverIndex((value)=>(value+1)%coverPhotos.length)}><ChevronRight size={20}/></button></div>:null}
        <div className="public-animal-identity"><span className="public-animal-avatar">{animal.foto_perfil?<img src={animal.foto_perfil} alt={animal.nombre}/>:<Beef size={52}/>}</span><div><Badge tone={animal.estado==='ACTIVO'?'success':'neutral'}>{humanizeCode(animal.estado)}</Badge><h1>{animal.nombre}</h1><p>{animal.codigo_arete?`Arete ${animal.codigo_arete}`:'Sin arete registrado'}</p></div></div>
      </section>
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
      {coverPhotos.length?<section className="public-animal-gallery"><header><div><h2><Images size={21}/>Fotos de portada</h2><p>Fotografías compartidas de {animal.nombre}.</p></div><Badge tone="neutral">{coverPhotos.length}</Badge></header><div>{coverPhotos.map((photo,index)=><button type="button" key={photo.id_imagen} onClick={()=>setViewerIndex(index)}><img src={photo.secure_url} alt={photo.descripcion||`Foto de ${animal.nombre}`}/><span><small>{photo.fecha_toma?formatDate(photo.fecha_toma):'Sin fecha'}</small>{photo.descripcion?<strong>{photo.descripcion}</strong>:null}</span><Maximize2 size={18}/></button>)}</div></section>:null}
      <section className="public-animal-download"><div><Download size={20}/><span><strong>Descargar ficha</strong><small>Guarda esta información para verla o compartirla.</small></span></div><div><Button variant="secondary" loading={downloading==='png'} disabled={Boolean(downloading)} onClick={()=>void download('png')}><FileImage size={17}/>PNG</Button><Button loading={downloading==='pdf'} disabled={Boolean(downloading)} onClick={()=>void download('pdf')}><FileText size={17}/>PDF</Button></div></section>
    </Card>
    {viewerIndex!==null?<ImageLightbox items={coverPhotos.map((photo)=>({key:photo.id_imagen,url:photo.secure_url,type:'IMAGEN',title:`${animal.nombre} · Foto de portada`,subtitle:photo.descripcion,date:photo.fecha_toma}))} initialIndex={viewerIndex} onClose={()=>setViewerIndex(null)}/>:null}
    <footer>Ficha compartida por {animal.compartido_por} desde SGB.</footer>
  </main>;
}

function PublicFact({icon:Icon,label,value}:{icon:typeof Beef;label:string;value:string}){return <div><Icon size={20}/><span><small>{label}</small><strong>{value}</strong></span></div>;}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { IconButton } from './ui';
import { formatDate } from '../utils';

export interface LightboxMedia {
  key: string;
  url: string;
  type?: 'IMAGEN' | 'VIDEO';
  title: string;
  subtitle?: string | null;
  date?: string | null;
  filename?: string | null;
}

interface ImageLightboxProps {
  items: LightboxMedia[];
  initialIndex: number;
  onClose: () => void;
  actions?: (item: LightboxMedia) => ReactNode;
}

function safeFilename(item:LightboxMedia) {
  const extension=item.type==='VIDEO'?'mp4':'jpg';
  const base=(item.filename||item.title||'archivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
  return base.includes('.')?base:`${base||'archivo'}.${extension}`;
}

async function downloadMedia(item:LightboxMedia) {
  try {
    const response=await fetch(item.url);
    if(!response.ok)throw new Error('No se pudo descargar el archivo.');
    const objectUrl=URL.createObjectURL(await response.blob());
    const link=document.createElement('a');
    link.href=objectUrl;link.download=safeFilename(item);document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  } catch {
    const link=document.createElement('a');
    link.href=item.url;link.download=safeFilename(item);document.body.appendChild(link);link.click();link.remove();
  }
}

export function ImageLightbox({items,initialIndex,onClose,actions}:ImageLightboxProps) {
  const [index,setIndex]=useState(initialIndex);
  const touchStart=useRef<number|null>(null);
  const current=items[index];
  const previous=()=>setIndex((value)=>(value-1+items.length)%items.length);
  const next=()=>setIndex((value)=>(value+1)%items.length);

  useEffect(()=>setIndex(Math.min(Math.max(initialIndex,0),Math.max(items.length-1,0))),[initialIndex,items.length]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape')onClose();
      if(items.length>1&&event.key==='ArrowLeft')previous();
      if(items.length>1&&event.key==='ArrowRight')next();
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });

  if(!current)return null;
  return <div
    className="image-lightbox"
    role="dialog"
    aria-modal="true"
    onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}
    onTouchStart={(event)=>{touchStart.current=event.touches[0]?.clientX??null;}}
    onTouchEnd={(event)=>{
      if(touchStart.current===null)return;
      const delta=(event.changedTouches[0]?.clientX??touchStart.current)-touchStart.current;
      if(items.length>1&&delta>45)previous();
      if(items.length>1&&delta<-45)next();
      touchStart.current=null;
    }}
  >
    <IconButton className="lightbox-download" label="Descargar archivo" onClick={()=>void downloadMedia(current)}><Download size={22}/></IconButton>
    <IconButton className="lightbox-close" label="Cerrar visor" onClick={onClose}><X size={28}/></IconButton>
    {items.length>1?<>
      <IconButton className="lightbox-arrow lightbox-arrow-left" label="Archivo anterior" onClick={previous}><ChevronLeft size={34}/></IconButton>
      <IconButton className="lightbox-arrow lightbox-arrow-right" label="Archivo siguiente" onClick={next}><ChevronRight size={34}/></IconButton>
    </>:null}
    <div className="image-lightbox-content">
      {current.type==='VIDEO'?<video src={current.url} controls autoPlay/>:<img src={current.url} alt={current.title}/>} 
      <div className="image-lightbox-details">
        <div><strong>{current.title}</strong><small>{[current.subtitle,current.date?formatDate(current.date):null,items.length>1?`${index+1} de ${items.length}`:null].filter(Boolean).join(' · ')}</small></div>
        {actions?.(current)}
      </div>
    </div>
  </div>;
}

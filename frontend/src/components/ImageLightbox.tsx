import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { IconButton } from './ui';
import { formatDate } from '../utils';
import { optimizedCloudinaryMediaUrl } from '../media';

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
  minimalControls?: boolean;
}

function safeFilename(item:LightboxMedia) {
  const extension=item.type==='VIDEO'?'mp4':'jpg';
  const base=(item.filename||item.title||'archivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/\.[^.]+$/,'').replace(/^-+|-+$/g,'');
  return `${base||'archivo'}.${extension}`;
}

function attachmentUrl(item:LightboxMedia) {
  if(!item.url.includes('/upload/'))return item.url;
  const name=safeFilename(item).replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80)||'archivo';
  return item.url.replace('/upload/',`/upload/fl_attachment:${name}/`);
}

async function downloadMedia(item:LightboxMedia) {
  const filename=safeFilename(item);
  const downloadUrl=optimizedCloudinaryMediaUrl(item.url,item.type??'IMAGEN','download');
  try {
    const response=await fetch(downloadUrl);
    if(!response.ok)throw new Error('No se pudo descargar el archivo.');
    const objectUrl=URL.createObjectURL(await response.blob());
    const link=document.createElement('a');
    link.href=objectUrl;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  } catch {
    const link=document.createElement('a');
    link.href=attachmentUrl({...item,url:downloadUrl});link.download=filename;document.body.appendChild(link);link.click();link.remove();
  }
}

export function ImageLightbox({items,initialIndex,onClose,actions,minimalControls=false}:ImageLightboxProps) {
  const [index,setIndex]=useState(initialIndex);
  const stageRef=useRef<HTMLDivElement|null>(null);
  const onCloseRef=useRef(onClose);
  const historyEntryActive=useRef(false);
  const historyMarker=useRef(`sgb-lightbox-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [view,setView]=useState({scale:1,x:0,y:0});
  const touchStart=useRef<{x:number;y:number;view:{scale:number;x:number;y:number}}|null>(null);
  const pinchStart=useRef<{distance:number;midX:number;midY:number;view:{scale:number;x:number;y:number}}|null>(null);
  const dragStart=useRef<{pointerId:number;x:number;y:number;view:{scale:number;x:number;y:number}}|null>(null);
  const current=items[index];
  const displayUrl=current?optimizedCloudinaryMediaUrl(current.url,current.type??'IMAGEN','display'):'';
  const previous=()=>setIndex((value)=>(value-1+items.length)%items.length);
  const next=()=>setIndex((value)=>(value+1)%items.length);

  const constrained=(candidate:{scale:number;x:number;y:number})=>{
    const scale=Math.min(5,Math.max(1,candidate.scale));
    if(scale<=1)return{scale:1,x:0,y:0};
    const stage=stageRef.current;
    if(!stage)return{scale,x:candidate.x,y:candidate.y};
    const maxX=Math.max(24,stage.clientWidth*(scale-1)/2);
    const maxY=Math.max(24,stage.clientHeight*(scale-1)/2);
    return{scale,x:Math.min(maxX,Math.max(-maxX,candidate.x)),y:Math.min(maxY,Math.max(-maxY,candidate.y))};
  };
  const zoomAt=(nextScale:number,clientX:number,clientY:number)=>setView((currentView)=>{
    const stage=stageRef.current;
    if(!stage)return constrained({...currentView,scale:nextScale});
    const rect=stage.getBoundingClientRect();
    const pointX=clientX-(rect.left+rect.width/2);const pointY=clientY-(rect.top+rect.height/2);
    const scale=Math.min(5,Math.max(1,nextScale));
    return constrained({scale,x:pointX-(pointX-currentView.x)*scale/currentView.scale,y:pointY-(pointY-currentView.y)*scale/currentView.scale});
  });

  useEffect(()=>setIndex(Math.min(Math.max(initialIndex,0),Math.max(items.length-1,0))),[initialIndex,items.length]);
  useEffect(()=>setView({scale:1,x:0,y:0}),[index]);
  useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
  useEffect(()=>{
    const marker=historyMarker.current;
    window.history.pushState({...window.history.state,sgbLightbox:marker},'',window.location.href);
    historyEntryActive.current=true;
    const onPopState=()=>{
      if(!historyEntryActive.current)return;
      historyEntryActive.current=false;
      onCloseRef.current();
    };
    window.addEventListener('popstate',onPopState);
    return()=>{
      window.removeEventListener('popstate',onPopState);
      if(historyEntryActive.current&&window.history.state?.sgbLightbox===marker){
        historyEntryActive.current=false;
        window.history.back();
      }
    };
  },[]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape')onClose();
      if(view.scale===1&&items.length>1&&event.key==='ArrowLeft')setIndex((value)=>(value-1+items.length)%items.length);
      if(view.scale===1&&items.length>1&&event.key==='ArrowRight')setIndex((value)=>(value+1)%items.length);
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[items.length,onClose,view.scale]);

  if(!current)return null;
  return <div
    className={`image-lightbox ${minimalControls?'lightbox-minimal-controls':''}`}
    role="dialog"
    aria-modal="true"
    onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}
    onTouchStart={(event)=>{
      if(current.type==='VIDEO')return;
      if(event.touches.length===2){
        const [first,second]=[event.touches[0],event.touches[1]];
        pinchStart.current={distance:Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY),midX:(first.clientX+second.clientX)/2,midY:(first.clientY+second.clientY)/2,view};
        touchStart.current=null;
      }else if(event.touches[0])touchStart.current={x:event.touches[0].clientX,y:event.touches[0].clientY,view};
    }}
    onTouchMove={(event)=>{
      if(current.type==='VIDEO')return;
      if(event.touches.length===2&&pinchStart.current){
        event.preventDefault();const [first,second]=[event.touches[0],event.touches[1]];const start=pinchStart.current;
        const distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);const scale=Math.min(5,Math.max(1,start.view.scale*distance/start.distance));
        const midX=(first.clientX+second.clientX)/2;const midY=(first.clientY+second.clientY)/2;const rect=stageRef.current?.getBoundingClientRect();
        const centerX=rect?rect.left+rect.width/2:0;const centerY=rect?rect.top+rect.height/2:0;
        setView(constrained({scale,x:midX-centerX-(start.midX-centerX-start.view.x)*scale/start.view.scale,y:midY-centerY-(start.midY-centerY-start.view.y)*scale/start.view.scale}));
      }else if(event.touches.length===1&&touchStart.current&&view.scale>1){
        event.preventDefault();const touch=event.touches[0];const start=touchStart.current;
        setView(constrained({...start.view,x:start.view.x+touch.clientX-start.x,y:start.view.y+touch.clientY-start.y}));
      }
    }}
    onTouchEnd={(event)=>{
      if(pinchStart.current){if(event.touches.length<2)pinchStart.current=null;if(event.touches.length===1)touchStart.current={x:event.touches[0].clientX,y:event.touches[0].clientY,view};return;}
      if(!touchStart.current)return;
      const delta=(event.changedTouches[0]?.clientX??touchStart.current.x)-touchStart.current.x;
      if(view.scale===1&&items.length>1&&delta>45)previous();
      if(view.scale===1&&items.length>1&&delta<-45)next();
      touchStart.current=null;
    }}
  >
    {!minimalControls?<IconButton className="lightbox-download" label="Descargar archivo" onClick={()=>void downloadMedia(current)}><Download size={22}/></IconButton>:null}
    {!minimalControls?<IconButton className="lightbox-close" label="Cerrar visor" onClick={onClose}><X size={28}/></IconButton>:null}
    {!minimalControls&&items.length>1&&view.scale===1?<><IconButton className="lightbox-arrow lightbox-arrow-left" label="Archivo anterior" onClick={previous}><ChevronLeft size={34}/></IconButton><IconButton className="lightbox-arrow lightbox-arrow-right" label="Archivo siguiente" onClick={next}><ChevronRight size={34}/></IconButton></>:null}
    <div className="image-lightbox-content">
      <div ref={stageRef} className={`lightbox-media-stage ${view.scale>1?'zoomed':''} ${dragStart.current?'dragging':''}`}
        onDoubleClick={(event)=>{if(current.type==='VIDEO')return;if(view.scale>1)setView({scale:1,x:0,y:0});else zoomAt(2.5,event.clientX,event.clientY);}}
        onWheel={(event)=>{if(current.type==='VIDEO')return;event.preventDefault();zoomAt(view.scale+(event.deltaY<0?.3:-.3),event.clientX,event.clientY);}}
        onPointerDown={(event)=>{if(current.type==='VIDEO'||event.pointerType!=='mouse'||view.scale<=1)return;event.currentTarget.setPointerCapture(event.pointerId);dragStart.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,view};}}
        onPointerMove={(event)=>{const start=dragStart.current;if(!start||start.pointerId!==event.pointerId)return;setView(constrained({...start.view,x:start.view.x+event.clientX-start.x,y:start.view.y+event.clientY-start.y}));}}
        onPointerUp={(event)=>{if(dragStart.current?.pointerId===event.pointerId){dragStart.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}}}
        onPointerCancel={()=>{dragStart.current=null;}}>
        {current.type==='VIDEO'?<video src={displayUrl} controls autoPlay/>:<img draggable={false} src={displayUrl} alt={current.title} style={{transform:`translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`}}/>}
        {minimalControls?<IconButton className="lightbox-download-overlay" label="Descargar archivo" onClick={(event)=>{event.stopPropagation();void downloadMedia(current);}}><Download size={22}/></IconButton>:null}
      </div>
      <div className="image-lightbox-details">
        <div><strong>{current.title}</strong><small>{[current.subtitle,current.date?formatDate(current.date):null,items.length>1?`${index+1} de ${items.length}`:null].filter(Boolean).join(' · ')}</small></div>
        {!minimalControls?actions?.(current):null}
      </div>
    </div>
  </div>;
}

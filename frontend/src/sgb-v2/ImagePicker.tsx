import {useEffect,useRef,useState} from 'react';
import {Camera,Trash2} from 'lucide-react';
import {IconButton} from '../components/ui';

export function ImagePicker({name,label,file,onChange,disabled=false,required=false,
  accept='image/jpeg,image/png,image/webp,image/heic'}:{name?:string;label:string;file?:File|null;
  onChange?:(file:File|null)=>void;disabled?:boolean;required?:boolean;accept?:string}){
  const input=useRef<HTMLInputElement>(null);const [local,setLocal]=useState<File|null>(null);
  const selected=file===undefined?local:file;const [url,setUrl]=useState('');
  useEffect(()=>{if(!selected){setUrl('');if(input.current)input.current.value='';return;}
    const next=URL.createObjectURL(selected);setUrl(next);return()=>URL.revokeObjectURL(next);},[selected]);
  useEffect(()=>{const form=input.current?.form;const reset=()=>{setLocal(null);onChange?.(null);};
    form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);},[onChange]);
  const change=(value:File|null)=>{setLocal(value);onChange?.(value);};
  return <div className="birth-profile-photo-picker"><strong>{label}</strong>
    <input ref={input} type="file" name={name} aria-label={label} accept={accept} disabled={disabled} required={required}
      style={{position:'absolute',width:1,height:1,opacity:0,pointerEvents:'none'}} tabIndex={-1}
      onChange={event=>change(event.target.files?.[0]??null)}/>
    <button type="button" disabled={disabled} className={`birth-profile-preview${url?' has-photo':''}`}
      aria-label={`Seleccionar ${label.toLowerCase()}`} onClick={()=>input.current?.click()}>
      {url?<img src={url} alt={`Vista previa: ${label}`}/>:<span><Camera size={26}/><strong>Seleccionar foto</strong></span>}</button>
    {selected&&<IconButton type="button" disabled={disabled} label={`Quitar ${label.toLowerCase()}`}
      onClick={()=>{if(input.current)input.current.value='';change(null);}}><Trash2 size={16}/></IconButton>}
  </div>;
}

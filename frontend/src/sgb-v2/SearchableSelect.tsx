import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Beef,Check,ChevronDown,Search,X} from 'lucide-react';
import {createPortal} from 'react-dom';

export interface SearchableSelectOption {
  value:string;
  label:string;
  description?:string|null;
  keywords?:string|null;
  imageUrl?:string|null;
  disabled?:boolean;
}

export function SearchableSelect({value,onChange,options,placeholder='Selecciona',title='Seleccionar opción',
  searchPlaceholder='Buscar…',emptyOptionLabel,emptyMessage='No hay opciones disponibles.',disabled=false,
  ariaLabel}:{
  value:string;onChange:(value:string)=>void;options:SearchableSelectOption[];
  placeholder?:string;title?:string;searchPlaceholder?:string;emptyOptionLabel?:string;
  emptyMessage?:string;disabled?:boolean;ariaLabel?:string;
}){
  const [open,setOpen]=useState(false);const [search,setSearch]=useState('');
  const searchRef=useRef<HTMLInputElement>(null);const titleId=useId();
  const selected=options.find(option=>option.value===value);
  const visible=useMemo(()=>{const term=search.trim().toLocaleLowerCase('es');
    if(!term)return options;
    return options.filter(option=>`${option.label} ${option.description??''} ${option.keywords??''}`
      .toLocaleLowerCase('es').includes(term));
  },[options,search]);
  useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';window.setTimeout(()=>searchRef.current?.focus(),0);
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    window.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;
      window.removeEventListener('keydown',key);};},[open]);
  function choose(next:string){onChange(next);setOpen(false);setSearch('');}
  const selectedText=selected?.label||(value===''&&emptyOptionLabel)||placeholder;
  const close=()=>{setOpen(false);setSearch('');};
  return <>
    <button type="button" className={`v2-search-select-trigger${selected||value===''&&emptyOptionLabel?' has-value':''}`}
      disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
      onClick={()=>setOpen(true)}>
      {selected&&'imageUrl' in selected?<span className="v2-search-select-selected-image">
        {selected.imageUrl?<img src={selected.imageUrl} alt=""/>:<Beef size={18}/>}</span>:null}
      <span><strong>{selectedText}</strong>{selected?.description&&<small>{selected.description}</small>}</span>
      <ChevronDown size={19}/>
    </button>
    {open&&createPortal(<div className="v2-search-select-backdrop" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
      <section className="v2-search-select-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Cerrar selector"
          onClick={close}><X size={21}/></button></header>
        <label className="v2-search-select-search"><Search size={18}/><input ref={searchRef} type="search"
          value={search} onChange={event=>setSearch(event.target.value)} placeholder={searchPlaceholder}/></label>
        <div className="v2-search-select-options" role="listbox">
          {emptyOptionLabel&&<button type="button" role="option" aria-selected={value===''}
            className={value===''?'selected':''} onClick={()=>choose('')}>
            <span><strong>{emptyOptionLabel}</strong></span>{value===''&&<Check size={19}/>}</button>}
          {visible.map(option=><button type="button" role="option" aria-selected={option.value===value}
            disabled={option.disabled} className={option.value===value?'selected':''} key={option.value}
            onClick={()=>choose(option.value)}>{'imageUrl' in option?<span className="v2-search-select-option-image">
              {option.imageUrl?<img src={option.imageUrl} alt=""/>:<Beef size={18}/>}</span>:null}<span><strong>{option.label}</strong>
              {option.description&&<small>{option.description}</small>}</span>
              {option.value===value&&<Check size={19}/>}</button>)}
          {!visible.length&&!emptyOptionLabel&&<p>{search?'No hay coincidencias.':emptyMessage}</p>}
        </div>
        <footer><button type="button" onClick={close}>Cerrar</button></footer>
      </section>
    </div>,document.body)}
  </>;
}

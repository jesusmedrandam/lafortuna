import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Modal,Select} from '../components/ui';
import {createCleaningProduct,getCleaningProducts,updateCleaningProduct,type CatalogItem,type CleaningProduct} from './api';

export function CleaningProductCatalog({accessToken,canManage,canEdit=false,catalog=false,categories}:{
  accessToken:string;canManage:boolean;canEdit?:boolean;catalog?:boolean;categories:CatalogItem[]}){
  const [items,setItems]=useState<CleaningProduct[]|null>(null);const [search,setSearch]=useState('');
  const [params,setParams]=useSearchParams();const navigate=useNavigate();
  const [draft,setDraft]=useState<CleaningProduct|null>(null);const [busy,setBusy]=useState(false);const saving=useRef(false);
  const [error,setError]=useState('');const id=params.get('producto');const selected=items?.find(item=>item.id===id);
  const creating=id==='nuevo';
  const open=(value:string)=>{setDraft(null);setError('');const next=new URLSearchParams(params);next.set('producto',value);setParams(next);};
  const close=()=>{if(!saving.current){setDraft(null);setError('');navigate(-1);}};
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;
    const load=()=>void getCleaningProducts(accessToken,catalog).then(rows=>{if(active)setItems(rows);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar los productos.');});
    const changed=(event:Event)=>{const path=(event as CustomEvent<{path?:string}>).detail?.path;
      if(path&&!path.startsWith('/cleanings/products')&&!path.startsWith('/catalogs/products'))return;
      clearTimeout(timer);timer=setTimeout(load,120);};
    load();window.addEventListener('sgb-v2-cache-updated',changed);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener('sgb-v2-cache-updated',changed);};},[accessToken,catalog]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving.current)return;
    const data=new FormData(event.currentTarget);saving.current=true;setBusy(true);setError('');
    const input={name:String(data.get('name')).trim(),category:String(data.get('category')).trim()||null,
      activeIngredient:String(data.get('activeIngredient')).trim()||null,formulatedBy:String(data.get('formulatedBy')).trim()||null,
      description:String(data.get('description')).trim()||null};
    try{const saved=draft?await updateCleaningProduct(accessToken,draft.id,{...input,active:data.get('active')==='on',expectedVersion:draft.version!},catalog):
        await createCleaningProduct(accessToken,input,catalog);
      setItems(rows=>[saved,...rows?.filter(item=>item.id!==saved.id)??[]]);setDraft(null);
      if(creating)navigate(-1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar el producto.');}
    finally{saving.current=false;setBusy(false);}
  }
  const visible=items?.filter(item=>[item.name,item.category,item.activeIngredient,item.formulatedBy].join(' ').toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase())).sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name,'es'));
  return <section className="catalog-workspace-card cleaning-product-catalog"><header><div><h3>Productos de limpieza</h3>
    <p className="muted">Compartidos entre las propiedades de esta cuenta.</p></div>
    {canManage&&<Button onClick={()=>open('nuevo')}>Nuevo producto</Button>}</header>
    {!selected&&!creating&&error&&<p className="form-error" role="alert">{error}</p>}
    <label className="catalog-search"><span className="sr-only">Buscar productos</span><input type="search" placeholder="Buscar producto, categoría o principio activo…"
      value={search} onChange={event=>setSearch(event.target.value)}/></label>
    {!items&&!error&&<p className="muted">Cargando productos…</p>}
    <div className="catalog-list">{visible?.map(item=><button className="catalog-detail-row" type="button" key={item.id} onClick={()=>open(item.id)}>
      <span><strong>{item.name}</strong><small>{item.category||'Sin categoría'} · {item.active?'Activo':'Inactivo'}</small></span><span aria-hidden="true">›</span></button>)}</div>
    {visible?.length===0&&<p className="muted">{search?'No hay productos con esa búsqueda.':'Sin productos registrados.'}</p>}
    {(creating&&canManage||selected)&&<Modal title={creating?'Nuevo producto':draft?'Editar producto':selected!.name} wide onClose={close}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {creating||draft&&canEdit?<form className="movement-form" onSubmit={event=>void save(event)} key={draft?.id??'nuevo'}>
        <fieldset className="movement-wide cleaning-product-fields" disabled={busy}>
          <label><span>Nombre *</span><input name="name" required minLength={2} maxLength={160} defaultValue={draft?.name}/></label>
          <label><span>Categoría</span><Select name="category" defaultValue={draft?.category??''}><option value="">Sin categoría</option>
            {categories.filter(item=>item.active||item.name===draft?.category).map(item=><option key={item.id} value={item.name}>{item.name}</option>)}
            {draft?.category&&!categories.some(item=>item.name===draft.category)&&<option value={draft.category}>{draft.category} (anterior)</option>}</Select></label>
          <label><span>Principio activo</span><textarea name="activeIngredient" maxLength={2000} defaultValue={draft?.activeIngredient??''}/></label>
          <label><span>Formulado por</span><input name="formulatedBy" maxLength={200} defaultValue={draft?.formulatedBy??''}/></label>
          <label><span>Descripción</span><textarea name="description" maxLength={2000} defaultValue={draft?.description??''}/></label>
          {draft&&<label className="checkbox"><input name="active" type="checkbox" defaultChecked={draft.active}/>Producto activo para nuevas aplicaciones</label>}
          <p className="muted">Las limpiezas guardadas conservan el nombre y las cantidades utilizadas.</p>
          <Button type="submit" loading={busy}>Guardar producto</Button>
          <Button variant="secondary" onClick={()=>draft?setDraft(null):close()}>Cancelar</Button>
        </fieldset>
      </form>:selected&&<><dl className="catalog-detail-grid">
        <div><dt>Origen</dt><dd>Esta cuenta</dd></div><div><dt>Estado</dt><dd>{selected.active?'Activo':'Inactivo'}</dd></div>
        <div><dt>Categoría</dt><dd>{selected.category||'Sin categoría'}</dd></div>
        <div><dt>Principio activo</dt><dd>{selected.activeIngredient||'Sin registrar'}</dd></div>
        <div><dt>Formulado por</dt><dd>{selected.formulatedBy||'Sin registrar'}</dd></div>
        <div><dt>Descripción</dt><dd>{selected.description||'Sin registrar'}</dd></div></dl>
        {canEdit&&selected.version!=null&&<Button onClick={()=>setDraft(selected)}>Editar producto</Button>}</>}
    </Modal>}
  </section>;
}

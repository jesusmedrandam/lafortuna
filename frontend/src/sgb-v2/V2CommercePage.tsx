import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Ban,ChevronRight,Plus,ShoppingCart,ShoppingBag,Trash2} from 'lucide-react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,Field,FloatingActionDock,
  IconButton,Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {formatDate} from '../utils';
import {cancelCommerce,createCommerce,getCommerce,getCommerceAnimals,listCatalogItems,
  createCatalogItem,type CatalogItem,type CommerceInput,type CommerceLine,type CommerceRecord} from './api';
import {useV2Session} from './V2Session';

type DraftLine={key:number;type:'ANIMAL'|'PRODUCT';animalId:string;productId:string;productName:string;
  quantity:string;unit:string;unitPrice:string;animalEffect:'KEEP_CURRENT_PROPERTY'|'EXIT_CURRENT_PROPERTY'};
let nextKey=1;
function freshLine():DraftLine{return {key:nextKey++,type:'PRODUCT',animalId:'',productId:'',productName:'',
  quantity:'1',unit:'UNIDAD',unitPrice:'',animalEffect:'KEEP_CURRENT_PROPERTY'};}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date());}
function money(value:number){return new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(value);}
function summary(line:CommerceLine){return line.animalName??`${line.quantity} ${line.unit} ${line.productName}`;}

export function V2CommercePage({kind}:{kind:'SALE'|'PURCHASE'}){
  const {session,hasPermission}=useV2Session();const token=session!.accessToken;const navigate=useNavigate();
  const [params]=useSearchParams();const initialAnimal=params.get('animal')??'';
  const [rows,setRows]=useState<CommerceRecord[]|null>(null);
  const [animals,setAnimals]=useState<Array<{id:string;name:string;earTagCode:string|null}>>([]);
  const [query,setQuery]=useState('');const [detail,setDetail]=useState<CommerceRecord|null>(null);
  const [open,setOpen]=useState(false);const [cancelling,setCancelling]=useState(false);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  const [draft,setDraft]=useState<DraftLine[]>([freshLine()]);
  const [buyers,setBuyers]=useState<CatalogItem[]>([]);const [products,setProducts]=useState<CatalogItem[]>([]);
  const [buyerId,setBuyerId]=useState('');
  const [newCatalog,setNewCatalog]=useState<'BUYERS'|'SALE_PRODUCTS'|null>(null);
  const [catalogLineKey,setCatalogLineKey]=useState<number|null>(null);
  const [newName,setNewName]=useState('');
  const canManage=hasPermission('COMMERCE_MANAGE');
  const canManageCatalogs=hasPermission('CATALOG_MANAGE');
  const openedFromProfile=useRef<string|null>(null);
  useEffect(()=>{if(!canManage||!initialAnimal||params.get('accion')!=='NUEVA'||
    openedFromProfile.current===initialAnimal||!animals.some(item=>item.id===initialAnimal))return;
    openedFromProfile.current=initialAnimal;start();
  },[animals,canManage,initialAnimal,params]);
  useEffect(()=>{let active=true;setRows(null);setError('');
    void getCommerce(token).then(data=>{if(active)setRows(data);}).catch(reason=>{
      if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar las operaciones.');});
    if(canManage)void getCommerceAnimals(token).then(data=>{if(active)setAnimals(data);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar los animales.');});
    if(kind==='SALE')void Promise.all([listCatalogItems(token,'BUYERS'),
      listCatalogItems(token,'SALE_PRODUCTS')]).then(([people,items])=>{
      if(active){setBuyers(people.filter(item=>item.active));setProducts(items.filter(item=>item.active));}
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar los catálogos.');});
    return()=>{active=false;};},[token,canManage,revision,kind]);
  const visible=useMemo(()=>rows?.filter(row=>row.kind===kind&&
    (!initialAnimal||row.lines.some(line=>line.animalId===initialAnimal))&&
    `${row.counterpartyName} ${row.destination??''} ${row.lines.map(summary).join(' ')}`
      .toLowerCase().includes(query.trim().toLowerCase()))??[],[rows,kind,query,initialAnimal]);
  function update(key:number,patch:Partial<DraftLine>){
    setDraft(lines=>lines.map(line=>line.key===key?{...line,...patch}:line));}
  function start(){setDraft([{...freshLine(),...(initialAnimal?{type:'ANIMAL' as const,
    animalId:initialAnimal,unit:'ANIMAL'}:{})}]);setBuyerId('');setError('');setOpen(true);}
  async function addCatalog(){if(!newCatalog||!newName.trim())return;
    setBusy(true);setError('');try{
      const item=await createCatalogItem(token,newCatalog,newName.trim());
      if(newCatalog==='BUYERS'){setBuyers(rows=>[...rows,item].sort((a,b)=>a.name.localeCompare(b.name)));
        setBuyerId(item.id);}
      else{setProducts(rows=>[...rows,item].sort((a,b)=>a.name.localeCompare(b.name)));
        setDraft(rows=>rows.map(line=>line.key===catalogLineKey?
          {...line,productId:item.id}:line));}
      setNewCatalog(null);setCatalogLineKey(null);setNewName('');
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo agregar la opción.');}
    finally{setBusy(false);}
  }
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    const lines:CommerceInput['lines']=draft.map(line=>line.type==='ANIMAL'?{
      animalId:line.animalId,quantity:1,unit:'ANIMAL',unitPrice:Number(line.unitPrice),
      ...(kind==='SALE'?{animalEffect:line.animalEffect}:{})}:{
      ...(kind==='SALE'?{productId:line.productId}:{productName:line.productName.trim()}),
      quantity:Number(line.quantity),unit:line.unit.trim(),
      unitPrice:Number(line.unitPrice)});
    const input:CommerceInput={kind,tradedOn:String(data.get('tradedOn')),
      ...(kind==='SALE'?{buyerId}:{counterpartyName:String(data.get('counterpartyName')).trim()}),
      counterpartyContact:String(data.get('counterpartyContact')??'').trim()||null,
      destination:String(data.get('destination')??'').trim()||null,
      notes:String(data.get('notes')??'').trim()||null,lines};
    if(lines.some(line=>line.animalId&&!animals.some(animal=>animal.id===line.animalId))){
      setError('Selecciona animales activos de esta propiedad.');return;}
    if(kind==='SALE'&&(!buyers.some(item=>item.id===buyerId)||draft.some(line=>
      line.type==='PRODUCT'&&!products.some(item=>item.id===line.productId)))){
      setError('Selecciona un comprador y productos de venta activos de tu cuenta.');return;}
    setBusy(true);setError('');try{await createCommerce(token,input);setOpen(false);
      setRevision(value=>value+1);}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.');}
    finally{setBusy(false);}
  }
  async function confirmCancel(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!detail)return;
    const reason=String(new FormData(event.currentTarget).get('reason')??'').trim();
    setBusy(true);setError('');try{await cancelCommerce(token,detail.id,reason);
      setCancelling(false);setDetail(null);setRevision(value=>value+1);
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo anular.');}
    finally{setBusy(false);}
  }
  const title=kind==='SALE'?'Ventas':'Compras';
  return <div className="module-no-header">
    <CompactToolbar search={query} onSearch={setQuery} placeholder={`Buscar ${title.toLowerCase()}…`}
      count={visible.length}/>
    {error&&!open&&!cancelling&&<div className="form-error admin-error" role="alert">{error}</div>}
    {rows===null&&!error?<LoadingState/>:rows===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<Card className="commerce-list">
      {visible.map(row=><button type="button" className="commerce-row" key={row.id}
        onClick={()=>setDetail(row)}><span className="commerce-main">
          <strong>{row.lines.map(summary).join(', ')}</strong>
          <small>{row.counterpartyName} · {formatDate(row.tradedOn)}</small></span>
          <span className="commerce-price"><strong>{money(row.total)}</strong>
            <Badge tone={row.status==='ACTIVE'?'success':'danger'}>
              {row.status==='ACTIVE'?'Registrada':'Anulada'}</Badge></span>
          <ChevronRight size={18}/></button>)}
    </Card>:<EmptyState icon={kind==='SALE'?ShoppingCart:ShoppingBag}
      title={`Sin ${title.toLowerCase()}`} description={rows.length?
        'No hay resultados para esta búsqueda.':'Registra una operación de la propiedad.'}/>}
    {detail&&!cancelling&&<Modal title={`Detalle de ${kind==='SALE'?'venta':'compra'}`}
      onClose={()=>setDetail(null)} footer={<><Button variant="ghost" onClick={()=>setDetail(null)}>Cerrar</Button>
        {canManage&&detail.status==='ACTIVE'&&<Button variant="secondary"
          onClick={()=>{setError('');setCancelling(true);}}><Ban size={16}/>Anular</Button>}</>}>
      <div className="record-detail"><div className="detail-grid">
        <div><small>{kind==='SALE'?'Comprador':'Vendedor'}</small><strong>{detail.counterpartyName}</strong></div>
        <div><small>Fecha</small><strong>{formatDate(detail.tradedOn)}</strong></div>
        <div><small>Total</small><strong>{money(detail.total)}</strong></div>
        <div><small>Contacto</small><strong>{detail.counterpartyContact??'Sin registrar'}</strong></div>
        <div><small>Destino</small><strong>{detail.destination??'Sin registrar'}</strong></div>
        <div><small>Registrado por</small><strong>{detail.registeredBy}</strong></div></div>
        <section><h3>Detalle</h3><div className="detail-lines">{detail.lines.map(line=><div key={line.id}>
          <span><strong>{summary(line)}</strong><small>{line.quantity} {line.unit} × {money(line.unitPrice)}
            {line.animalEffect==='EXIT_CURRENT_PROPERTY'?' · Salió de la propiedad':''}</small></span>
          <strong>{money(line.quantity*line.unitPrice)}</strong>
          {line.animalId&&<Button variant="ghost" onClick={()=>navigate(`/animales/${line.animalId}`)}>
            Ver animal</Button>}</div>)}</div></section>
        {detail.notes&&<section><h3>Observaciones</h3><p>{detail.notes}</p></section>}
        {detail.cancellationReason&&<p>Motivo de anulación: {detail.cancellationReason}</p>}
      </div></Modal>}
    {detail&&cancelling&&<Modal title="Anular operación" onClose={()=>setCancelling(false)}
      footer={<><Button variant="ghost" onClick={()=>setCancelling(false)}>Volver</Button>
        <Button type="submit" form="commerce-cancel" loading={busy}>Confirmar anulación</Button></>}>
      <form id="commerce-cancel" className="form-stack" onSubmit={event=>void confirmCancel(event)}>
        <p>Se conservará la operación y su historial. Si la venta sacó animales, se intentará revertir su salida.
          Después revisa y reasigna el grupo y la ubicación desde Movimientos.</p>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Motivo" required><Textarea name="reason" required minLength={3} maxLength={3000}/></Field>
      </form></Modal>}
    {open&&<Modal title={`Nueva ${kind==='SALE'?'venta':'compra'}`} wide
      onClose={()=>setOpen(false)} footer={<><Button variant="ghost" onClick={()=>setOpen(false)}>Cancelar</Button>
        <Button type="submit" form="commerce-form" loading={busy}>Guardar</Button></>}>
      <form id="commerce-form" className="form-stack" onSubmit={event=>void save(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <div className="form-grid"><Field label="Fecha" required><Input name="tradedOn" type="date"
          max={today()} defaultValue={today()} required/></Field>
          {kind==='SALE'?<Field label="Comprador" required><Select required value={buyerId}
            onChange={event=>setBuyerId(event.target.value)}><option value="">Selecciona un comprador</option>
            {buyers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            {canManageCatalogs&&<button type="button" className="v2-catalog-add"
              onClick={()=>{setNewCatalog('BUYERS');setNewName('');}}>+ Agregar comprador</button>}</Field>
            :<Field label="Vendedor" required><Input name="counterpartyName" required maxLength={180}/></Field>}
          <Field label="Contacto"><Input name="counterpartyContact" maxLength={180}/></Field>
          <Field label="Destino"><Input name="destination" maxLength={240}/></Field></div>
        <h3>Animales y productos</h3>
        {draft.map(line=><div key={line.key} className="form-section">
          <div className="form-grid"><Field label="Tipo"><Select value={line.type}
            onChange={event=>update(line.key,{type:event.target.value as DraftLine['type'],
              animalId:'',productId:'',productName:'',quantity:'1',unit:event.target.value==='ANIMAL'?'ANIMAL':'UNIDAD'})}>
              <option value="PRODUCT">Producto</option><option value="ANIMAL">Animal</option>
            </Select></Field>
            {line.type==='ANIMAL'?<Field label="Animal" required><Select required value={line.animalId}
              onChange={event=>update(line.key,{animalId:event.target.value})}>
              <option value="">Selecciona</option>{animals.map(animal=><option key={animal.id} value={animal.id}>
                {animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}</option>)}</Select></Field>
              :<Field label="Producto" required>{kind==='SALE'?<><Select required
                value={line.productId} onChange={event=>update(line.key,{productId:event.target.value})}>
                <option value="">Selecciona un producto</option>{products.map(item=><option key={item.id}
                  value={item.id}>{item.name}</option>)}</Select>
                {canManageCatalogs&&<button type="button" className="v2-catalog-add"
                  onClick={()=>{setCatalogLineKey(line.key);setNewCatalog('SALE_PRODUCTS');
                    setNewName('');}}>+ Agregar producto</button>}</>
                :<Input required maxLength={180} value={line.productName}
                  onChange={event=>update(line.key,{productName:event.target.value})}/>}</Field>}
            {line.type==='PRODUCT'&&<><Field label="Cantidad" required><Input type="number" min="0.001"
              step="0.001" required value={line.quantity} onChange={event=>update(line.key,{quantity:event.target.value})}/></Field>
              <Field label="Unidad" required><Input required maxLength={40} value={line.unit}
                onChange={event=>update(line.key,{unit:event.target.value})}/></Field></>}
            <Field label={line.type==='ANIMAL'?'Precio del animal (USD)':'Precio unitario (USD)'} required>
              <Input type="number" min="0" step="0.01" required value={line.unitPrice}
                onChange={event=>update(line.key,{unitPrice:event.target.value})}/></Field>
            {kind==='SALE'&&line.type==='ANIMAL'&&<Field label="Después de la venta">
              <Select value={line.animalEffect} onChange={event=>update(line.key,{
                animalEffect:event.target.value as DraftLine['animalEffect']})}>
                <option value="KEEP_CURRENT_PROPERTY">Permanece en la propiedad</option>
                <option value="EXIT_CURRENT_PROPERTY">Sale de la propiedad</option></Select></Field>}
          </div>{draft.length>1&&<Button variant="ghost" type="button" onClick={()=>setDraft(items=>
            items.filter(item=>item.key!==line.key))}><Trash2 size={16}/>Quitar</Button>}
        </div>)}
        {kind==='PURCHASE'&&draft.some(line=>line.type==='ANIMAL')&&
          <p className="muted">Primero registra el animal y asígnalo a su grupo; después selecciónalo aquí para asociar la compra.</p>}
        <Button variant="secondary" type="button" onClick={()=>setDraft(items=>[...items,freshLine()])}>
          <Plus size={16}/>Añadir producto o animal</Button>
        <strong>Total: {money(draft.reduce((sum,line)=>sum+(Number(line.quantity)||0)*
          (Number(line.unitPrice)||0),0))}</strong>
        <Field label="Observaciones"><Textarea name="notes" maxLength={3000} rows={3}/></Field>
      </form></Modal>}
    {newCatalog&&<Modal title={newCatalog==='BUYERS'?'Agregar comprador':'Agregar producto de venta'}
      onClose={()=>setNewCatalog(null)} footer={<><Button variant="ghost"
        onClick={()=>setNewCatalog(null)}>Cancelar</Button><Button type="button" loading={busy}
        onClick={()=>void addCatalog()}>Agregar a mi cuenta</Button></>}>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <Field label="Nombre" required><Input autoFocus minLength={2} maxLength={160} required
        value={newName} onChange={event=>setNewName(event.target.value)}/></Field>
      <p className="muted">Estará disponible en todas las propiedades de tu cuenta.</p>
    </Modal>}
    {canManage&&<FloatingActionDock><IconButton label={`Nueva ${kind==='SALE'?'venta':'compra'}`}
      onClick={start}><Plus size={23}/></IconButton></FloatingActionDock>}
  </div>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, BookOpen, Edit3, MapPinned, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { CatalogItem } from '../../types/api';

const catalogDefinitions = [
  ['compradores', 'Compradores'], ['productos-venta', 'Productos de venta'], ['unidades', 'Unidades de medida'],
  ['tipos-producto-compra', 'Tipos de producto de compra'], ['tipos-actividad', 'Tipos de actividad'], ['etiquetas-multimedia', 'Etiquetas de fotografías'],
  ['categorias-animales', 'Categorías de animales'], ['condiciones-animales', 'Condiciones del animal'], ['especies', 'Especies'], ['origenes', 'Orígenes'], ['colores', 'Colores'], ['razas', 'Razas'],
  ['tipos-grupo', 'Tipos de grupo'], ['pastos', 'Tipos de pasto'], ['usos-potrero', 'Usos de potrero'], ['tipos-corral', 'Tipos de corral'],
  ['motivos-movimiento', 'Motivos de movimiento'], ['tipos-limpieza', 'Tipos de limpieza'], ['categorias-agroquimicos', 'Categorías agroquímicas'], ['agroquimicos', 'Productos agroquímicos'],
  ['tipos-tratamiento', 'Tipos de tratamiento'], ['tipos-condicion-salud', 'Problemas de salud'], ['vias', 'Vías de administración'], ['medicamentos', 'Medicamentos'],
] as const;
const orderedCatalogDefinitions=[...catalogDefinitions].sort((left,right)=>left[1].localeCompare(right[1],'es',{sensitivity:'base'}));
type CatalogName = typeof catalogDefinitions[number][0];
const isCatalogName = (value: string | null): value is CatalogName => catalogDefinitions.some(([name]) => name === value);

type CatalogForm = Record<string, string | boolean | string[]> & { activo: boolean };
const emptyForm = (): CatalogForm => ({ codigo: '', nombre: '', descripcion: '', id_vias_administracion: [], activo: true });

export function CatalogsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalog, setCatalog] = useState<CatalogName>(() => { const requested = searchParams.get('catalog'); return isCatalogName(requested) ? requested : 'especies'; });
  const selectCatalog = (name: CatalogName) => { setCatalog(name); setSearchParams({ catalog: name }, { replace: true }); };
  const query = useCatalog(catalog);
  const species = useCatalog('especies');
  const categories = useCatalog('categorias-agroquimicos');
  const units = useCatalog('unidades');
  const administrationRoutes = useCatalog('vias');
  const treatmentTypes = useCatalog('tipos-tratamiento');
  const [open, setOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [descending, setDescending] = useState(false);
  const catalogTabs = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); setDetailItem(null); setEditingId(null); setForm(emptyForm()); }, [catalog]);
  useEffect(() => {
    catalogTabs.current?.querySelector<HTMLElement>('button.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [catalog]);
  const title = catalogDefinitions.find(([name]) => name === catalog)?.[1] ?? 'Catálogo';
  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (query.data ?? []).filter((item) => !term || `${itemLabel(item)} ${String(item.codigo ?? '')} ${String(item.descripcion ?? '')}`.toLocaleLowerCase('es').includes(term)).sort((a, b) => {
      const result = itemLabel(a).localeCompare(itemLabel(b), 'es', { sensitivity: 'base' });
      return descending ? -result : result;
    });
  }, [descending, query.data, search]);

  const fields = useMemo(() => {
    if (catalog === 'unidades') return ['codigo','nombre','simbolo','magnitud'];
    if (catalog === 'razas') return ['id_especie','codigo','nombre','descripcion'];
    if (catalog === 'tipos-grupo') return ['id_especie','codigo','nombre','descripcion'];
    if (catalog === 'tipos-limpieza') return ['codigo','nombre','requiere_productos','descripcion'];
    if (catalog === 'agroquimicos') return ['id_categoria_producto','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','instrucciones'];
    if (catalog === 'medicamentos') return ['id_tipo_tratamiento','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','dosis_sugerida','indicaciones','dias_retiro_leche','dias_retiro_carne'];
    if (catalog === 'productos-venta') return ['codigo','nombre','id_unidad_venta','id_unidad_complementaria','descripcion'];
    if (catalog === 'compradores') return ['codigo','nombre','contacto','destino','descripcion'];
    if (catalog === 'tipos-producto-compra') return ['codigo','nombre','es_animal','descripcion'];
    return ['codigo','nombre','descripcion'];
  }, [catalog]);

  const save = useMutation({
    mutationFn: () => {
      if(catalog==='medicamentos'&&!form.id_tipo_tratamiento)throw new Error('Selecciona el tipo de tratamiento del medicamento.');
      if(catalog==='medicamentos'&&(!Array.isArray(form.id_vias_administracion)||!form.id_vias_administracion.length))throw new Error('Selecciona al menos una vía de administración.');
      const body: Record<string, unknown> = { activo: form.activo };
      for (const field of fields) {
        const value = form[field];
        if (field === 'requiere_productos' || field === 'es_animal') body[field] = Boolean(value);
        else if (field.startsWith('dias_')) body[field] = value === '' || value == null ? null : Number(value);
        else body[field] = typeof value === 'string' && !value.trim() ? null : value;
      }
      if (catalog === 'medicamentos') body.id_vias_administracion = form.id_vias_administracion;
      return apiRequest(`/catalogos/${catalog}${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', body });
    },
    onSuccess: (data) => {
      const pending = Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).__offline);
      toast.show(pending ? 'Elemento guardado en este dispositivo; se sincronizará al recuperar conexión.' : editingId ? 'Elemento actualizado.' : 'Elemento creado.');
      setOpen(false); setEditingId(null); setForm(emptyForm());
      void client.invalidateQueries({ queryKey: ['catalog', catalog] });
      void query.refetch();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/catalogos/${catalog}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.show('Elemento desactivado.'); setDeleteId(null); void client.invalidateQueries({ queryKey: ['catalog', catalog] }); void query.refetch(); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const openEdit = (item: CatalogItem) => {
    const next = emptyForm();
    for (const field of fields) next[field] = field === 'requiere_productos' || field === 'es_animal' ? Boolean(item[field]) : String(item[field] ?? '');
    next.activo = item.activo !== false;
    next.es_sistema = Boolean(item.es_sistema);
    if (catalog === 'medicamentos') next.id_vias_administracion = Array.isArray(item.id_vias_administracion) ? item.id_vias_administracion.map(String) : [];
    setForm(next); setEditingId(itemId(item)); setOpen(true);
  };

  const displayValue = (item: CatalogItem, field: string) => {
    if (field === 'id_especie') return itemLabel(species.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'id_categoria_producto') return itemLabel(categories.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'id_tipo_tratamiento') return itemLabel(treatmentTypes.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: 'Sin clasificar' });
    if (field === 'id_unidad_predeterminada' || field === 'id_unidad_venta' || field === 'id_unidad_complementaria') return itemLabel(units.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'requiere_productos') return item[field] ? 'Sí' : 'No';
    if (field === 'es_animal') return item[field] ? 'Crea un animal' : 'Producto o insumo';
    return String(item[field] ?? '—');
  };
  const summaryFor=(item:CatalogItem):Array<{label:string;value:string}>=>{
    const present=(value:unknown)=>value!==null&&value!==undefined&&String(value).trim()!=='';
    const detail=(label:string,value:unknown)=>present(value)?[{label,value:String(value)}]:[];
    if(catalog==='medicamentos')return[{label:'Dosis sugerida',value:present(item.dosis_sugerida)?String(item.dosis_sugerida):'Sin dosis sugerida'}];
    if(catalog==='compradores')return[...detail('Contacto',item.contacto),...detail('Destino',item.destino)];
    if(catalog==='productos-venta')return detail('Unidad de venta',displayValue(item,'id_unidad_venta'));
    if(catalog==='unidades')return[...detail('Símbolo',item.simbolo),...detail('Magnitud',item.magnitud)];
    if(catalog==='razas'||catalog==='tipos-grupo')return detail('Especie',displayValue(item,'id_especie'));
    if(catalog==='tipos-limpieza')return detail('Usa productos',displayValue(item,'requiere_productos'));
    if(catalog==='agroquimicos')return[...detail('Categoría',displayValue(item,'id_categoria_producto')),...detail('Fabricante',item.fabricante)];
    if(catalog==='tipos-producto-compra')return detail('Tipo',displayValue(item,'es_animal'));
    return detail('Descripción',item.descripcion);
  };
  const fieldLabel=(field:string)=>({
    codigo:'Código',nombre:'Nombre',descripcion:'Descripción',simbolo:'Símbolo',magnitud:'Magnitud',
    id_especie:'Especie',requiere_productos:'Requiere productos',id_categoria_producto:'Categoría',
    nombre_comercial:'Nombre comercial',principio_activo:'Principio activo',fabricante:'Fabricante',
    id_unidad_predeterminada:'Unidad predeterminada',instrucciones:'Instrucciones',
    id_tipo_tratamiento:'Tipo de tratamiento',dosis_sugerida:'Dosis sugerida',indicaciones:'Indicaciones',
    dias_retiro_leche:'Retiro de leche (días)',dias_retiro_carne:'Retiro de carne (días)',
    id_unidad_venta:'Unidad de venta',id_unidad_complementaria:'Unidad complementaria',
    contacto:'Contacto',destino:'Destino',es_animal:'Tipo de compra',
  } as Record<string,string>)[field]??field.replace(/^id_/,'').replaceAll('_',' ');
  const detailsFor=(item:CatalogItem)=>{
    const details=fields.map((field)=>({label:fieldLabel(field),value:displayValue(item,field)}));
    if(catalog==='medicamentos'){
      const routeNames=Array.isArray(item.vias_administracion)
        ? item.vias_administracion.map((route)=>typeof route==='object'&&route!==null?String((route as Record<string,unknown>).nombre??''):'').filter(Boolean)
        : [];
      const resolvedRoutes=routeNames.length?routeNames:(Array.isArray(item.id_vias_administracion)?item.id_vias_administracion.map((routeId)=>itemLabel(administrationRoutes.data?.find((route)=>itemId(route)===String(routeId))??{nombre:'—'})):[]);
      details.splice(1,0,{label:'Vías de administración',value:resolvedRoutes.join(', ')||'—'});
    }
    return details;
  };

  return <div className="module-no-header">
    <CompactToolbar search={search} onSearch={setSearch} placeholder={`Buscar en ${title.toLowerCase()}…`} count={visibleItems.length} actions={<>{catalog === 'categorias-animales' && hasPermission('UBICACION_CONSULTAR') ? <IconButton label="Otras propiedades" onClick={() => navigate('/ubicaciones')}><MapPinned size={18}/></IconButton> : null}<IconButton label={descending ? 'Orden Z a A' : 'Orden A a Z'} onClick={() => setDescending((value) => !value)}><ArrowUpDown size={18}/></IconButton></>} below={<div ref={catalogTabs} className="compact-scroll-tabs catalog-scroll-tabs" aria-label="Catálogo visible">{orderedCatalogDefinitions.map(([name,label])=><button type="button" className={catalog===name?'active':''} aria-current={catalog===name?'page':undefined} onClick={()=>selectCatalog(name)} key={name}>{label}</button>)}</div>}/>
    <section className="catalog-content compact-catalog-content">
      {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : visibleItems.length ? <div className="catalog-summary-list">{visibleItems.map((item)=>{const summary=summaryFor(item);return <article className="catalog-summary-row" role="button" tabIndex={0} aria-label={`Ver detalles de ${itemLabel(item)}`} key={itemId(item)} onClick={()=>setDetailItem(item)} onKeyDown={(event)=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();setDetailItem(item);}}}><header><strong>{itemLabel(item)}</strong><Badge tone={item.activo!==false?'success':'neutral'}>{item.activo!==false?'Activo':'Inactivo'}</Badge></header>{summary.length?<dl>{summary.map((entry)=><div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>:null}{hasPermission('CATALOGO_ADMINISTRAR')?<footer><IconButton label={`Editar ${itemLabel(item)}`} onClick={(event)=>{event.stopPropagation();openEdit(item);}}><Edit3 size={16}/></IconButton>{catalog!=='condiciones-animales'||!item.es_sistema?<IconButton label={`Desactivar ${itemLabel(item)}`} onClick={(event)=>{event.stopPropagation();setDeleteId(itemId(item));}}><Trash2 size={16}/></IconButton>:null}</footer>:null}</article>;})}</div> : <EmptyState icon={BookOpen} title={`Sin elementos en ${title.toLowerCase()}`} description="Agrega el primer elemento para utilizarlo en los demás módulos." />}
    </section>

    {detailItem?<Modal title={`Detalle · ${title}`} onClose={()=>setDetailItem(null)} footer={<><Button variant="ghost" onClick={()=>setDetailItem(null)}>Cerrar</Button>{hasPermission('CATALOGO_ADMINISTRAR')?<Button variant="secondary" onClick={()=>{const item=detailItem;setDetailItem(null);openEdit(item);}}><Edit3 size={16}/>Editar</Button>:null}</>}><div className="record-detail catalog-item-detail"><div className="record-detail-heading"><div className="record-icon"><BookOpen size={22}/></div><div><h2>{itemLabel(detailItem)}</h2><p>{title}</p></div><Badge tone={detailItem.activo!==false?'success':'neutral'}>{detailItem.activo!==false?'Activo':'Inactivo'}</Badge></div><div className="detail-grid">{detailsFor(detailItem).map((detail)=><div key={detail.label}><small>{detail.label}</small><strong>{detail.value}</strong></div>)}</div></div></Modal>:null}

    {open ? <Modal title={editingId ? `Editar ${title}` : `Nuevo elemento · ${title}`} onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}><div className="form-stack">{catalog==='medicamentos'?<Field label="Vías de administración" required hint="Puedes seleccionar más de una."><div className="medication-route-selector">{administrationRoutes.data?.filter((item)=>item.activo!==false).map((item)=>{const id=itemId(item);const selected=Array.isArray(form.id_vias_administracion)&&form.id_vias_administracion.includes(id);return <label className={selected?'selected':''} key={id}><input type="checkbox" checked={selected} onChange={()=>setForm((current)=>{const values=Array.isArray(current.id_vias_administracion)?current.id_vias_administracion:[];return {...current,id_vias_administracion:selected?values.filter((value)=>value!==id):[...values,id]};})}/><span>{itemLabel(item)}</span></label>;})}</div></Field>:null}{fields.map((field) => {
      const label = field.replace(/^id_/, '').replaceAll('_', ' ');
      if (field === 'id_especie') return <Field key={field} label="Especie" required={catalog === 'razas'}><Select value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">Sin especie específica</option>{species.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>;
      if (field === 'id_categoria_producto') return <Field key={field} label="Categoría" required><Select value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">Selecciona</option>{categories.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>;
      if (field === 'id_tipo_tratamiento') return <Field key={field} label="Tipo de tratamiento" required><Select required value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">Selecciona</option>{treatmentTypes.data?.filter((item)=>item.activo!==false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>;
      if (field === 'id_unidad_predeterminada' || field === 'id_unidad_venta' || field === 'id_unidad_complementaria') { const complementary=field==='id_unidad_complementaria'; const saleUnit=field==='id_unidad_venta'; const medicationUnit=catalog==='medicamentos'&&field==='id_unidad_predeterminada'; return <Field key={field} label={complementary?'Unidad complementaria':saleUnit?'Unidad de venta':'Unidad predeterminada'} required={saleUnit||medicationUnit}><Select required={saleUnit||medicationUnit} value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">{saleUnit||medicationUnit?'Selecciona una unidad':complementary?'Sin campo complementario':'Sin unidad'}</option>{units.data?.filter((item) => item.activo !== false&&(!complementary||itemId(item)!==String(form.id_unidad_venta??''))).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select>{complementary?<small className="muted">Si la configuras, la venta pedirá también esta cantidad (por ejemplo, marquetas).</small>:null}</Field>; }
      if (field === 'requiere_productos') return <label key={field} className="checkbox"><input type="checkbox" checked={Boolean(form[field])} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.checked }))} />Requiere registrar productos aplicados</label>;
      if (field === 'es_animal') return <label key={field} className="checkbox"><input type="checkbox" checked={Boolean(form[field])} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.checked }))} />Esta compra crea un nuevo animal</label>;
      if (field === 'descripcion' || field === 'instrucciones' || field === 'dosis_sugerida' || field === 'indicaciones' || field === 'principio_activo') return <Field key={field} label={field==='dosis_sugerida'?'Dosis sugerida':label}><Textarea rows={field==='principio_activo'?4:undefined} value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
      return <Field key={field} label={label} required={['codigo','nombre','nombre_comercial'].includes(field)}><Input disabled={catalog === 'condiciones-animales' && Boolean(form.es_sistema) && field === 'codigo'} type={field.startsWith('dias_') ? 'number' : 'text'} min={field.startsWith('dias_') ? 0 : undefined} value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
    })}<label className="checkbox"><input type="checkbox" disabled={catalog === 'condiciones-animales' && Boolean(form.es_sistema)} checked={form.activo} onChange={(event) => setForm((current) => ({ ...current, activo: event.target.checked }))} />Activo</label></div></Modal> : null}
    {hasPermission('CATALOGO_ADMINISTRAR') ? <FloatingActionDock><IconButton label="Nuevo elemento" onClick={() => { setEditingId(null); setForm(emptyForm()); setOpen(true); }}><Plus size={22}/></IconButton></FloatingActionDock> : null}
    {deleteId ? <ConfirmDialog title="Desactivar elemento" message="El elemento quedará inactivo y se conservarán las relaciones históricas." onClose={() => setDeleteId(null)} onConfirm={() => remove.mutate(deleteId)} loading={remove.isPending} /> : null}
  </div>;
}

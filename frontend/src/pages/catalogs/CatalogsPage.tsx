import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Edit3, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
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
type CatalogName = typeof catalogDefinitions[number][0];
const isCatalogName = (value: string | null): value is CatalogName => catalogDefinitions.some(([name]) => name === value);

type CatalogForm = Record<string, string | boolean> & { activo: boolean };
const emptyForm = (): CatalogForm => ({ codigo: '', nombre: '', descripcion: '', activo: true });

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
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { setOpen(false); setEditingId(null); setForm(emptyForm()); }, [catalog]);
  const title = catalogDefinitions.find(([name]) => name === catalog)?.[1] ?? 'Catálogo';

  const fields = useMemo(() => {
    if (catalog === 'unidades') return ['codigo','nombre','simbolo','magnitud'];
    if (catalog === 'razas') return ['id_especie','codigo','nombre','descripcion'];
    if (catalog === 'tipos-grupo') return ['id_especie','codigo','nombre','descripcion'];
    if (catalog === 'tipos-limpieza') return ['codigo','nombre','requiere_productos','descripcion'];
    if (catalog === 'agroquimicos') return ['id_categoria_producto','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','instrucciones'];
    if (catalog === 'medicamentos') return ['nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','dias_retiro_leche','dias_retiro_carne'];
    if (catalog === 'productos-venta') return ['codigo','nombre','id_unidad_venta','descripcion'];
    if (catalog === 'compradores') return ['codigo','nombre','contacto','destino','descripcion'];
    if (catalog === 'tipos-producto-compra') return ['codigo','nombre','es_animal','descripcion'];
    return ['codigo','nombre','descripcion'];
  }, [catalog]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { activo: form.activo };
      for (const field of fields) {
        const value = form[field];
        if (field === 'requiere_productos' || field === 'es_animal') body[field] = Boolean(value);
        else if (field.startsWith('dias_')) body[field] = value === '' || value == null ? null : Number(value);
        else body[field] = typeof value === 'string' && !value.trim() ? null : value;
      }
      return apiRequest(`/catalogos/${catalog}${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => {
      localStorage.removeItem(`mm.catalog.${catalog}`);
      toast.show(editingId ? 'Elemento actualizado.' : 'Elemento creado.');
      setOpen(false); setEditingId(null); setForm(emptyForm());
      void client.invalidateQueries({ queryKey: ['catalog', catalog] });
      void query.refetch();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/catalogos/${catalog}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { localStorage.removeItem(`mm.catalog.${catalog}`); toast.show('Elemento desactivado.'); setDeleteId(null); void client.invalidateQueries({ queryKey: ['catalog', catalog] }); void query.refetch(); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const openEdit = (item: CatalogItem) => {
    const next = emptyForm();
    for (const field of fields) next[field] = field === 'requiere_productos' || field === 'es_animal' ? Boolean(item[field]) : String(item[field] ?? '');
    next.activo = item.activo !== false;
    next.es_sistema = Boolean(item.es_sistema);
    setForm(next); setEditingId(itemId(item)); setOpen(true);
  };

  const displayValue = (item: CatalogItem, field: string) => {
    if (field === 'id_especie') return itemLabel(species.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'id_categoria_producto') return itemLabel(categories.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'id_unidad_predeterminada' || field === 'id_unidad_venta') return itemLabel(units.data?.find((value) => itemId(value) === String(item[field])) ?? { nombre: '—' });
    if (field === 'requiere_productos') return item[field] ? 'Sí' : 'No';
    if (field === 'es_animal') return item[field] ? 'Crea un animal' : 'Producto o insumo';
    return String(item[field] ?? '—');
  };

  return <div>
    <PageHeader title="Catálogos" description="Administra las opciones utilizadas en formularios, potreros, sanidad, animales y ventas." action={hasPermission('CATALOGO_ADMINISTRAR') ? <Button onClick={() => { setEditingId(null); setForm(emptyForm()); setOpen(true); }}><Plus size={18} />Nuevo elemento</Button> : undefined} />
    <div className="catalog-layout">
      <aside className="catalog-menu">{catalogDefinitions.map(([name, label]) => <button key={name} className={catalog === name ? 'active' : ''} onClick={() => selectCatalog(name)}><BookOpen size={17} /><span>{label}</span></button>)}</aside>
      <section className="catalog-content">
        <div className="section-heading-inline catalog-heading"><div><h2>{title}</h2><p className="muted">{query.data?.length ?? 0} elementos registrados</p></div><div className="inline-actions">{catalog === 'categorias-animales' && hasPermission('UBICACION_CONSULTAR') ? <Button variant="ghost" onClick={() => navigate('/ubicaciones')}>Otras propiedades</Button> : null}{hasPermission('CATALOGO_ADMINISTRAR') ? <Button onClick={() => { setEditingId(null); setForm(emptyForm()); setOpen(true); }}><Plus size={17} />Agregar</Button> : null}</div></div>
        {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Nombre</th>{fields.filter((field) => !['nombre','nombre_comercial','descripcion','instrucciones'].includes(field)).slice(0, 3).map((field) => <th key={field}>{field.replace(/^id_/, '').replaceAll('_', ' ')}</th>)}<th>Estado</th>{hasPermission('CATALOGO_ADMINISTRAR') ? <th>Acciones</th> : null}</tr></thead><tbody>{query.data.map((item) => <tr key={itemId(item)}><td><strong>{itemLabel(item)}</strong><small>{String(item.descripcion ?? item.instrucciones ?? item.principio_activo ?? '')}</small></td>{fields.filter((field) => !['nombre','nombre_comercial','descripcion','instrucciones'].includes(field)).slice(0, 3).map((field) => <td key={field}>{displayValue(item, field)}</td>)}<td><Badge tone={item.activo !== false ? 'success' : 'neutral'}>{item.activo !== false ? 'Activo' : 'Inactivo'}</Badge></td>{hasPermission('CATALOGO_ADMINISTRAR') ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => openEdit(item)}><Edit3 size={16} /></Button>{catalog !== 'condiciones-animales' || !item.es_sistema ? <Button variant="ghost" onClick={() => setDeleteId(itemId(item))}><Trash2 size={16} /></Button> : null}</div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={BookOpen} title={`Sin elementos en ${title.toLowerCase()}`} description="Agrega el primer elemento para utilizarlo en los demás módulos." />}
      </section>
    </div>

    {open ? <Modal title={editingId ? `Editar ${title}` : `Nuevo elemento · ${title}`} onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}><div className="form-stack">{fields.map((field) => {
      const label = field.replace(/^id_/, '').replaceAll('_', ' ');
      if (field === 'id_especie') return <Field key={field} label="Especie" required={catalog === 'razas'}><Select value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">Sin especie específica</option>{species.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>;
      if (field === 'id_categoria_producto') return <Field key={field} label="Categoría" required><Select value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">Selecciona</option>{categories.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>;
      if (field === 'id_unidad_predeterminada' || field === 'id_unidad_venta') return <Field key={field} label={field === 'id_unidad_venta' ? 'Unidad de venta' : 'Unidad predeterminada'} required={field === 'id_unidad_venta'}><Select required={field === 'id_unidad_venta'} value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}><option value="">{field === 'id_unidad_venta' ? 'Selecciona una unidad' : 'Sin unidad'}</option>{units.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>;
      if (field === 'requiere_productos') return <label key={field} className="checkbox"><input type="checkbox" checked={Boolean(form[field])} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.checked }))} />Requiere registrar productos aplicados</label>;
      if (field === 'es_animal') return <label key={field} className="checkbox"><input type="checkbox" checked={Boolean(form[field])} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.checked }))} />Esta compra crea un nuevo animal</label>;
      if (field === 'descripcion' || field === 'instrucciones') return <Field key={field} label={label}><Textarea value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
      return <Field key={field} label={label} required={['codigo','nombre','nombre_comercial'].includes(field)}><Input disabled={catalog === 'condiciones-animales' && Boolean(form.es_sistema) && field === 'codigo'} type={field.startsWith('dias_') ? 'number' : 'text'} min={field.startsWith('dias_') ? 0 : undefined} value={String(form[field] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>;
    })}<label className="checkbox"><input type="checkbox" disabled={catalog === 'condiciones-animales' && Boolean(form.es_sistema)} checked={form.activo} onChange={(event) => setForm((current) => ({ ...current, activo: event.target.checked }))} />Activo</label></div></Modal> : null}
    {deleteId ? <ConfirmDialog title="Desactivar elemento" message="El elemento quedará inactivo y se conservarán las relaciones históricas." onClose={() => setDeleteId(null)} onConfirm={() => remove.mutate(deleteId)} loading={remove.isPending} /> : null}
  </div>;
}

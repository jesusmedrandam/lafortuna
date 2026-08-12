import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronRight, Edit3, Package, Plus, ShoppingCart, Trash2, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListToolbar, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { useListControls } from '../../hooks/useListControls';
import type { AnimalSale, CatalogItem, ProductSale } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, numberOrNull, nullIfEmpty } from '../../utils';

type SaleTab = 'ANIMALES' | 'PRODUCTOS';

function money(value: number | string | null, currency: string) {
  if (value === null || value === '') return 'Sin precio registrado';
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: currency || 'USD' }).format(Number(value));
}

export function SalesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [tab, setTab] = useState<SaleTab>('ANIMALES');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<AnimalSale | ProductSale | null>(null);
  const [editing, setEditing] = useState<AnimalSale | ProductSale | null>(null);
  const animalSales = useQuery({ queryKey: ['sales', 'animals'], queryFn: () => apiRequest<AnimalSale[]>('/ventas') });
  const productSales = useQuery({ queryKey: ['sales', 'products'], queryFn: () => apiRequest<ProductSale[]>('/ventas/productos') });
  const cancelSale = useMutation({
    mutationFn: ({ id, type }: { id: string; type: SaleTab }) => apiRequest(type === 'ANIMALES' ? `/ventas/${id}/anular` : `/ventas/productos/${id}/anular`, { method: 'PATCH' }),
    onSuccess: async (_data, variables) => {
      toast.show(variables.type === 'ANIMALES' ? 'Venta anulada y animales restaurados.' : 'Venta de productos anulada.');
      await client.invalidateQueries({ queryKey: ['sales'] });
      await client.invalidateQueries({ queryKey: ['animals'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  const current = tab === 'ANIMALES' ? animalSales : productSales;
  const animalList = useListControls({ items: animalSales.data ?? [], storageKey: 'sales-animals', searchText: (sale) => `${sale.comprador_nombre} ${sale.destino ?? ''} ${sale.animales.map((item) => `${item.animal} ${item.codigo_arete ?? ''}`).join(' ')}`, dateValue: (sale) => sale.fecha_venta, nameValue: (sale) => sale.comprador_nombre });
  const productList = useListControls({ items: productSales.data ?? [], storageKey: 'sales-products', searchText: (sale) => `${sale.comprador_nombre} ${sale.destino ?? ''} ${sale.productos.map((item) => item.producto).join(' ')}`, dateValue: (sale) => sale.fecha_venta, nameValue: (sale) => sale.comprador_nombre });
  const controls = tab === 'ANIMALES' ? animalList : productList;

  return <div>
    <PageHeader
      title="Ventas"
      description="Registra ventas de animales, leche, queso y otros productos del catálogo."
      action={hasPermission('VENTA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />{tab === 'ANIMALES' ? 'Vender animales' : 'Vender productos'}</Button> : undefined}
    />
    <div className="page-tabs"><button className={tab === 'ANIMALES' ? 'active' : ''} onClick={() => { setTab('ANIMALES'); setCreating(false); }}><Users size={17} />Animales</button><button className={tab === 'PRODUCTOS' ? 'active' : ''} onClick={() => { setTab('PRODUCTOS'); setCreating(false); }}><Package size={17} />Leche, queso y productos</button></div>
    <ListToolbar search={controls.search} onSearch={controls.setSearch} order={controls.order} onOrder={controls.setOrder} placeholder={tab === 'ANIMALES' ? 'Buscar comprador, animal o arete…' : 'Buscar comprador o producto…'} count={controls.visible.length} />
    {current.isLoading ? <LoadingState /> : current.isError ? <ErrorState message={(current.error as Error).message} onRetry={() => void current.refetch()} /> : tab === 'ANIMALES' ? <AnimalSalesList sales={animalList.visible} canAdmin={hasPermission('VENTA_ADMINISTRAR')} onCreate={() => setCreating(true)} onOpen={setDetail} onEdit={setEditing} onCancel={(id) => cancelSale.mutate({ id, type: 'ANIMALES' })} cancelling={cancelSale.isPending} /> : <ProductSalesList sales={productList.visible} canAdmin={hasPermission('VENTA_ADMINISTRAR')} onCreate={() => setCreating(true)} onOpen={setDetail} onEdit={setEditing} onCancel={(id) => cancelSale.mutate({ id, type: 'PRODUCTOS' })} cancelling={cancelSale.isPending} />}
    {creating && tab === 'ANIMALES' ? <AnimalSaleForm onClose={() => setCreating(false)} onSaved={() => setCreating(false)} /> : null}
    {creating && tab === 'PRODUCTOS' ? <ProductSaleForm onClose={() => setCreating(false)} onSaved={() => setCreating(false)} /> : null}
    {detail ? <SaleDetail sale={detail} onClose={() => setDetail(null)} onEdit={hasPermission('VENTA_ADMINISTRAR') && detail.estado === 'COMPLETADA' ? () => { setEditing(detail); setDetail(null); } : undefined} onCancel={hasPermission('VENTA_ADMINISTRAR') && detail.estado === 'COMPLETADA' ? () => cancelSale.mutate({ id: 'id_venta' in detail ? detail.id_venta : detail.id_venta_producto, type: 'id_venta' in detail ? 'ANIMALES' : 'PRODUCTOS' }) : undefined} cancelling={cancelSale.isPending} /> : null}
    {editing && 'id_venta' in editing ? <AnimalSaleEditForm sale={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
    {editing && 'id_venta_producto' in editing ? <ProductSaleForm sale={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
  </div>;
}

function AnimalSalesList({ sales, canAdmin, onCreate, onOpen, onEdit }: { sales: AnimalSale[]; canAdmin: boolean; onCreate: () => void; onOpen: (sale: AnimalSale) => void; onEdit: (sale: AnimalSale) => void; onCancel: (id: string) => void; cancelling: boolean }) {
  if (!sales.length) return <EmptyState icon={ShoppingCart} title="No hay ventas de animales" description="Todavía no se han registrado ventas de animales." action={canAdmin ? <Button onClick={onCreate}><Plus size={18} />Registrar venta</Button> : undefined} />;
  return <Card className="record-list sales-record-list"><div className="record-list-head"><span>Comprador</span><span>Fecha</span><span>Animales</span><span>Total</span><span>Estado</span><span /></div>{sales.map((sale) => <button type="button" className="record-list-row" key={sale.id_venta} onClick={() => onOpen(sale)}><span><strong>{sale.comprador_nombre}</strong><small>{sale.destino || 'Sin destino'}</small></span><span><strong>{formatDate(sale.fecha_venta)}</strong><small>{sale.registrado_por_nombre}</small></span><span><strong>{sale.animales.length} animal{sale.animales.length === 1 ? '' : 'es'}</strong><small>{sale.animales.slice(0, 2).map((item) => item.animal).join(', ')}</small></span><span><strong>{money(sale.precio_total, sale.moneda)}</strong></span><span><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></span><span className="record-row-actions">{canAdmin && sale.estado === 'COMPLETADA' ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); onEdit(sale); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card>;
}

function ProductSalesList({ sales, canAdmin, onCreate, onOpen, onEdit }: { sales: ProductSale[]; canAdmin: boolean; onCreate: () => void; onOpen: (sale: ProductSale) => void; onEdit: (sale: ProductSale) => void; onCancel: (id: string) => void; cancelling: boolean }) {
  if (!sales.length) return <EmptyState icon={Package} title="No hay ventas de productos" description="Registra la primera venta de leche, queso u otro producto del catálogo." action={canAdmin ? <Button onClick={onCreate}><Plus size={18} />Registrar venta</Button> : undefined} />;
  return <Card className="record-list sales-record-list"><div className="record-list-head"><span>Comprador</span><span>Fecha</span><span>Productos</span><span>Total</span><span>Estado</span><span /></div>{sales.map((sale) => <button type="button" className="record-list-row" key={sale.id_venta_producto} onClick={() => onOpen(sale)}><span><strong>{sale.comprador_nombre}</strong><small>{sale.destino || 'Sin destino'}</small></span><span><strong>{formatDate(sale.fecha_venta)}</strong><small>{sale.periodicidad === 'DIARIA' ? 'Diaria' : 'Semanal'}</small></span><span><strong>{sale.productos.length} producto{sale.productos.length === 1 ? '' : 's'}</strong><small>{sale.productos.slice(0, 2).map((item) => item.producto).join(', ')}</small></span><span><strong>{money(sale.precio_total, sale.moneda)}</strong></span><span><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></span><span className="record-row-actions">{canAdmin && sale.estado === 'COMPLETADA' ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); onEdit(sale); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card>;
}

function SaleDetail({ sale, onClose, onEdit, onCancel, cancelling }: { sale: AnimalSale | ProductSale; onClose: () => void; onEdit?: () => void; onCancel?: () => void; cancelling: boolean }) {
  const products = 'productos' in sale;
  return <Modal title="Detalle de la venta" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onCancel ? <Button variant="ghost" onClick={onCancel} loading={cancelling}><Ban size={17} />Anular</Button> : null}{onEdit ? <Button onClick={onEdit}><Edit3 size={17} />Editar venta</Button> : null}</>}>
    <div className="record-detail"><div className="record-detail-heading"><div className="record-icon">{products ? <Package size={22} /> : <Users size={22} />}</div><div><h2>{sale.comprador_nombre}</h2><p>{sale.destino || 'Destino no registrado'}</p></div><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></div>
      <div className="detail-grid"><div><small>Fecha</small><strong>{formatDate(sale.fecha_venta)}</strong></div><div><small>Total</small><strong>{money(sale.precio_total, sale.moneda)}</strong></div><div><small>Contacto</small><strong>{sale.comprador_contacto || 'Sin registrar'}</strong></div><div><small>Registrado por</small><strong>{sale.registrado_por_nombre}</strong></div></div>
      <section><h3>{products ? 'Productos vendidos' : 'Animales vendidos'}</h3><div className="detail-lines">{products ? sale.productos.map((item) => <div key={item.id_venta_producto_detalle}><span><strong>{item.producto}</strong><small>{item.cantidad} {item.unidad} × {money(item.precio_unitario, sale.moneda)}</small></span><strong>{money(item.subtotal, sale.moneda)}</strong></div>) : sale.animales.map((item) => <div key={item.id_venta_detalle}><span><strong>{item.animal}</strong><small>{item.codigo_arete ? `Arete ${item.codigo_arete}` : 'Sin arete'}</small></span><strong>{money(item.precio_individual, sale.moneda)}</strong></div>)}</div></section>
      {sale.observaciones ? <section><h3>Observaciones</h3><p>{sale.observaciones}</p></section> : null}
    </div>
  </Modal>;
}

function AnimalSaleEditForm({ sale, onClose, onSaved }: { sale: AnimalSale; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const client = useQueryClient(); const buyers = useCatalog('compradores');
  const [form, setForm] = useState({ fecha_venta: dateInputValue(sale.fecha_venta), id_comprador: sale.id_comprador ?? '', precio_total: sale.precio_total == null ? '' : String(sale.precio_total), observaciones: sale.observaciones ?? '' });
  const selectedBuyer = buyers.data?.find((item) => itemId(item) === form.id_comprador);
  const mutation = useMutation({ mutationFn: () => apiRequest(`/ventas/${sale.id_venta}`, { method: 'PATCH', body: { fecha_venta: form.fecha_venta, id_comprador: form.id_comprador, precio_total: numberOrNull(form.precio_total), moneda: sale.moneda, observaciones: nullIfEmpty(form.observaciones) } }), onSuccess: async () => { toast.show('Venta actualizada.'); await client.invalidateQueries({ queryKey: ['sales'] }); onSaved(); }, onError: (error) => toast.show((error as ApiError).message, 'error') });
  return <Modal title="Editar venta de animales" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending}>Guardar cambios</Button></>}><div className="form-stack"><div className="form-grid"><Field label="Fecha" required><Input type="date" value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field><Field label="Comprador" required><Select value={form.id_comprador} onChange={(event) => setForm({ ...form, id_comprador: event.target.value })}><option value="">Selecciona</option>{buyers.data?.filter((item) => item.activo !== false || itemId(item) === form.id_comprador).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Precio total"><Input type="number" min="0" step="0.01" value={form.precio_total} onChange={(event) => setForm({ ...form, precio_total: event.target.value })} /></Field></div><BuyerPreview buyer={selectedBuyer} /><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field><p className="muted">El destino se toma automáticamente del comprador. Los animales vendidos conservan su historial.</p></div></Modal>;
}

function BuyerPreview({ buyer }: { buyer?: CatalogItem }) {
  if (!buyer) return <div className="buyer-empty"><span>Primero registra el comprador en el catálogo.</span><Link className="button button-secondary" to="/catalogos?catalog=compradores">Registrar comprador</Link></div>;
  return <div className="buyer-preview"><span><small>Comprador seleccionado</small><strong>{itemLabel(buyer)}</strong></span><span><small>Contacto</small><strong>{String(buyer.contacto ?? 'Sin contacto')}</strong></span><span><small>Destino habitual</small><strong>{String(buyer.destino ?? 'Sin destino')}</strong></span></div>;
}

function productUnit(product: CatalogItem | undefined, units: CatalogItem[] | undefined) {
  if (!product) return '';
  const unit = units?.find((item) => itemId(item) === String(product.id_unidad_venta ?? ''));
  return String(unit?.simbolo ?? unit?.nombre ?? product.unidad ?? '');
}

function AnimalSaleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const client = useQueryClient(); const buyers = useCatalog('compradores');
  const [selection, setSelection] = useState<AnimalSelectionValue>({ mode: 'SELECCION_MANUAL', groupId: '', animals: [] });
  const [form, setForm] = useState({ fecha_venta: currentDateInput(), id_comprador: '', precio_total: '', observaciones: '' });
  const selectedBuyer = buyers.data?.find((item) => itemId(item) === form.id_comprador);
  const selectBuyer = (id: string) => setForm((current) => ({ ...current, id_comprador: id }));
  const mutation = useMutation({ mutationFn: () => { const selected = selection.animals.filter((animal) => animal.seleccionado); if (!form.id_comprador) throw new ApiError(400, 'NO_BUYER', 'Selecciona un comprador.'); if (!selected.length) throw new ApiError(400, 'NO_ANIMALS', 'Selecciona al menos un animal.'); return apiRequest('/ventas', { method: 'POST', body: { fecha_venta: form.fecha_venta, id_comprador: form.id_comprador, precio_total: numberOrNull(form.precio_total), moneda: 'USD', observaciones: nullIfEmpty(form.observaciones), animales: selected.map((animal) => ({ id_animal: animal.id_animal, precio_individual: null, observaciones: null })) } }); }, onSuccess: async () => { toast.show('Venta registrada correctamente.'); await client.invalidateQueries({ queryKey: ['sales'] }); await client.invalidateQueries({ queryKey: ['animals'] }); await client.invalidateQueries({ queryKey: ['dashboard'] }); onSaved(); }, onError: (error) => toast.show((error as ApiError).message, 'error') });
  return <Modal title="Registrar venta de animales" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="animal-sale-form" loading={mutation.isPending}><ShoppingCart size={18} />Guardar venta</Button></>}><form id="animal-sale-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}><div className="form-grid"><Field label="Fecha" required><Input type="date" required value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field><Field label="Comprador" required><Select required value={form.id_comprador} onChange={(event) => selectBuyer(event.target.value)}><option value="">Selecciona un comprador</option>{buyers.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{item.codigo ? ` · ${String(item.codigo)}` : ''}</option>)}</Select></Field><Field label="Precio total (USD)"><Input type="number" min="0" step="0.01" value={form.precio_total} onChange={(event) => setForm({ ...form, precio_total: event.target.value })} /></Field></div><BuyerPreview buyer={selectedBuyer} /><Field label="Observaciones"><Textarea rows={3} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field><div className="form-section"><h3>Animales vendidos</h3><AnimalSelectionBuilder value={selection} operationCode="VENTA" onChange={setSelection} /></div></form></Modal>;
}

interface ProductLineForm { id_producto_venta: string; cantidad: string; precio_unitario: string; observaciones: string }
const emptyProductLine = (): ProductLineForm => ({ id_producto_venta: '', cantidad: '', precio_unitario: '', observaciones: '' });

function ProductSaleForm({ sale, onClose, onSaved }: { sale?: ProductSale; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const client = useQueryClient(); const products = useCatalog('productos-venta'); const buyers = useCatalog('compradores'); const units = useCatalog('unidades');
  const [form, setForm] = useState({ fecha_venta: sale ? dateInputValue(sale.fecha_venta) : currentDateInput(), periodicidad: sale?.periodicidad ?? 'DIARIA' as 'DIARIA' | 'SEMANAL', id_comprador: sale?.id_comprador ?? '', observaciones: sale?.observaciones ?? '', productos: sale?.productos.map((item) => ({ id_producto_venta: item.id_producto_venta, cantidad: String(item.cantidad), precio_unitario: String(item.precio_unitario), observaciones: item.observaciones ?? '' })) ?? [emptyProductLine()] });
  const selectedBuyer = buyers.data?.find((item) => itemId(item) === form.id_comprador);
  const selectBuyer = (id: string) => setForm((current) => ({ ...current, id_comprador: id }));
  const total = form.productos.reduce((sum, item) => sum + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0);
  const updateLine = (index: number, patch: Partial<ProductLineForm>) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const mutation = useMutation({
    mutationFn: () => {
      if (!form.id_comprador) throw new ApiError(400, 'NO_BUYER', 'Selecciona un comprador.');
      if (form.productos.some((item) => !item.id_producto_venta || Number(item.cantidad) <= 0 || Number(item.precio_unitario) < 0 || item.precio_unitario === '')) throw new ApiError(400, 'INVALID_PRODUCTS', 'Completa el producto, la cantidad y el precio unitario de cada fila.');
      if (new Set(form.productos.map((item) => item.id_producto_venta)).size !== form.productos.length) throw new ApiError(400, 'DUPLICATED_PRODUCTS', 'No repitas productos en la misma venta.');
      return apiRequest(sale ? `/ventas/productos/${sale.id_venta_producto}` : '/ventas/productos', { method: sale ? 'PATCH' : 'POST', body: { fecha_venta: form.fecha_venta, periodicidad: form.periodicidad, id_comprador: form.id_comprador, moneda: sale?.moneda ?? 'USD', observaciones: nullIfEmpty(form.observaciones), productos: form.productos.map((item) => ({ id_producto_venta: item.id_producto_venta, cantidad: Number(item.cantidad), precio_unitario: Number(item.precio_unitario), observaciones: nullIfEmpty(item.observaciones) })) } });
    },
    onSuccess: async () => { toast.show(sale ? 'Venta de productos actualizada.' : 'Venta de productos registrada.'); await client.invalidateQueries({ queryKey: ['sales'] }); await client.invalidateQueries({ queryKey: ['dashboard'] }); onSaved(); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  return <Modal title={sale ? 'Editar venta de productos' : 'Registrar venta de productos'} onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="product-sale-form" loading={mutation.isPending}><ShoppingCart size={18} />{sale ? 'Guardar cambios' : 'Guardar venta'}</Button></>}>
    <form id="product-sale-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid"><Field label="Fecha" required><Input type="date" required value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field><Field label="Frecuencia" required><Select value={form.periodicidad} onChange={(event) => setForm({ ...form, periodicidad: event.target.value as 'DIARIA' | 'SEMANAL' })}><option value="DIARIA">Diaria</option><option value="SEMANAL">Semanal</option></Select></Field><Field label="Comprador" required><Select required value={form.id_comprador} onChange={(event) => selectBuyer(event.target.value)}><option value="">Selecciona un comprador</option>{buyers.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{item.codigo ? ` · ${String(item.codigo)}` : ''}</option>)}</Select></Field></div>
      <BuyerPreview buyer={selectedBuyer} />
      <div className="form-section"><div className="section-heading-inline"><h3>Productos vendidos</h3><Button type="button" variant="secondary" onClick={() => setForm((current) => ({ ...current, productos: [...current.productos, emptyProductLine()] }))}><Plus size={17} />Agregar producto</Button></div><div className="product-sale-form-lines">{form.productos.map((line, index) => { const selected = products.data?.find((item) => itemId(item) === line.id_producto_venta); const unit = productUnit(selected, units.data); return <div className="product-sale-form-line" key={index}><Field label="Producto" required><Select required value={line.id_producto_venta} onChange={(event) => updateLine(index, { id_producto_venta: event.target.value })}><option value="">Selecciona un producto</option>{products.data?.filter((item) => item.activo !== false).map((item) => { const itemUnit = productUnit(item, units.data); return <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{itemUnit ? ` (${itemUnit})` : ''}</option>; })}</Select></Field><Field label={`Cantidad${unit ? ` (${unit})` : ''}`} required><Input type="number" min="0.001" step="0.001" required value={line.cantidad} onChange={(event) => updateLine(index, { cantidad: event.target.value })} /></Field><Field label={`Precio por ${unit || 'unidad'} (USD)`} required><Input type="number" min="0" step="0.0001" required value={line.precio_unitario} onChange={(event) => updateLine(index, { precio_unitario: event.target.value })} /></Field><div className="product-line-total"><small>Subtotal</small><strong>{money((Number(line.cantidad) || 0) * (Number(line.precio_unitario) || 0), 'USD')}</strong></div><Button type="button" variant="ghost" disabled={form.productos.length === 1} onClick={() => setForm((current) => ({ ...current, productos: current.productos.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={17} /></Button></div>; })}</div><div className="product-sale-total"><span>Total de la venta</span><strong>{money(total, 'USD')}</strong></div></div>
      <Field label="Observaciones"><Textarea rows={3} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field>
    </form>
  </Modal>;
}

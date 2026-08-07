import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Package, Plus, ShoppingCart, Trash2, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { AnimalSale, CatalogItem, ProductSale } from '../../types/api';
import { formatDate, numberOrNull, nullIfEmpty } from '../../utils';

type SaleTab = 'ANIMALES' | 'PRODUCTOS';

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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

  return <div>
    <PageHeader
      title="Ventas"
      description="Registra ventas de animales, leche, queso y otros productos del catálogo."
      action={hasPermission('VENTA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />{tab === 'ANIMALES' ? 'Vender animales' : 'Vender productos'}</Button> : undefined}
    />
    <div className="page-tabs"><button className={tab === 'ANIMALES' ? 'active' : ''} onClick={() => { setTab('ANIMALES'); setCreating(false); }}><Users size={17} />Animales</button><button className={tab === 'PRODUCTOS' ? 'active' : ''} onClick={() => { setTab('PRODUCTOS'); setCreating(false); }}><Package size={17} />Leche, queso y productos</button></div>
    {current.isLoading ? <LoadingState /> : current.isError ? <ErrorState message={(current.error as Error).message} onRetry={() => void current.refetch()} /> : tab === 'ANIMALES' ? <AnimalSalesList sales={animalSales.data ?? []} canAdmin={hasPermission('VENTA_ADMINISTRAR')} onCreate={() => setCreating(true)} onCancel={(id) => cancelSale.mutate({ id, type: 'ANIMALES' })} cancelling={cancelSale.isPending} /> : <ProductSalesList sales={productSales.data ?? []} canAdmin={hasPermission('VENTA_ADMINISTRAR')} onCreate={() => setCreating(true)} onCancel={(id) => cancelSale.mutate({ id, type: 'PRODUCTOS' })} cancelling={cancelSale.isPending} />}
    {creating && tab === 'ANIMALES' ? <AnimalSaleForm onClose={() => setCreating(false)} onSaved={() => setCreating(false)} /> : null}
    {creating && tab === 'PRODUCTOS' ? <ProductSaleForm onClose={() => setCreating(false)} onSaved={() => setCreating(false)} /> : null}
  </div>;
}

function AnimalSalesList({ sales, canAdmin, onCreate, onCancel, cancelling }: { sales: AnimalSale[]; canAdmin: boolean; onCreate: () => void; onCancel: (id: string) => void; cancelling: boolean }) {
  if (!sales.length) return <EmptyState icon={ShoppingCart} title="No hay ventas de animales" description="Todavía no se han registrado ventas de animales." action={canAdmin ? <Button onClick={onCreate}><Plus size={18} />Registrar venta</Button> : undefined} />;
  return <div className="sale-list">{sales.map((sale) => <Card className="sale-card" key={sale.id_venta}>
    <div className="sale-card-header"><div><span className="eyebrow">{formatDate(sale.fecha_venta)}</span><h3>{sale.comprador_nombre}</h3><p>{sale.destino || 'Destino no registrado'}</p></div><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></div>
    <div className="sale-summary"><span><Users size={17} /><strong>{sale.animales.length}</strong> animal{sale.animales.length === 1 ? '' : 'es'}</span><span><strong>{money(sale.precio_total, sale.moneda)}</strong></span></div>
    <div className="sale-animal-chips">{sale.animales.map((animal) => <span key={animal.id_venta_detalle}>{animal.animal}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</span>)}</div>
    {sale.comprador_contacto ? <p className="muted">Contacto: {sale.comprador_contacto}</p> : null}{sale.observaciones ? <p className="muted">{sale.observaciones}</p> : null}
    {canAdmin && sale.estado === 'COMPLETADA' ? <div className="record-actions"><Button variant="ghost" onClick={() => onCancel(sale.id_venta)} loading={cancelling}><Ban size={17} />Anular venta</Button></div> : null}
  </Card>)}</div>;
}

function ProductSalesList({ sales, canAdmin, onCreate, onCancel, cancelling }: { sales: ProductSale[]; canAdmin: boolean; onCreate: () => void; onCancel: (id: string) => void; cancelling: boolean }) {
  if (!sales.length) return <EmptyState icon={Package} title="No hay ventas de productos" description="Registra la primera venta de leche, queso u otro producto del catálogo." action={canAdmin ? <Button onClick={onCreate}><Plus size={18} />Registrar venta</Button> : undefined} />;
  return <div className="sale-list">{sales.map((sale) => <Card className="sale-card" key={sale.id_venta_producto}>
    <div className="sale-card-header"><div><span className="eyebrow">{formatDate(sale.fecha_venta)}</span><h3>{sale.comprador_nombre}</h3><p>{sale.destino || 'Destino no registrado'}</p></div><div className="sale-statuses"><Badge tone="info">{sale.periodicidad === 'DIARIA' ? 'Diaria' : 'Semanal'}</Badge><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></div></div>
    <div className="sale-summary"><span><Package size={17} /><strong>{sale.productos.length}</strong> producto{sale.productos.length === 1 ? '' : 's'}</span><span><strong>{money(sale.precio_total, sale.moneda)}</strong></span></div>
    <div className="product-sale-lines">{sale.productos.map((product) => <div key={product.id_venta_producto_detalle}><span><strong>{product.producto}</strong><small>{product.cantidad} {product.unidad} × {money(product.precio_unitario, sale.moneda)}</small></span><strong>{money(product.subtotal, sale.moneda)}</strong></div>)}</div>
    {sale.comprador_contacto ? <p className="muted">Contacto: {sale.comprador_contacto}</p> : null}{sale.observaciones ? <p className="muted">{sale.observaciones}</p> : null}
    {canAdmin && sale.estado === 'COMPLETADA' ? <div className="record-actions"><Button variant="ghost" onClick={() => onCancel(sale.id_venta_producto)} loading={cancelling}><Ban size={17} />Anular venta</Button></div> : null}
  </Card>)}</div>;
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
  const [form, setForm] = useState({ fecha_venta: localDateTime(), id_comprador: '', destino: '', precio_total: '', observaciones: '' });
  const selectedBuyer = buyers.data?.find((item) => itemId(item) === form.id_comprador);
  const selectBuyer = (id: string) => { const buyer = buyers.data?.find((item) => itemId(item) === id); setForm((current) => ({ ...current, id_comprador: id, destino: String(buyer?.destino ?? '') })); };
  const mutation = useMutation({ mutationFn: () => { const selected = selection.animals.filter((animal) => animal.seleccionado); if (!form.id_comprador) throw new ApiError(400, 'NO_BUYER', 'Selecciona un comprador.'); if (!selected.length) throw new ApiError(400, 'NO_ANIMALS', 'Selecciona al menos un animal.'); return apiRequest('/ventas', { method: 'POST', body: { fecha_venta: new Date(form.fecha_venta).toISOString(), id_comprador: form.id_comprador, destino: nullIfEmpty(form.destino), precio_total: numberOrNull(form.precio_total), moneda: 'USD', observaciones: nullIfEmpty(form.observaciones), animales: selected.map((animal) => ({ id_animal: animal.id_animal, precio_individual: null, observaciones: null })) } }); }, onSuccess: async () => { toast.show('Venta registrada correctamente.'); await client.invalidateQueries({ queryKey: ['sales'] }); await client.invalidateQueries({ queryKey: ['animals'] }); await client.invalidateQueries({ queryKey: ['dashboard'] }); onSaved(); }, onError: (error) => toast.show((error as ApiError).message, 'error') });
  return <Modal title="Registrar venta de animales" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="animal-sale-form" loading={mutation.isPending}><ShoppingCart size={18} />Guardar venta</Button></>}><form id="animal-sale-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}><div className="form-grid"><Field label="Fecha" required><Input type="datetime-local" required value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field><Field label="Comprador" required><Select required value={form.id_comprador} onChange={(event) => selectBuyer(event.target.value)}><option value="">Selecciona un comprador</option>{buyers.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{item.codigo ? ` · ${String(item.codigo)}` : ''}</option>)}</Select></Field><Field label="Destino de esta venta"><Input value={form.destino} onChange={(event) => setForm({ ...form, destino: event.target.value })} /></Field><Field label="Precio total (USD)"><Input type="number" min="0" step="0.01" value={form.precio_total} onChange={(event) => setForm({ ...form, precio_total: event.target.value })} /></Field></div><BuyerPreview buyer={selectedBuyer} /><Field label="Observaciones"><Textarea rows={3} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field><div className="form-section"><h3>Animales vendidos</h3><AnimalSelectionBuilder value={selection} onChange={setSelection} /></div></form></Modal>;
}

interface ProductLineForm { id_producto_venta: string; cantidad: string; precio_unitario: string; observaciones: string }
const emptyProductLine = (): ProductLineForm => ({ id_producto_venta: '', cantidad: '', precio_unitario: '', observaciones: '' });

function ProductSaleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const client = useQueryClient(); const products = useCatalog('productos-venta'); const buyers = useCatalog('compradores'); const units = useCatalog('unidades');
  const [form, setForm] = useState({ fecha_venta: localDateTime(), periodicidad: 'DIARIA' as 'DIARIA' | 'SEMANAL', id_comprador: '', destino: '', observaciones: '', productos: [emptyProductLine()] });
  const selectedBuyer = buyers.data?.find((item) => itemId(item) === form.id_comprador);
  const selectBuyer = (id: string) => { const buyer = buyers.data?.find((item) => itemId(item) === id); setForm((current) => ({ ...current, id_comprador: id, destino: String(buyer?.destino ?? '') })); };
  const total = form.productos.reduce((sum, item) => sum + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0);
  const updateLine = (index: number, patch: Partial<ProductLineForm>) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const mutation = useMutation({
    mutationFn: () => {
      if (!form.id_comprador) throw new ApiError(400, 'NO_BUYER', 'Selecciona un comprador.');
      if (form.productos.some((item) => !item.id_producto_venta || Number(item.cantidad) <= 0 || Number(item.precio_unitario) < 0 || item.precio_unitario === '')) throw new ApiError(400, 'INVALID_PRODUCTS', 'Completa el producto, la cantidad y el precio unitario de cada fila.');
      if (new Set(form.productos.map((item) => item.id_producto_venta)).size !== form.productos.length) throw new ApiError(400, 'DUPLICATED_PRODUCTS', 'No repitas productos en la misma venta.');
      return apiRequest('/ventas/productos', { method: 'POST', body: { fecha_venta: new Date(form.fecha_venta).toISOString(), periodicidad: form.periodicidad, id_comprador: form.id_comprador, destino: nullIfEmpty(form.destino), moneda: 'USD', observaciones: nullIfEmpty(form.observaciones), productos: form.productos.map((item) => ({ id_producto_venta: item.id_producto_venta, cantidad: Number(item.cantidad), precio_unitario: Number(item.precio_unitario), observaciones: nullIfEmpty(item.observaciones) })) } });
    },
    onSuccess: async () => { toast.show('Venta de productos registrada.'); await client.invalidateQueries({ queryKey: ['sales'] }); await client.invalidateQueries({ queryKey: ['dashboard'] }); onSaved(); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  return <Modal title="Registrar venta de productos" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="product-sale-form" loading={mutation.isPending}><ShoppingCart size={18} />Guardar venta</Button></>}>
    <form id="product-sale-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid"><Field label="Fecha" required><Input type="datetime-local" required value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field><Field label="Frecuencia" required><Select value={form.periodicidad} onChange={(event) => setForm({ ...form, periodicidad: event.target.value as 'DIARIA' | 'SEMANAL' })}><option value="DIARIA">Diaria</option><option value="SEMANAL">Semanal</option></Select></Field><Field label="Comprador" required><Select required value={form.id_comprador} onChange={(event) => selectBuyer(event.target.value)}><option value="">Selecciona un comprador</option>{buyers.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{item.codigo ? ` · ${String(item.codigo)}` : ''}</option>)}</Select></Field><Field label="Destino de esta venta"><Input value={form.destino} onChange={(event) => setForm({ ...form, destino: event.target.value })} /></Field></div>
      <BuyerPreview buyer={selectedBuyer} />
      <div className="form-section"><div className="section-heading-inline"><div><h3>Productos vendidos</h3></div><Button type="button" variant="secondary" onClick={() => setForm((current) => ({ ...current, productos: [...current.productos, emptyProductLine()] }))}><Plus size={17} />Agregar producto</Button></div><div className="product-sale-form-lines">{form.productos.map((line, index) => { const selected = products.data?.find((item) => itemId(item) === line.id_producto_venta); const unit = productUnit(selected, units.data); return <div className="product-sale-form-line" key={index}><Field label="Producto" required><Select required value={line.id_producto_venta} onChange={(event) => updateLine(index, { id_producto_venta: event.target.value })}><option value="">Selecciona un producto</option>{products.data?.filter((item) => item.activo !== false).map((item) => { const itemUnit = productUnit(item, units.data); return <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}{itemUnit ? ` (${itemUnit})` : ''}</option>; })}</Select></Field><Field label={`Cantidad${unit ? ` (${unit})` : ''}`} required><Input type="number" min="0.001" step="0.001" required value={line.cantidad} onChange={(event) => updateLine(index, { cantidad: event.target.value })} /></Field><Field label={`Precio por ${unit || 'unidad'} (USD)`} required><Input type="number" min="0" step="0.0001" required value={line.precio_unitario} onChange={(event) => updateLine(index, { precio_unitario: event.target.value })} /></Field><div className="product-line-total"><small>Subtotal</small><strong>{money((Number(line.cantidad) || 0) * (Number(line.precio_unitario) || 0), 'USD')}</strong></div><Button type="button" variant="ghost" disabled={form.productos.length === 1} onClick={() => setForm((current) => ({ ...current, productos: current.productos.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={17} /></Button></div>; })}</div><div className="product-sale-total"><span>Total de la venta</span><strong>{money(total, 'USD')}</strong></div></div>
      <Field label="Observaciones"><Textarea rows={3} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field>
    </form>
  </Modal>;
}

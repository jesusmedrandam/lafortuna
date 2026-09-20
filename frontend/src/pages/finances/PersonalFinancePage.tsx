import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, ChevronRight, CircleDollarSign,
  CreditCard, Edit3, Eye, EyeOff, HandCoins, Landmark, Plus, ReceiptText, Scale,
  Settings2, Trash2, WalletCards,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useToast } from '../../components/ToastContext';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock,
  IconButton, Input, LoadingState, Modal, Select, Textarea,
} from '../../components/ui';
import { currentDateInput, formatDate, humanizeCode } from '../../utils';

type AccountType = 'EFECTIVO' | 'BANCO' | 'BILLETERA' | 'OTRO';
type MovementType = 'INGRESO' | 'EGRESO' | 'TRANSFERENCIA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';
type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO' | 'DEPOSITO' | 'OTRO';
type DebtType = 'A_FAVOR' | 'EN_CONTRA';
type FinanceTab = 'RESUMEN' | 'CUENTAS' | 'MOVIMIENTOS' | 'DEUDAS';

interface FinanceConfiguration { habilitadas: boolean; permitir_saldo_negativo: boolean; moneda: string }
interface FinanceAccount {
  id_cuenta: string; nombre: string; tipo: AccountType; saldo_inicial: number | string; saldo_actual?: number | string;
  descripcion?: string | null; color?: string | null; activa: boolean; __offline?: boolean;
}
interface FinanceMovement {
  id_movimiento_financiero: string; tipo: MovementType; id_cuenta_origen?: string | null; id_cuenta_destino?: string | null;
  id_deuda?: string | null; monto: number | string; metodo_pago: PaymentMethod; categoria?: string | null;
  concepto: string; fecha: string; observaciones?: string | null; cuenta_origen?: string | null;
  cuenta_destino?: string | null; deuda_tipo?: DebtType | null; deuda_contraparte?: string | null; __offline?: boolean;
}
interface PersonalDebt {
  id_deuda: string; tipo: DebtType; contraparte: string; concepto: string; monto_original: number | string;
  monto_abonado?: number | string; saldo_pendiente?: number | string; fecha_inicio: string;
  fecha_vencimiento?: string | null; estado: 'PENDIENTE' | 'PAGADA' | 'CANCELADA'; observaciones?: string | null; __offline?: boolean;
}
interface AccountForm { id?: string; nombre: string; tipo: AccountType; saldo_inicial: string; descripcion: string; color: string; activa: boolean }
interface MovementForm {
  id?: string; tipo: MovementType; id_cuenta_origen: string; id_cuenta_destino: string; id_deuda: string;
  monto: string; metodo_pago: PaymentMethod; categoria: string; concepto: string; fecha: string; observaciones: string;
}
interface DebtForm { id?: string; tipo: DebtType; contraparte: string; concepto: string; monto_original: string; fecha_inicio: string; fecha_vencimiento: string; observaciones: string }

const accountColors = ['#16834f', '#2878b5', '#8357b5', '#c17b22', '#c24f4f', '#56636d'];
const incomeCategories = ['Sueldo', 'Venta personal', 'Cobro de deuda', 'Reembolso', 'Regalo', 'Otro ingreso'];
const expenseCategories = ['Alimentación', 'Transporte', 'Salud', 'Servicios', 'Compra personal', 'Pago de deuda', 'Otro egreso'];
const paymentMethods: Array<[PaymentMethod, string]> = [
  ['EFECTIVO', 'Efectivo'], ['TRANSFERENCIA', 'Transferencia'], ['TARJETA_DEBITO', 'Tarjeta de débito'],
  ['TARJETA_CREDITO', 'Tarjeta de crédito'], ['DEPOSITO', 'Depósito'], ['OTRO', 'Otro'],
];
const money = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const amount = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
const emptyAccount = (): AccountForm => ({ nombre: '', tipo: 'EFECTIVO', saldo_inicial: '0', descripcion: '', color: accountColors[0], activa: true });
const emptyMovement = (tipo: MovementType = 'EGRESO'): MovementForm => ({ id_cuenta_origen: '', id_cuenta_destino: '', id_deuda: '', monto: '', metodo_pago: tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'EFECTIVO', categoria: '', concepto: '', fecha: currentDateInput(), observaciones: '', tipo });
const emptyDebt = (): DebtForm => ({ tipo: 'A_FAVOR', contraparte: '', concepto: '', monto_original: '', fecha_inicio: currentDateInput(), fecha_vencimiento: '', observaciones: '' });

function accountIcon(type: AccountType) {
  if (type === 'EFECTIVO') return Banknote;
  if (type === 'BANCO') return Landmark;
  if (type === 'BILLETERA') return WalletCards;
  return CreditCard;
}

export function PersonalFinancePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const [tab, setTab] = useState<FinanceTab>('RESUMEN');
  const [hidden, setHidden] = useState(() => localStorage.getItem('sgb.personal-finance.hide-balances') === 'true');
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [movementForm, setMovementForm] = useState<MovementForm | null>(null);
  const [debtForm, setDebtForm] = useState<DebtForm | null>(null);
  const [adjusting, setAdjusting] = useState<FinanceAccount | null>(null);
  const [targetBalance, setTargetBalance] = useState('');
  const [deleting, setDeleting] = useState<{ kind: 'cuenta' | 'movimiento' | 'deuda'; id: string; label: string } | null>(null);

  const configuration = useQuery({ queryKey: ['personal-finance-configuration'], queryFn: () => apiRequest<FinanceConfiguration>('/mis-finanzas/configuracion') });
  const enabled = configuration.data?.habilitadas === true;
  const accounts = useQuery({ queryKey: ['personal-finance-accounts'], queryFn: () => apiRequest<FinanceAccount[]>('/mis-finanzas/cuentas'), enabled });
  const movements = useQuery({ queryKey: ['personal-finance-movements'], queryFn: () => apiRequest<FinanceMovement[]>('/mis-finanzas/movimientos'), enabled });
  const debts = useQuery({ queryKey: ['personal-finance-debts'], queryFn: () => apiRequest<PersonalDebt[]>('/mis-finanzas/deudas'), enabled });

  const balances = useMemo(() => {
    const result = new Map<string, number>();
    for (const account of accounts.data ?? []) result.set(account.id_cuenta, amount(account.saldo_inicial));
    for (const movement of movements.data ?? []) {
      const value = amount(movement.monto);
      if (movement.id_cuenta_destino) result.set(movement.id_cuenta_destino, (result.get(movement.id_cuenta_destino) ?? 0) + value);
      if (movement.id_cuenta_origen) result.set(movement.id_cuenta_origen, (result.get(movement.id_cuenta_origen) ?? 0) - value);
    }
    return result;
  }, [accounts.data, movements.data]);

  const debtBalances = useMemo(() => {
    const paid = new Map<string, number>();
    for (const movement of movements.data ?? []) if (movement.id_deuda) paid.set(movement.id_deuda, (paid.get(movement.id_deuda) ?? 0) + amount(movement.monto));
    return new Map((debts.data ?? []).map((debt) => [debt.id_deuda, Math.max(0, amount(debt.monto_original) - (paid.get(debt.id_deuda) ?? 0))]));
  }, [debts.data, movements.data]);

  const totalBalance = [...balances.values()].reduce((sum, value) => sum + value, 0);
  const receivable = (debts.data ?? []).filter((debt) => debt.tipo === 'A_FAVOR' && debt.estado !== 'CANCELADA').reduce((sum, debt) => sum + (debtBalances.get(debt.id_deuda) ?? 0), 0);
  const payable = (debts.data ?? []).filter((debt) => debt.tipo === 'EN_CONTRA' && debt.estado !== 'CANCELADA').reduce((sum, debt) => sum + (debtBalances.get(debt.id_deuda) ?? 0), 0);
  const month = currentDateInput().slice(0, 7);
  const monthIncome = (movements.data ?? []).filter((item) => item.tipo === 'INGRESO' && item.fecha.startsWith(month)).reduce((sum, item) => sum + amount(item.monto), 0);
  const monthExpense = (movements.data ?? []).filter((item) => item.tipo === 'EGRESO' && item.fecha.startsWith(month)).reduce((sum, item) => sum + amount(item.monto), 0);
  const activeAccounts = (accounts.data ?? []).filter((account) => account.activa);
  const accountNames = new Map((accounts.data ?? []).map((account) => [account.id_cuenta, account.nombre]));
  const showMoney = (value: number) => hidden ? '••••••' : money.format(value);
  const invalidate = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['personal-finance-accounts'] }),
    client.invalidateQueries({ queryKey: ['personal-finance-movements'] }),
    client.invalidateQueries({ queryKey: ['personal-finance-debts'] }),
  ]);

  const saveAccount = useMutation({
    mutationFn: () => {
      if (!accountForm?.nombre.trim()) throw new Error('Escribe el nombre de la cuenta.');
      const body = { nombre: accountForm.nombre.trim(), tipo: accountForm.tipo, descripcion: accountForm.descripcion.trim() || null, color: accountForm.color || null, activa: accountForm.activa };
      return accountForm.id
        ? apiRequest(`/mis-finanzas/cuentas/${accountForm.id}`, { method: 'PATCH', body })
        : apiRequest('/mis-finanzas/cuentas', { method: 'POST', body: { ...body, saldo_inicial: Number(accountForm.saldo_inicial || 0) } });
    },
    onSuccess: async () => { toast.show(accountForm?.id ? 'Cuenta actualizada.' : 'Cuenta creada.'); setAccountForm(null); await invalidate(); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveMovement = useMutation({
    mutationFn: (override?: MovementForm) => {
      const form = override ?? movementForm;
      if (!form || !form.concepto.trim() || Number(form.monto) <= 0) throw new Error('Completa el concepto y un monto mayor a cero.');
      const body = { ...form, monto: Number(form.monto), id_cuenta_origen: form.id_cuenta_origen || null, id_cuenta_destino: form.id_cuenta_destino || null, id_deuda: form.id_deuda || null, categoria: form.categoria.trim() || null, observaciones: form.observaciones.trim() || null };
      delete body.id;
      return form.id ? apiRequest(`/mis-finanzas/movimientos/${form.id}`, { method: 'PATCH', body }) : apiRequest('/mis-finanzas/movimientos', { method: 'POST', body });
    },
    onSuccess: async () => { toast.show('Movimiento guardado.'); setMovementForm(null); setAdjusting(null); await invalidate(); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveDebt = useMutation({
    mutationFn: () => {
      if (!debtForm?.contraparte.trim() || !debtForm.concepto.trim() || Number(debtForm.monto_original) <= 0) throw new Error('Completa la persona o entidad, el concepto y el monto.');
      const body = { ...debtForm, monto_original: Number(debtForm.monto_original), fecha_vencimiento: debtForm.fecha_vencimiento || null, observaciones: debtForm.observaciones.trim() || null };
      delete body.id;
      return debtForm.id ? apiRequest(`/mis-finanzas/deudas/${debtForm.id}`, { method: 'PATCH', body }) : apiRequest('/mis-finanzas/deudas', { method: 'POST', body });
    },
    onSuccess: async () => { toast.show(debtForm?.id ? 'Deuda actualizada.' : 'Deuda registrada.'); setDebtForm(null); await invalidate(); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const remove = useMutation({
    mutationFn: () => deleting ? apiRequest(`/mis-finanzas/${deleting.kind === 'cuenta' ? 'cuentas' : deleting.kind === 'movimiento' ? 'movimientos' : 'deudas'}/${deleting.id}`, { method: 'DELETE' }) : Promise.resolve(),
    onSuccess: async () => { toast.show('Registro eliminado.'); setDeleting(null); await invalidate(); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  function openMovement(type: MovementType, debt?: PersonalDebt) {
    const form = emptyMovement(debt ? (debt.tipo === 'A_FAVOR' ? 'INGRESO' : 'EGRESO') : type);
    form.id_deuda = debt?.id_deuda ?? '';
    form.monto = debt ? String(debtBalances.get(debt.id_deuda) ?? amount(debt.monto_original)) : '';
    form.concepto = debt ? `${debt.tipo === 'A_FAVOR' ? 'Cobro' : 'Pago'}: ${debt.concepto}` : '';
    form.categoria = debt ? (debt.tipo === 'A_FAVOR' ? 'Cobro de deuda' : 'Pago de deuda') : '';
    setMovementForm(form);
  }

  function setMovementType(type: MovementType) {
    if (!movementForm) return;
    setMovementForm({ ...emptyMovement(type), id: movementForm.id, concepto: movementForm.concepto, monto: movementForm.monto, fecha: movementForm.fecha, observaciones: movementForm.observaciones });
  }

  function selectOrigin(id: string) {
    if (!movementForm) return;
    const account = activeAccounts.find((item) => item.id_cuenta === id);
    setMovementForm({ ...movementForm, id_cuenta_origen: id, metodo_pago: movementForm.tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : account?.tipo === 'EFECTIVO' ? 'EFECTIVO' : movementForm.metodo_pago === 'EFECTIVO' ? 'TRANSFERENCIA' : movementForm.metodo_pago });
  }

  function selectDestination(id: string) {
    if (!movementForm) return;
    const account = activeAccounts.find((item) => item.id_cuenta === id);
    setMovementForm({ ...movementForm, id_cuenta_destino: id, metodo_pago: movementForm.tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : account?.tipo === 'EFECTIVO' ? 'EFECTIVO' : movementForm.metodo_pago === 'EFECTIVO' ? 'TRANSFERENCIA' : movementForm.metodo_pago });
  }

  if (configuration.isLoading) return <LoadingState text="Cargando Mis finanzas…" />;
  if (configuration.isError) return <ErrorState message={(configuration.error as Error).message} onRetry={() => void configuration.refetch()} />;
  if (!enabled) return <EmptyState icon={WalletCards} title="Mis finanzas está desactivado" description="Esta sección es privada y opcional. Actívala desde Configuración para crear tus cuentas y llevar tu contabilidad." action={<Button onClick={() => navigate('/configuracion?seccion=finanzas')}><Settings2 size={17} />Ir a Configuración</Button>} />;
  if (accounts.isLoading || movements.isLoading || debts.isLoading) return <LoadingState text="Preparando tu información financiera…" />;
  const firstError = accounts.error ?? movements.error ?? debts.error;
  if (firstError) return <ErrorState message={(firstError as Error).message} onRetry={() => { void accounts.refetch(); void movements.refetch(); void debts.refetch(); }} />;

  return <div className="personal-finance-page module-no-header">
    <div className="finance-toolbar">
      <div className="finance-tabs">
        {([
          ['RESUMEN', CircleDollarSign, 'Resumen'], ['CUENTAS', WalletCards, 'Saldos'],
          ['MOVIMIENTOS', ReceiptText, 'Movimientos'], ['DEUDAS', HandCoins, 'Deudas'],
        ] as Array<[FinanceTab, typeof CircleDollarSign, string]>).map(([value, Icon, label]) => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}><span><Icon size={20} /></span><small>{label}</small></button>)}
      </div>
      <IconButton label={hidden ? 'Mostrar saldos' : 'Ocultar saldos'} onClick={() => { const next = !hidden; setHidden(next); localStorage.setItem('sgb.personal-finance.hide-balances', String(next)); }}>{hidden ? <Eye size={20} /> : <EyeOff size={20} />}</IconButton>
    </div>

    {tab === 'RESUMEN' ? <>
      <div className="finance-summary-grid">
        <Card className="finance-metric balance"><small>Saldo disponible</small><strong>{showMoney(totalBalance)}</strong><span>En todas tus cuentas</span></Card>
        <Card className="finance-metric worth"><small>Patrimonio estimado</small><strong>{showMoney(totalBalance + receivable - payable)}</strong><span>Saldo + por cobrar − por pagar</span></Card>
        <Card className="finance-metric income"><small>Ingresos este mes</small><strong>{showMoney(monthIncome)}</strong><span>{currentDateInput().slice(0, 7)}</span></Card>
        <Card className="finance-metric expense"><small>Egresos este mes</small><strong>{showMoney(monthExpense)}</strong><span>{currentDateInput().slice(0, 7)}</span></Card>
      </div>
      <section className="finance-section"><div className="section-heading-inline"><div><h2>Dinero por cuenta</h2><p className="muted">Saldo calculado desde el valor inicial y tus movimientos.</p></div><Button variant="secondary" onClick={() => setTab('CUENTAS')}>Ver saldos</Button></div>
        {activeAccounts.length ? <div className="finance-account-grid">{activeAccounts.map((account) => { const Icon = accountIcon(account.tipo); return <Card key={account.id_cuenta} className="finance-account-card" onClick={() => { setTab('CUENTAS'); }}><span className="finance-account-icon" style={{ background: account.color ?? accountColors[0] }}><Icon size={21} /></span><span><small>{humanizeCode(account.tipo)}</small><strong>{account.nombre}</strong></span><b>{showMoney(balances.get(account.id_cuenta) ?? 0)}</b><ChevronRight size={17} /></Card>; })}</div> : <EmptyState icon={WalletCards} title="Aún no tienes cuentas" description="Agrega efectivo, una cuenta bancaria o una billetera." action={<Button onClick={() => setAccountForm(emptyAccount())}><Plus size={17} />Agregar cuenta</Button>} />}
      </section>
      <div className="finance-debt-summary"><Card><span><ArrowDownLeft size={19} />Por cobrar</span><strong>{showMoney(receivable)}</strong></Card><Card><span><ArrowUpRight size={19} />Por pagar</span><strong>{showMoney(payable)}</strong></Card><Card><span><Scale size={19} />Balance de deudas</span><strong>{showMoney(receivable - payable)}</strong></Card></div>
      <section className="finance-section"><div className="section-heading-inline"><div><h2>Últimos movimientos</h2><p className="muted">Tus registros más recientes.</p></div><Button variant="secondary" onClick={() => setTab('MOVIMIENTOS')}>Ver todos</Button></div><MovementList items={(movements.data ?? []).slice(0, 5)} accountNames={accountNames} hidden={hidden} onEdit={(item) => setMovementForm(movementToForm(item))} onDelete={(item) => setDeleting({ kind: 'movimiento', id: item.id_movimiento_financiero, label: item.concepto })} /></section>
    </> : null}

    {tab === 'CUENTAS' ? <section className="finance-section"><div className="section-heading-inline"><div><h2>Saldos y cuentas</h2><p className="muted">No se solicitan números de cuenta ni información bancaria personal.</p></div><Button onClick={() => setAccountForm(emptyAccount())}><Plus size={17} />Cuenta</Button></div>
      {accounts.data?.length ? <div className="finance-account-grid detailed">{accounts.data.map((account) => { const Icon = accountIcon(account.tipo); return <Card key={account.id_cuenta} className={`finance-account-detail ${account.activa ? '' : 'inactive'}`}><div className="finance-account-detail-head"><span className="finance-account-icon" style={{ background: account.color ?? accountColors[0] }}><Icon size={22} /></span><span><small>{humanizeCode(account.tipo)}</small><strong>{account.nombre}</strong></span><Badge tone={account.activa ? 'success' : 'neutral'}>{account.activa ? 'Activa' : 'Inactiva'}</Badge></div><strong className="finance-account-balance">{showMoney(balances.get(account.id_cuenta) ?? 0)}</strong><small>{account.descripcion || 'Sin descripción'}</small><div className="finance-inline-actions"><Button variant="secondary" onClick={() => { setAdjusting(account); setTargetBalance(String((balances.get(account.id_cuenta) ?? 0).toFixed(2))); }}>Ajustar saldo</Button><IconButton label="Editar cuenta" onClick={() => setAccountForm({ id: account.id_cuenta, nombre: account.nombre, tipo: account.tipo, saldo_inicial: String(account.saldo_inicial), descripcion: account.descripcion ?? '', color: account.color ?? accountColors[0], activa: account.activa })}><Edit3 size={17} /></IconButton><IconButton label="Eliminar cuenta" onClick={() => setDeleting({ kind: 'cuenta', id: account.id_cuenta, label: account.nombre })}><Trash2 size={17} /></IconButton></div></Card>; })}</div> : <EmptyState icon={WalletCards} title="Sin cuentas" description="Registra dónde mantienes tu dinero." />}
    </section> : null}

    {tab === 'MOVIMIENTOS' ? <section className="finance-section"><div className="section-heading-inline"><div><h2>Ingresos y egresos</h2><p className="muted">También puedes mover dinero entre tus propias cuentas.</p></div><div className="finance-heading-actions"><Button variant="secondary" onClick={() => openMovement('INGRESO')}><ArrowDownLeft size={17} />Ingreso</Button><Button variant="secondary" onClick={() => openMovement('EGRESO')}><ArrowUpRight size={17} />Egreso</Button><Button onClick={() => openMovement('TRANSFERENCIA')}><ArrowRightLeft size={17} />Transferir</Button></div></div><MovementList items={movements.data ?? []} accountNames={accountNames} hidden={hidden} onEdit={(item) => setMovementForm(movementToForm(item))} onDelete={(item) => setDeleting({ kind: 'movimiento', id: item.id_movimiento_financiero, label: item.concepto })} /></section> : null}

    {tab === 'DEUDAS' ? <section className="finance-section"><div className="section-heading-inline"><div><h2>Deudas</h2><p className="muted">Controla el dinero que te deben y el que tienes pendiente por pagar.</p></div><Button onClick={() => setDebtForm(emptyDebt())}><Plus size={17} />Deuda</Button></div>
      {debts.data?.length ? <div className="finance-debt-list">{debts.data.map((debt) => { const pending = debtBalances.get(debt.id_deuda) ?? 0; return <Card key={debt.id_deuda} className={`finance-debt-card ${debt.tipo.toLowerCase()}`}><span className="finance-debt-icon">{debt.tipo === 'A_FAVOR' ? <ArrowDownLeft size={21} /> : <ArrowUpRight size={21} />}</span><span><small>{debt.tipo === 'A_FAVOR' ? 'Me deben' : 'Debo'} · {debt.contraparte}</small><strong>{debt.concepto}</strong><em>{debt.fecha_vencimiento ? `Vence ${formatDate(debt.fecha_vencimiento)}` : `Desde ${formatDate(debt.fecha_inicio)}`}</em></span><span className="finance-debt-amount"><strong>{showMoney(pending)}</strong><small>de {showMoney(amount(debt.monto_original))}</small><Badge tone={pending <= 0 ? 'success' : 'warning'}>{pending <= 0 ? 'Pagada' : 'Pendiente'}</Badge></span><div className="finance-inline-actions">{pending > 0 ? <Button variant="secondary" onClick={() => openMovement(debt.tipo === 'A_FAVOR' ? 'INGRESO' : 'EGRESO', debt)}>Registrar abono</Button> : null}<IconButton label="Editar deuda" onClick={() => setDebtForm(debtToForm(debt))}><Edit3 size={17} /></IconButton><IconButton label="Eliminar deuda" onClick={() => setDeleting({ kind: 'deuda', id: debt.id_deuda, label: debt.concepto })}><Trash2 size={17} /></IconButton></div></Card>; })}</div> : <EmptyState icon={HandCoins} title="Sin deudas registradas" description="Aquí puedes guardar tanto cuentas por cobrar como por pagar." />}
    </section> : null}

    {accountForm ? <Modal title={accountForm.id ? 'Editar cuenta' : 'Nueva cuenta o saldo'} onClose={() => setAccountForm(null)} footer={<><Button variant="ghost" onClick={() => setAccountForm(null)}>Cancelar</Button><Button loading={saveAccount.isPending} onClick={() => saveAccount.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Nombre" hint="Ejemplo: Efectivo, Pichincha 1 o Guayaquil 2." required><Input value={accountForm.nombre} onChange={(event) => setAccountForm({ ...accountForm, nombre: event.target.value })} /></Field><Field label="Tipo" required><Select value={accountForm.tipo} onChange={(event) => setAccountForm({ ...accountForm, tipo: event.target.value as AccountType })}><option value="EFECTIVO">Efectivo</option><option value="BANCO">Cuenta bancaria</option><option value="BILLETERA">Billetera digital</option><option value="OTRO">Otra</option></Select></Field>{!accountForm.id ? <Field label="Saldo actual" hint="Se guardará como punto de partida para los cálculos." required><Input type="number" step="0.01" value={accountForm.saldo_inicial} onChange={(event) => setAccountForm({ ...accountForm, saldo_inicial: event.target.value })} /></Field> : null}<Field label="Descripción"><Input value={accountForm.descripcion} onChange={(event) => setAccountForm({ ...accountForm, descripcion: event.target.value })} /></Field><Field label="Color"><div className="finance-color-picker">{accountColors.map((color) => <button type="button" aria-label={`Color ${color}`} className={accountForm.color === color ? 'selected' : ''} style={{ background: color }} key={color} onClick={() => setAccountForm({ ...accountForm, color })} />)}</div></Field>{accountForm.id ? <label className="offline-setting-row"><div><strong>Cuenta activa</strong><span>Las cuentas inactivas conservan su historial.</span></div><span className="switch"><input type="checkbox" checked={accountForm.activa} onChange={(event) => setAccountForm({ ...accountForm, activa: event.target.checked })} /><i /></span></label> : null}</div></Modal> : null}

    {movementForm ? <Modal title={movementForm.id ? 'Editar movimiento' : movementForm.id_deuda ? 'Registrar abono' : 'Nuevo movimiento'} wide onClose={() => setMovementForm(null)} footer={<><Button variant="ghost" onClick={() => setMovementForm(null)}>Cancelar</Button><Button loading={saveMovement.isPending} onClick={() => saveMovement.mutate(undefined)}>Guardar</Button></>}><div className="form-stack"><div className="finance-movement-types">{(['INGRESO', 'EGRESO', 'TRANSFERENCIA'] as MovementType[]).map((type) => <button type="button" key={type} className={movementForm.tipo === type ? 'selected' : ''} disabled={Boolean(movementForm.id_deuda)} onClick={() => setMovementType(type)}>{type === 'INGRESO' ? <ArrowDownLeft size={18} /> : type === 'EGRESO' ? <ArrowUpRight size={18} /> : <ArrowRightLeft size={18} />}{humanizeCode(type)}</button>)}</div><div className="form-grid">{['EGRESO', 'TRANSFERENCIA', 'AJUSTE_SALIDA'].includes(movementForm.tipo) ? <Field label="Debitar desde" required><Select value={movementForm.id_cuenta_origen} onChange={(event) => selectOrigin(event.target.value)}><option value="">Selecciona una cuenta</option>{activeAccounts.map((account) => <option key={account.id_cuenta} value={account.id_cuenta}>{account.nombre} · {showMoney(balances.get(account.id_cuenta) ?? 0)}</option>)}</Select></Field> : null}{['INGRESO', 'TRANSFERENCIA', 'AJUSTE_ENTRADA'].includes(movementForm.tipo) ? <Field label={movementForm.tipo === 'TRANSFERENCIA' ? 'Acreditar en' : 'Guardar en'} required><Select value={movementForm.id_cuenta_destino} onChange={(event) => selectDestination(event.target.value)}><option value="">Selecciona una cuenta</option>{activeAccounts.filter((account) => account.id_cuenta !== movementForm.id_cuenta_origen).map((account) => <option key={account.id_cuenta} value={account.id_cuenta}>{account.nombre} · {showMoney(balances.get(account.id_cuenta) ?? 0)}</option>)}</Select></Field> : null}<Field label="Monto" required><Input type="number" min="0.01" step="0.01" value={movementForm.monto} onChange={(event) => setMovementForm({ ...movementForm, monto: event.target.value })} /></Field><Field label="Método de pago" required><Select value={movementForm.metodo_pago} disabled={movementForm.tipo === 'TRANSFERENCIA'} onChange={(event) => setMovementForm({ ...movementForm, metodo_pago: event.target.value as PaymentMethod })}>{paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="Fecha" required><Input type="date" value={movementForm.fecha} onChange={(event) => setMovementForm({ ...movementForm, fecha: event.target.value })} /></Field><Field label="Categoría"><Input list="finance-categories" value={movementForm.categoria} onChange={(event) => setMovementForm({ ...movementForm, categoria: event.target.value })} /><datalist id="finance-categories">{(movementForm.tipo === 'INGRESO' ? incomeCategories : expenseCategories).map((category) => <option value={category} key={category} />)}</datalist></Field></div><Field label="Concepto" required><Input value={movementForm.concepto} onChange={(event) => setMovementForm({ ...movementForm, concepto: event.target.value })} /></Field><Field label="Observaciones"><Textarea value={movementForm.observaciones} onChange={(event) => setMovementForm({ ...movementForm, observaciones: event.target.value })} /></Field>{movementForm.id_deuda ? <div className="form-alert"><HandCoins size={18} />Este movimiento quedará relacionado con la deuda seleccionada.</div> : null}</div></Modal> : null}

    {debtForm ? <Modal title={debtForm.id ? 'Editar deuda' : 'Nueva deuda'} onClose={() => setDebtForm(null)} footer={<><Button variant="ghost" onClick={() => setDebtForm(null)}>Cancelar</Button><Button loading={saveDebt.isPending} onClick={() => saveDebt.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Tipo" required><Select value={debtForm.tipo} onChange={(event) => setDebtForm({ ...debtForm, tipo: event.target.value as DebtType })}><option value="A_FAVOR">A favor · me deben</option><option value="EN_CONTRA">En contra · debo</option></Select></Field><Field label="Persona o entidad" required><Input value={debtForm.contraparte} onChange={(event) => setDebtForm({ ...debtForm, contraparte: event.target.value })} /></Field><Field label="Concepto" required><Input value={debtForm.concepto} onChange={(event) => setDebtForm({ ...debtForm, concepto: event.target.value })} /></Field><Field label="Monto original" required><Input type="number" min="0.01" step="0.01" value={debtForm.monto_original} onChange={(event) => setDebtForm({ ...debtForm, monto_original: event.target.value })} /></Field><div className="form-grid"><Field label="Fecha inicial" required><Input type="date" value={debtForm.fecha_inicio} onChange={(event) => setDebtForm({ ...debtForm, fecha_inicio: event.target.value })} /></Field><Field label="Vencimiento"><Input type="date" min={debtForm.fecha_inicio} value={debtForm.fecha_vencimiento} onChange={(event) => setDebtForm({ ...debtForm, fecha_vencimiento: event.target.value })} /></Field></div><Field label="Observaciones"><Textarea value={debtForm.observaciones} onChange={(event) => setDebtForm({ ...debtForm, observaciones: event.target.value })} /></Field></div></Modal> : null}

    {adjusting ? <Modal title={`Ajustar saldo de ${adjusting.nombre}`} onClose={() => setAdjusting(null)} footer={<><Button variant="ghost" onClick={() => setAdjusting(null)}>Cancelar</Button><Button loading={saveMovement.isPending} onClick={() => { const current = balances.get(adjusting.id_cuenta) ?? 0, target = Number(targetBalance), difference = target - current; if (!Number.isFinite(target) || Math.abs(difference) < 0.005) { toast.show('El nuevo saldo debe ser diferente del actual.', 'error'); return; } const type: MovementType = difference > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA'; saveMovement.mutate({ ...emptyMovement(type), monto: String(Math.abs(difference)), metodo_pago: adjusting.tipo === 'EFECTIVO' ? 'EFECTIVO' : 'OTRO', concepto: 'Ajuste de saldo', categoria: 'Ajuste', id_cuenta_origen: difference < 0 ? adjusting.id_cuenta : '', id_cuenta_destino: difference > 0 ? adjusting.id_cuenta : '' }); }}>Aplicar ajuste</Button></>}><div className="form-stack"><div className="finance-adjust-current"><small>Saldo calculado actual</small><strong>{showMoney(balances.get(adjusting.id_cuenta) ?? 0)}</strong></div><Field label="Nuevo saldo real" hint="Se creará un movimiento de ajuste; el historial anterior no se modificará." required><Input type="number" step="0.01" value={targetBalance} onChange={(event) => setTargetBalance(event.target.value)} /></Field></div></Modal> : null}
    {deleting ? <ConfirmDialog title="Eliminar registro" message={`Se eliminará “${deleting.label}”. Esta acción quedará pendiente si estás sin conexión.`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} /> : null}
    {tab === 'RESUMEN' && activeAccounts.length ? <FloatingActionDock><IconButton label="Registrar movimiento" onClick={() => openMovement('EGRESO')}><Plus size={22} /></IconButton></FloatingActionDock> : null}
  </div>;
}

function MovementList({ items, accountNames, hidden, onEdit, onDelete }: { items: FinanceMovement[]; accountNames: Map<string, string>; hidden: boolean; onEdit: (item: FinanceMovement) => void; onDelete: (item: FinanceMovement) => void }) {
  const show = (value: number) => hidden ? '••••••' : money.format(value);
  if (!items.length) return <EmptyState icon={ReceiptText} title="Sin movimientos" description="Registra tu primer ingreso, egreso o transferencia." />;
  return <Card className="finance-movement-list">{items.map((item) => { const incoming = ['INGRESO', 'AJUSTE_ENTRADA'].includes(item.tipo), transfer = item.tipo === 'TRANSFERENCIA', origin = item.cuenta_origen || accountNames.get(item.id_cuenta_origen ?? '') || 'Origen', destination = item.cuenta_destino || accountNames.get(item.id_cuenta_destino ?? '') || 'Destino'; return <div className="finance-movement-row" key={item.id_movimiento_financiero}><span className={`finance-movement-icon ${transfer ? 'transfer' : incoming ? 'income' : 'expense'}`}>{transfer ? <ArrowRightLeft size={18} /> : incoming ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><span><small>{formatDate(item.fecha)} · {item.categoria || humanizeCode(item.tipo)}</small><strong>{item.concepto}</strong><em>{transfer ? `${origin} → ${destination}` : incoming ? destination : origin} · {humanizeCode(item.metodo_pago)}</em></span><b className={transfer ? '' : incoming ? 'positive' : 'negative'}>{transfer ? show(amount(item.monto)) : `${incoming ? '+' : '−'}${show(amount(item.monto))}`}</b><div className="finance-inline-actions"><IconButton label="Editar movimiento" onClick={() => onEdit(item)}><Edit3 size={16} /></IconButton><IconButton label="Eliminar movimiento" onClick={() => onDelete(item)}><Trash2 size={16} /></IconButton></div></div>; })}</Card>;
}

function movementToForm(item: FinanceMovement): MovementForm {
  return { id: item.id_movimiento_financiero, tipo: item.tipo, id_cuenta_origen: item.id_cuenta_origen ?? '', id_cuenta_destino: item.id_cuenta_destino ?? '', id_deuda: item.id_deuda ?? '', monto: String(item.monto), metodo_pago: item.metodo_pago, categoria: item.categoria ?? '', concepto: item.concepto, fecha: String(item.fecha).slice(0, 10), observaciones: item.observaciones ?? '' };
}

function debtToForm(debt: PersonalDebt): DebtForm {
  return { id: debt.id_deuda, tipo: debt.tipo, contraparte: debt.contraparte, concepto: debt.concepto, monto_original: String(debt.monto_original), fecha_inicio: String(debt.fecha_inicio).slice(0, 10), fecha_vencimiento: debt.fecha_vencimiento ? String(debt.fecha_vencimiento).slice(0, 10) : '', observaciones: debt.observaciones ?? '' };
}

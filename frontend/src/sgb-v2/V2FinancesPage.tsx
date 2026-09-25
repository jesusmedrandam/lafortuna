import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ArrowDownLeft,ArrowRightLeft,ArrowUpRight,Eye,EyeOff,Plus,WalletCards} from 'lucide-react';
import {Badge,Button,Card,EmptyState,ErrorState,Field,FloatingActionDock,IconButton,
  Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {formatDate} from '../utils';
import {cancelFinanceMovement,createFinanceAccount,createFinanceMovement,getFinanceAccounts,
  getFinanceMovements,updateFinanceAccount,type FinanceAccount,type FinanceMovement,
  type FinanceScope} from './api';
import {useV2Session} from './V2Session';
const names:Record<FinanceAccount['kind'],string>={CASH:'Efectivo',BANK:'Banco',
  WALLET:'Billetera',CREDIT_CARD:'Tarjeta de crédito',OTHER:'Otra'};
const kinds:Record<FinanceMovement['kind'],string>={INCOME:'Ingreso',EXPENSE:'Egreso',
  TRANSFER:'Transferencia'};
function money(value:number){return new Intl.NumberFormat('es-EC',{
  style:'currency',currency:'USD'}).format(value);}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date());}
export function V2FinancesPage({scope}:{scope:FinanceScope}){
  const {session,hasPermission}=useV2Session();const token=session!.accessToken;
  const [accounts,setAccounts]=useState<FinanceAccount[]|null>(null);
  const [movements,setMovements]=useState<FinanceMovement[]|null>(null);
  const [tab,setTab]=useState<'SUMMARY'|'ACCOUNTS'|'MOVEMENTS'>('SUMMARY');
  const [hidden,setHidden]=useState(()=>localStorage.getItem('sgb.finance.hide')==='true');
  const [selectedAccount,setSelectedAccount]=useState<FinanceAccount|null>(null);
  const [selectedMovement,setSelectedMovement]=useState<FinanceMovement|null>(null);
  const [accountForm,setAccountForm]=useState<FinanceAccount|null|undefined>(undefined);
  const [movementForm,setMovementForm]=useState(false);
  const [movementKind,setMovementKind]=useState<FinanceMovement['kind']>('EXPENSE');
  const [cancelling,setCancelling]=useState(false);const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  const canManage=scope==='personal'||hasPermission('FINANCE_MANAGE');
  useEffect(()=>{let active=true;setError('');setAccounts(null);setMovements(null);
    void Promise.all([getFinanceAccounts(token,scope),getFinanceMovements(token,scope)])
      .then(([a,m])=>{if(active){setAccounts(a);setMovements(m);}})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar las finanzas.');});
    return()=>{active=false;};},[token,scope,revision]);
  const active=accounts?.filter(account=>account.active)??[];
  const summary=useMemo(()=>{const month=today().slice(0,7);
    const incoming=movements?.filter(row=>!row.cancelledAt&&row.kind==='INCOME'&&
      row.occurredOn.startsWith(month)).reduce((sum,row)=>sum+row.amount,0)??0;
    const outgoing=movements?.filter(row=>!row.cancelledAt&&row.kind==='EXPENSE'&&
      row.occurredOn.startsWith(month)).reduce((sum,row)=>sum+row.amount,0)??0;
    return {balance:accounts?.filter(row=>row.kind!=='CREDIT_CARD').reduce(
      (sum,row)=>sum+row.balance,0)??0,incoming,outgoing};},[accounts,movements]);
  function show(value:number){return hidden?'••••••':money(value);}
  async function saveAccount(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    setBusy(true);setError('');try{if(accountForm){await updateFinanceAccount(token,scope,accountForm.id,{
      name:String(data.get('name')).trim(),kind:String(data.get('kind')) as FinanceAccount['kind'],
      active:data.get('active')==='on'});}else await createFinanceAccount(token,scope,{
      name:String(data.get('name')).trim(),kind:String(data.get('kind')) as FinanceAccount['kind'],
      openingBalance:Number(data.get('openingBalance'))});
      setAccountForm(undefined);setSelectedAccount(null);setRevision(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar la cuenta.');}
    finally{setBusy(false);}
  }
  async function saveMovement(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    const input={kind:movementKind,
      sourceAccountId:movementKind==='INCOME'?null:String(data.get('sourceAccountId')||'')||null,
      destinationAccountId:movementKind==='EXPENSE'?null:String(data.get('destinationAccountId')||'')||null,
      amount:Number(data.get('amount')),occurredOn:String(data.get('occurredOn')),
      category:String(data.get('category')??'').trim()||null,
      concept:String(data.get('concept')??'').trim(),notes:String(data.get('notes')??'').trim()||null};
    setBusy(true);setError('');try{await createFinanceMovement(token,scope,input);
      setMovementForm(false);setRevision(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar el movimiento.');}
    finally{setBusy(false);}
  }
  async function confirmCancel(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selectedMovement)return;
    setBusy(true);setError('');try{await cancelFinanceMovement(token,scope,selectedMovement.id,
      String(new FormData(event.currentTarget).get('reason')).trim());
      setCancelling(false);setSelectedMovement(null);setRevision(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo anular el movimiento.');}
    finally{setBusy(false);}
  }
  function toggleHide(){setHidden(value=>{localStorage.setItem('sgb.finance.hide',String(!value));return !value;});}
  return <div className="personal-finance-page module-no-header">
    <div className="finance-toolbar"><div className="finance-tabs">
      {([['SUMMARY','Resumen'],['ACCOUNTS','Cuentas'],['MOVEMENTS','Movimientos']] as const)
        .map(([code,name])=><button key={code} className={tab===code?'active':''}
          onClick={()=>setTab(code)}>{name}</button>)}
      </div><IconButton label={hidden?'Mostrar saldos':'Ocultar saldos'} onClick={toggleHide}>
        {hidden?<Eye size={20}/>:<EyeOff size={20}/>}</IconButton></div>
    {error&&!accountForm&&!movementForm&&!cancelling&&<div className="form-error admin-error" role="alert">{error}</div>}
    {accounts===null||movements===null? !error?<LoadingState/>:<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:<>
      {tab==='SUMMARY'&&<><div className="finance-summary-grid">
        <Card className="finance-metric balance"><small>Saldo disponible</small><strong>{show(summary.balance)}</strong>
          <span>Sin tarjetas de crédito</span></Card>
        <Card className="finance-metric income"><small>Ingresos este mes</small>
          <strong>{show(summary.incoming)}</strong><span>{today().slice(0,7)}</span></Card>
        <Card className="finance-metric expense"><small>Egresos este mes</small>
          <strong>{show(summary.outgoing)}</strong><span>{today().slice(0,7)}</span></Card>
      </div><h3>Cuentas</h3>{accounts.length?<Card className="commerce-list">
        {accounts.map(row=><button type="button" className="commerce-row" key={row.id}
          onClick={()=>setSelectedAccount(row)}><span className="commerce-main"><strong>{row.name}</strong>
            <small>{names[row.kind]}{row.active?'':' · Inactiva'}</small></span>
            <strong>{show(row.balance)}</strong></button>)}</Card>:<EmptyState icon={WalletCards}
            title="Sin cuentas" description="Crea una cuenta para registrar ingresos y egresos."/>}</>}
      {tab==='ACCOUNTS'&&(accounts.length?<Card className="commerce-list">
        {accounts.map(row=><button type="button" className="commerce-row" key={row.id}
          onClick={()=>setSelectedAccount(row)}><span className="commerce-main"><strong>{row.name}</strong>
            <small>{names[row.kind]}{row.active?'':' · Inactiva'}</small></span>
            <strong>{show(row.balance)}</strong></button>)}</Card>:<EmptyState icon={WalletCards}
            title="Sin cuentas" description="Crea una cuenta para comenzar."/>)}
      {tab==='MOVEMENTS'&&(movements.length?<Card className="commerce-list">
        {movements.map(row=><button type="button" className="commerce-row" key={row.id}
          onClick={()=>setSelectedMovement(row)}><span className="commerce-main"><strong>{row.concept}</strong>
            <small>{kinds[row.kind]} · {formatDate(row.occurredOn)}</small></span>
            <span className="commerce-price"><strong>{show(row.amount)}</strong>
              <Badge tone={row.cancelledAt?'danger':row.kind==='INCOME'?'success':'info'}>
                {row.cancelledAt?'Anulado':kinds[row.kind]}</Badge></span></button>)}</Card>
          :<EmptyState icon={ArrowRightLeft} title="Sin movimientos"
            description="Registra un ingreso, egreso o transferencia."/>)}
    </>}
    {selectedAccount&&<Modal title="Detalle de la cuenta" onClose={()=>setSelectedAccount(null)} footer={<>
      <Button variant="ghost" onClick={()=>setSelectedAccount(null)}>Cerrar</Button>
      {canManage&&<Button variant="secondary" onClick={()=>{setAccountForm(selectedAccount);
        setSelectedAccount(null);}}>Editar cuenta</Button>}</>}>
      <div className="detail-grid"><div><small>Cuenta</small><strong>{selectedAccount.name}</strong></div>
        <div><small>Tipo</small><strong>{names[selectedAccount.kind]}</strong></div>
        <div><small>Saldo inicial</small><strong>{show(selectedAccount.openingBalance)}</strong></div>
        <div><small>Saldo actual</small><strong>{show(selectedAccount.balance)}</strong></div></div>
    </Modal>}
    {selectedMovement&&!cancelling&&<Modal title="Detalle del movimiento"
      onClose={()=>setSelectedMovement(null)} footer={<><Button variant="ghost"
        onClick={()=>setSelectedMovement(null)}>Cerrar</Button>
        {canManage&&!selectedMovement.cancelledAt&&<Button variant="secondary"
          onClick={()=>{setError('');setCancelling(true);}}>Anular</Button>}</>}>
      <div className="detail-grid"><div><small>Concepto</small><strong>{selectedMovement.concept}</strong></div>
        <div><small>Tipo</small><strong>{kinds[selectedMovement.kind]}</strong></div>
        <div><small>Fecha</small><strong>{formatDate(selectedMovement.occurredOn)}</strong></div>
        <div><small>Valor</small><strong>{show(selectedMovement.amount)}</strong></div>
        <div><small>Cuenta origen</small><strong>{selectedMovement.sourceAccountName??'—'}</strong></div>
        <div><small>Cuenta destino</small><strong>{selectedMovement.destinationAccountName??'—'}</strong></div>
        {selectedMovement.category&&<div><small>Categoría</small><strong>{selectedMovement.category}</strong></div>}
        {selectedMovement.notes&&<div><small>Notas</small><strong>{selectedMovement.notes}</strong></div>}
        {selectedMovement.cancellationReason&&<div><small>Anulación</small>
          <strong>{selectedMovement.cancellationReason}</strong></div>}</div>
    </Modal>}
    {selectedMovement&&cancelling&&<Modal title="Anular movimiento"
      onClose={()=>setCancelling(false)} footer={<><Button variant="ghost"
        onClick={()=>setCancelling(false)}>Volver</Button>
        <Button type="submit" form="finance-cancel" loading={busy}>Confirmar</Button></>}>
      <form id="finance-cancel" className="form-stack" onSubmit={event=>void confirmCancel(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Motivo" required><Textarea name="reason" required minLength={3} maxLength={3000}/></Field>
      </form></Modal>}
    {accountForm!==undefined&&<Modal title={accountForm?'Editar cuenta':'Nueva cuenta'}
      onClose={()=>setAccountForm(undefined)} footer={<><Button variant="ghost"
        onClick={()=>setAccountForm(undefined)}>Cancelar</Button>
        <Button type="submit" form="finance-account" loading={busy}>Guardar</Button></>}>
      <form id="finance-account" className="form-stack" onSubmit={event=>void saveAccount(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Nombre" required><Input name="name" required maxLength={160}
          defaultValue={accountForm?.name??''}/></Field>
        <Field label="Tipo"><Select name="kind" defaultValue={accountForm?.kind??'CASH'}>
          {Object.entries(names).map(([code,name])=><option value={code} key={code}>{name}</option>)}
        </Select></Field>
        {accountForm?<label><input name="active" type="checkbox" defaultChecked={accountForm.active}/>
          Cuenta activa</label>:<Field label="Saldo inicial (USD)" required><Input name="openingBalance"
            type="number" step="0.01" defaultValue="0" required/></Field>}
      </form></Modal>}
    {movementForm&&<Modal title="Nuevo movimiento" onClose={()=>setMovementForm(false)}
      footer={<><Button variant="ghost" onClick={()=>setMovementForm(false)}>Cancelar</Button>
        <Button type="submit" form="finance-movement" loading={busy}>Guardar</Button></>}>
      <form id="finance-movement" className="form-stack" onSubmit={event=>void saveMovement(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Tipo"><Select value={movementKind} onChange={event=>setMovementKind(
          event.target.value as FinanceMovement['kind'])}>
          <option value="EXPENSE">Egreso</option><option value="INCOME">Ingreso</option>
          <option value="TRANSFER">Transferencia</option></Select></Field>
        {(movementKind==='EXPENSE'||movementKind==='TRANSFER')&&<Field label="Cuenta origen" required>
          <Select name="sourceAccountId" required><option value="">Selecciona</option>
            {active.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</Select></Field>}
        {(movementKind==='INCOME'||movementKind==='TRANSFER')&&<Field label="Cuenta destino" required>
          <Select name="destinationAccountId" required><option value="">Selecciona</option>
            {active.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</Select></Field>}
        <div className="form-grid"><Field label="Valor (USD)" required><Input name="amount" type="number"
          min="0.01" step="0.01" required/></Field>
          <Field label="Fecha" required><Input name="occurredOn" type="date" required max={today()}
            defaultValue={today()}/></Field></div>
        <Field label="Concepto" required><Input name="concept" required maxLength={240}/></Field>
        <Field label="Categoría"><Input name="category" maxLength={120}/></Field>
        <Field label="Notas"><Textarea name="notes" maxLength={3000}/></Field>
      </form></Modal>}
    {canManage&&<FloatingActionDock><IconButton label={tab==='ACCOUNTS'?'Nueva cuenta':'Nuevo movimiento'}
      onClick={()=>{setError('');if(tab==='ACCOUNTS'||!active.length)setAccountForm(null);
        else{setMovementKind('EXPENSE');setMovementForm(true);}}}>
      {tab==='MOVEMENTS'?<ArrowUpRight size={23}/>:tab==='SUMMARY'?<ArrowDownLeft size={23}/>:<Plus size={23}/>}
    </IconButton></FloatingActionDock>}
  </div>;
}

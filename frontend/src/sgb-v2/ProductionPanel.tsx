import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {CalendarRange,Gauge,Milk,Plus} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal} from '../components/ui';
import {formatDate} from '../utils';
import {ApiRequestError,createLactation,finishLactation,getProduction,recordMilk,
  recordTank,setLactationMilking,setCowMilking,type MilkShift,type ProductionRecords} from './api';

function localDate(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
const issue=(error:unknown)=>error instanceof ApiRequestError ? error.message
  : error instanceof Error ? error.message : 'No se pudo guardar la producción.';
const optional=(data:FormData,key:string)=>String(data.get(key)||'').trim()||null;
const shiftName:Record<MilkShift,string>={MORNING:'Mañana',AFTERNOON:'Tarde',NIGHT:'Noche',SINGLE:'Único'};
function ShiftSelect(){return <select name="shift" defaultValue="SINGLE">
  {Object.entries(shiftName).map(([code,label])=><option key={code} value={code}>{label}</option>)}
</select>;}

export function ProductionPanel({accessToken,canManage,initialAnimalId}:{accessToken:string;
  canManage:boolean;initialAnimalId?:string|undefined}){
  const [records,setRecords]=useState<ProductionRecords|null>(null);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [date,setDate]=useState(localDate());
  const [tab,setTab]=useState<'production'|'lactations'>('production');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<{kind:'MILK'|'TANK'|'LACTATION'|'COW';id:string}|null>(null);
  const [activeForm,setActiveForm]=useState<'LACTATION'|'MILK'|'TANK'|null>(null);
  useEffect(()=>{
    let active=true;
    void getProduction(accessToken).then((value)=>{if(active)setRecords(value);})
      .catch((failure)=>{if(active)setError(issue(failure));});
    return ()=>{active=false;};
  },[accessToken,revision]);
  const milkingCows=records?.cows.filter((row)=>row.inMilking)??[];
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  useEffect(()=>{if(!initialAnimalId||initialAnimalId===prefilledAnimalId||!records||!canManage)return;
    if(records.cows.some(row=>row.id===initialAnimalId&&row.inMilking)){
      setActiveForm('MILK');setPrefilledAnimalId(initialAnimalId);}
  },[initialAnimalId,prefilledAnimalId,records,canManage]);
  const daily=useMemo(()=>({
    milk:records?.milk.filter((row)=>row.producedOn===date&&row.cowName.toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()))??[],
    tanks:records?.tanks.filter((row)=>row.producedOn===date&&(!search||'tanque'
      .includes(search.trim().toLocaleLowerCase())))??[],
  }),[records,date,search]);
  const lactations=useMemo(()=>records?.lactations.filter(row=>row.cowName.toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase()))??[],[records,search]);
  const viewMilk=selected?.kind==='MILK'?records?.milk.find(row=>row.id===selected.id):null;
  const viewTank=selected?.kind==='TANK'?records?.tanks.find(row=>row.id===selected.id):null;
  const viewLactation=selected?.kind==='LACTATION'?records?.lactations.find(row=>row.id===selected.id):null;
  const viewCow=selected?.kind==='COW'?records?.cows.find(row=>row.id===selected.id):null;
  async function run(operation:()=>Promise<unknown>,form?:HTMLFormElement){
    setBusy(true);setError(null);
    try{await operation();form?.reset();setActiveForm(null);setSelected(null);
      setRevision((value)=>value+1);}
    catch(failure){setError(issue(failure));}
    finally{setBusy(false);}
  }
  function start(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>createLactation(accessToken,{birthId:String(data.get('birthId')),
      inMilking:data.get('inMilking')==='on',notes:optional(data,'notes')}),form);
  }
  function milk(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>recordMilk(accessToken,{cowId:String(data.get('cowId')),
      producedOn:String(data.get('producedOn')),shift:String(data.get('shift')) as MilkShift,
      liters:Number(data.get('liters')),source:String(data.get('source')) as 'MANUAL'|'SENSOR',
      externalReference:optional(data,'externalReference'),notes:optional(data,'notes')}),form);
  }
  function tank(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>recordTank(accessToken,{producedOn:String(data.get('producedOn')),
      shift:String(data.get('shift')) as MilkShift,liters:Number(data.get('liters')),
      source:String(data.get('source')) as 'MANUAL'|'SENSOR',
      externalReference:optional(data,'externalReference'),notes:optional(data,'notes')}),form);
  }
  return <section className="module-no-header production-panel">
    <div className="form-toolbar reproduction-tabs" role="tablist" aria-label="Producción">
      <button type="button" role="tab" aria-selected={tab==='production'}
        className={tab==='production'?'active':''} onClick={()=>setTab('production')}><Milk size={17}/>Producción</button>
      <button type="button" role="tab" aria-selected={tab==='lactations'}
        className={tab==='lactations'?'active':''} onClick={()=>setTab('lactations')}>
        <CalendarRange size={17}/>Lactancias</button></div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar vaca…"
      count={tab==='production'?daily.milk.length+daily.tanks.length:lactations.length}/>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {!records&&!error&&<LoadingState/>}
    {!records&&error&&<ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>}
    {canManage&&records&&activeForm&&<Modal title="Registrar producción" wide
      onClose={()=>setActiveForm(null)} footer={<Button variant="ghost"
        onClick={()=>setActiveForm(null)}>Cerrar</Button>}>
      <div className="form-toolbar" aria-label="Tipo de registro">
      {([['LACTATION','Iniciar lactancia'],['MILK','Ordeño'],['TANK','Tanque']] as const)
        .map(([id,label])=><button type="button" key={id} className={activeForm===id?'active':''}
          aria-pressed={activeForm===id} onClick={()=>setActiveForm(id)}>{label}</button>)}
      </div>
      <div className="production-forms">
      <form className="group-new-form" onSubmit={start} hidden={activeForm!=='LACTATION'}>
        <h3>Iniciar lactancia</h3>
        <label><span>Parto *</span><select name="birthId" required defaultValue="">
          <option value="" disabled>Selecciona el parto de la vaca</option>
          {records.births.map((row)=><option key={row.id} value={row.id}>{row.cowName} · {row.occurredOn}</option>)}
        </select></label>
        <label><span>En ordeño</span><input type="checkbox" name="inMilking" defaultChecked /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy||!records.births.length}>Iniciar lactancia</button>
      </form>
      <form className="group-new-form" onSubmit={milk} hidden={activeForm!=='MILK'}>
        <h3>Registrar ordeño</h3>
        <label><span>Vaca en ordeño *</span><select name="cowId" required
          defaultValue={milkingCows.some(row=>row.id===initialAnimalId)?initialAnimalId:''}>
          <option value="" disabled>Selecciona la vaca</option>
          {milkingCows.map((row)=><option key={row.id} value={row.id}>
            {row.name}{row.lactationId?' · con lactancia':' · sin lactancia'}</option>)}
        </select></label>
        <label><span>Fecha *</span><input type="date" name="producedOn" required defaultValue={localDate()} /></label>
        <label><span>Turno</span><ShiftSelect/></label>
        <label><span>Litros *</span><input type="number" name="liters" min="0" max="10000" step="0.001" required /></label>
        <label><span>Fuente</span><select name="source" defaultValue="MANUAL">
          <option value="MANUAL">Manual</option><option value="SENSOR">Sensor</option>
        </select></label>
        <label><span>Referencia externa</span><input name="externalReference" maxLength={160}/></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy||!milkingCows.length}>Guardar ordeño</button>
      </form>
      <form className="group-new-form" onSubmit={tank} hidden={activeForm!=='TANK'}>
        <h3>Registrar tanque</h3>
        <label><span>Fecha *</span><input type="date" name="producedOn" required defaultValue={localDate()}/></label>
        <label><span>Turno</span><ShiftSelect/></label>
        <label><span>Litros *</span><input type="number" name="liters" min="0" max="100000" step="0.001" required/></label>
        <label><span>Fuente</span><select name="source" defaultValue="MANUAL">
          <option value="MANUAL">Manual</option><option value="SENSOR">Sensor</option>
        </select></label>
        <label><span>Referencia externa</span><input name="externalReference" maxLength={160}/></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy}>Guardar tanque</button>
      </form>
    </div></Modal>}
    {records&&tab==='production'&&<><div className="production-date-filter">
      <label><span>Fecha</span><input type="date" value={date}
        onChange={event=>setDate(event.target.value)}/></label></div>
      <section className="production-daily-compact"><div className="production-daily-group">
        <header><span><Milk size={18}/><strong>Producción por animal</strong></span>
          <b>{records.milk.filter(row=>row.producedOn===date)
            .reduce((sum,row)=>sum+row.liters,0).toFixed(3)} L</b></header>
        {daily.milk.length?<div className="production-compact-list">{daily.milk.map(row=><button
          type="button" className="production-compact-row" key={row.id}
          onClick={()=>setSelected({kind:'MILK',id:row.id})}>
          <span><strong>{row.cowName}</strong><small>{shiftName[row.shift as MilkShift]??row.shift}
            {' · '}{row.source==='SENSOR'?'Sensor':'Manual'}</small></span>
          <b>{row.liters.toFixed(3)} L</b></button>)}</div>:<p className="production-compact-empty">
          Sin producción animal en la fecha seleccionada.</p>}</div>
        <div className="production-daily-group tank-group"><header><span><Gauge size={18}/>
          <strong>Producción del tanque</strong></span><b>{records.tanks.filter(row=>row.producedOn===date)
            .reduce((sum,row)=>sum+row.liters,0).toFixed(3)} L</b></header>
          {daily.tanks.length?<div className="production-compact-list">{daily.tanks.map(row=><button
            type="button" className="production-compact-row" key={row.id}
            onClick={()=>setSelected({kind:'TANK',id:row.id})}>
            <span><strong>{shiftName[row.shift as MilkShift]??row.shift}</strong>
              <small>{row.source==='SENSOR'?'Sensor':'Manual'}</small></span>
            <b>{row.liters.toFixed(3)} L</b></button>)}</div>:<p className="production-compact-empty">
            Sin mediciones de tanque en la fecha seleccionada.</p>}</div></section></>}
    {records&&tab==='lactations'&&<>
      {lactations.length?<Card className="lactation-compact-list">{lactations.map(row=><button
        type="button" className="lactation-compact-row" key={row.id}
        onClick={()=>setSelected({kind:'LACTATION',id:row.id})}>
        <strong>{row.cowName}</strong><span className="lactation-period"><small>Período</small>
          <strong>{formatDate(row.startedOn)} – {row.endedOn?formatDate(row.endedOn):'Actualidad'}</strong>
        </span><span className="lactation-status"><Badge tone={row.endedOn?'neutral':'success'}>
          {row.endedOn?'Cerrada':'Activa'}</Badge>{row.inMilking&&<Badge tone="info">En ordeño</Badge>}
        </span></button>)}</Card>:<EmptyState icon={CalendarRange} title="Sin lactancias"
        description="Abre una lactancia para habilitar el registro diario de esa vaca."/>}
      {records.cows.length>0&&<section className="production-daily-group production-cows">
        <header><span><Milk size={18}/><strong>Vacas aptas para ordeño</strong></span></header>
        <div className="production-compact-list">{records.cows.filter(row=>row.name.toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())).map(row=><button type="button"
          className="production-compact-row" key={row.id}
          onClick={()=>setSelected({kind:'COW',id:row.id})}><span><strong>{row.name}</strong>
            <small>{row.inMilking?'En ordeño':'Sin ordeño'}</small></span>
          <Badge tone={row.inMilking?'success':'neutral'}>{row.inMilking?'Activa':'Pausada'}</Badge></button>)}
        </div></section>}</>}
    {viewMilk&&<Modal title="Detalle de producción" onClose={()=>setSelected(null)}
      footer={<Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>}>
      <div className="detail-grid"><div><small>Animal</small><strong>{viewMilk.cowName}</strong></div>
        <div><small>Fecha</small><strong>{formatDate(viewMilk.producedOn)}</strong></div>
        <div><small>Producción</small><strong>{viewMilk.liters.toFixed(3)} L</strong></div>
        <div><small>Turno</small><strong>{shiftName[viewMilk.shift as MilkShift]??viewMilk.shift}</strong></div>
        <div><small>Fuente</small><strong>{viewMilk.source}</strong></div>
        {viewMilk.notes&&<div><small>Observaciones</small><strong>{viewMilk.notes}</strong></div>}
      </div></Modal>}
    {viewTank&&<Modal title="Detalle del tanque" onClose={()=>setSelected(null)}
      footer={<Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>}>
      <div className="detail-grid"><div><small>Fecha</small><strong>{formatDate(viewTank.producedOn)}</strong></div>
        <div><small>Litros</small><strong>{viewTank.liters.toFixed(3)} L</strong></div>
        <div><small>Turno</small><strong>{shiftName[viewTank.shift as MilkShift]??viewTank.shift}</strong></div>
        <div><small>Fuente</small><strong>{viewTank.source}</strong></div>
        {viewTank.notes&&<div><small>Observaciones</small><strong>{viewTank.notes}</strong></div>}
      </div></Modal>}
    {viewLactation&&<Modal title="Detalle de lactancia" onClose={()=>setSelected(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {canManage&&!viewLactation.endedOn&&<><Button variant="secondary" disabled={busy}
          onClick={()=>void run(()=>setLactationMilking(accessToken,viewLactation.id,
            !viewLactation.inMilking))}>{viewLactation.inMilking?'Pausar ordeño':'Reanudar ordeño'}</Button>
          <Button disabled={busy} onClick={()=>{const endedOn=window.prompt(
            'Fecha de cierre (AAAA-MM-DD)',localDate());if(endedOn)void run(()=>finishLactation(
              accessToken,viewLactation.id,endedOn));}}>Cerrar lactancia</Button></>}</>}>
      <div className="detail-grid"><div><small>Animal</small><strong>{viewLactation.cowName}</strong></div>
        <div><small>Inicio</small><strong>{formatDate(viewLactation.startedOn)}</strong></div>
        <div><small>Fin</small><strong>{viewLactation.endedOn?formatDate(viewLactation.endedOn):'Actualidad'}</strong></div>
        <div><small>Estado</small><strong>{viewLactation.inMilking?'En ordeño':'Pausada'}</strong></div>
        {viewLactation.notes&&<div><small>Observaciones</small><strong>{viewLactation.notes}</strong></div>}
      </div></Modal>}
    {viewCow&&<Modal title="Estado del ordeño" onClose={()=>setSelected(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {canManage&&<Button disabled={busy} onClick={()=>void run(()=>setCowMilking(accessToken,
          viewCow.id,!viewCow.inMilking))}>{viewCow.inMilking?'Pausar ordeño':'Activar ordeño'}</Button>}</>}>
      <div className="detail-grid"><div><small>Animal</small><strong>{viewCow.name}</strong></div>
        <div><small>Estado</small><strong>{viewCow.inMilking?'En ordeño':'Sin ordeño'}</strong></div>
      </div></Modal>}
    {canManage&&records&&<FloatingActionDock>{tab==='production'&&<IconButton label="Medición del tanque"
      className="secondary-fab" onClick={()=>setActiveForm('TANK')}><Gauge size={21}/></IconButton>}
      <IconButton label={tab==='production'?'Producción por vaca':'Nueva lactancia'}
        onClick={()=>setActiveForm(tab==='production'?'MILK':'LACTATION')}><Plus size={23}/>
      </IconButton></FloatingActionDock>}
  </section>;
}

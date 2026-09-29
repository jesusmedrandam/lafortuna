import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {CalendarRange,Gauge,Milk,Plus} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal} from '../components/ui';
import {formatDate} from '../utils';
import {ApiRequestError,createLactation,finishLactation,getProduction,recordMilk,
  recordTank,setLactationMilking,setCowMilking,type MilkShift,type ProductionRecords} from './api';
import {SearchableSelect} from './SearchableSelect';

function localDate(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
const issue=(error:unknown)=>error instanceof ApiRequestError ? error.message
  : error instanceof Error ? error.message : 'No se pudo guardar la producción.';
const optional=(data:FormData,key:string)=>String(data.get(key)||'').trim()||null;
const shiftName:Record<MilkShift,string>={MORNING:'Mañana',AFTERNOON:'Tarde',NIGHT:'Noche',SINGLE:'Único'};

export function ProductionPanel({accessToken,canManage,initialAnimalId,initialAction,onCompleted}:{
  accessToken:string;canManage:boolean;initialAnimalId?:string|undefined;
  initialAction?:string;onCompleted?:()=>void}){
  const [records,setRecords]=useState<ProductionRecords|null>(null);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [date,setDate]=useState(initialAnimalId?'':localDate());
  const [tab,setTab]=useState<'production'|'lactations'>('production');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<{kind:'MILK'|'TANK'|'LACTATION'|'COW';id:string}|null>(null);
  const [activeForm,setActiveForm]=useState<'LACTATION'|'MILK'|'TANK'|'CLOSE_LACTATION'|null>(null);
  const [birthId,setBirthId]=useState('');
  const [milkCowId,setMilkCowId]=useState('');
  const [milkShift,setMilkShift]=useState<MilkShift>('SINGLE');
  const [milkSource,setMilkSource]=useState<'MANUAL'|'SENSOR'>('MANUAL');
  const [tankShift,setTankShift]=useState<MilkShift>('SINGLE');
  const [tankSource,setTankSource]=useState<'MANUAL'|'SENSOR'>('MANUAL');
  const [closingLactationId,setClosingLactationId]=useState<string|null>(null);
  const [closeDate,setCloseDate]=useState(localDate());
  useEffect(()=>{
    let active=true;
    void getProduction(accessToken).then((value)=>{if(active)setRecords(value);})
      .catch((failure)=>{if(active)setError(issue(failure));});
    return ()=>{active=false;};
  },[accessToken,revision]);
  const milkingCows=records?.cows.filter((row)=>row.inMilking)??[];
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  useEffect(()=>{const requested=initialAction??new URLSearchParams(window.location.search).get('accion');
    if(!initialAnimalId||initialAnimalId===prefilledAnimalId||!records||!canManage)return;
    if(requested==='LECHE'&&records.cows.some(row=>row.id===initialAnimalId&&row.inMilking)){
      setMilkCowId(initialAnimalId);setActiveForm('MILK');setPrefilledAnimalId(initialAnimalId);return;}
    if(requested==='CERRAR_LACTANCIA'){const active=records.lactations.find(row=>
      row.cowId===initialAnimalId&&!row.endedOn);if(active){setClosingLactationId(active.id);
        setCloseDate(localDate());setActiveForm('CLOSE_LACTATION');setPrefilledAnimalId(initialAnimalId);}}
  },[initialAnimalId,prefilledAnimalId,records,canManage,initialAction]);
  const daily=useMemo(()=>({
    milk:records?.milk.filter((row)=>(!initialAnimalId||row.cowId===initialAnimalId)&&
      (!date||row.producedOn===date)&&row.cowName.toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()))??[],
    tanks:initialAnimalId?[]:records?.tanks.filter((row)=>(!date||row.producedOn===date)&&(!search||'tanque'
      .includes(search.trim().toLocaleLowerCase())))??[],
  }),[records,date,search,initialAnimalId]);
  const lactations=useMemo(()=>records?.lactations.filter(row=>(!initialAnimalId||
    row.cowId===initialAnimalId)&&row.cowName.toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase()))??[],[records,search,initialAnimalId]);
  const viewMilk=selected?.kind==='MILK'?records?.milk.find(row=>row.id===selected.id):null;
  const viewTank=selected?.kind==='TANK'?records?.tanks.find(row=>row.id===selected.id):null;
  const viewLactation=selected?.kind==='LACTATION'?records?.lactations.find(row=>row.id===selected.id):null;
  const viewCow=selected?.kind==='COW'?records?.cows.find(row=>row.id===selected.id):null;
  const closingLactation=records?.lactations.find(row=>row.id===closingLactationId);
  async function run(operation:()=>Promise<unknown>,form?:HTMLFormElement){
    setBusy(true);setError(null);
    try{await operation();form?.reset();setActiveForm(null);setSelected(null);setClosingLactationId(null);
      if(initialAction)onCompleted?.();
      setRevision((value)=>value+1);}
    catch(failure){setError(issue(failure));}
    finally{setBusy(false);}
  }
  function start(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>createLactation(accessToken,{birthId,
      inMilking:data.get('inMilking')==='on',notes:optional(data,'notes')}),form);
  }
  function milk(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>recordMilk(accessToken,{cowId:milkCowId,
      producedOn:String(data.get('producedOn')),shift:milkShift,
      liters:Number(data.get('liters')),source:milkSource,
      externalReference:optional(data,'externalReference'),notes:optional(data,'notes')}),form);
  }
  function tank(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;
    const data=new FormData(form);
    void run(()=>recordTank(accessToken,{producedOn:String(data.get('producedOn')),
      shift:tankShift,liters:Number(data.get('liters')),
      source:tankSource,
      externalReference:optional(data,'externalReference'),notes:optional(data,'notes')}),form);
  }
  function closeLactation(event:FormEvent<HTMLFormElement>){event.preventDefault();
    if(!closingLactation)return;void run(()=>finishLactation(accessToken,closingLactation.id,closeDate),
      event.currentTarget);}
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
    {canManage&&records&&activeForm&&<Modal title={activeForm==='CLOSE_LACTATION'?'Cerrar lactancia':'Registrar producción'} wide
      onClose={()=>{setActiveForm(null);setClosingLactationId(null);}} footer={<Button variant="ghost"
        onClick={()=>{setActiveForm(null);setClosingLactationId(null);}}>Cerrar</Button>}>
      {!initialAction&&activeForm!=='CLOSE_LACTATION'&&<div className="form-toolbar" aria-label="Tipo de registro">
      {([['LACTATION','Iniciar lactancia'],['MILK','Ordeño'],['TANK','Tanque']] as const)
        .map(([id,label])=><button type="button" key={id} className={activeForm===id?'active':''}
          aria-pressed={activeForm===id} onClick={()=>setActiveForm(id)}>{label}</button>)}
      </div>}
      <div className="production-forms">
      <form className="group-new-form" onSubmit={start} hidden={activeForm!=='LACTATION'}>
        <h3>Iniciar lactancia</h3>
        <label><span>Parto *</span><SearchableSelect value={birthId} onChange={setBirthId}
          title="Seleccionar parto" placeholder="Selecciona el parto de la vaca"
          searchPlaceholder="Buscar por vaca o fecha…" options={records.births.map(row=>({value:row.id,
            label:row.cowName,description:formatDate(row.occurredOn)}))}/></label>
        <label><span>En ordeño</span><input type="checkbox" name="inMilking" defaultChecked /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy||!birthId}>Iniciar lactancia</button>
      </form>
      <form className="group-new-form" onSubmit={milk} hidden={activeForm!=='MILK'}>
        <h3>Registrar ordeño</h3>
        <label><span>Vaca en ordeño *</span>{initialAnimalId&&milkCowId?<div className="health-fixed-animal selected">
          <strong>{milkingCows.find(row=>row.id===milkCowId)?.name??'Vaca seleccionada'}</strong>
          <small>Seleccionada desde su ficha</small></div>:<SearchableSelect value={milkCowId}
            onChange={setMilkCowId} title="Seleccionar vaca" placeholder="Selecciona la vaca"
            searchPlaceholder="Buscar vaca…" options={milkingCows.map(row=>({value:row.id,label:row.name,
              description:row.lactationId?'Con lactancia activa':'Sin lactancia'}))}/>}</label>
        <label><span>Fecha *</span><input type="date" name="producedOn" required defaultValue={localDate()} /></label>
        <label><span>Turno</span><SearchableSelect value={milkShift}
          onChange={value=>setMilkShift(value as MilkShift)} title="Turno de ordeño"
          options={Object.entries(shiftName).map(([value,label])=>({value,label}))}/></label>
        <label><span>Litros *</span><input type="number" name="liters" min="0" max="10000" step="0.001" required /></label>
        <label><span>Fuente</span><SearchableSelect value={milkSource}
          onChange={value=>setMilkSource(value as 'MANUAL'|'SENSOR')} title="Fuente de la medición"
          options={[{value:'MANUAL',label:'Manual'},{value:'SENSOR',label:'Sensor'}]}/></label>
        <label><span>Referencia externa</span><input name="externalReference" maxLength={160}/></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy||!milkCowId}>Guardar ordeño</button>
      </form>
      <form className="group-new-form" onSubmit={tank} hidden={activeForm!=='TANK'}>
        <h3>Registrar tanque</h3>
        <label><span>Fecha *</span><input type="date" name="producedOn" required defaultValue={localDate()}/></label>
        <label><span>Turno</span><SearchableSelect value={tankShift}
          onChange={value=>setTankShift(value as MilkShift)} title="Turno del tanque"
          options={Object.entries(shiftName).map(([value,label])=>({value,label}))}/></label>
        <label><span>Litros *</span><input type="number" name="liters" min="0" max="100000" step="0.001" required/></label>
        <label><span>Fuente</span><SearchableSelect value={tankSource}
          onChange={value=>setTankSource(value as 'MANUAL'|'SENSOR')} title="Fuente de la medición"
          options={[{value:'MANUAL',label:'Manual'},{value:'SENSOR',label:'Sensor'}]}/></label>
        <label><span>Referencia externa</span><input name="externalReference" maxLength={160}/></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000}/></label>
        <button className="primary-button compact" disabled={busy}>Guardar tanque</button>
      </form>
      <form className="group-new-form production-close-lactation" onSubmit={closeLactation}
        hidden={activeForm!=='CLOSE_LACTATION'}>
        <h3>Cerrar lactancia activa</h3>
        {closingLactation&&<div className="health-fixed-animal selected"><strong>{closingLactation.cowName}</strong>
          <small>Inició el {formatDate(closingLactation.startedOn)}</small></div>}
        <label><span>Fecha de cierre *</span><input type="date" required value={closeDate}
          min={closingLactation?.startedOn} max={localDate()} onChange={event=>setCloseDate(event.target.value)}/></label>
        <p className="muted">Después del cierre ya no se podrán registrar nuevas producciones dentro de esta lactancia.</p>
        <button className="primary-button compact" disabled={busy||!closingLactation||!closeDate}>
          {busy?'Cerrando…':'Cerrar lactancia'}</button>
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
        <div className="production-compact-list">{records.cows.filter(row=>(!initialAnimalId||
          row.id===initialAnimalId)&&row.name.toLocaleLowerCase()
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
          <Button disabled={busy} onClick={()=>{setSelected(null);setClosingLactationId(viewLactation.id);
            setCloseDate(localDate());setActiveForm('CLOSE_LACTATION');}}>Cerrar lactancia</Button></>}</>}>
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
      className="secondary-fab" onClick={()=>{setTankShift('SINGLE');setTankSource('MANUAL');
        setActiveForm('TANK');}}><Gauge size={21}/></IconButton>}
      <IconButton label={tab==='production'?'Producción por vaca':'Nueva lactancia'}
        onClick={()=>{if(tab==='production'){setMilkCowId(initialAnimalId&&milkingCows.some(row=>row.id===initialAnimalId)
          ?initialAnimalId:'');setMilkShift('SINGLE');setMilkSource('MANUAL');setActiveForm('MILK');}
        else{setBirthId('');setActiveForm('LACTATION');}}}><Plus size={23}/>
      </IconButton></FloatingActionDock>}
  </section>;
}

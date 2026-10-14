import {useEffect,useState,type FormEvent} from 'react';
import {useSearchParams} from 'react-router-dom';
import {ArrowLeftRight,Copy,ChevronRight} from 'lucide-react';
import {Button,IconButton,DateInput,LoadingState} from '../components/ui';
import {AnimalIcon} from '../components/AnimalIcon';
import {formatDate} from '../utils';
import {useV2Session} from './V2Session';
import {getExternalTransferSettings,setExternalTransferSettings,getExternalTransfers,lookupExternalDestination,
 createExternalTransfer,respondExternalTransfer,getMovementOptions,type ExternalTransfer,type ExternalTransferSettings,
 type PreviousAnimalEvent,type MovementOptions} from './api';
import {isRuntimeOnline,refreshCachedPaths} from './offline/runtime';
import {reproductionToday} from './reproductionAge';
import {SearchableSelect} from './SearchableSelect';

const states={PENDING:'Pendiente',ACCEPTED:'Aceptado',REJECTED:'Rechazado',CANCELLED:'Cancelado'};
export function PreviousAnimalHistory({entries}:{entries:PreviousAnimalEvent[]}){
 return <div className="previous-animal-history">{[...entries].sort((a,b)=>b.date.localeCompare(a.date)).map(entry=>
  <details key={entry.id}><summary><strong>{entry.title}</strong><span>{formatDate(entry.date)}</span></summary>
   <small className="muted">{entry.sourcePropertyName}</small>{entry.lines.map((line,index)=><p key={index}>{line.replace(/\d{4}-\d{2}-\d{2}/g,date=>formatDate(date))}</p>)}
   {entry.notes&&<p>{entry.notes}</p>}</details>)}</div>;
}
export function ExternalTransferPolicy({accessToken}:{accessToken:string}){
 const {session}=useV2Session();const context=session?.overview.activeContext;
 const [settings,setSettings]=useState<ExternalTransferSettings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 useEffect(()=>{let active=true;setSettings(null);void getExternalTransferSettings(accessToken).then(value=>{if(active)setSettings(value);})
  .catch(reason=>{if(active)setError(reason.message);});return()=>{active=false;};},[accessToken,context?.propertyId,context?.roleId]);
 return <div className="external-transfer-policy">
  <div className="property-module-row"><div><strong>Traslados entre cuentas</strong><small>Permitir enviar y recibir animales en todas las propiedades del dueño.</small></div>
   <label><input type="checkbox" aria-label="Permitir traslados entre cuentas" checked={settings?.enabled??false}
    disabled={!settings?.canManage||busy||!isRuntimeOnline()} onChange={event=>{setBusy(true);setError('');
     void setExternalTransferSettings(accessToken,event.target.checked).then(setSettings).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}/></label></div>
  {settings&&!settings.canManage&&<small className="muted">Solo el dueño puede cambiar esta opción.</small>}
  {settings?.receiveCode&&<div className="external-receive-code"><label>Código para recibir en esta propiedad<input readOnly value={settings.receiveCode}/></label>
   <IconButton label="Copiar código de recepción" onClick={()=>void navigator.clipboard.writeText(settings.receiveCode!).then(()=>setCopied(true)).catch(()=>setError('Selecciona el código y cópialo.'))}><Copy size={18}/></IconButton>
   <small className="muted">{copied?'Código copiado.':'Comparte este código con el administrador de origen. Cada solicitud necesita tu aceptación.'}</small></div>}
  {error&&<p role="alert" className="form-error">{error}</p>}
 </div>;
}
export function ExternalTransfersPanel({accessToken,propertyId,initialAnimalId,onCompleted}:{accessToken:string;propertyId:string;initialAnimalId?:string|undefined;onCompleted?:()=>void|undefined}){
 const [params,setParams]=useSearchParams();const {session}=useV2Session();
 const [items,setItems]=useState<ExternalTransfer[]|null>(null),[options,setOptions]=useState<MovementOptions|null>(null);
 const [settings,setSettings]=useState<ExternalTransferSettings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [code,setCode]=useState(''),[destination,setDestination]=useState<{id:string;name:string;ownerName:string}|null>(null);
 const [animalIds,setAnimalIds]=useState<string[]>(initialAnimalId?[initialAnimalId]:[]),[groupId,setGroupId]=useState('');
 const [revision]=useState(0),[earTags,setEarTags]=useState<Record<string,string>>({});
 const screen=params.get('solicitud');const selected=items?.find(item=>item.id===screen);
 useEffect(()=>{let active=true;setItems(null);setSettings(null);setOptions(null);setError('');
  void Promise.all([getExternalTransfers(accessToken),getExternalTransferSettings(accessToken)]).then(([rows,policy])=>{if(active){setItems(rows);setSettings(policy);}})
   .catch(reason=>{if(active)setError(reason.message);});
  void getMovementOptions(accessToken).then(value=>{if(active)setOptions(value);}).catch(()=>{});
  return()=>{active=false;};},[accessToken,propertyId,session?.overview.activeContext?.roleId,revision]);
 function open(id:string|null){const next=new URLSearchParams(params);next.set('externos','1');if(id)next.set('solicitud',id);else next.delete('solicitud');setParams(next);setError('');setGroupId('');setEarTags({});}
 async function run(operation:()=>Promise<ExternalTransfer>){if(busy)return;setBusy(true);setError('');
  try{const result=await operation();setItems(rows=>[result,...(rows??[]).filter(row=>row.id!==result.id)]);open(result.id);
   const ids=result.animals.map(row=>result.destinationPropertyId===propertyId?row.destinationAnimalId:row.sourceAnimalId).filter((id):id is string=>Boolean(id));
   if(result.status==='ACCEPTED')await refreshCachedPaths(['/animals?page=1&search=','/animals/summary','/animals/received-histories?page=1','/movements/options','/groups','/reproduction','/reproduction/candidates','/production','/health-records/conditions','/media',
    ...ids.flatMap(id=>[`/animals/${id}`,`/animals/${id}/received-history`])]);
   onCompleted?.();
  }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo completar el traslado.');}finally{setBusy(false);}
 }
 function send(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!destination||!animalIds.length||animalIds.length>50){setError('Comprueba el destino y selecciona entre 1 y 50 animales.');return;}
  const data=new FormData(event.currentTarget);void run(()=>createExternalTransfer(accessToken,{receiveCode:code,animalIds,
   movementOn:String(data.get('movementOn')),reason:String(data.get('reason')).trim(),notes:String(data.get('notes')).trim()||null}));}
 const canDecide=settings?.canRequest&&isRuntimeOnline()&&!busy;
 return <section className="external-transfers-panel">
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!isRuntimeOnline()&&<p className="muted">Puedes consultar lo descargado. Conéctate para enviar o responder solicitudes.</p>}
  {!items&&!error&&<LoadingState/>}
  {!screen&&<><ExternalTransferPolicy accessToken={accessToken}/>
   {settings?.enabled&&settings.canRequest&&<Button disabled={!canDecide} onClick={()=>open('nueva')}><ArrowLeftRight size={18}/>Solicitar traslado</Button>}
   <div className="external-transfer-list">{items?.map(item=><button key={item.id} onClick={()=>open(item.id)}>
    <ArrowLeftRight size={20}/><span><strong>{item.sourcePropertyId===propertyId?`A ${item.destinationPropertyName}`:`Desde ${item.sourcePropertyName}`}</strong>
     <small>{item.animals.map(row=>row.profile?.name??'Animal').join(', ')} · {formatDate(item.movementOn)}</small></span><span>{states[item.status]}</span><ChevronRight size={18}/></button>)}</div>
   {items?.length===0&&<p className="muted">No hay solicitudes de traslado.</p>}</>}
  {screen==='nueva'&&<form onSubmit={send}><h2>Solicitar traslado externo</h2><p className="muted">El animal permanece en origen hasta que el destino acepte. Se comparten ficha, fotos e historial del animal.</p>
   <fieldset disabled={busy||!settings?.canRequest||!isRuntimeOnline()}>
    <label>Código de la propiedad destino<input value={code} required onChange={event=>{setCode(event.target.value.trim());setDestination(null);}}/></label>
    <Button variant="secondary" onClick={()=>{setBusy(true);setError('');void lookupExternalDestination(accessToken,code).then(setDestination).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}>Comprobar destino</Button>
    {destination&&<p><strong>{destination.name}</strong> · {destination.ownerName}</p>}
    <label>Fecha del traslado<DateInput name="movementOn" required defaultValue={reproductionToday()} max={reproductionToday()}/></label>
    <label>Motivo<input name="reason" required minLength={2} maxLength={300}/></label><label>Observaciones<textarea name="notes" maxLength={5000}/></label>
    <p>Animales seleccionados: {animalIds.length}/50</p><div className="external-animal-choices">{options?.animals.map(animal=><label key={animal.id}>
     <input type="checkbox" checked={animalIds.includes(animal.id)} disabled={!animalIds.includes(animal.id)&&animalIds.length>=50} onChange={event=>setAnimalIds(rows=>event.target.checked?[...rows,animal.id]:rows.filter(id=>id!==animal.id))}/>
     {animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}</label>)}</div>
    <Button type="submit" disabled={!destination||!animalIds.length}>Enviar solicitud</Button>
   </fieldset></form>}
  {selected&&<><h2>{selected.sourcePropertyName} → {selected.destinationPropertyName}</h2>
   <p>{states[selected.status]} · {formatDate(selected.movementOn)}</p><p>{selected.reason}</p>{selected.notes&&<p>{selected.notes}</p>}
   {selected.decisionReason&&<p>{selected.decisionReason}</p>}
   {selected.animals.map(item=><details className="external-animal-review" key={item.sourceAnimalId}><summary>
    {item.profile?.profilePhotoUrl?<img src={item.profile.profilePhotoUrl} alt=""/>:<AnimalIcon size={36}/>}<strong>{item.profile?.name??'Animal'}</strong><ChevronRight size={18}/></summary>
    {item.profile&&<><p>{item.profile.sex==='FEMALE'?'Hembra':'Macho'} · {item.profile.classification?.name}{item.profile.earTagCode?` · Arete ${item.profile.earTagCode}`:''}</p>
     <p>Nacimiento: {item.profile.birthDate?formatDate(item.profile.birthDate):'Sin fecha registrada'} · Ingreso en origen: {formatDate(item.profile.entryDate)}</p>
     {item.profile.description&&<p>{item.profile.description}</p>}<p>Propietarios: {item.profile.owners.map(owner=>`${owner.name} (${owner.percent}%)`).join(', ')||'Sin registrar'}</p>
     <p>Grupo de origen: {item.profile.group?.name??'Sin grupo'} · {item.profile.location?.name??''}</p>
     <p>{[item.profile.breeds.map(row=>row.name).join(', '),item.profile.colors?.map(row=>row.name).join(', '),item.profile.brands.map(row=>row.name).join(', ')].filter(Boolean).join(' · ')}</p>
     {(item.profile.mother||item.profile.father)&&<p>Madre: {item.profile.mother?.name??'Sin registrar'} · Padre: {item.profile.father?.name??'Sin registrar'}</p>}</>}
    <p>{item.processes.pregnancy?'Preñez por continuar. ':''}{item.processes.conditions?`${item.processes.conditions} condiciones de salud por continuar. `:''}{item.processes.milking?'En ordeño.':''}</p>
    <PreviousAnimalHistory entries={item.history}/><div className="external-photo-review">{item.media.map(photo=><a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.description??'Foto del animal'} loading="lazy"/></a>)}</div>
   </details>)}
   {selected.status==='PENDING'&&settings?.canRequest&&<fieldset disabled={!canDecide}>
    {selected.destinationPropertyId===propertyId?<>
     <label>Grupo de recepción<SearchableSelect ariaLabel="Grupo de recepción" value={groupId} onChange={setGroupId} options={(options?.groups??[]).filter(group=>group.propertyId===propertyId&&group.locationId).map(group=>({value:group.id,label:group.name,description:group.locationName??''}))}/></label>
     <details><summary>Revisar aretes al recibir</summary>{selected.animals.map(item=><label key={item.sourceAnimalId}>{item.profile?.name}<input
      value={earTags[item.sourceAnimalId]??item.profile?.earTagCode??''} maxLength={80} onChange={event=>setEarTags(rows=>({...rows,[item.sourceAnimalId]:event.target.value}))}/></label>)}<small>El arete anterior quedará conservado en el historial.</small></details>
     <Button disabled={!groupId||!settings.enabled} onClick={()=>void run(()=>respondExternalTransfer(accessToken,selected.id,'accept',{expectedVersion:selected.version,groupId,
      earTags:Object.entries(earTags).map(([animalId,earTagCode])=>({animalId,earTagCode:earTagCode.trim()||null}))}))}>Aceptar e ingresar animales</Button>
     <Button variant="danger" onClick={()=>void run(()=>respondExternalTransfer(accessToken,selected.id,'reject',{expectedVersion:selected.version}))}>Rechazar solicitud</Button>
    </>:<><Button variant="secondary" disabled={!settings.enabled} onClick={()=>void run(()=>respondExternalTransfer(accessToken,selected.id,'refresh',{expectedVersion:selected.version}))}>Actualizar ficha e historial enviados</Button>
     <Button variant="danger" onClick={()=>void run(()=>respondExternalTransfer(accessToken,selected.id,'cancel',{expectedVersion:selected.version}))}>Cancelar solicitud</Button></>}
   </fieldset>}
  </>}
  {screen&&screen!=='nueva'&&items&&!selected&&<p>Esta solicitud ya no está disponible en la propiedad activa.</p>}
 </section>;
}

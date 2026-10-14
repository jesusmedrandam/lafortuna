import {useEffect,useState,type ReactNode} from 'react';
import {formatDate} from '../utils';
import {getActivities,getCleanings,getHealthCampaigns,getMovements,getProduction,getReproduction,type MediaItem} from './api';

async function details(token:string,item:MediaItem){
  if(item.recordDetails)return <><strong>{item.recordDetails.title} · {formatDate(item.recordDetails.date)}</strong>
    {item.recordDetails.lines.map((line,index)=><p key={index}>{line.replace(/\b\d{4}-\d{2}-\d{2}\b/g,date=>formatDate(date))}</p>)}{item.recordDetails.notes&&<p>{item.recordDetails.notes}</p>}</>;
  const id=item.entity_id;
  if(item.entity_type.startsWith('REPRODUCTION_')){
    const data=await getReproduction(token);
    if(item.entity_type==='REPRODUCTION_BIRTH'){
      const row=data.births.find(row=>row.id===id);if(!row)return null;
      return <><strong>Parto · {formatDate(row.occurredOn)}</strong><p>{row.motherName?`Madre: ${row.motherName}. `:''}
        {({NORMAL:'Normal',ASSISTED:'Asistido',CAESAREAN:'Cesárea',UNKNOWN:'Tipo no registrado'} as const)[row.kind??'UNKNOWN']}.
        {' '}{row.liveCount??row.calves.length} {(row.liveCount??row.calves.length)===1?'cría viva':'crías vivas'}{row.stillbornCount?` y ${row.stillbornCount} nacidas sin vida`:''}.</p>
        {row.calves.map(calf=><p key={calf.id}>{calf.name} · {calf.sex==='FEMALE'?'Hembra':'Macho'}{calf.initialWeight?` · ${calf.initialWeight} ${calf.initialWeightUnitCode==='POUND'?'lb':'kg'}`:''}{calf.description?` · ${calf.description}`:''}</p>)}{row.notes&&<p>{row.notes}</p>}</>;
    }
    if(item.entity_type==='REPRODUCTION_HEAT'){const row=data.heats.find(row=>row.id===id);return row?<><strong>{row.isFalse?'Celo falso':'Celo'} · {row.cowName}</strong><p>Inicio: {formatDate(row.startsOn)}{row.endsOn?` · Fin: ${formatDate(row.endsOn)}`:' · Sin finalizar'}</p>{row.notes&&<p>{row.notes}</p>}</>:null;}
    if(item.entity_type==='REPRODUCTION_SERVICE'){const row=data.services.find(row=>row.id===id);return row?<><strong>{row.kind==='INSEMINATION'?'Inseminación artificial':'Implantación de embrión'} · {row.cowName}</strong><p>{formatDate(row.occurredOn)}{row.technician?` · ${row.technician}`:''}</p>{row.notes&&<p>{row.notes}</p>}</>:null;}
    if(item.entity_type==='REPRODUCTION_PREGNANCY'){const row=data.pregnancies.find(row=>row.id===id);return row?<><strong>Preñez · {row.cowName}</strong><p>Confirmada el {formatDate(row.confirmedOn)}{row.expectedBirthOn?` · Parto previsto: ${formatDate(row.expectedBirthOn)}`:''}</p>{row.notes&&<p>{row.notes}</p>}</>:null;}
    const row=data.losses.find(row=>row.id===id);return row?<><strong>Aborto · {row.cowName}</strong><p>{formatDate(row.occurredOn)} · {row.notes}</p></>:null;
  }
  if(item.entity_type==='LIVESTOCK_MOVEMENT'){
    const row=(await getMovements(token)).find(row=>row.id===id);return row?<><strong>Movimiento · {formatDate(row.movementOn)}</strong><p>{row.sourceGroupName} → {row.destinationGroupName}{row.destinationLocationName?` · ${row.destinationLocationName}`:''}</p><p>{row.animals.length} animales · {row.reason}</p>{row.notes&&<p>{row.notes}</p>}</>:null;
  }
  if(item.entity_type==='CLEANING'){
    const row=(await getCleanings(token)).find(row=>row.id===id);return row?<><strong>Limpieza · {row.locationName}</strong><p>{formatDate(row.startedOn)}{row.finishedOn?` al ${formatDate(row.finishedOn)}`:''}</p>{row.products.map(product=><p key={product.productId}>{product.productName} · {product.totalQuantity??product.quantityPerApplication} {product.unitCode}</p>)}{row.notes&&<p>{row.notes}</p>}</>:null;
  }
  if(item.entity_type==='LIVESTOCK_ACTIVITY'){
    const row=(await getActivities(token)).find(row=>row.id===id);return row?<><strong>{row.title} · {formatDate(row.occurredOn)}</strong><p>{row.animals.map(animal=>animal.name).join(', ')}</p>{row.description&&<p>{row.description}</p>}</>:null;
  }
  if(item.entity_type==='HEALTH_CAMPAIGN'){
    const row=(await getHealthCampaigns(token)).find(row=>row.id===id);return row?<><strong>Tratamiento · {row.medicineName}</strong><p>{formatDate(row.appliedOn)} · {row.responsible}</p>{row.notes&&<p>{row.notes}</p>}</>:null;
  }
  if(item.entity_type.startsWith('MILK_')){
    const data=await getProduction(token);const row=[...data.milk,...data.tanks].find(row=>row.id===id);return row?<><strong>Producción de leche · {formatDate(row.producedOn)}</strong><p>{row.liters} litros</p>{row.notes&&<p>{row.notes}</p>}</>:null;
  }
  return null;
}

export function MediaRecordDetails({accessToken,item,permissions}:{accessToken:string;item:MediaItem;permissions:string[]}){
  const type=item.recordType??item.entity_type;
  const permission=type.startsWith('REPRODUCTION_')?'REPRODUCTION_VIEW':({LIVESTOCK_MOVEMENT:'MOVEMENT_VIEW',CLEANING:'CLEANING_VIEW',LIVESTOCK_ACTIVITY:'ACTIVITY_VIEW',HEALTH_CAMPAIGN:'HEALTH_VIEW'} as Record<string,string>)[type]??(type.startsWith('MILK_')?'PRODUCTION_VIEW':null);
  const [content,setContent]=useState<ReactNode>(null);const [error,setError]=useState('');
  const allowed=Boolean(permission&&permissions.includes(permission));
  useEffect(()=>{if(!allowed)return;let active=true;setContent(null);setError('');
    void details(accessToken,item).then(value=>{if(active){setContent(value);if(!value)setError('La información de este registro todavía no está guardada en este dispositivo.');}})
      .catch(()=>{if(active)setError('No se pudo consultar este registro. Conserva su información para verlo sin conexión.');});
    return()=>{active=false;};},[accessToken,item.entity_type,item.entity_id,item.recordDetails,allowed]);
  return allowed?<section className="media-record-details">{content??<small>{error||'Cargando información del registro…'}</small>}</section>:null;
}

import {CalendarDays,Clock3,Users} from 'lucide-react';
import {Badge} from '../components/ui';
import {currentDateInput,dateInputValue,formatDate} from '../utils';
import type {LocationOccupation,PhysicalLocation} from './api';

function calendarDays(start:string|null,end:string){
  if(!start)return null;
  const difference=(Date.parse(`${dateInputValue(end)}T00:00:00Z`)-
    Date.parse(`${dateInputValue(start)}T00:00:00Z`))/86400000;
  return Number.isFinite(difference)&&difference>=0?difference:null;
}
const days=(value:number|null)=>value===null?'Sin datos':`${value} ${value===1?'día':'días'}`;
const animals=(count:number)=>`${count} ${count===1?'animal':'animales'}`;
const duration=(period:LocationOccupation)=>days(calendarDays(period.startedOn,period.endedOn??currentDateInput()));
const rest=(period:LocationOccupation)=>days(calendarDays(period.restStartedOn,period.startedOn));
const dates=(period:LocationOccupation)=>`${formatDate(period.startedOn)} – ${period.endedOn?formatDate(period.endedOn):'En curso'}`;

export function PastureOccupationStatus({place}:{place:PhysicalLocation}){
  const latest=place.occupationHistory?.[0];
  if(place.currentAnimalCount===undefined)return <><Badge>Sin datos de ocupación</Badge></>;
  const occupied=place.currentAnimalCount>0;
  return <>
    <Badge tone={occupied?'info':'success'}>{occupied?'Ocupado':'En descanso'}</Badge>
    <small>{occupied?`${animals(place.currentAnimalCount)} · ${latest?duration(latest):'Sin fecha de entrada'}`
      :`${days(calendarDays(latest?.endedOn??place.lastRestDate,currentDateInput()))} en descanso`}</small>
    {!occupied&&latest&&<small>Última: {animals(latest.animalCount)} · {duration(latest)}</small>}
  </>;
}

export function PastureOccupations({place}:{place:PhysicalLocation}){
  const history=place.occupationHistory;
  const latest=history?.[0];
  return <div className="pasture-detail">
    <section className="pasture-detail-section pasture-latest-occupation">
      <h3>Última ocupación</h3>
      {latest?<div className="pasture-summary-grid">
        <div><CalendarDays size={20}/><span><small>Entrada y salida</small><strong>{dates(latest)}</strong></span></div>
        <div><Users size={20}/><span><small>Animales en esta ocupación</small><strong>{animals(latest.animalCount)}</strong>
          {latest.endedOn===null&&place.currentAnimalCount!==undefined&&<small>{animals(place.currentAnimalCount)} actualmente</small>}</span></div>
        <div><Clock3 size={20}/><span><small>Duración{latest.endedOn===null?' hasta hoy':''}</small><strong>{duration(latest)}</strong></span></div>
        <div><Clock3 size={20}/><span><small>Descanso anterior a la ocupación</small><strong>{rest(latest)}</strong>
          {latest.restStartedOn&&<small>{formatDate(latest.restStartedOn)} – {formatDate(latest.startedOn)}</small>}</span></div>
      </div>:<p className="muted">{history?'Sin ocupaciones registradas.':'No hay información de ocupaciones disponible.'}</p>}
    </section>
    {place.currentAnimalCount===0&&<section className="pasture-detail-section">
      <h3>Descanso actual</h3><p>{days(calendarDays(latest?.endedOn??place.lastRestDate,currentDateInput()))}
        {(latest?.endedOn??place.lastRestDate)&&<> · Desde {formatDate(latest?.endedOn??place.lastRestDate)}</>}</p>
    </section>}
    <section className="pasture-detail-section pasture-occupation-history">
      <h3>Historial de ocupaciones{history&&history.length>0?` (${history.length})`:''}</h3>
      {history?.length?<div className="pasture-history-table">
        <div className="pasture-history-head"><span>Entrada / salida</span><span>Animales</span>
          <span>Duración</span><span>Descanso anterior</span></div>
        {history.map((period,index)=><div className="pasture-history-row" key={`${period.startedOn}:${index}`}>
          <span><small>Entrada / salida</small><strong>{dates(period)}</strong></span>
          <span><small>Animales</small><strong>{animals(period.animalCount)}</strong></span>
          <span><small>Duración</small><strong>{duration(period)}</strong></span>
          <span><small>Descanso anterior</small><strong>{rest(period)}</strong>
            {period.restStartedOn&&<small>{formatDate(period.restStartedOn)} – {formatDate(period.startedOn)}</small>}</span>
        </div>)}
      </div>:<p className="muted">{history?'Sin ocupaciones registradas.':'No hay información de ocupaciones disponible.'}</p>}
    </section>
  </div>;
}

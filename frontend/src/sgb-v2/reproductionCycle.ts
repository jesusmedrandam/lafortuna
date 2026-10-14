import type {ReproductionRecords} from './api';

export function hasActivePregnancy(records:Partial<ReproductionRecords>,cowId:string,activePregnancyId?:string|null){
  const resolved=(id:string)=>(records.births??[]).some(row=>row.pregnancyId===id)
    ||(records.losses??[]).some(row=>row.pregnancyId===id);
  const known=(records.pregnancies??[]).find(row=>row.id===activePregnancyId);
  return Boolean(activePregnancyId&&!resolved(activePregnancyId)&&(!known||known.status==='CONFIRMED'))
    ||(records.pregnancies??[]).some(row=>row.cowId===cowId&&row.status==='CONFIRMED'&&!resolved(row.id));
}

export function pregnancyHeats(records:Partial<ReproductionRecords>,cowId:string,on:string){
  return cycleTrueHeats(records,cowId,on).filter(heat=>!heat.hasPregnancy
    &&!(records.pregnancies??[]).some(row=>row.heatId===heat.id&&row.status!=='CANCELLED')
    &&!(records.births??[]).some(row=>row.motherId===cowId&&row.occurredOn>heat.startsOn)
    &&!(records.losses??[]).some(row=>row.cowId===cowId&&row.occurredOn>heat.startsOn));
}

export function pregnancyServiceAvailable(records:Partial<ReproductionRecords>,service:ReproductionRecords['services'][number]){
  return !service.cancelled&&!service.hasPregnancy
    &&!(records.pregnancies??[]).some(row=>row.serviceId===service.id&&row.status!=='CANCELLED')
    &&!(records.births??[]).some(row=>row.motherId===service.cowId&&row.occurredOn>service.occurredOn)
    &&!(records.losses??[]).some(row=>row.cowId===service.cowId&&row.occurredOn>service.occurredOn);
}

export function cycleTrueHeats(records:Partial<ReproductionRecords>,cowId:string,on:string){
  const boundaries=[...(records.births??[]).filter(row=>row.motherId===cowId),
    ...(records.losses??[]).filter(row=>row.cowId===cowId)].map(row=>row.occurredOn).concat((records.cycleBoundaries??[]).filter(row=>row.cowId===cowId).flatMap(row=>[row.lastBirthOn,row.lastLossOn].filter((date):date is string=>Boolean(date)))).sort();
  const previous=boundaries.filter(date=>date<=on).at(-1)??'';
  const next=boundaries.find(date=>date>on)??'9999-12-31';
  return (records.heats??[]).filter(heat=>heat.cowId===cowId&&!heat.cancelled&&!heat.isFalse
    &&heat.startsOn>=previous&&heat.startsOn<next).sort((a,b)=>b.startsOn.localeCompare(a.startsOn));
}

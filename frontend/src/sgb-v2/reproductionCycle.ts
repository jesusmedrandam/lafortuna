import type {ReproductionRecords} from './api';

export function cycleTrueHeats(records:ReproductionRecords,cowId:string,on:string){
  const boundaries=[...records.births.filter(row=>row.motherId===cowId),
    ...records.losses.filter(row=>row.cowId===cowId)].map(row=>row.occurredOn).sort();
  const previous=boundaries.filter(date=>date<=on).at(-1)??'';
  const next=boundaries.find(date=>date>on)??'9999-12-31';
  return records.heats.filter(heat=>heat.cowId===cowId&&!heat.cancelled&&!heat.isFalse
    &&heat.startsOn>=previous&&heat.startsOn<next).sort((a,b)=>b.startsOn.localeCompare(a.startsOn));
}

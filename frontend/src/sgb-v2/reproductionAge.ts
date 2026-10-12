// Calendar months match PostgreSQL, including births on the last day of a month.
export function reproductionToday(){
  const parts=new Intl.DateTimeFormat('en',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
}
export function reachedReproductionAge(birthDate:string|null|undefined,eventOn:string,months:number){
  if(birthDate===null||months===0)return true;
  if(!birthDate)return false;
  const [year,month,day]=birthDate.split('-').map(Number);
  const target=new Date(Date.UTC(year!,month!-1+months,1));
  const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  const threshold=`${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(day!,lastDay)).padStart(2,'0')}`;
  return eventOn>=threshold;
}

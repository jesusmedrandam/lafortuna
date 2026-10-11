// Calendar months match PostgreSQL, including births on the last day of a month.
export function reachedReproductionAge(birthDate:string|null|undefined,eventOn:string,months:number){
  if(!birthDate||months===0)return true;
  const [year,month,day]=birthDate.split('-').map(Number);
  const target=new Date(Date.UTC(year!,month!-1+months,1));
  const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  const threshold=`${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(day!,lastDay)).padStart(2,'0')}`;
  return eventOn>=threshold;
}

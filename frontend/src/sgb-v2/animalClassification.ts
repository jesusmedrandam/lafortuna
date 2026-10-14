import type {Animal,AnimalClassificationPolicy,ReproductionRecords} from './api';
import {reachedReproductionAge,reproductionToday} from './reproductionAge';

const labels={VACA:'Vaca',VACONA:'Vacona',TERNERA:'Ternera',TORO:'Toro',TORETE:'Torete',TERNERO:'Ternero'};
export function animalClassification(animal:Pick<Animal,'id'|'sex'|'birthDate'|'classification'>,
  policy:Partial<AnimalClassificationPolicy>,records:Partial<ReproductionRecords>,on=reproductionToday()){
  const previous=animal.classification?.code;
  const adultHistory=animal.sex==='FEMALE'?(records.births??[]).some(row=>row.motherId===animal.id&&row.occurredOn<=on)
    :(records.pregnancies??[]).some(row=>row.fatherId===animal.id&&row.status!=='CANCELLED'&&row.confirmedOn<=on);
  const months=animal.sex==='FEMALE'?policy.femaleAdultMonths:policy.maleAdultMonths;
  if(!adultHistory&&months===undefined&&previous&&(animal.sex==='FEMALE'?['VACA','VACONA','TERNERA']:['TORO','TORETE','TERNERO']).includes(previous))
    return {code:previous,name:policy.names?.[previous as keyof typeof labels]??animal.classification!.name};
  let code:keyof typeof labels;
  if(animal.sex==='FEMALE')code=previous==='VACA'||(records.births??[]).some(row=>row.motherId===animal.id&&row.occurredOn<=on)
    ?'VACA':reachedReproductionAge(animal.birthDate,on,policy.femaleAdultMonths??12)?'VACONA':'TERNERA';
  else code=previous==='TORO'||(records.pregnancies??[]).some(row=>row.fatherId===animal.id&&row.status!=='CANCELLED'&&row.confirmedOn<=on)
    ?'TORO':reachedReproductionAge(animal.birthDate,on,policy.maleAdultMonths??12)?'TORETE':'TERNERO';
  return {code,name:policy.names?.[code]??(previous===code?animal.classification?.name:null)??labels[code]};
}

import {type FormEvent,useState} from 'react';
import {type CatalogItem,type HealthMedicine,type HealthOptions} from './api';
import {SearchableSelect} from './SearchableSelect';

export const medicineKinds={VACUNA:'Vacuna',DESPARASITACION:'Desparasitación',ENFERMEDAD:'Tratamiento de enfermedad',OTRO:'Otro tratamiento'};
export const defaultRoutes={ORAL:'Oral',INTRAMUSCULAR:'Intramuscular',SUBCUTANEA:'Subcutánea',INTRAVENOSA:'Intravenosa',TOPICA:'Tópica',OTRA:'Otra'};
export const routeKey=(route:CatalogItem)=>route.itemCode||route.id;
// Las unidades oficiales permiten usar formularios con descargas anteriores a Sanidad.
export const medicineDoseUnits:HealthOptions['units']=[
  {code:'MILLIGRAM',name:'Miligramo',symbol:'mg'},{code:'GRAM',name:'Gramo',symbol:'g'},
  {code:'MILLILITER',name:'Mililitro',symbol:'ml'},{code:'LITER',name:'Litro',symbol:'l'},
  {code:'UNIT',name:'Unidad',symbol:'u'},{code:'DOSE',name:'Dosis',symbol:'dosis'},
];
export const medicineClassifications=[{code:'VACA',name:'Vaca'},{code:'VACONA',name:'Vacona'},
  {code:'TERNERA',name:'Ternera'},{code:'TORO',name:'Toro'},{code:'TORETE',name:'Torete'},{code:'TERNERO',name:'Ternero'}];
export function medicineDoseReference(medicine:HealthMedicine|undefined,animal:HealthOptions['animals'][number]|undefined,
  units:HealthOptions['units'],classifications=medicineClassifications){
  if(!medicine)return null;
  const symbol=(units.length?units:medicineDoseUnits).find(item=>item.code===medicine.defaultUnitCode)?.symbol??medicine.defaultUnitCode;
  const ranges=medicine.doseClassificationRanges??[];
  if(ranges.length){
    const matched=ranges.filter(range=>range.classificationCode===animal?.classificationCode);
    const reference=(matched.length?matched:ranges).map(range=>
      `${classifications.find(item=>item.code===range.classificationCode)?.name??range.classificationCode}: ${range.min}–${range.max} ${symbol}`).join(' · ');
    return animal?.classificationCode&&!matched.length
      ?`Sin rango para ${classifications.find(item=>item.code===animal.classificationCode)?.name??animal.classificationCode}. ${reference}`:reference;
  }
  if(medicine.doseAmount!=null)return `${medicine.doseAmount} ${symbol}${medicine.doseWeight!=null
    ?` por ${medicine.doseWeight} ${medicine.doseWeightUnitCode==='POUND'?'lb':'kg'}`:' por animal'}`;
  return medicine.suggestedDose||null;
}
export function suggestedMedicineDose(medicine:HealthMedicine|undefined,animal:HealthOptions['animals'][number]|undefined){
  if(medicine?.doseClassificationRanges?.length||!medicine?.doseAmount||!Number.isFinite(medicine.doseAmount))return null;
  let dose=medicine.doseAmount;
  if(medicine.doseWeight!=null){
    if(!animal?.weightKg||!Number.isFinite(animal.weightKg)||animal.weightKg<=0||medicine.doseWeight<=0||
      !['KILOGRAM','POUND'].includes(medicine.doseWeightUnitCode??''))return null;
    dose*=animal.weightKg/(medicine.doseWeight*(medicine.doseWeightUnitCode==='POUND'?0.45359237:1));
  }
  const rounded=Math.round(dose*1000)/1000;
  return Number.isFinite(rounded)&&rounded>=0.001&&rounded<=1000000?rounded:null;
}
export function MedicineForm({units:providedUnits,routes,treatmentTypes,classifications=medicineClassifications,initial,busy,onSave,onCancel}:{
  units:HealthOptions['units'];routes:CatalogItem[];treatmentTypes:CatalogItem[];busy:boolean;
  classifications?:Array<{code:string;name:string}>;initial?:HealthMedicine;
  onSave:(input:Omit<HealthMedicine,'id'|'active'>)=>void;onCancel:()=>void}){
  const units=providedUnits.length?providedUnits:medicineDoseUnits;
  const [kind,setKind]=useState<HealthMedicine['kind']>(initial?.kind??'VACUNA');
  const [classification,setClassification]=useState(initial?.treatmentCatalogItemId??'');const [unit,setUnit]=useState(initial?.defaultUnitCode??'');
  const [selectedRoutes,setSelectedRoutes]=useState<string[]>(initial?.administrationRoutes??[]);
  const [selectedClassifications,setSelectedClassifications]=useState<string[]>(initial?.doseClassificationRanges?.map(item=>item.classificationCode)??[]);
  const [error,setError]=useState('');
  const [doseMode,setDoseMode]=useState(initial?.doseClassificationRanges?.length?'CLASSIFICATION':initial?.doseWeight!=null?'WEIGHT':initial?.doseAmount!=null?'FIXED':'NONE');const [weightUnit,setWeightUnit]=useState<'KILOGRAM'|'POUND'>(initial?.doseWeightUnitCode??'KILOGRAM');
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    if(!selectedRoutes.length||!units.some(item=>item.code===unit)){setError('Selecciona la unidad de dosis y al menos una vía.');return;}
    const ranges=doseMode==='CLASSIFICATION'?selectedClassifications.map(classificationCode=>({classificationCode,
      min:Number(data.get(`min-${classificationCode}`)),max:Number(data.get(`max-${classificationCode}`))})):[];
    if(doseMode==='CLASSIFICATION'&&(!ranges.length||ranges.some(range=>!Number.isFinite(range.min)||!Number.isFinite(range.max)
      ||range.min<0.000001||range.max>1000000||range.max<range.min))){
      setError('Selecciona las clasificaciones e indica un mínimo y máximo válidos.');return;}
    setError('');
    onSave({name:String(data.get('name')).trim(),kind,defaultUnitCode:unit,
      treatmentCatalogItemId:classification||null,activeIngredient:String(data.get('ingredient')??'').trim()||null,
      administrationRoutes:selectedRoutes,doseAmount:['NONE','CLASSIFICATION'].includes(doseMode)?null:Number(data.get('amount')),
      doseClassificationRanges:ranges,
      doseWeight:doseMode==='WEIGHT'?Number(data.get('weight')):null,
      doseWeightUnitCode:doseMode==='WEIGHT'?weightUnit:null,suggestedDose:doseMode==='NONE'?initial?.suggestedDose??null:null,
      indications:String(data.get('indications')??'').trim()||null,
      withdrawalMilkDays:Number(data.get('milkDays')),withdrawalMeatDays:Number(data.get('meatDays'))});
  }
  return <form className="movement-form" onSubmit={submit}>
    {error&&<div className="form-error movement-wide" role="alert">{error}</div>}
    <label><span>Nombre comercial *</span><input name="name" defaultValue={initial?.name} required minLength={2} maxLength={160}/></label>
    <label><span>Uso principal *</span><SearchableSelect value={kind} onChange={value=>setKind(value as HealthMedicine['kind'])}
      title="Uso principal" options={Object.entries(medicineKinds).map(([value,label])=>({value,label}))}/>
      <small>Indica para qué se utiliza: vacunación, desparasitación o tratamiento.</small></label>
    <label><span>Clase farmacológica</span><SearchableSelect value={classification} onChange={setClassification}
      title="Clase farmacológica" emptyOptionLabel="Sin clasificar" options={treatmentTypes.filter(item=>item.active)
        .map(item=>({value:item.id,label:item.name}))}/><small>Por ejemplo: antibiótico, analgésico o vitamina.</small></label>
    <label><span>Unidad de dosis *</span><SearchableSelect value={unit} onChange={setUnit} title="Unidad de dosis" placeholder="Selecciona la unidad"
      options={units.map(item=>({value:item.code,label:item.name,description:item.symbol}))}/>
      <small>Disponible en Catálogos → Unidades de dosis.</small></label>
    <fieldset className="movement-wide medicine-routes"><legend>Vías de administración *</legend>
      {routes.filter(item=>item.active||selectedRoutes.includes(routeKey(item))).map(item=><label key={item.id}><input type="checkbox"
        checked={selectedRoutes.includes(routeKey(item))} onChange={event=>setSelectedRoutes(previous=>event.target.checked
          ?[...previous,routeKey(item)]:previous.filter(key=>key!==routeKey(item)))}/><span>{item.name}{!item.active?' · Inactiva':''}</span></label>)}
      <small>Puedes añadir vías en Catálogos → Vías de administración.</small></fieldset>
    <label><span>Referencia de dosis</span><SearchableSelect value={doseMode} onChange={setDoseMode} title="Referencia de dosis"
      options={[{value:'NONE',label:'Sin referencia'},{value:'FIXED',label:'Cantidad fija'},{value:'WEIGHT',label:'Según el peso'},
        {value:'CLASSIFICATION',label:'Según la clasificación'}]}/></label>
    {['FIXED','WEIGHT'].includes(doseMode)&&<label><span>Cantidad ({units.find(item=>item.code===unit)?.symbol??'unidad'}) *</span>
      <input name="amount" defaultValue={initial?.doseAmount??undefined} type="number" min="0.000001" max="1000000" step="any" required/></label>}
    {doseMode==='WEIGHT'&&<><label><span>Por cada cantidad de peso *</span><input name="weight" defaultValue={initial?.doseWeight??undefined} type="number"
      min="0.000001" max="1000000" step="any" required/></label><label><span>Unidad de peso *</span>
      <SearchableSelect value={weightUnit} onChange={value=>setWeightUnit(value as 'KILOGRAM'|'POUND')}
        title="Unidad de peso" options={[{value:'KILOGRAM',label:'Kilogramos (kg)'},{value:'POUND',label:'Libras (lb)'}]}/></label></>}
    {doseMode==='CLASSIFICATION'&&<fieldset className="movement-wide"><legend>Rangos por clasificación ({units.find(item=>item.code===unit)?.symbol})</legend>
      {classifications.map(item=><div key={item.code}><label><input type="checkbox" checked={selectedClassifications.includes(item.code)}
        onChange={event=>setSelectedClassifications(previous=>event.target.checked?[...previous,item.code]:previous.filter(code=>code!==item.code))}/>
        <span>{item.name}</span></label>{selectedClassifications.includes(item.code)&&<div className="movement-form">
          <label><span>Mínimo *</span><input name={`min-${item.code}`} defaultValue={initial?.doseClassificationRanges?.find(range=>range.classificationCode===item.code)?.min} type="number" min="0.000001" max="1000000" step="any" required/></label>
          <label><span>Máximo *</span><input name={`max-${item.code}`} defaultValue={initial?.doseClassificationRanges?.find(range=>range.classificationCode===item.code)?.max} type="number" min="0.000001" max="1000000" step="any" required/></label>
        </div>}</div>)}
      <small>Selecciona las clasificaciones que correspondan y configura sus rangos.</small></fieldset>}
    {doseMode!=='NONE'&&<p className="muted movement-wide">{doseMode==='CLASSIFICATION'
      ?'Al aplicar el tratamiento verás el rango del animal y podrás indicar la cantidad.'
      :'Esta referencia calculará la cantidad al aplicar el tratamiento. Puedes modificar el resultado.'}</p>}
    <label><span>Principio activo</span><textarea name="ingredient" defaultValue={initial?.activeIngredient??undefined} maxLength={2000}/></label>
    <label><span>Indicaciones</span><textarea name="indications" defaultValue={initial?.indications??undefined} maxLength={2000}/></label>
    <label><span>Retiro de leche (días)</span><input name="milkDays" type="number" min={0} max={10000} defaultValue={initial?.withdrawalMilkDays??0} required/></label>
    <label><span>Retiro de carne (días)</span><input name="meatDays" type="number" min={0} max={10000} defaultValue={initial?.withdrawalMeatDays??0} required/></label>
    <div className="reference-dialog-footer movement-wide"><button type="button" className="secondary-button compact"
      onClick={onCancel} disabled={busy}>Cancelar</button><button className="primary-button compact"
        disabled={busy||!unit||!selectedRoutes.length}>{busy?'Guardando…':'Guardar medicamento'}</button></div>
  </form>;
}

import {type FormEvent,useEffect,useRef,useState} from 'react';
import {Baby,ChevronRight,SlidersHorizontal} from 'lucide-react';
import {useSearchParams} from 'react-router-dom';
import {Button,ErrorState,LoadingState} from '../components/ui';
import {getAnimalClassificationPolicy,getReproductionSettings,updateAnimalClassificationPolicy,
  updateReproductionSettings,type AnimalClassificationPolicy,type ReproductionSettings} from './api';

const classificationCodes=['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'] as const;
const days=[
  ['minimumBullMonths','Edad mínima para ser padre (meses)',120],
  ['minimumCowMonths','Edad mínima de la hembra para celo o preñez (meses)',120],
  ['daysAfterBirthHeat','Días después de un parto para registrar celo',365],
  ['daysAfterBirthPregnancy','Días después de un parto para registrar preñez',365],
  ['daysAfterLossHeat','Días después de una pérdida para registrar celo',365],
  ['daysAfterLossPregnancy','Días después de una pérdida para registrar preñez',365],
  ['maxMilkingDays','Máximo de días de ordeño después de un parto',730],
] as const;
const checks=[
  ['allowSecondHeat','Permitir más de un celo en el ciclo'],
  ['allowFalseHeatInPregnancy','Permitir celos aparentes durante la preñez'],
  ['useLastValidHeat','Usar el final del último celo válido para calcular el parto'],
] as const;

export function AnimalRulesPanel({accessToken,propertyName}:{accessToken:string;propertyName:string}){
  const [params,setParams]=useSearchParams();const requested=params.get('opcion');
  const option=requested==='reproduccion'||requested==='clasificacion'?requested:null;
  const [reproduction,setReproduction]=useState<ReproductionSettings|null>(null);
  const [classification,setClassification]=useState<AnimalClassificationPolicy|null>(null);
  const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const [busy,setBusy]=useState(false);const saving=useRef(false);const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setError('');setSaved(false);setReproduction(null);setClassification(null);
    if(option){void (option==='reproduccion'?getReproductionSettings(accessToken):getAnimalClassificationPolicy(accessToken))
      .then(policy=>{if(!active)return;
        if(!policy.canManageRules){setError('Solo los administradores pueden modificar estas reglas.');return;}
        if(option==='reproduccion')setReproduction(policy as ReproductionSettings);
        else setClassification(policy as AnimalClassificationPolicy);
      }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar las reglas.');});}
    return()=>{active=false;};
  },[accessToken,option,revision]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving.current)return;const data=new FormData(event.currentTarget);
    saving.current=true;setBusy(true);setError('');setSaved(false);
    try{
      if(option==='reproduccion'&&reproduction){
        const input={...reproduction};
        for(const [key] of days)input[key]=Number(data.get(key));
        for(const [key] of checks)input[key]=data.get(key)==='on';
        setReproduction(await updateReproductionSettings(accessToken,input));
      }else if(option==='clasificacion'&&classification){
        const names=Object.fromEntries(classificationCodes.map(code=>[code,String(data.get(code)).trim()])) as AnimalClassificationPolicy['names'];
        setClassification(await updateAnimalClassificationPolicy(accessToken,{
          femaleAdultMonths:Number(data.get('femaleAdultMonths')),maleAdultMonths:Number(data.get('maleAdultMonths')),names}));
      }else return;
      setSaved(true);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudieron guardar las reglas.');}
    finally{saving.current=false;setBusy(false);}
  }
  const choose=(value:string)=>{const next=new URLSearchParams(params);next.set('opcion',value);setParams(next);};
  return <section className="animal-rules-panel">
    <p className="muted">Estas reglas se aplican a todas las propiedades del dueño de la cuenta de <strong>{propertyName}</strong>. El historial conserva sus datos.</p>
    {!option&&<div className="animal-rules-options">
      {[{id:'reproduccion',title:'Reproducción',description:'Edad mínima para ser padre, celos, preñeces y días de espera.',Icon:Baby},
        {id:'clasificacion',title:'Clasificación',description:'Edades y nombres para clasificar a los animales.',Icon:SlidersHorizontal}].map(({id,title,description,Icon})=>
        <button type="button" key={id} className="card settings-hub-card" onClick={()=>choose(id)}>
          <span className="settings-card-icon"><Icon size={23}/></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={18}/>
        </button>)}
    </div>}
    {option&&!reproduction&&!classification&&!error&&<LoadingState/>}
    {option&&error&&!reproduction&&!classification&&<ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>}
    {(reproduction||classification)&&<form className="animal-rules-form" onSubmit={save} key={JSON.stringify(reproduction??classification)}>
      <h3>{option==='reproduccion'?'Reglas de reproducción':'Reglas de clasificación'}</h3>
      <fieldset disabled={busy}>
        {reproduction&&<>
          {days.map(([key,label,max])=><label key={key}><span>{label}</span>
            <input type="number" name={key} min={key==='maxMilkingDays'?1:0} max={max} required defaultValue={reproduction[key]}/></label>)}
          {checks.map(([key,label])=><label key={key} className="rule-checkbox">
            <input type="checkbox" name={key} defaultChecked={reproduction[key]}/><span>{label}</span></label>)}
        </>}
        {classification&&<>
          <label><span>Hembras adultas desde (meses)</span><input name="femaleAdultMonths" type="number"
            min="1" max="120" required defaultValue={classification.femaleAdultMonths}/></label>
          <label><span>Machos adultos desde (meses)</span><input name="maleAdultMonths" type="number"
            min="1" max="120" required defaultValue={classification.maleAdultMonths}/></label>
          {classificationCodes.map(code=><label key={code}><span>{classification.names[code]}</span><input name={code}
            minLength={2} maxLength={80} required defaultValue={classification.names[code]}/></label>)}
        </>}
      </fieldset>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {saved&&<p role="status">Reglas guardadas para todas las propiedades de esta cuenta.</p>}
      <Button type="submit" loading={busy}>Guardar reglas</Button>
    </form>}
  </section>;
}

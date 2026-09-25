import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {ArrowUpDown,Baby,ChevronRight,Plus,Settings2} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal} from '../components/ui';
import {formatDate} from '../utils';
import {
  ApiRequestError, cancelHeat, cancelPregnancy, cancelService, createHeat, createPregnancy, createService,
  getReproduction, getReproductionCandidates, getReproductionSettings,
  recordBirth, recordLoss, updateReproductionSettings,
  type ReproductionCandidate, type ReproductionRecords, type ReproductionSettings,
} from './api';

function localDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
const errorMessage = (error: unknown) => error instanceof ApiRequestError
  ? error.message : error instanceof Error ? error.message : 'No fue posible guardar el evento.';
const optional = (form: FormData, name: string) => String(form.get(name) || '').trim() || null;
type ReproductionKind='HEAT'|'SERVICE'|'PREGNANCY'|'BIRTH'|'LOSS';
const categories:Record<ReproductionKind,string>={HEAT:'Celos',SERVICE:'Servicios',
  PREGNANCY:'Preñeces',BIRTH:'Partos',LOSS:'Pérdidas'};
interface ReproductionRow {id:string;kind:ReproductionKind;name:string;date:string;
  summary:string;notes:string|null;status:string;canCancel:boolean;}

export function ReproductionPanel({ accessToken, canManage, initialAnimalId }: {
  accessToken: string; canManage: boolean; initialAnimalId?:string|undefined;
}) {
  const [records, setRecords] = useState<ReproductionRecords | null>(null);
  const [candidates, setCandidates] = useState<ReproductionCandidate[]>([]);
  const [settings, setSettings] = useState<ReproductionSettings | null>(null);
  const [cowId, setCowId] = useState('');
  const [calfCount, setCalfCount] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<'HEAT'|'PREGNANCY'|'SERVICE'|'BIRTH'|'LOSS'|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [selectedCategory,setSelectedCategory]=useState<ReproductionKind|null>(null);
  const [selectedRecord,setSelectedRecord]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [newest,setNewest]=useState(true);
  const females = candidates.filter((animal) => animal.sex === 'FEMALE');
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  useEffect(()=>{const action=new URLSearchParams(window.location.search).get('accion');
    const form=({CELO:'HEAT',SERVICIO:'SERVICE',PRENEZ:'PREGNANCY',PARTO:'BIRTH',
      PERDIDA:'LOSS'} as const)[action as 'CELO'];
    if(!form||
    !initialAnimalId||initialAnimalId===prefilledAnimalId||!canManage||
    !candidates.some(animal=>animal.id===initialAnimalId&&animal.sex==='FEMALE'))return;
    setCowId(initialAnimalId);setActiveForm(form);setPrefilledAnimalId(initialAnimalId);
  },[initialAnimalId,prefilledAnimalId,candidates,canManage]);
  const males = candidates.filter((animal) => animal.sex === 'MALE');
  const confirmed = records?.pregnancies.filter((pregnancy) => pregnancy.status === 'CONFIRMED') ?? [];
  const rows=useMemo<ReproductionRow[]>(()=>records?[
    ...records.heats.map(item=>({id:item.id,kind:'HEAT' as const,name:item.cowName,
      date:item.startsOn,summary:`${item.isFalse?'Celo aparente':'Celo'}${item.endsOn?` · Fin ${formatDate(item.endsOn)}`:''}`,
      notes:item.notes,status:item.cancelled?'Cancelado':'Registrado',canCancel:!item.cancelled})),
    ...records.services.map(item=>({id:item.id,kind:'SERVICE' as const,name:item.cowName,
      date:item.occurredOn,summary:item.kind==='INSEMINATION'?'Inseminación artificial':'Transferencia de embriones',
      notes:item.notes,status:item.cancelled?'Cancelado':item.hasPregnancy?'Con preñez':'Registrado',
      canCancel:!item.cancelled&&!item.hasPregnancy})),
    ...records.pregnancies.map(item=>({id:item.id,kind:'PREGNANCY' as const,name:item.cowName,
      date:item.confirmedOn,summary:`Parto estimado: ${item.expectedBirthOn?formatDate(item.expectedBirthOn):'sin estimación'}`,
      notes:item.notes,status:item.status==='CONFIRMED'?'Confirmada':item.status==='BORN'?'Parto registrado':
        item.status==='LOST'?'Pérdida':'Cancelada',canCancel:item.status==='CONFIRMED'})),
    ...records.births.map(item=>({id:item.id,kind:'BIRTH' as const,name:item.motherName,
      date:item.occurredOn,summary:`${item.liveCount} vivas · ${item.stillbornCount} nacidas muertas${
        item.calves.length?` · ${item.calves.map(calf=>calf.name).join(', ')}`:''}`,
      notes:item.notes,status:'Registrado',canCancel:false})),
    ...records.losses.map(item=>({id:item.id,kind:'LOSS' as const,name:item.cowName,
      date:item.occurredOn,summary:'Pérdida de preñez',notes:item.notes,status:'Registrado',canCancel:false})),
  ]:[],[records]);
  const relatedIds=useMemo(()=>new Set(initialAnimalId&&records?[
    ...records.heats.filter(item=>item.cowId===initialAnimalId).map(item=>item.id),
    ...records.services.filter(item=>item.cowId===initialAnimalId||item.fatherId===initialAnimalId||
      item.donorId===initialAnimalId).map(item=>item.id),
    ...records.pregnancies.filter(item=>item.cowId===initialAnimalId||item.fatherId===initialAnimalId)
      .map(item=>item.id),
    ...records.births.filter(item=>item.motherId===initialAnimalId||
      item.calves.some(calf=>calf.id===initialAnimalId)).map(item=>item.id),
    ...records.losses.filter(item=>item.cowId===initialAnimalId).map(item=>item.id),
  ]:[]),[records,initialAnimalId]);
  const visible=useMemo(()=>rows.filter(item=>(!initialAnimalId||relatedIds.has(item.id))&&
    (!selectedCategory||selectedCategory===item.kind)&&
    `${item.name} ${item.summary} ${item.notes??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(newest?-1:1)*a.date.localeCompare(b.date)),
    [rows,selectedCategory,search,newest,initialAnimalId,relatedIds]);
  const viewing=rows.find(item=>`${item.kind}:${item.id}`===selectedRecord);

  useEffect(() => {
    let active = true;
    void Promise.all([getReproduction(accessToken), getReproductionCandidates(accessToken),
      getReproductionSettings(accessToken)])
      .then(([next, animals, config]) => {
        if (active) { setRecords(next); setCandidates(animals); setSettings(config); }
      })
      .catch((failure) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [accessToken, revision]);

  async function run(operation: () => Promise<unknown>, form?: HTMLFormElement) {
    setBusy(true); setError(null);
    try { await operation(); form?.reset();setActiveForm(null);setSettingsOpen(false);
      setSelectedRecord(null);setRevision((value) => value + 1); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  function heat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => createHeat(accessToken, {
      cowId: String(data.get('cowId')), bullId: optional(data, 'bullId'),
      startsOn: String(data.get('startsOn')), endsOn: optional(data, 'endsOn'),
      isFalse: data.get('isFalse') === 'on', notes: optional(data, 'notes'),
    }), form);
  }

  function pregnancy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const days = optional(data, 'gestationDays');
    const serviceId = optional(data, 'serviceId');
    const service = records?.services.find((row) => row.id === serviceId);
    void run(() => createPregnancy(accessToken, {
      cowId: String(data.get('cowId')), heatId: service ? null : optional(data, 'heatId'), serviceId,
      fatherId: service ? null : optional(data, 'fatherId'),
      externalFather: service ? null : optional(data, 'externalFather'),
      conceptionMethod: service?.kind ?? String(data.get('conceptionMethod')),
      confirmationMethod: String(data.get('confirmationMethod')),
      confirmedOn: String(data.get('confirmedOn')),
      ...(days ? { gestationDays: Number(days) } : {}), notes: optional(data, 'notes'),
    }), form);
  }

  function reproductiveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => createService(accessToken, {
      cowId: String(data.get('cowId')), heatId: optional(data, 'heatId'),
      fatherId: optional(data, 'fatherId'), externalFather: optional(data, 'externalFather'),
      donorId: optional(data, 'donorId'), externalDonor: optional(data, 'externalDonor'),
      kind: String(data.get('kind')) as 'INSEMINATION' | 'EMBRYO_TRANSFER',
      occurredOn: String(data.get('occurredOn')), materialCode: optional(data, 'materialCode'),
      quality: optional(data, 'quality'), technician: optional(data, 'technician'),
      supplier: optional(data, 'supplier'), notes: optional(data, 'notes'),
    }), form);
  }

  function birth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const calves = Array.from({ length: calfCount }, (_, index) => ({
      name: String(data.get(`calfName:${index}`) || '').trim(),
      sex: String(data.get(`calfSex:${index}`)) as 'FEMALE' | 'MALE',
      ...(optional(data, `calfTag:${index}`) ? { earTagCode: optional(data, `calfTag:${index}`)! } : {}),
    }));
    void run(() => recordBirth(accessToken, {
      pregnancyId: String(data.get('pregnancyId')),
      occurredOn: String(data.get('occurredOn')), calves,
      stillbornCount: Number(data.get('stillbornCount') || 0), notes: optional(data, 'notes'),
    }), form);
  }

  function loss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => recordLoss(accessToken, {
      pregnancyId: String(data.get('pregnancyId')),
      occurredOn: String(data.get('occurredOn')), notes: String(data.get('notes')).trim(),
    }), form);
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const days = (key: string) => Number(data.get(key));
    const checked = (key: string) => data.get(key) === 'on';
    void run(() => updateReproductionSettings(accessToken, {
      daysAfterBirthHeat: days('daysAfterBirthHeat'),
      daysAfterBirthPregnancy: days('daysAfterBirthPregnancy'),
      daysAfterLossHeat: days('daysAfterLossHeat'),
      daysAfterLossPregnancy: days('daysAfterLossPregnancy'),
      minimumCowMonths: days('minimumCowMonths'), minimumBullMonths: days('minimumBullMonths'),
      allowSecondHeat: checked('allowSecondHeat'),
      allowFalseHeatInPregnancy: checked('allowFalseHeatInPregnancy'),
      useLastValidHeat: checked('useLastValidHeat'),
      maxMilkingDays: days('maxMilkingDays'),
    }));
  }

  return <section className="module-no-header reproduction-panel">
    <div className="activity-type-strip"><button type="button" className={!selectedCategory?'selected':''}
      onClick={()=>setSelectedCategory(null)}><span><Baby size={20}/></span><small>Todos</small></button>
      {(Object.keys(categories) as ReproductionKind[]).map(kind=><button type="button" key={kind}
        className={selectedCategory===kind?'selected':''} onClick={()=>setSelectedCategory(kind)}>
        <span>{categories[kind].slice(0,1)}</span><small>{categories[kind]}</small></button>)}</div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar animal o evento…"
      count={visible.length} actions={<><IconButton label={newest?'Más recientes':'Más antiguos'}
        onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={18}/></IconButton>
        {canManage&&<IconButton label="Reglas de reproducción" onClick={()=>setSettingsOpen(true)}>
          <Settings2 size={18}/></IconButton>}</>}/>
    {error && <div role="alert" className="form-error admin-error">{error}</div>}
    {!records && !error && <LoadingState/>}
    {!records && error && <ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>}
    {canManage && settings && settingsOpen && <Modal title="Reglas de reproducción" wide
      onClose={()=>setSettingsOpen(false)} footer={<Button variant="ghost"
        onClick={()=>setSettingsOpen(false)}>Cerrar</Button>}>
      <form className="group-new-form" onSubmit={saveSettings} key={revision}>
        <p className="muted">Los cambios rigen los próximos registros; el historial conserva sus datos.</p>
        {([
          ['daysAfterBirthHeat', 'Días tras parto para celo', 365],
          ['daysAfterBirthPregnancy', 'Días tras parto para preñez', 365],
          ['daysAfterLossHeat', 'Días tras pérdida para celo', 365],
          ['daysAfterLossPregnancy', 'Días tras pérdida para preñez', 365],
          ['minimumCowMonths', 'Edad mínima de la vaca (meses)', 120],
          ['minimumBullMonths', 'Edad mínima del toro (meses)', 120],
          ['maxMilkingDays', 'Máximo de días de ordeño tras parto', 730],
        ] as const).map(([key, label, max]) => <label key={key}><span>{label}</span>
          <input type="number" name={key} min="0" max={max} required defaultValue={settings[key]} />
        </label>)}
        {([
          ['allowSecondHeat', 'Permitir más de un celo en el ciclo'],
          ['allowFalseHeatInPregnancy', 'Permitir celos falsos durante la preñez'],
          ['useLastValidHeat', 'Usar el final del último celo válido para calcular el parto'],
        ] as const).map(([key, label]) => <label key={key}><span>{label}</span>
          <input type="checkbox" name={key} defaultChecked={settings[key]} />
        </label>)}
        <button className="primary-button compact" disabled={busy}>Guardar reglas</button>
      </form>
    </Modal>}
    {canManage && activeForm && <Modal title="Registrar evento reproductivo" wide
      onClose={()=>setActiveForm(null)} footer={<Button variant="ghost"
        onClick={()=>setActiveForm(null)}>Cerrar</Button>}>
      <div className="form-toolbar" aria-label="Tipo de evento">
      {([['HEAT','Celo'],['SERVICE','Servicio'],['PREGNANCY','Preñez'],
        ['BIRTH','Parto'],['LOSS','Pérdida']] as const).map(([id,label])=><button
          key={id} type="button" className={activeForm===id?'active':''}
          aria-pressed={activeForm===id} onClick={()=>setActiveForm(id)}>
          {label}</button>)}
      </div>
      <div className="reproduction-forms">
      <form className="group-new-form" onSubmit={heat} hidden={activeForm!=='HEAT'}>
        <h3>Registrar celo</h3>
        <label><span>Vaca *</span><select name="cowId" required defaultValue={initialAnimalId??''}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Toro registrado</span><select name="bullId" defaultValue="">
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Inicio *</span><input type="date" name="startsOn" required defaultValue={localDate()} /></label>
        <label><span>Fin</span><input type="date" name="endsOn" /></label>
        <label><span>Celo aparente o falso</span><input type="checkbox" name="isFalse" /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar celo</button>
      </form>

      <form className="group-new-form" onSubmit={pregnancy} hidden={activeForm!=='PREGNANCY'}>
        <h3>Confirmar preñez</h3>
        <label><span>Vaca *</span><select name="cowId" required value={cowId}
          onChange={(event) => setCowId(event.target.value)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Celo relacionado</span><select name="heatId" defaultValue="" key={cowId}>
          <option value="">Sin celo registrado</option>
          {records?.heats.filter((entry) => entry.cowId === cowId && !entry.cancelled && !entry.isFalse)
            .map((entry) => <option key={entry.id} value={entry.id}>{entry.startsOn}</option>)}
        </select></label>
        <label><span>Servicio asistido relacionado</span><select name="serviceId" defaultValue="" key={`service:${cowId}`}>
          <option value="">Sin servicio asistido</option>
          {records?.services.filter((entry) => entry.cowId === cowId && !entry.cancelled && !entry.hasPregnancy)
            .map((entry) => <option key={entry.id} value={entry.id}>
              {entry.occurredOn} · {entry.kind === 'INSEMINATION' ? 'Inseminación' : 'Transferencia'}</option>)}
        </select><small>Si eliges un servicio, se toman su celo y padre.</small></label>
        <label><span>Padre registrado</span><select name="fatherId" defaultValue="">
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} /></label>
        <label><span>Método de embarazo</span><select name="conceptionMethod" defaultValue="NATURAL">
          <option value="NATURAL">Monta natural</option>
          <option value="INSEMINATION">Inseminación</option>
          <option value="EMBRYO_TRANSFER">Transferencia de embriones</option>
          <option value="UNKNOWN">Desconocido</option>
        </select></label>
        <label><span>Método de confirmación</span><select name="confirmationMethod" defaultValue="PALPATION">
          <option value="PALPATION">Palpación</option><option value="ULTRASOUND">Ecografía</option>
          <option value="BLOOD_TEST">Análisis de sangre</option>
          <option value="OBSERVATION">Observación</option><option value="OTHER">Otro</option>
        </select></label>
        <label><span>Fecha de confirmación *</span><input type="date" name="confirmedOn"
          required defaultValue={localDate()} /></label>
        <label><span>Días de gestación</span><input type="number" name="gestationDays" min="0" max="400" />
          <small>Con un celo se calculan automáticamente; sin selección se usa el último celo válido según las reglas.</small></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>
          Confirmar preñez</button>
      </form>

      <form className="group-new-form" onSubmit={reproductiveService} hidden={activeForm!=='SERVICE'}>
        <h3>Inseminación o transferencia</h3>
        <label><span>Receptora *</span><select name="cowId" required defaultValue={initialAnimalId??''}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Tipo *</span><select name="kind" defaultValue="INSEMINATION">
          <option value="INSEMINATION">Inseminación artificial</option>
          <option value="EMBRYO_TRANSFER">Transferencia de embriones</option>
        </select></label>
        <label><span>Fecha *</span><input type="date" name="occurredOn" required defaultValue={localDate()} /></label>
        <label><span>Celo relacionado</span><select name="heatId" defaultValue="">
          <option value="">Sin celo registrado</option>
          {records?.heats.filter((entry) => !entry.cancelled && !entry.isFalse)
            .map((entry) => <option key={entry.id} value={entry.id}>{entry.cowName} · {entry.startsOn}</option>)}
        </select></label>
        <label><span>Padre registrado</span><select name="fatherId" defaultValue="">
          <option value="">Sin padre registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} /></label>
        <label><span>Donante registrada (solo transferencia)</span><select name="donorId" defaultValue="">
          <option value="">Sin donante registrada</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </select></label>
        <label><span>Donante externa (solo transferencia)</span><input name="externalDonor" maxLength={240} /></label>
        <label><span>Código de material</span><input name="materialCode" maxLength={160} /></label>
        <label><span>Calidad</span><input name="quality" maxLength={120} /></label>
        <label><span>Técnico</span><input name="technician" maxLength={160} /></label>
        <label><span>Proveedor</span><input name="supplier" maxLength={160} /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar servicio</button>
      </form>

      <form className="group-new-form" onSubmit={birth} hidden={activeForm!=='BIRTH'}>
        <h3>Registrar parto</h3>
        <label><span>Preñez confirmada *</span><select name="pregnancyId" required
          defaultValue={confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {item.confirmedOn}</option>)}
        </select></label>
        <label><span>Fecha de parto *</span><input type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Crías vivas</span><input type="number" min="0" max="8" value={calfCount}
          onChange={(event) => setCalfCount(Number(event.target.value))} /></label>
        {Array.from({ length: calfCount }, (_, index) => <div key={index} className="group-inline-form">
          <label><span>Nombre de la cría {index + 1} *</span>
            <input name={`calfName:${index}`} required maxLength={160} /></label>
          <label><span>Sexo *</span><select name={`calfSex:${index}`} defaultValue="FEMALE">
            <option value="FEMALE">Hembra</option><option value="MALE">Macho</option>
          </select></label>
          <label><span>Arete individual</span><input name={`calfTag:${index}`} maxLength={80} /></label>
        </div>)}
        <label><span>Crías nacidas muertas</span><input type="number" name="stillbornCount"
          defaultValue="0" min="0" max="8" required /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={5000} /></label>
        <button className="primary-button compact" disabled={busy || !confirmed.length}>
          Registrar parto y crías</button>
      </form>

      <form className="group-new-form" onSubmit={loss} hidden={activeForm!=='LOSS'}>
        <h3>Registrar pérdida de preñez</h3>
        <label><span>Preñez confirmada *</span><select name="pregnancyId" required
          defaultValue={confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {item.confirmedOn}</option>)}
        </select></label>
        <label><span>Fecha *</span><input type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Observaciones *</span><textarea name="notes" required maxLength={5000} /></label>
        <button className="secondary-button compact" disabled={busy || !confirmed.length}>
          Registrar pérdida</button>
      </form>
    </div></Modal>}

    {records && (visible.length?<Card className="record-list">
      <div className="record-list-head"><span>Animal</span><span>Fecha</span>
        <span>Evento</span><span>Estado</span><span/><span/></div>
      {visible.map(item=><button type="button" className="record-list-row" key={`${item.kind}:${item.id}`}
        onClick={()=>setSelectedRecord(`${item.kind}:${item.id}`)}>
        <span><strong>{item.name}</strong><small>{categories[item.kind]}</small></span>
        <span><strong>{formatDate(item.date)}</strong></span>
        <span><strong>{item.summary}</strong></span>
        <span><Badge tone={item.status==='Cancelado'?'danger':item.status==='Registrado'||
          item.status==='Confirmada'?'success':'neutral'}>{item.status}</Badge></span>
        <span/><span className="record-row-actions"><ChevronRight size={18}/></span>
      </button>)}</Card>:<EmptyState icon={Baby} title="Sin eventos reproductivos"
      description={rows.length?'Prueba con otra búsqueda o categoría.':
        'Registra celos, preñeces, servicios y partos de la propiedad.'}/>)}
    {viewing&&<Modal title="Detalle reproductivo" wide onClose={()=>setSelectedRecord(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelectedRecord(null)}>Cerrar</Button>
        {canManage&&viewing.canCancel&&<Button variant="secondary" disabled={busy}
          onClick={()=>{if(!window.confirm('¿Cancelar este evento? Se conservará en el historial.'))return;
            void run(()=>viewing.kind==='HEAT'?cancelHeat(accessToken,viewing.id):
              viewing.kind==='SERVICE'?cancelService(accessToken,viewing.id):
                cancelPregnancy(accessToken,viewing.id));}}>Cancelar evento</Button>}</>}>
      <div className="record-detail"><div className="record-detail-heading"><div className="record-icon">
        <Baby size={22}/></div><div><h2>{viewing.name}</h2><p>{categories[viewing.kind]} · {formatDate(viewing.date)}</p></div>
        <Badge tone={viewing.status==='Cancelado'?'danger':'success'}>{viewing.status}</Badge></div>
        <section><h3>Información</h3><div className="detail-grid"><div><small>Tipo de evento</small>
          <strong>{categories[viewing.kind]}</strong></div><div><small>Fecha</small>
          <strong>{formatDate(viewing.date)}</strong></div></div><p>{viewing.summary}</p></section>
        {viewing.kind==='BIRTH'&&records?.births.find(item=>item.id===viewing.id)?.calves.length
          ?<section><h3>Crías</h3><div className="detail-lines compact">{records.births.find(
            item=>item.id===viewing.id)?.calves.map(calf=><div key={calf.id}><span>
              <strong>{calf.name}</strong><small>{calf.sex==='FEMALE'?'Hembra':'Macho'}</small>
            </span></div>)}</div></section>:null}
        {viewing.notes&&<section><h3>Observaciones</h3><p>{viewing.notes}</p></section>}
      </div></Modal>}
    {canManage&&<FloatingActionDock><IconButton label="Nuevo evento reproductivo" onClick={()=>
      setActiveForm(selectedCategory??'HEAT')}><Plus size={22}/></IconButton></FloatingActionDock>}
  </section>;
}

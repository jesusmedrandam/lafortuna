import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, CheckCircle2, ChevronRight, Edit3, Plus, Stethoscope, Syringe, Trash2, Users } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { AnimalIdentity, AnimalSelect, animalOption, useAnimalDirectory } from '../../components/AnimalPicker';
import { isInOwnershipScope, OwnershipScopeFilter, type OwnershipScope } from '../../components/OwnershipScopeFilter';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { useListControls } from '../../hooks/useListControls';
import type { GenericRecord, HealthCondition, SanitaryCampaign } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, formatNumber, humanizeCode, nullIfEmpty } from '../../utils';

type Tab = 'campaigns' | 'individual' | 'conditions';

interface CampaignForm {
  id_tipo_tratamiento: string;
  id_medicamento: string;
  id_via_administracion: string;
  dosis_general: string;
  id_unidad_dosis: string;
  fecha_aplicacion: string;
  responsable: string;
  observaciones: string;
  selection: AnimalSelectionValue;
}

const emptyCampaign = (): CampaignForm => ({
  id_tipo_tratamiento: '', id_medicamento: '', id_via_administracion: '', dosis_general: '', id_unidad_dosis: '',
  fecha_aplicacion: currentDateInput(), responsable: '', observaciones: '', selection: { mode: 'GRUPO', groupId: '', animals: [] },
});

interface TreatmentForm {
  id_tratamiento?: string;
  id_animal: string;
  id_condicion_salud: string;
  id_tipo_tratamiento: string;
  id_medicamento: string;
  id_via_administracion: string;
  dosis: string;
  id_unidad_dosis: string;
  fecha_aplicacion: string;
  proxima_aplicacion: string;
  aplicado_por: string;
  descripcion: string;
  observaciones: string;
}

const emptyTreatment = (): TreatmentForm => ({
  id_animal: '', id_condicion_salud: '', id_tipo_tratamiento: '', id_medicamento: '', id_via_administracion: '', dosis: '', id_unidad_dosis: '',
  fecha_aplicacion: currentDateInput(), proxima_aplicacion: '', aplicado_por: '', descripcion: '', observaciones: '',
});

interface ConditionForm{id_condicion_salud?:string;id_animal:string;id_tipo_condicion_salud:string;fecha_deteccion:string;descripcion:string}
const emptyCondition=():ConditionForm=>({id_animal:'',id_tipo_condicion_salud:'',fecha_deteccion:currentDateInput(),descripcion:''});


export function SanitaryPage() {
  const [searchParams]=useSearchParams();
  const consumedRoute=useRef(false);
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('campaigns');
  const [ownershipScope, setOwnershipScope] = useState<OwnershipScope>('EN_PROPIEDAD');
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<SanitaryCampaign | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<SanitaryCampaign | null>(null);
  const [campaign, setCampaign] = useState<CampaignForm>(emptyCampaign);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [treatment, setTreatment] = useState<TreatmentForm>(emptyTreatment);
  const [deleteRecord, setDeleteRecord] = useState<string | null>(null);
  const [selectedTreatment, setSelectedTreatment] = useState<GenericRecord | null>(null);
  const [conditionOpen,setConditionOpen]=useState(false);
  const [condition,setCondition]=useState<ConditionForm>(emptyCondition);
  const [selectedCondition,setSelectedCondition]=useState<HealthCondition|null>(null);
  const [showAllConditionTreatments,setShowAllConditionTreatments]=useState(false);

  const types = useCatalog('tipos-tratamiento');
  const medicines = useCatalog('medicamentos');
  const routes = useCatalog('vias');
  const units = useCatalog('unidades');
  const conditionTypes=useCatalog('tipos-condicion-salud');
  const directory=useAnimalDirectory();
  const campaigns = useQuery({ queryKey: ['sanitary-campaigns'], queryFn: () => apiRequest<SanitaryCampaign[]>('/jornadas-sanitarias') });
  const treatments = useQuery({ queryKey: ['records', 'tratamientos'], queryFn: () => apiRequest<GenericRecord[]>('/registros/tratamientos') });
  const conditions=useQuery({queryKey:['health-conditions'],queryFn:()=>apiRequest<HealthCondition[]>('/condiciones-salud')});
  const medicineById=(id:string)=>medicines.data?.find((item)=>itemId(item)===id);
  const medicinesForType=(typeId:string)=>(medicines.data??[]).filter((item)=>item.activo!==false&&String(item.id_tipo_tratamiento??'')===typeId);
  const routesForMedicine=(id:string)=>{const medicine=medicineById(id);const allowed=Array.isArray(medicine?.id_vias_administracion)?medicine.id_vias_administracion.map(String):[];return (routes.data??[]).filter((item)=>item.activo!==false&&allowed.includes(itemId(item)));};
  const chooseCampaignMedicine=(id:string)=>{const medicine=medicineById(id);setCampaign((current)=>({...current,id_medicamento:id,id_via_administracion:'',id_unidad_dosis:String(medicine?.id_unidad_predeterminada??'')}));};
  const chooseTreatmentMedicine=(id:string)=>{const medicine=medicineById(id);setTreatment((current)=>({...current,id_medicamento:id,id_via_administracion:'',id_unidad_dosis:String(medicine?.id_unidad_predeterminada??'')}));};
  const selectedCampaignMedicine=medicineById(campaign.id_medicamento);
  const selectedTreatmentMedicine=medicineById(treatment.id_medicamento);
  useEffect(()=>{
    if(consumedRoute.current)return;
    const animalId=searchParams.get('animal');
    const treatmentId=searchParams.get('tratamiento');
    const campaignId=searchParams.get('jornada');
    const conditionId=searchParams.get('condicion');
    const requestedNew=searchParams.get('nuevo');
    if(requestedNew==='condicion'&&animalId){setTab('conditions');setCondition({...emptyCondition(),id_animal:animalId});setConditionOpen(true);consumedRoute.current=true;return;}
    if(requestedNew==='1'&&animalId){setTab('individual');setTreatment({...emptyTreatment(),id_animal:animalId,id_condicion_salud:conditionId??''});setTreatmentOpen(true);consumedRoute.current=true;return;}
    if(treatmentId&&treatments.data){const match=treatments.data.find((item)=>String(item.id_tratamiento)===treatmentId);if(match){setTab('individual');setSelectedTreatment(match);consumedRoute.current=true;return;}}
    if(campaignId&&campaigns.data){const match=campaigns.data.find(item=>item.id_jornada===campaignId);if(match){setTab('campaigns');setSelectedCampaign(match);consumedRoute.current=true;return;}}
    if(conditionId&&conditions.data){const match=conditions.data.find(item=>item.id_condicion_salud===conditionId);if(match){setTab('conditions');setSelectedCondition(match);consumedRoute.current=true;return;}}
  },[campaigns.data,conditions.data,searchParams,treatments.data]);

  const createCampaign = useMutation({
    mutationFn: () => {
      const selected = campaign.selection.animals.filter((animal) => animal.seleccionado);
      if (!selected.length) throw new Error('Selecciona al menos un animal.');
      if (!campaign.id_tipo_tratamiento || !campaign.id_medicamento || !campaign.id_via_administracion || !campaign.id_unidad_dosis || !campaign.dosis_general) throw new Error('Completa tipo, medicamento, vía, dosis y unidad.');
      const body = {
          id_tipo_tratamiento: campaign.id_tipo_tratamiento,
          id_medicamento: campaign.id_medicamento,
          id_via_administracion: campaign.id_via_administracion,
          dosis_general: Number(campaign.dosis_general),
          id_unidad_dosis: campaign.id_unidad_dosis,
          modo_seleccion: campaign.selection.mode,
          id_grupo_filtro: campaign.selection.mode === 'GRUPO' ? campaign.selection.groupId : null,
          fecha_aplicacion: campaign.fecha_aplicacion,
          responsable: nullIfEmpty(campaign.responsable),
          observaciones: nullIfEmpty(campaign.observaciones),
          animales: campaign.selection.animals.map((animal) => ({
            id_animal: animal.id_animal,
            seleccionado: animal.seleccionado,
            dosis_aplicada: animal.dosis_aplicada || null,
            id_unidad_dosis: animal.dosis_aplicada ? campaign.id_unidad_dosis : null,
            observaciones: animal.observaciones || null,
          })),
        };
      return apiRequest<SanitaryCampaign>(editingCampaign ? `/jornadas-sanitarias/${editingCampaign.id_jornada}` : '/jornadas-sanitarias', {
        method: editingCampaign ? 'PATCH' : 'POST', body: editingCampaign ? { ...body, animales: undefined } : body,
      }).then(async (result) => { if (editingCampaign) await apiRequest(`/jornadas-sanitarias/${editingCampaign.id_jornada}/seleccion`, { method: 'PUT', body: { animales: body.animales } }); return result; });
    },
    onSuccess: () => { toast.show(editingCampaign ? 'Jornada actualizada.' : 'Jornada guardada como borrador.'); setCampaignOpen(false); setEditingCampaign(null); setCampaign(emptyCampaign()); void queryClient.invalidateQueries({ queryKey: ['sanitary-campaigns'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const applyCampaign = useMutation({
    mutationFn: (id: string) => apiRequest(`/jornadas-sanitarias/${id}/aplicar`, { method: 'POST' }),
    onSuccess: () => { toast.show('Jornada aplicada y registros individuales generados.'); void queryClient.invalidateQueries({ queryKey: ['sanitary-campaigns'] }); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const saveTreatment = useMutation({
    mutationFn: () => {
      if (!treatment.id_animal || !treatment.id_tipo_tratamiento || !treatment.id_medicamento || !treatment.id_via_administracion || !treatment.id_unidad_dosis || !treatment.dosis) throw new Error('Completa los campos obligatorios.');
      const body = {
        id_animal: treatment.id_animal,
        id_condicion_salud:treatment.id_condicion_salud||null,
        id_tipo_tratamiento: treatment.id_tipo_tratamiento,
        id_medicamento: treatment.id_medicamento,
        id_via_administracion: treatment.id_via_administracion,
        dosis: Number(treatment.dosis),
        id_unidad_dosis: treatment.id_unidad_dosis,
        fecha_aplicacion: treatment.fecha_aplicacion,
        proxima_aplicacion: treatment.proxima_aplicacion || null,
        aplicado_por: nullIfEmpty(treatment.aplicado_por),
        descripcion: nullIfEmpty(treatment.descripcion),
        observaciones: nullIfEmpty(treatment.observaciones),
      };
      return apiRequest(`/registros/tratamientos${treatment.id_tratamiento ? `/${treatment.id_tratamiento}` : ''}`, { method: treatment.id_tratamiento ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(treatment.id_tratamiento ? 'Tratamiento actualizado.' : 'Tratamiento registrado.'); setTreatmentOpen(false); setTreatment(emptyTreatment()); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] });void queryClient.invalidateQueries({queryKey:['health-conditions']}); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveCondition=useMutation({mutationFn:()=>{if(!condition.id_animal||!condition.fecha_deteccion||!condition.descripcion.trim())throw new Error('Selecciona el animal, la fecha y describe el problema.');return apiRequest(`/condiciones-salud${condition.id_condicion_salud?`/${condition.id_condicion_salud}`:''}`,{method:condition.id_condicion_salud?'PATCH':'POST',body:{id_animal:condition.id_animal,id_tipo_condicion_salud:condition.id_tipo_condicion_salud||null,fecha_deteccion:condition.fecha_deteccion,descripcion:condition.descripcion.trim()}});},onSuccess:()=>{toast.show(condition.id_condicion_salud?'Condición actualizada.':'Problema de salud registrado.');setConditionOpen(false);setCondition(emptyCondition());void queryClient.invalidateQueries({queryKey:['health-conditions']});},onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error')});
  const resolveCondition=useMutation({mutationFn:(id:string)=>apiRequest(`/condiciones-salud/${id}/resolver`,{method:'PATCH',body:{fecha_resolucion:currentDateInput()}}),onSuccess:()=>{toast.show('Condición marcada como resuelta.');setSelectedCondition(null);void queryClient.invalidateQueries({queryKey:['health-conditions']});},onError:(error)=>toast.show((error as ApiError).message,'error')});

  const removeTreatment = useMutation({
    mutationFn: (id: string) => apiRequest(`/registros/tratamientos/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.show('Tratamiento eliminado.'); setDeleteRecord(null); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const typeName = (id: unknown) => {
    const item = types.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const medicineName = (id: unknown) => {
    const item = medicines.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const routeName = (id: unknown) => {
    const item = routes.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const unitName = (id: unknown) => {
    const item = units.data?.find((value) => itemId(value) === String(id));
    return item ? String(item.simbolo ?? item.nombre ?? '—') : '—';
  };

  const editTreatment = (record: GenericRecord) => {
    setTreatment({
      id_tratamiento: String(record.id_tratamiento), id_animal: String(record.id_animal), id_condicion_salud:String(record.id_condicion_salud??''), id_tipo_tratamiento: String(record.id_tipo_tratamiento),
      id_medicamento: String(record.id_medicamento), id_via_administracion: String(record.id_via_administracion), dosis: String(record.dosis ?? ''),
      id_unidad_dosis: String(record.id_unidad_dosis), fecha_aplicacion: dateInputValue(String(record.fecha_aplicacion ?? '')), proxima_aplicacion: dateInputValue(String(record.proxima_aplicacion ?? '')),
      aplicado_por: String(record.aplicado_por ?? ''), descripcion: String(record.descripcion ?? ''), observaciones: String(record.observaciones ?? ''),
    });
    setTreatmentOpen(true);
    setSelectedTreatment(null);
  };

  const scopedAnimals = directory.animals.filter((item) => isInOwnershipScope(item.categoria_codigo, ownershipScope));
  const campaignList = useListControls({ items: (campaigns.data ?? []).filter((item) => item.detalles.some((detail) => detail.seleccionado && isInOwnershipScope(detail.categoria_codigo, ownershipScope))), storageKey: 'sanitary-campaigns', searchText: (item) => `${item.tipo_tratamiento} ${item.medicamento} ${item.via} ${item.responsable ?? ''} ${item.detalles.map((detail) => detail.animal).join(' ')}`, dateValue: (item) => item.fecha_aplicacion, nameValue: (item) => item.tipo_tratamiento });
  const treatmentList = useListControls({ items: (treatments.data ?? []).filter((item) => isInOwnershipScope(String(item.categoria_codigo ?? ''), ownershipScope)), storageKey: 'sanitary-treatments', searchText: (item) => `${String(item.animal ?? '')} ${String(item.codigo_arete ?? '')} ${typeName(item.id_tipo_tratamiento)} ${medicineName(item.id_medicamento)}`, dateValue: (item) => String(item.fecha_aplicacion ?? ''), nameValue: (item) => String(item.animal ?? '') });
  const conditionList=useListControls({items:(conditions.data??[]).filter((item)=>isInOwnershipScope(item.categoria_codigo,ownershipScope)),storageKey:'sanitary-conditions',searchText:(item)=>`${item.animal} ${item.codigo_arete??''} ${item.tipo_condicion??''} ${item.descripcion} ${item.estado}`,dateValue:(item)=>item.fecha_deteccion,nameValue:(item)=>item.animal});
  const controls = tab === 'campaigns' ? campaignList : tab==='individual'?treatmentList:conditionList;
  const conditionTreatments=(id:string)=>(treatments.data??[]).filter((record)=>String(record.id_condicion_salud??'')===id);
  const selectedConditionTreatments=selectedCondition?conditionTreatments(selectedCondition.id_condicion_salud):[];
  const editCondition=(item:HealthCondition)=>{setCondition({id_condicion_salud:item.id_condicion_salud,id_animal:item.id_animal,id_tipo_condicion_salud:item.id_tipo_condicion_salud??'',fecha_deteccion:dateInputValue(item.fecha_deteccion),descripcion:item.descripcion});setSelectedCondition(null);setConditionOpen(true);};
  const editCampaign = (item: SanitaryCampaign) => {
    setCampaign({ id_tipo_tratamiento: item.id_tipo_tratamiento, id_medicamento: item.id_medicamento, id_via_administracion: item.id_via_administracion, dosis_general: String(item.dosis_general), id_unidad_dosis: item.id_unidad_dosis, fecha_aplicacion: dateInputValue(item.fecha_aplicacion), responsable: item.responsable ?? '', observaciones: item.observaciones ?? '', selection: { mode: item.modo_seleccion, groupId: item.id_grupo_filtro ?? '', animals: item.detalles.map((detail) => ({ id_animal: detail.id_animal, nombre: detail.nombre ?? detail.animal, codigo_arete: detail.codigo_arete ?? null, sexo: detail.sexo ?? 'HEMBRA', id_categoria_animal: detail.id_categoria_animal ?? '', categoria: detail.categoria ?? '', id_grupo_actual: detail.id_grupo_actual ?? null, grupo: detail.grupo ?? null, id_ubicacion_actual: detail.id_ubicacion_actual ?? null, ubicacion: detail.ubicacion ?? null, seleccionado: detail.seleccionado, dosis_aplicada: detail.dosis_aplicada == null ? null : Number(detail.dosis_aplicada), id_unidad_dosis: detail.id_unidad_dosis ?? item.id_unidad_dosis, observaciones: detail.observaciones ?? null })) } });
    setEditingCampaign(item); setSelectedCampaign(null); setCampaignOpen(true);
  };

  const changeScope=(scope:OwnershipScope)=>{setOwnershipScope(scope);setCampaignOpen(false);setTreatmentOpen(false);setConditionOpen(false);setSelectedCampaign(null);setSelectedTreatment(null);setSelectedCondition(null);setCampaign(emptyCampaign());setTreatment(emptyTreatment());setCondition(emptyCondition());};
  const cycleOrder=()=>controls.setOrder(controls.order==='NEWEST'?'OLDEST':controls.order==='OLDEST'?'AZ':controls.order==='AZ'?'ZA':'NEWEST');
  const openNew=()=>tab==='campaigns'?(setCampaign(emptyCampaign()),setCampaignOpen(true)):tab==='individual'?(setTreatment(emptyTreatment()),setTreatmentOpen(true)):(setCondition(emptyCondition()),setConditionOpen(true));

  return <div className="module-no-header">
    <CompactToolbar search={controls.search} onSearch={controls.setSearch} placeholder="Buscar en sanidad…" count={controls.visible.length} actions={<><IconButton label="Cambiar orden" onClick={cycleOrder}><ArrowUpDown size={19}/></IconButton><OwnershipScopeFilter compact value={ownershipScope} onChange={changeScope}/></>} below={<div className="compact-scroll-tabs"><button className={tab === 'conditions' ? 'active' : ''} onClick={() => setTab('conditions')}><Stethoscope size={17} />Condiciones de salud</button><button className={tab === 'individual' ? 'active' : ''} onClick={() => setTab('individual')}><Syringe size={17} />Tratamientos</button><button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}><Users size={17} />Jornadas colectivas</button></div>}/>

    {tab === 'campaigns' ? <>
      {campaigns.isLoading ? <LoadingState /> : campaigns.isError ? <ErrorState message={(campaigns.error as Error).message} onRetry={() => void campaigns.refetch()} /> : campaignList.visible.length ? <Card className="record-list sanitary-record-list"><div className="record-list-head"><span>Jornada</span><span>Fecha</span><span>Medicamento</span><span>Animales</span><span>Estado</span><span /></div>{campaignList.visible.map((item) => <button type="button" className="record-list-row" key={item.id_jornada} onClick={() => setSelectedCampaign(item)}><span><strong>{item.tipo_tratamiento}</strong><small>{item.via} · {formatNumber(item.dosis_general, 4)} {item.unidad}</small></span><span><strong>{formatDate(item.fecha_aplicacion)}</strong></span><span><strong>{item.medicamento}</strong><small>{item.responsable || 'Sin responsable'}</small></span><span><strong>{item.total_seleccionados} seleccionados</strong><small>{item.total_candidatos} candidatos</small></span><span><Badge tone={item.estado === 'COMPLETADO' ? 'success' : item.estado === 'CANCELADO' ? 'danger' : 'warning'}>{humanizeCode(item.estado)}</Badge></span><span className="record-row-actions">{item.estado === 'BORRADOR' && hasPermission('SANIDAD_ADMINISTRAR') ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); editCampaign(item); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card> : <EmptyState icon={Syringe} title="Sin jornadas sanitarias" description="Crea una vacunación, desparasitación o tratamiento para varios animales." action={hasPermission('SANIDAD_ADMINISTRAR') ? <Button onClick={() => setCampaignOpen(true)}><Plus size={18} />Nueva jornada</Button> : undefined} />}
    </> : tab==='individual'?<>
      {treatments.isLoading ? <LoadingState /> : treatments.isError ? <ErrorState message={(treatments.error as Error).message} onRetry={() => void treatments.refetch()} /> : treatmentList.visible.length ? <Card className="sanitary-compact-list">{treatmentList.visible.map((record) => {const animal=directory.byId.get(String(record.id_animal??''));return <button type="button" className="sanitary-compact-row" key={String(record.id_tratamiento)} onClick={() => setSelectedTreatment(record)}><AnimalIdentity option={{id:String(record.id_animal??''),name:String(record.animal??'—'),photoUrl:animal?.foto_perfil,subtitle:formatDate(String(record.fecha_aplicacion))}}/><span><strong>{typeName(record.id_tipo_tratamiento)} · {medicineName(record.id_medicamento)}</strong><small>{formatNumber(record.dosis as number|string,4)} {unitName(record.id_unidad_dosis)} · {routeName(record.id_via_administracion)}</small></span><span className="record-row-actions">{hasPermission('SANIDAD_ADMINISTRAR')?<IconButton label="Editar tratamiento" onClick={(event)=>{event.stopPropagation();editTreatment(record);}}><Edit3 size={16}/></IconButton>:null}<ChevronRight size={18}/></span></button>;})}</Card> : <EmptyState icon={Stethoscope} title="Sin tratamientos individuales" description="Registra medicamentos y dosis aplicadas a un animal." />}
    </>:<>{conditions.isLoading?<LoadingState/>:conditions.isError?<ErrorState message={(conditions.error as Error).message} onRetry={()=>void conditions.refetch()}/>:conditionList.visible.length?<Card className="sanitary-compact-list">{conditionList.visible.map((item)=>{const related=conditionTreatments(item.id_condicion_salud);const medicinesShown=related.slice(0,2).map((record)=>medicineName(record.id_medicamento)).join(', ');return <button type="button" className="sanitary-compact-row" key={item.id_condicion_salud} onClick={()=>{setShowAllConditionTreatments(false);setSelectedCondition(item);}}><AnimalIdentity option={{id:item.id_animal,name:item.animal,photoUrl:item.foto_perfil??directory.byId.get(item.id_animal)?.foto_perfil,subtitle:related.length?`${related.length} tratamiento(s): ${medicinesShown}`:'Sin tratamientos relacionados'}}/><span><strong>{item.tipo_condicion||'Otro problema'}</strong><small>{formatDate(item.fecha_deteccion)} · {item.descripcion}</small></span><Badge tone={item.estado==='RESUELTA'?'success':item.estado==='EN_TRATAMIENTO'?'info':'warning'}>{humanizeCode(item.estado)}</Badge><span className="record-row-actions">{hasPermission('SANIDAD_ADMINISTRAR')&&item.estado!=='RESUELTA'?<IconButton label="Editar condición" onClick={(event)=>{event.stopPropagation();editCondition(item);}}><Edit3 size={16}/></IconButton>:null}<ChevronRight size={18}/></span></button>;})}</Card>:<EmptyState icon={Stethoscope} title="Sin problemas de salud" description="Registra una enfermedad, lesión u otra condición detectada."/>}</>}

    {selectedCampaign ? <CampaignDetail item={selectedCampaign} onClose={() => setSelectedCampaign(null)} onEdit={selectedCampaign.estado === 'BORRADOR' && hasPermission('SANIDAD_ADMINISTRAR') ? () => editCampaign(selectedCampaign) : undefined} onApply={selectedCampaign.estado === 'BORRADOR' && hasPermission('SANIDAD_ADMINISTRAR') ? () => applyCampaign.mutate(selectedCampaign.id_jornada) : undefined} loading={applyCampaign.isPending} /> : null}
    {selectedTreatment ? <TreatmentDetail record={selectedTreatment} typeName={typeName} medicineName={medicineName} routeName={routeName} unitName={unitName} onClose={() => setSelectedTreatment(null)} onEdit={hasPermission('SANIDAD_ADMINISTRAR') ? () => editTreatment(selectedTreatment) : undefined} onDelete={hasPermission('SANIDAD_ADMINISTRAR') ? () => { setDeleteRecord(String(selectedTreatment.id_tratamiento)); setSelectedTreatment(null); } : undefined} /> : null}
    {selectedCondition?<Modal title="Detalle de la condición de salud" wide onClose={()=>setSelectedCondition(null)} footer={<><Button variant="ghost" onClick={()=>setSelectedCondition(null)}>Cerrar</Button>{hasPermission('SANIDAD_ADMINISTRAR')&&selectedCondition.estado!=='RESUELTA'?<><Button variant="secondary" onClick={()=>{setTreatment({...emptyTreatment(),id_animal:selectedCondition.id_animal,id_condicion_salud:selectedCondition.id_condicion_salud});setSelectedCondition(null);setTreatmentOpen(true);}}><Syringe size={16}/>Aplicar tratamiento</Button><Button onClick={()=>resolveCondition.mutate(selectedCondition.id_condicion_salud)} loading={resolveCondition.isPending}><CheckCircle2 size={16}/>Marcar resuelta</Button></>:null}</>}><div className="record-detail"><div className="record-detail-heading"><AnimalIdentity option={{id:selectedCondition.id_animal,name:selectedCondition.animal,photoUrl:selectedCondition.foto_perfil??directory.byId.get(selectedCondition.id_animal)?.foto_perfil,subtitle:selectedCondition.tipo_condicion||'Problema de salud'}}/><Badge tone={selectedCondition.estado==='RESUELTA'?'success':selectedCondition.estado==='EN_TRATAMIENTO'?'info':'warning'}>{humanizeCode(selectedCondition.estado)}</Badge></div><div className="detail-grid"><div><small>Fecha de detección</small><strong>{formatDate(selectedCondition.fecha_deteccion)}</strong></div><div><small>Tratamientos relacionados</small><strong>{selectedConditionTreatments.length}</strong></div><div><small>Fecha de resolución</small><strong>{formatDate(selectedCondition.fecha_resolucion)}</strong></div></div><section><h3>Descripción</h3><p>{selectedCondition.descripcion}</p></section><section><div className="section-heading-inline"><h3>Tratamientos relacionados <Badge tone="info">{selectedConditionTreatments.length}</Badge></h3>{selectedConditionTreatments.length>3?<Button variant="ghost" onClick={()=>setShowAllConditionTreatments((value)=>!value)}>{showAllConditionTreatments?'Mostrar 3':'Mostrar todos'}</Button>:null}</div>{selectedConditionTreatments.length?<div className="condition-treatment-preview">{(showAllConditionTreatments?selectedConditionTreatments:selectedConditionTreatments.slice(0,3)).map((record)=><button type="button" key={String(record.id_tratamiento)} onClick={()=>{setSelectedCondition(null);setSelectedTreatment(record);}}><span><strong>{medicineName(record.id_medicamento)}</strong><small>{formatDate(String(record.fecha_aplicacion))}</small></span><span><strong>{formatNumber(record.dosis as number|string,4)} {unitName(record.id_unidad_dosis)}</strong><small>{routeName(record.id_via_administracion)}</small></span><ChevronRight size={17}/></button>)}</div>:<p className="muted">Todavía no hay tratamientos relacionados.</p>}</section></div></Modal>:null}

    {campaignOpen ? <Modal title={editingCampaign ? 'Editar jornada sanitaria' : 'Nueva jornada sanitaria'} wide onClose={() => { setCampaignOpen(false); setEditingCampaign(null); }} footer={<><Button variant="ghost" onClick={() => { setCampaignOpen(false); setEditingCampaign(null); }}>Cancelar</Button><Button onClick={() => createCampaign.mutate()} loading={createCampaign.isPending}>{editingCampaign ? 'Guardar cambios' : 'Guardar borrador'}</Button></>}><div className="form-stack"><div className="form-section"><h3>Tratamiento general</h3><div className="form-grid">
      <Field label="Tipo" required><Select value={campaign.id_tipo_tratamiento} onChange={(event) => setCampaign((current) => ({ ...current, id_tipo_tratamiento: event.target.value, id_medicamento:'', id_via_administracion:'', id_unidad_dosis:'' }))}><option value="">Selecciona</option>{types.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Medicamento" required><Select disabled={!campaign.id_tipo_tratamiento} value={campaign.id_medicamento} onChange={(event) => chooseCampaignMedicine(event.target.value)}><option value="">{campaign.id_tipo_tratamiento?'Selecciona':'Selecciona primero el tipo'}</option>{medicinesForType(campaign.id_tipo_tratamiento).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      {selectedCampaignMedicine&&(selectedCampaignMedicine.dosis_sugerida||selectedCampaignMedicine.indicaciones)?<div className="form-alert">{selectedCampaignMedicine.dosis_sugerida?<><strong>Dosis sugerida:</strong> {String(selectedCampaignMedicine.dosis_sugerida)}<br/></>:null}{selectedCampaignMedicine.indicaciones?<><strong>Indicaciones:</strong> {String(selectedCampaignMedicine.indicaciones)}</>:null}</div>:null}
      <Field label="Vía" required><Select disabled={!campaign.id_medicamento} value={campaign.id_via_administracion} onChange={(event) => setCampaign((current) => ({ ...current, id_via_administracion: event.target.value }))}><option value="">Selecciona</option>{routesForMedicine(campaign.id_medicamento).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Dosis general" required><Input type="number" min="0.0001" step="0.0001" value={campaign.dosis_general} onChange={(event) => setCampaign((current) => ({ ...current, dosis_general: event.target.value }))} /></Field>
      <Field label="Unidad" required><Select disabled={Boolean(selectedCampaignMedicine?.id_unidad_predeterminada)} value={campaign.id_unidad_dosis} onChange={(event) => setCampaign((current) => ({ ...current, id_unidad_dosis: event.target.value }))}><option value="">Selecciona</option>{units.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
      <Field label="Fecha" required><Input type="date" value={campaign.fecha_aplicacion} onChange={(event) => setCampaign((current) => ({ ...current, fecha_aplicacion: event.target.value }))} /></Field>
      <Field label="Responsable"><Input value={campaign.responsable} onChange={(event) => setCampaign((current) => ({ ...current, responsable: event.target.value }))} /></Field>
    </div><Field label="Observaciones"><Textarea value={campaign.observaciones} onChange={(event) => setCampaign((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div><AnimalSelectionBuilder value={campaign.selection} operationCode="TRATAMIENTO" ownershipScope={ownershipScope} doseUnitId={campaign.id_unidad_dosis} allowDose onChange={(selection) => setCampaign((current) => ({ ...current, selection }))} /></div></Modal> : null}

    {treatmentOpen ? <Modal title={treatment.id_tratamiento ? 'Editar tratamiento' : 'Nuevo tratamiento'} wide onClose={() => setTreatmentOpen(false)} footer={<><Button variant="ghost" onClick={() => setTreatmentOpen(false)}>Cancelar</Button><Button onClick={() => saveTreatment.mutate()} loading={saveTreatment.isPending}>Guardar</Button></>}><div className="form-stack"><div className="form-grid">
      <Field label="Condición relacionada" hint="Opcional para vacunas, vitaminas y otros tratamientos preventivos."><Select value={treatment.id_condicion_salud} onChange={(event)=>{const linked=conditions.data?.find((item)=>item.id_condicion_salud===event.target.value);setTreatment((current)=>({...current,id_condicion_salud:event.target.value,id_animal:linked?.id_animal??current.id_animal}));}}><option value="">Tratamiento preventivo o sin condición</option>{conditions.data?.filter((item)=>item.estado!=='RESUELTA'&&(!treatment.id_animal||item.id_animal===treatment.id_animal||item.id_condicion_salud===treatment.id_condicion_salud)).map((item)=><option key={item.id_condicion_salud} value={item.id_condicion_salud}>{item.animal} · {item.tipo_condicion||item.descripcion}</option>)}</Select></Field>
      <Field label="Animal" required><AnimalSelect value={treatment.id_animal} options={scopedAnimals.map(animalOption)} onChange={(id)=>setTreatment((current)=>({...current,id_animal:id,id_condicion_salud:conditions.data?.some((item)=>item.id_condicion_salud===current.id_condicion_salud&&item.id_animal===id)?current.id_condicion_salud:''}))}/></Field>
      <Field label="Tipo" required><Select value={treatment.id_tipo_tratamiento} onChange={(event) => setTreatment((current) => ({ ...current, id_tipo_tratamiento: event.target.value, id_medicamento:'', id_via_administracion:'', id_unidad_dosis:'' }))}><option value="">Selecciona</option>{types.data?.filter((item)=>item.activo!==false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Medicamento" required><Select disabled={!treatment.id_tipo_tratamiento} value={treatment.id_medicamento} onChange={(event) => chooseTreatmentMedicine(event.target.value)}><option value="">{treatment.id_tipo_tratamiento?'Selecciona':'Selecciona primero el tipo'}</option>{medicinesForType(treatment.id_tipo_tratamiento).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      {selectedTreatmentMedicine&&(selectedTreatmentMedicine.dosis_sugerida||selectedTreatmentMedicine.indicaciones)?<div className="form-alert">{selectedTreatmentMedicine.dosis_sugerida?<><strong>Dosis sugerida:</strong> {String(selectedTreatmentMedicine.dosis_sugerida)}<br/></>:null}{selectedTreatmentMedicine.indicaciones?<><strong>Indicaciones:</strong> {String(selectedTreatmentMedicine.indicaciones)}</>:null}</div>:null}
      <Field label="Vía" required><Select disabled={!treatment.id_medicamento} value={treatment.id_via_administracion} onChange={(event) => setTreatment((current) => ({ ...current, id_via_administracion: event.target.value }))}><option value="">Selecciona</option>{routesForMedicine(treatment.id_medicamento).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Dosis" required><Input type="number" min="0.0001" step="0.0001" value={treatment.dosis} onChange={(event) => setTreatment((current) => ({ ...current, dosis: event.target.value }))} /></Field>
      <Field label="Unidad" required><Select disabled={Boolean(selectedTreatmentMedicine?.id_unidad_predeterminada)} value={treatment.id_unidad_dosis} onChange={(event) => setTreatment((current) => ({ ...current, id_unidad_dosis: event.target.value }))}><option value="">Selecciona</option>{units.data?.map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
      <Field label="Fecha de aplicación" required><Input type="date" value={treatment.fecha_aplicacion} onChange={(event) => setTreatment((current) => ({ ...current, fecha_aplicacion: event.target.value }))} /></Field>
      <Field label="Próxima aplicación"><Input type="date" value={treatment.proxima_aplicacion} onChange={(event) => setTreatment((current) => ({ ...current, proxima_aplicacion: event.target.value }))} /></Field>
      <Field label="Aplicado por"><Input value={treatment.aplicado_por} onChange={(event) => setTreatment((current) => ({ ...current, aplicado_por: event.target.value }))} /></Field>
      <Field label="Descripción"><Input value={treatment.descripcion} onChange={(event) => setTreatment((current) => ({ ...current, descripcion: event.target.value }))} /></Field>
    </div><Field label="Observaciones"><Textarea value={treatment.observaciones} onChange={(event) => setTreatment((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div></Modal> : null}
    {conditionOpen?<Modal title={condition.id_condicion_salud?'Editar condición de salud':'Nueva condición de salud'} wide onClose={()=>setConditionOpen(false)} footer={<><Button variant="ghost" onClick={()=>setConditionOpen(false)}>Cancelar</Button><Button onClick={()=>saveCondition.mutate()} loading={saveCondition.isPending}>Guardar</Button></>}><div className="form-stack"><div className="form-grid"><Field label="Animal" required><AnimalSelect value={condition.id_animal} options={scopedAnimals.map(animalOption)} onChange={(id)=>setCondition({...condition,id_animal:id})}/></Field><Field label="Tipo de problema"><Select value={condition.id_tipo_condicion_salud} onChange={(event)=>setCondition({...condition,id_tipo_condicion_salud:event.target.value})}><option value="">Otro o sin clasificar</option>{conditionTypes.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Fecha de detección" required><Input type="date" value={condition.fecha_deteccion} onChange={(event)=>setCondition({...condition,fecha_deteccion:event.target.value})}/></Field></div><Field label="Descripción del problema" required><Textarea value={condition.descripcion} onChange={(event)=>setCondition({...condition,descripcion:event.target.value})}/></Field></div></Modal>:null}
    {hasPermission('SANIDAD_ADMINISTRAR')?<FloatingActionDock><IconButton label={tab==='campaigns'?'Nueva jornada':tab==='individual'?'Nuevo tratamiento':'Nueva condición'} onClick={openNew}><Plus size={23}/></IconButton></FloatingActionDock>:null}
    {deleteRecord ? <ConfirmDialog title="Eliminar tratamiento" message="¿Deseas eliminar este registro del historial?" onClose={() => setDeleteRecord(null)} onConfirm={() => removeTreatment.mutate(deleteRecord)} loading={removeTreatment.isPending} /> : null}
  </div>;
}

function CampaignDetail({ item, onClose, onEdit, onApply, loading }: { item: SanitaryCampaign; onClose: () => void; onEdit?: () => void; onApply?: () => void; loading: boolean }) {
  return <Modal title="Detalle de la jornada" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onEdit ? <Button variant="secondary" onClick={onEdit}><Edit3 size={17} />Editar</Button> : null}{onApply ? <Button onClick={onApply} loading={loading}><CheckCircle2 size={17} />Aplicar jornada</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><Syringe size={22} /></div><div><h2>{item.tipo_tratamiento}</h2><p>{formatDate(item.fecha_aplicacion)}</p></div><Badge tone={item.estado === 'COMPLETADO' ? 'success' : item.estado === 'CANCELADO' ? 'danger' : 'warning'}>{humanizeCode(item.estado)}</Badge></div><div className="detail-grid"><div><small>Medicamento</small><strong>{item.medicamento}</strong></div><div><small>Dosis general</small><strong>{formatNumber(item.dosis_general, 4)} {item.unidad}</strong></div><div><small>Vía</small><strong>{item.via}</strong></div><div><small>Responsable</small><strong>{item.responsable || 'Sin registrar'}</strong></div></div><section><h3>Animales</h3><div className="detail-lines compact">{item.detalles.map((detail) => <div key={detail.id_detalle} className={!detail.seleccionado ? 'excluded' : ''}><span><strong>{detail.animal}</strong><small>{detail.dosis_aplicada ? `Dosis ${detail.dosis_aplicada} ${item.unidad}` : 'Dosis general'}</small></span><Badge tone={detail.seleccionado ? 'success' : 'neutral'}>{detail.seleccionado ? humanizeCode(detail.estado) : 'Excluido'}</Badge></div>)}</div></section>{item.observaciones ? <section><h3>Observaciones</h3><p>{item.observaciones}</p></section> : null}</div></Modal>;
}

function TreatmentDetail({ record, typeName, medicineName, routeName, unitName, onClose, onEdit, onDelete }: { record: GenericRecord; typeName: (id: unknown) => string; medicineName: (id: unknown) => string; routeName: (id: unknown) => string; unitName: (id: unknown) => string; onClose: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return <Modal title="Detalle del tratamiento" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onDelete ? <Button variant="ghost" onClick={onDelete}><Trash2 size={17} />Eliminar</Button> : null}{onEdit ? <Button onClick={onEdit}><Edit3 size={17} />Editar</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><Stethoscope size={22} /></div><div><h2>{String(record.animal ?? 'Animal')}</h2><p>{record.codigo_arete ? `Arete ${String(record.codigo_arete)}` : 'Sin arete'}</p></div></div><div className="detail-grid"><div><small>Tratamiento</small><strong>{typeName(record.id_tipo_tratamiento)}</strong></div><div><small>Medicamento</small><strong>{medicineName(record.id_medicamento)}</strong></div><div><small>Dosis</small><strong>{formatNumber(record.dosis as number | string, 4)} {unitName(record.id_unidad_dosis)}</strong></div><div><small>Vía</small><strong>{routeName(record.id_via_administracion)}</strong></div><div><small>Aplicación</small><strong>{formatDate(String(record.fecha_aplicacion))}</strong></div><div><small>Próxima aplicación</small><strong>{formatDate(record.proxima_aplicacion ? String(record.proxima_aplicacion) : null)}</strong></div><div><small>Aplicado por</small><strong>{String(record.aplicado_por ?? 'Sin registrar')}</strong></div>{record.id_condicion_salud?<div><small>Condición relacionada</small><strong>{String(record.condicion_tipo??record.condicion_descripcion??'Problema de salud')}</strong></div>:null}</div>{record.descripcion ? <section><h3>Descripción</h3><p>{String(record.descripcion)}</p></section> : null}{record.observaciones ? <section><h3>Observaciones</h3><p>{String(record.observaciones)}</p></section> : null}</div></Modal>;
}

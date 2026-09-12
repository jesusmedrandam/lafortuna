import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Baby, CalendarClock, Camera, ChevronRight, Edit3, HeartCrack, HeartPulse, ImagePlus, Plus, Syringe, Trash2, X } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { ImageLightbox } from '../../components/ImageLightbox';
import { AnimalIdentity, AnimalSelect, type AnimalPickerOption, useAnimalDirectory } from '../../components/AnimalPicker';
import { isInOwnershipScope, OwnershipScopeFilter, type OwnershipScope } from '../../components/OwnershipScopeFilter';
import { Badge, Button, Card, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { useListControls } from '../../hooks/useListControls';
import type { AssistedReproductionRecord, Birth, CatalogItem, GenericRecord, Group, HeatRecord, Location, OwnerOption, PregnancyRecord, UpcomingBirth } from '../../types/api';
import { currentDateInput, dateInputValue, formatAge, formatDate, formatNumber, humanizeCode, nullIfEmpty, numberOrNull } from '../../utils';

type Tab = 'heats' | 'services' | 'pregnancies' | 'upcoming' | 'births' | 'abortions';
type ReproductionAnimal = { id_animal: string; nombre: string; codigo_arete: string | null; fecha_nacimiento: string | null; id_especie: string; id_categoria_animal: string; categoria_codigo: string; categoria: string; prenez_confirmada?:boolean };
type ReproductionOptions = { hembras: ReproductionAnimal[]; hembras_prenez?:ReproductionAnimal[]; machos: ReproductionAnimal[] };
type OperationVisibilityResponse = { operaciones: Record<string,boolean> };

const localToday = currentDateInput;

interface HeatForm { id_celo?: string; id_vaca: string; id_toro: string; fecha_inicio: string; fecha_fin: string; es_falso?:boolean; observaciones: string }
const emptyHeat = (): HeatForm => ({ id_vaca: '', id_toro: '', fecha_inicio: localToday(), fecha_fin: '', es_falso:false, observaciones: '' });

interface PregnancyForm {
  id_prenez?: string;
  id_celo: string;
  id_vaca: string;
  id_padre: string;
  padre_externo:string;
  id_servicio_reproductivo:string;
  metodo_embarazo: 'MONTA_NATURAL' | 'INSEMINACION_ARTIFICIAL' | 'TRANSFERENCIA_EMBRIONES' | 'DESCONOCIDO';
  metodo_confirmacion: 'PALPACION' | 'ECOGRAFIA' | 'ANALISIS_SANGRE' | 'OBSERVACION' | 'OTRO';
  fecha_confirmacion: string;
  dias_gestacion_confirmacion: string;
  observaciones: string;
}
const emptyPregnancy = (): PregnancyForm => ({ id_celo: '', id_vaca: '', id_padre: '', padre_externo:'',id_servicio_reproductivo:'',metodo_embarazo: 'MONTA_NATURAL', metodo_confirmacion: 'PALPACION', fecha_confirmacion: localToday(), dias_gestacion_confirmacion: '', observaciones: '' });

interface AssistedServiceForm{id_servicio_reproductivo?:string;id_vaca:string;tipo:'INSEMINACION_ARTIFICIAL'|'TRANSFERENCIA_EMBRIONES';fecha:string;id_celo:string;id_padre:string;padre_externo:string;id_donante:string;donante_externa:string;codigo_material:string;calidad:string;tecnico:string;proveedor:string;observaciones:string}
const emptyAssistedService=(tipo:AssistedServiceForm['tipo']='INSEMINACION_ARTIFICIAL'):AssistedServiceForm=>({id_vaca:'',tipo,fecha:localToday(),id_celo:'',id_padre:'',padre_externo:'',id_donante:'',donante_externa:'',codigo_material:'',calidad:'',tecnico:'',proveedor:'',observaciones:''});

const addDays = (value: string, days: number) => { const date=new Date(`${value.slice(0,10)}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10); };
const animalPickerOption = (item: ReproductionAnimal, photoUrl?: string | null): AnimalPickerOption => ({ id:item.id_animal,name:item.nombre,subtitle:[item.codigo_arete?`Arete ${item.codigo_arete}`:null,formatAge(item.fecha_nacimiento)].filter(Boolean).join(' · '),photoUrl });

interface ChildForm {
  codigo_arete: string; nombre: string; id_especie: string; sexo: 'MACHO' | 'HEMBRA'; id_origen: string;
  id_color: string; id_raza: string; propietarios: { id: string; porcentaje: string; principal: boolean }[];
  id_grupo_actual: string; id_ubicacion_actual: string; estado: 'ACTIVO' | 'MUERTO';
  estado_nacimiento: 'VIVA' | 'MUERTA' | 'DEBIL' | 'DESCONOCIDO'; peso_nacimiento_kg: string;
  observaciones: string; foto_perfil: File | null; fotos: File[];
}
const emptyChild = (species = ''): ChildForm => ({ codigo_arete: '', nombre: '', id_especie: species, sexo: 'HEMBRA', id_origen: '', id_color: '', id_raza: '', propietarios: [], id_grupo_actual: '', id_ubicacion_actual: '', estado: 'ACTIVO', estado_nacimiento: 'VIVA', peso_nacimiento_kg: '', observaciones: '', foto_perfil: null, fotos: [] });
interface BirthForm { id_prenez: string; fecha_parto: string; tipo_parto: string; observaciones: string; crias: ChildForm[] }
const emptyBirth = (): BirthForm => ({ id_prenez: '', fecha_parto: localToday(), tipo_parto: 'NORMAL', observaciones: '', crias: [emptyChild()] });
interface BirthEditForm { id_parto: string; fecha_parto: string; tipo_parto: string; observaciones: string }

interface AbortionForm { id_aborto?: string; id_prenez: string; id_vaca: string; fecha: string; causa: string; meses_gestacion: string; descripcion: string }
const emptyAbortion = (): AbortionForm => ({ id_prenez: '', id_vaca: '', fecha: localToday(), causa: '', meses_gestacion: '', descripcion: '' });

export function BirthsPage() {
  const [searchParams]=useSearchParams();
  const routeAnimalId=searchParams.get('animal')??'';
  const consumedRoute=useRef('');
  const consumedAction=useRef('');
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canBirths = hasPermission('PARTO_CONSULTAR');
  const canAbortions = hasPermission('ABORTO_CONSULTAR');
  const [tab, setTab] = useState<Tab>(() => canBirths ? 'upcoming' : 'abortions');
  const [ownershipScope, setOwnershipScope] = useState<OwnershipScope>('EN_PROPIEDAD');
  const [heatForm, setHeatForm] = useState<HeatForm | null>(null);
  const [serviceForm,setServiceForm]=useState<AssistedServiceForm|null>(null);
  const [pregnancyForm, setPregnancyForm] = useState<PregnancyForm | null>(null);
  const [birthForm, setBirthForm] = useState<BirthForm | null>(null);
  const [birthEditForm, setBirthEditForm] = useState<BirthEditForm | null>(null);
  const [selectedBirth, setSelectedBirth] = useState<Birth | null>(null);
  const [abortionForm, setAbortionForm] = useState<AbortionForm | null>(null);
  const [selectedRecord,setSelectedRecord]=useState<{title:string;rows:Array<[string,string]>}|null>(null);
  const [deleting, setDeleting] = useState<{ type: 'heat' | 'service' | 'pregnancy' | 'abortion'; id: string } | null>(null);

  const options = useQuery({ queryKey: ['reproduction', 'options'], queryFn: () => apiRequest<ReproductionOptions>('/reproduccion/opciones'), enabled: canBirths || canAbortions });
  const heats = useQuery({ queryKey: ['reproduction', 'heats'], queryFn: () => apiRequest<HeatRecord[]>('/reproduccion/celos'), enabled: canBirths });
  const services=useQuery({queryKey:['reproduction','services'],queryFn:()=>apiRequest<AssistedReproductionRecord[]>('/reproduccion/servicios'),enabled:canBirths});
  const operationVisibility=useQuery({queryKey:['visible-operation-policy'],queryFn:()=>apiRequest<OperationVisibilityResponse>('/configuracion/operaciones-visibles'),enabled:canBirths,staleTime:5*60_000});
  const allowInsemination=operationVisibility.data?.operaciones.INSEMINACION_ARTIFICIAL===true;
  const allowEmbryoTransfer=operationVisibility.data?.operaciones.TRANSFERENCIA_EMBRIONES===true;
  const assistedOperationsEnabled=allowInsemination||allowEmbryoTransfer;
  const showServices=Boolean(services.data?.length)||assistedOperationsEnabled;
  const defaultAssistedType:AssistedServiceForm['tipo']=allowInsemination?'INSEMINACION_ARTIFICIAL':'TRANSFERENCIA_EMBRIONES';
  const pregnancies = useQuery({ queryKey: ['reproduction', 'pregnancies'], queryFn: () => apiRequest<PregnancyRecord[]>('/reproduccion/preneces'), enabled: canBirths });
  const upcoming = useQuery({ queryKey: ['reproduction', 'upcoming'], queryFn: () => apiRequest<UpcomingBirth[]>('/reproduccion/proximos-partos'), enabled: canBirths });
  const births = useQuery({ queryKey: ['births'], queryFn: () => apiRequest<Birth[]>('/partos'), enabled: canBirths });
  const abortions = useQuery({ queryKey: ['records', 'abortos'], queryFn: () => apiRequest<GenericRecord[]>('/registros/abortos'), enabled: canAbortions });
  useEffect(()=>{
    const requestedTab=searchParams.get('tab') as Tab|null;
    if(requestedTab&&['heats','services','pregnancies','upcoming','births','abortions'].includes(requestedTab)&&!(requestedTab==='services'&&!showServices))setTab(requestedTab);
    const parto=searchParams.get('parto');
    const celo=searchParams.get('celo');
    const prenez=searchParams.get('prenez');
    const aborto=searchParams.get('aborto');
    const routeKey=[parto,celo,prenez,aborto].filter(Boolean).join(':');
    if(!routeKey||consumedRoute.current===routeKey)return;
    if(parto&&births.data){const match=births.data.find((item)=>item.id_parto===parto);if(match){setTab('births');setSelectedBirth(match);consumedRoute.current=routeKey;return;}}
    if(celo&&heats.data){const item=heats.data.find((record)=>record.id_celo===celo);if(item){setTab('heats');setSelectedRecord({title:`Celo de ${item.vaca}`,rows:[['Vaca',item.vaca],['Toro',item.toro||'No registrado'],['Inicio',formatDate(item.fecha_inicio)],['Fin',formatDate(item.fecha_fin)],['Estado',item.es_falso?'Celo falso o aparente':item.tiene_prenez?'Preñez relacionada':'Registrado'],['Observaciones',item.observaciones||'Sin observaciones']]});consumedRoute.current=routeKey;return;}}
    if(prenez&&pregnancies.data){const item=pregnancies.data.find((record)=>record.id_prenez===prenez);if(item){setTab('pregnancies');setSelectedRecord({title:`Preñez de ${item.vaca}`,rows:[['Vaca',item.vaca],['Padre',item.padre||'No registrado'],['Confirmación',formatDate(item.fecha_confirmacion)],['Método',humanizeCode(item.metodo_confirmacion)],['Parto tentativo',formatDate(item.fecha_parto_tentativa)],['Estado',humanizeCode(item.estado)],['Observaciones',item.observaciones||'Sin observaciones']]});consumedRoute.current=routeKey;return;}}
    if(aborto&&abortions.data){const item=abortions.data.find((record)=>String(record.id_aborto)===aborto);if(item){setTab('abortions');setSelectedRecord({title:`Aborto de ${String(item.animal??'animal')}`,rows:[['Animal',String(item.animal??'—')],['Fecha',formatDate(item.fecha?String(item.fecha):null)],['Causa',String(item.causa??'No registrada')],['Gestación',item.meses_gestacion==null?'No registrada':`${formatNumber(item.meses_gestacion as number|string,1)} meses`],['Descripción',String(item.descripcion??'Sin descripción')]]});consumedRoute.current=routeKey;}}
  },[abortions.data,births.data,heats.data,pregnancies.data,searchParams,showServices]);
  useEffect(()=>{if(tab==='services'&&!showServices&&!operationVisibility.isPending)setTab(canBirths?'upcoming':'abortions');},[canBirths,operationVisibility.isPending,showServices,tab]);
  useEffect(()=>{
    const action=searchParams.get('nuevo');const animal=searchParams.get('animal')??'';const key=`${action}:${animal}`;
    if(!action||consumedAction.current===key)return;
    if(action==='celo'){setTab('heats');setHeatForm({...emptyHeat(),id_vaca:animal});}
    else if(action==='inseminacion'||action==='embrion'){
      if(operationVisibility.isPending)return;
      const requestedType=action==='embrion'?'TRANSFERENCIA_EMBRIONES':'INSEMINACION_ARTIFICIAL';
      if((requestedType==='INSEMINACION_ARTIFICIAL'&&!allowInsemination)||(requestedType==='TRANSFERENCIA_EMBRIONES'&&!allowEmbryoTransfer)){consumedAction.current=key;return;}
      setTab('services');setServiceForm({...emptyAssistedService(requestedType),id_vaca:animal});
    }
    else if(action==='prenez'){setTab('pregnancies');setPregnancyForm({...emptyPregnancy(),id_vaca:animal});}
    else if(action==='parto'){setTab('births');const pregnancy=pregnancies.data?.find((item)=>item.id_vaca===animal&&item.estado==='CONFIRMADA');setBirthForm({...emptyBirth(),id_prenez:pregnancy?.id_prenez??''});}
    else if(action==='aborto'){setTab('abortions');const pregnancy=pregnancies.data?.find((item)=>item.id_vaca===animal&&item.estado==='CONFIRMADA');setAbortionForm({...emptyAbortion(),id_vaca:animal,id_prenez:pregnancy?.id_prenez??''});}
    else return;consumedAction.current=key;
  },[allowEmbryoTransfer,allowInsemination,operationVisibility.isPending,pregnancies.data,searchParams]);
  const species = useCatalog('especies');
  const origins = useCatalog('origenes');
  const colors = useCatalog('colores');
  const breeds = useCatalog('razas');
  const owners = useQuery({ queryKey: ['animal-owner-options'], queryFn: () => apiRequest<OwnerOption[]>('/animales/opciones/propietarios'), enabled: canBirths });
  const groups = useQuery({ queryKey: ['groups', 'birth'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'birth'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  const directory=useAnimalDirectory(canBirths||canAbortions);
  const photoFor=(id:unknown)=>directory.byId.get(String(id??''))?.foto_perfil??null;

  const scopedFemales = options.data?.hembras.filter((item) => (isInOwnershipScope(item.categoria_codigo, ownershipScope)||item.id_animal===routeAnimalId)&&(!pregnancyForm||!item.prenez_confirmada||item.id_animal===pregnancyForm.id_vaca)) ?? [];
  const heatFemales=scopedFemales.filter((item)=>Boolean(heatForm?.es_falso)||!item.prenez_confirmada||item.id_animal===heatForm?.id_vaca);
  const serviceFemales=scopedFemales.filter((item)=>!item.prenez_confirmada||Boolean(serviceForm?.id_servicio_reproductivo&&item.id_animal===serviceForm.id_vaca));
  const scopedMales = options.data?.machos.filter((item) => isInOwnershipScope(item.categoria_codigo, ownershipScope)||item.id_animal===routeAnimalId) ?? [];
  const inRoute=(ids:unknown[])=>!routeAnimalId||ids.some(value=>String(value??'')===routeAnimalId);
  const inScope=(category:string,ids:unknown[])=>routeAnimalId?inRoute(ids):isInOwnershipScope(category,ownershipScope);
  const heatList = useListControls({ items: (heats.data ?? []).filter((item) => inScope(item.categoria_codigo,[item.id_vaca,item.id_toro])), storageKey: 'reproduction-heats', searchText: (item) => `${item.vaca} ${item.codigo_arete ?? ''} ${item.toro ?? ''}`, dateValue: (item) => item.fecha_inicio, nameValue: (item) => item.vaca });
  const serviceList=useListControls({items:(services.data??[]).filter((item)=>inScope(item.categoria_codigo,[item.id_vaca,item.id_padre,item.id_donante])),storageKey:'reproduction-services',searchText:(item)=>`${item.vaca} ${item.padre??''} ${item.donante??''} ${item.tecnico??''} ${item.codigo_material??''}`,dateValue:(item)=>item.fecha,nameValue:(item)=>item.vaca});
  const pregnancyList = useListControls({ items: (pregnancies.data ?? []).filter((item) => inScope(item.categoria_codigo,[item.id_vaca,item.id_padre])), storageKey: 'reproduction-pregnancies', searchText: (item) => `${item.vaca} ${item.codigo_arete ?? ''} ${item.padre ?? ''} ${item.metodo_confirmacion}`, dateValue: (item) => item.fecha_confirmacion, nameValue: (item) => item.vaca });
  const upcomingList = useListControls({ items: (upcoming.data ?? []).filter((item) => inScope(item.categoria_codigo,[item.id_vaca])), storageKey: 'reproduction-upcoming', searchText: (item) => `${item.vaca} ${item.codigo_arete ?? ''} ${item.padre ?? ''}`, dateValue: (item) => item.fecha_tentativa ?? item.fecha_confirmacion, nameValue: (item) => item.vaca });
  const birthList = useListControls({ items: (births.data ?? []).filter((item) => inScope(item.categoria_codigo,[item.id_madre,item.id_padre,...item.crias.map(child=>child.id_cria)])), storageKey: 'reproduction-births', searchText: (item) => `${item.madre} ${item.madre_arete ?? ''} ${item.padre ?? ''} ${item.tipo_parto} ${item.crias.map((child) => `${child.cria} ${child.codigo_arete ?? ''}`).join(' ')}`, dateValue: (item) => item.fecha_parto, nameValue: (item) => item.madre });
  const abortionList = useListControls({ items: (abortions.data ?? []).filter((item) => inScope(String(item.categoria_codigo ?? ''),[item.id_vaca])), storageKey: 'reproduction-abortions', searchText: (item) => `${String(item.animal ?? '')} ${String(item.causa ?? '')} ${String(item.descripcion ?? '')}`, dateValue: (item) => String(item.fecha ?? ''), nameValue: (item) => String(item.animal ?? '') });
  const controls = tab === 'heats' ? heatList : tab==='services'?serviceList:tab === 'pregnancies' ? pregnancyList : tab === 'upcoming' ? upcomingList : tab === 'births' ? birthList : abortionList;

  const refreshReproduction = () => {
    void client.invalidateQueries({ queryKey: ['reproduction'] });
    void client.invalidateQueries({ queryKey: ['births'] });
    void client.invalidateQueries({ queryKey: ['animals'] });
  };

  const saveHeat = useMutation({
    mutationFn: () => {
      if (!heatForm?.id_vaca || !heatForm.fecha_inicio) throw new Error('Selecciona la vaca y la fecha de inicio.');
      return apiRequest(`/reproduccion/celos${heatForm.id_celo ? `/${heatForm.id_celo}` : ''}`, {
        method: heatForm.id_celo ? 'PATCH' : 'POST',
        body: { id_vaca: heatForm.id_vaca, id_toro: heatForm.id_toro || null, fecha_inicio: heatForm.fecha_inicio, fecha_fin: heatForm.fecha_fin || null, es_falso:Boolean(heatForm.es_falso), observaciones: nullIfEmpty(heatForm.observaciones) },
      });
    },
    onSuccess: () => { toast.show(heatForm?.id_celo ? 'Celo actualizado.' : 'Celo registrado.'); setHeatForm(null); refreshReproduction(); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveService=useMutation({
    mutationFn:()=>{
      if(!serviceForm?.id_vaca||!serviceForm.fecha)throw new Error('Selecciona la receptora y la fecha.');
      if(options.data?.hembras.find((item)=>item.id_animal===serviceForm.id_vaca)?.prenez_confirmada)throw new Error('No se puede realizar este procedimiento porque la receptora ya tiene una preñez confirmada.');
      return apiRequest(`/reproduccion/servicios${serviceForm.id_servicio_reproductivo?`/${serviceForm.id_servicio_reproductivo}`:''}`,{
        method:serviceForm.id_servicio_reproductivo?'PATCH':'POST',body:{...serviceForm,id_servicio_reproductivo:undefined,id_celo:serviceForm.id_celo||null,id_padre:serviceForm.id_padre||null,padre_externo:nullIfEmpty(serviceForm.padre_externo),id_donante:serviceForm.tipo==='TRANSFERENCIA_EMBRIONES'?serviceForm.id_donante||null:null,donante_externa:serviceForm.tipo==='TRANSFERENCIA_EMBRIONES'?nullIfEmpty(serviceForm.donante_externa):null,codigo_material:nullIfEmpty(serviceForm.codigo_material),calidad:nullIfEmpty(serviceForm.calidad),tecnico:nullIfEmpty(serviceForm.tecnico),proveedor:nullIfEmpty(serviceForm.proveedor),observaciones:nullIfEmpty(serviceForm.observaciones)},
      });
    },
    onSuccess:()=>{toast.show(serviceForm?.id_servicio_reproductivo?'Servicio actualizado.':'Servicio reproductivo registrado.');setServiceForm(null);refreshReproduction();},
    onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error'),
  });

  const savePregnancy = useMutation({
    mutationFn: () => {
      if (!pregnancyForm || (!pregnancyForm.id_celo && !pregnancyForm.id_vaca)) throw new Error('Selecciona un celo o una vaca.');
      return apiRequest(`/reproduccion/preneces${pregnancyForm.id_prenez ? `/${pregnancyForm.id_prenez}` : ''}`, {
        method: pregnancyForm.id_prenez ? 'PATCH' : 'POST',
        body: {
          id_celo: pregnancyForm.id_celo || null,
          id_vaca: pregnancyForm.id_vaca || null,
          id_padre: pregnancyForm.id_padre || null,
          padre_externo:nullIfEmpty(pregnancyForm.padre_externo),
          id_servicio_reproductivo:pregnancyForm.id_servicio_reproductivo||null,
          metodo_embarazo: pregnancyForm.metodo_embarazo,
          metodo_confirmacion: pregnancyForm.metodo_confirmacion,
          fecha_confirmacion: pregnancyForm.fecha_confirmacion,
          dias_gestacion_confirmacion: numberOrNull(pregnancyForm.dias_gestacion_confirmacion),
          observaciones: nullIfEmpty(pregnancyForm.observaciones),
        },
      });
    },
    onSuccess: () => { toast.show(pregnancyForm?.id_prenez ? 'Preñez actualizada.' : 'Preñez confirmada.'); setPregnancyForm(null); refreshReproduction(); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const createBirth = useMutation({
    mutationFn: async () => {
      if (!birthForm?.id_prenez || !birthForm.fecha_parto || !birthForm.crias.length) throw new Error('Selecciona la preñez, fecha y al menos una cría.');
      if (birthForm.crias.some((child) => !child.nombre.trim() || !child.id_especie || !child.id_origen)) throw new Error('Cada cría debe tener nombre, especie y origen.');
      const result = await apiRequest<Birth>('/partos', {
        method: 'POST',
        body: {
          id_prenez: birthForm.id_prenez,
          fecha_parto: birthForm.fecha_parto,
          fecha_parto_local: birthForm.fecha_parto,
          tipo_parto: birthForm.tipo_parto,
          observaciones: nullIfEmpty(birthForm.observaciones),
          crias: birthForm.crias.map((child) => ({
            animal: { codigo_arete: nullIfEmpty(child.codigo_arete), nombre: child.nombre.trim(), id_especie: child.id_especie, sexo: child.sexo, id_origen: child.id_origen, id_grupo_actual: child.id_grupo_actual || null, id_ubicacion_actual: child.id_ubicacion_actual || null, estado: child.estado, colores: child.id_color ? [{ id: child.id_color, principal: true }] : [], razas: child.id_raza ? [{ id: child.id_raza, porcentaje: 100 }] : [], propietarios: child.propietarios.map((owner) => ({ id: owner.id, porcentaje: numberOrNull(owner.porcentaje), principal: owner.principal })) },
            estado_nacimiento: child.estado_nacimiento,
            peso_nacimiento_kg: numberOrNull(child.peso_nacimiento_kg),
            observaciones: nullIfEmpty(child.observaciones),
          })),
        },
      });
      const failed: string[] = [];
      for (let index = 0; index < result.crias.length; index += 1) {
        const createdChild = result.crias[index];
        const draft = birthForm.crias[index];
        if (!createdChild || !draft) continue;
        const files = [...(draft.foto_perfil ? [{ file: draft.foto_perfil, profile: true }] : []), ...draft.fotos.map((file) => ({ file, profile: false }))];
        for (const item of files) {
          const data = new FormData(); data.set('imagen', item.file); data.set('es_perfil', String(item.profile));
          try { await apiRequest(`/partos/${result.id_parto}/crias/${createdChild.id_cria}/imagenes`, { method: 'POST', body: data }); }
          catch { failed.push(`${createdChild.cria}: ${item.file.name}`); }
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      toast.show(failed.length ? `El parto se guardó, pero fallaron ${failed.length} fotografía(s).` : 'Parto y crías registrados.', failed.length ? 'error' : 'success');
      setBirthForm(null); refreshReproduction();
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveAbortion = useMutation({
    mutationFn: () => {
      if (!abortionForm?.id_vaca) throw new Error('Selecciona la vaca.');
      const body = { id_prenez: abortionForm.id_prenez || null, id_vaca: abortionForm.id_vaca, fecha: abortionForm.fecha || null, causa: nullIfEmpty(abortionForm.causa), meses_gestacion: numberOrNull(abortionForm.meses_gestacion), descripcion: nullIfEmpty(abortionForm.descripcion) };
      return apiRequest(`/registros/abortos${abortionForm.id_aborto ? `/${abortionForm.id_aborto}` : ''}`, { method: abortionForm.id_aborto ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(abortionForm?.id_aborto ? 'Aborto actualizado.' : 'Aborto registrado.'); setAbortionForm(null); void client.invalidateQueries({ queryKey: ['records', 'abortos'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveBirthEdit = useMutation({
    mutationFn: () => {
      if (!birthEditForm) throw new Error('No hay un parto seleccionado.');
      return apiRequest(`/partos/${birthEditForm.id_parto}`, { method: 'PATCH', body: { fecha_parto: birthEditForm.fecha_parto, tipo_parto: birthEditForm.tipo_parto, observaciones: nullIfEmpty(birthEditForm.observaciones) } });
    },
    onSuccess: () => { toast.show('Parto actualizado.'); setBirthEditForm(null); setSelectedBirth(null); void client.invalidateQueries({ queryKey: ['births'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const remove = useMutation({
    mutationFn: () => deleting?.type === 'heat' ? apiRequest(`/reproduccion/celos/${deleting.id}`, { method: 'DELETE' }) : deleting?.type==='service'?apiRequest(`/reproduccion/servicios/${deleting.id}`,{method:'DELETE'}):deleting?.type === 'pregnancy' ? apiRequest(`/reproduccion/preneces/${deleting.id}`, { method: 'DELETE' }) : apiRequest(`/registros/abortos/${deleting?.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.show(deleting?.type === 'pregnancy' ? 'Preñez cancelada.' : 'Registro eliminado.'); setDeleting(null); refreshReproduction(); void client.invalidateQueries({ queryKey: ['records', 'abortos'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  function pageAction() {
    if (!hasPermission(tab === 'abortions' ? 'ABORTO_ADMINISTRAR' : 'PARTO_ADMINISTRAR')) return undefined;
    if (tab === 'heats') return <IconButton label="Registrar celo" onClick={() => setHeatForm(emptyHeat())}><Plus size={20} /></IconButton>;
    if(tab==='services'&&assistedOperationsEnabled)return <IconButton label="Registrar servicio reproductivo" onClick={()=>setServiceForm(emptyAssistedService(defaultAssistedType))}><Plus size={20}/></IconButton>;
    if (tab === 'pregnancies') return <IconButton label="Confirmar preñez" onClick={() => setPregnancyForm(emptyPregnancy())}><Plus size={20} /></IconButton>;
    if (tab === 'births') return <IconButton label="Registrar parto" onClick={() => setBirthForm(emptyBirth())}><Plus size={20} /></IconButton>;
    if (tab === 'abortions') return <IconButton label="Registrar aborto" onClick={() => setAbortionForm(emptyAbortion())}><Plus size={20} /></IconButton>;
    return undefined;
  }

  const pendingPregnancies = pregnancies.data?.filter((item) => item.estado === 'CONFIRMADA' && isInOwnershipScope(item.categoria_codigo, ownershipScope)) ?? [];
  const editBirth = (birth: Birth) => { setBirthEditForm({ id_parto: birth.id_parto, fecha_parto: dateInputValue(birth.fecha_parto), tipo_parto: birth.tipo_parto, observaciones: birth.observaciones ?? '' }); setSelectedBirth(null); };
  const changeScope=(scope:OwnershipScope)=>{setOwnershipScope(scope);setHeatForm(null);setServiceForm(null);setPregnancyForm(null);setBirthForm(null);setAbortionForm(null);};
  const cycleOrder=()=>controls.setOrder(controls.order==='NEWEST'?'OLDEST':controls.order==='OLDEST'?'AZ':controls.order==='AZ'?'ZA':'NEWEST');

  return <div className="module-no-header">
    <CompactToolbar search={controls.search} onSearch={controls.setSearch} placeholder="Buscar en reproducción…" count={controls.visible.length} actions={<><IconButton label="Cambiar orden" onClick={cycleOrder}><ArrowUpDown size={19}/></IconButton><OwnershipScopeFilter compact value={ownershipScope} onChange={changeScope}/></>} below={<div className="compact-scroll-tabs reproduction-tabs">
      {canBirths ? <><TabButton active={tab === 'heats'} onClick={() => setTab('heats')} icon={HeartPulse} label="Celos" />{showServices?<TabButton active={tab==='services'} onClick={()=>setTab('services')} icon={Syringe} label="Inseminación y embriones"/>:null}<TabButton active={tab === 'pregnancies'} onClick={() => setTab('pregnancies')} icon={HeartPulse} label="Preñeces" /><TabButton active={tab === 'upcoming'} onClick={() => setTab('upcoming')} icon={CalendarClock} label="Próximos partos" /><TabButton active={tab === 'births'} onClick={() => setTab('births')} icon={Baby} label="Partos" /></> : null}
      {canAbortions ? <TabButton active={tab === 'abortions'} onClick={() => setTab('abortions')} icon={HeartCrack} label="Abortos" /> : null}
    </div>}/>

    {tab === 'heats' ? <HeatsList query={heats} items={heatList.visible} photoFor={photoFor} canEdit={hasPermission('PARTO_ADMINISTRAR')} onOpen={(item)=>setSelectedRecord({title:`Celo de ${item.vaca}`,rows:[['Vaca',item.vaca],['Toro',item.toro||'No registrado'],['Inicio',formatDate(item.fecha_inicio)],['Fin',formatDate(item.fecha_fin)],['Estado',item.tiene_prenez?'Preñez relacionada':'Registrado'],['Observaciones',item.observaciones||'Sin observaciones']]})} onEdit={setHeatForm} onDelete={(id) => setDeleting({ type: 'heat', id })} /> : null}
    {tab==='services'&&showServices?<AssistedServicesList query={services} items={serviceList.visible} photoFor={photoFor} canEdit={hasPermission('PARTO_ADMINISTRAR')} onOpen={(item)=>setSelectedRecord({title:`${humanizeCode(item.tipo)} de ${item.vaca}`,rows:[['Receptora',item.vaca],['Fecha',formatDate(item.fecha)],['Padre',item.padre||'No registrado'],...(item.tipo==='TRANSFERENCIA_EMBRIONES'?[['Donante',item.donante||'No registrada'] as [string,string]]:[]),['Código del material',item.codigo_material||'No registrado'],['Calidad',item.calidad||'No registrada'],['Técnico',item.tecnico||'No registrado'],['Proveedor',item.proveedor||'No registrado'],['Observaciones',item.observaciones||'Sin observaciones']]})} onEdit={(item)=>setServiceForm({id_servicio_reproductivo:item.id_servicio_reproductivo,id_vaca:item.id_vaca,tipo:item.tipo,fecha:String(item.fecha).slice(0,10),id_celo:item.id_celo??'',id_padre:item.id_padre??'',padre_externo:item.padre_externo??'',id_donante:item.id_donante??'',donante_externa:item.donante_externa??'',codigo_material:item.codigo_material??'',calidad:item.calidad??'',tecnico:item.tecnico??'',proveedor:item.proveedor??'',observaciones:item.observaciones??''})} onDelete={(id)=>setDeleting({type:'service',id})}/>:null}
    {tab === 'pregnancies' ? <PregnanciesList query={pregnancies} items={pregnancyList.visible} photoFor={photoFor} heatFor={(id)=>heats.data?.find((item)=>item.id_celo===id)} canEdit={hasPermission('PARTO_ADMINISTRAR')} onOpen={(item)=>setSelectedRecord({title:`Preñez de ${item.vaca}`,rows:[['Vaca',item.vaca],['Padre',item.padre||'No registrado'],['Celo relacionado',formatDate(item.celo_inicio)],['Confirmación',formatDate(item.fecha_confirmacion)],['Método',humanizeCode(item.metodo_confirmacion)],['Parto tentativo',formatDate(item.fecha_parto_tentativa)],['Estado',humanizeCode(item.estado)],['Observaciones',item.observaciones||'Sin observaciones']]})} onEdit={(record) => setPregnancyForm({ id_prenez: record.id_prenez, id_celo: record.id_celo ?? '', id_vaca: record.id_vaca, id_padre: record.id_padre ?? '',padre_externo:record.padre_externo??'',id_servicio_reproductivo:record.id_servicio_reproductivo??'', metodo_embarazo: record.metodo_embarazo as PregnancyForm['metodo_embarazo'], metodo_confirmacion: record.metodo_confirmacion as PregnancyForm['metodo_confirmacion'], fecha_confirmacion: String(record.fecha_confirmacion).slice(0, 10), dias_gestacion_confirmacion: record.dias_gestacion_confirmacion?.toString() ?? '', observaciones: record.observaciones ?? '' })} onDelete={(id) => setDeleting({ type: 'pregnancy', id })} /> : null}
    {tab === 'upcoming' ? <UpcomingList query={upcoming} items={upcomingList.visible} photoFor={photoFor} onOpen={(item)=>setSelectedRecord({title:`Próximo parto de ${item.vaca}`,rows:[['Vaca',item.vaca],['Padre',item.padre||'No registrado'],['Fecha tentativa',formatDate(item.fecha_tentativa)],['Confirmación',formatDate(item.fecha_confirmacion)]]})} /> : null}
    {tab === 'births' ? <BirthsList query={births} items={birthList.visible} photoFor={photoFor} canEdit={hasPermission('PARTO_ADMINISTRAR')} onOpen={setSelectedBirth} onEdit={editBirth} /> : null}
    {tab === 'abortions' ? <AbortionsList query={abortions} items={abortionList.visible} photoFor={photoFor} canEdit={hasPermission('ABORTO_ADMINISTRAR')} onEdit={(record) => { setAbortionForm({ id_aborto: String(record.id_aborto), id_prenez: String(record.id_prenez??''), id_vaca: String(record.id_vaca), fecha: dateInputValue(String(record.fecha ?? '')), causa: String(record.causa ?? ''), meses_gestacion: String(record.meses_gestacion ?? ''), descripcion: String(record.descripcion ?? '') }); }} onDelete={(id) => setDeleting({ type: 'abortion', id })} /> : null}

    {selectedBirth ? <BirthDetail birth={selectedBirth} onClose={() => setSelectedBirth(null)} onEdit={hasPermission('PARTO_ADMINISTRAR') ? () => editBirth(selectedBirth) : undefined} canUpload={hasPermission('PARTO_ADMINISTRAR')} /> : null}
    {selectedRecord?<Modal title={selectedRecord.title} wide onClose={()=>setSelectedRecord(null)} footer={<Button variant="ghost" onClick={()=>setSelectedRecord(null)}>Cerrar</Button>}><div className="detail-grid">{selectedRecord.rows.map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div></Modal>:null}

    {heatForm ? <Modal title={heatForm.id_celo ? 'Editar celo' : 'Registrar celo'} onClose={() => setHeatForm(null)} footer={<><Button variant="ghost" onClick={() => setHeatForm(null)}>Cancelar</Button><Button loading={saveHeat.isPending} onClick={() => saveHeat.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Vaca" required><AnimalSelect value={heatForm.id_vaca} options={heatFemales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} onChange={(id)=>setHeatForm({...heatForm,id_vaca:id})}/></Field><Field label="Toro con el que anda"><AnimalSelect value={heatForm.id_toro} options={scopedMales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} emptyLabel="No registrado" onChange={(id)=>setHeatForm({...heatForm,id_toro:id})}/></Field><div className="form-grid"><Field label="Inicio" required><Input type="date" value={heatForm.fecha_inicio} onChange={(event) => setHeatForm({ ...heatForm, fecha_inicio: event.target.value })} /></Field><Field label="Fin"><Input type="date" min={heatForm.fecha_inicio} value={heatForm.fecha_fin} onChange={(event) => setHeatForm({ ...heatForm, fecha_fin: event.target.value })} /></Field></div><label className="checkbox-field"><input type="checkbox" checked={heatForm.es_falso} onChange={(event)=>setHeatForm({...heatForm,es_falso:event.target.checked})}/><span><strong>Celo falso o aparente</strong><small>No se usará para calcular la fecha tentativa de parto.</small></span></label><Field label="Observaciones"><Textarea value={heatForm.observaciones} onChange={(event) => setHeatForm({ ...heatForm, observaciones: event.target.value })} /></Field></div></Modal> : null}

    {serviceForm?<Modal title={serviceForm.id_servicio_reproductivo?'Editar servicio reproductivo':'Registrar servicio reproductivo'} wide onClose={()=>setServiceForm(null)} footer={<><Button variant="ghost" onClick={()=>setServiceForm(null)}>Cancelar</Button><Button loading={saveService.isPending} onClick={()=>saveService.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Procedimiento" required><Select value={serviceForm.tipo} onChange={(event)=>setServiceForm({...serviceForm,tipo:event.target.value as AssistedServiceForm['tipo'],id_donante:'',donante_externa:''})}>{allowInsemination||serviceForm.tipo==='INSEMINACION_ARTIFICIAL'?<option value="INSEMINACION_ARTIFICIAL">Inseminación artificial</option>:null}{allowEmbryoTransfer||serviceForm.tipo==='TRANSFERENCIA_EMBRIONES'?<option value="TRANSFERENCIA_EMBRIONES">Transferencia de embriones</option>:null}</Select></Field><div className="form-grid"><Field label="Receptora" required><AnimalSelect value={serviceForm.id_vaca} options={serviceFemales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} onChange={(id)=>setServiceForm({...serviceForm,id_vaca:id,id_celo:''})}/></Field><Field label="Fecha" required><Input type="date" value={serviceForm.fecha} onChange={(event)=>setServiceForm({...serviceForm,fecha:event.target.value})}/></Field></div><Field label="Celo relacionado"><Select value={serviceForm.id_celo} onChange={(event)=>{const heat=heats.data?.find((item)=>item.id_celo===event.target.value);setServiceForm({...serviceForm,id_celo:event.target.value,id_vaca:heat?.id_vaca??serviceForm.id_vaca});}}><option value="">Sin celo relacionado</option>{heats.data?.filter((item)=>!item.es_falso&&!options.data?.hembras.find((female)=>female.id_animal===item.id_vaca)?.prenez_confirmada&&(!serviceForm.id_vaca||item.id_vaca===serviceForm.id_vaca)).map((item)=><option key={item.id_celo} value={item.id_celo}>{item.vaca} · {formatDate(item.fecha_inicio)}</option>)}</Select></Field><div className="form-grid"><Field label="Padre registrado"><AnimalSelect value={serviceForm.id_padre} options={scopedMales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} emptyLabel="No está registrado" onChange={(id)=>setServiceForm({...serviceForm,id_padre:id,padre_externo:id?'':serviceForm.padre_externo})}/></Field><Field label="Padre externo" hint="Nombre, registro, raza o identificación de la pajilla."><Input disabled={Boolean(serviceForm.id_padre)} value={serviceForm.padre_externo} onChange={(event)=>setServiceForm({...serviceForm,padre_externo:event.target.value})}/></Field>{serviceForm.tipo==='TRANSFERENCIA_EMBRIONES'?<><Field label="Donante registrada"><AnimalSelect value={serviceForm.id_donante} options={scopedFemales.filter((item)=>item.id_animal!==serviceForm.id_vaca).map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} emptyLabel="No está registrada" onChange={(id)=>setServiceForm({...serviceForm,id_donante:id,donante_externa:id?'':serviceForm.donante_externa})}/></Field><Field label="Donante externa"><Input disabled={Boolean(serviceForm.id_donante)} value={serviceForm.donante_externa} onChange={(event)=>setServiceForm({...serviceForm,donante_externa:event.target.value})}/></Field></>:null}<Field label={serviceForm.tipo==='INSEMINACION_ARTIFICIAL'?'Código de pajilla o lote':'Código del embrión o lote'}><Input value={serviceForm.codigo_material} onChange={(event)=>setServiceForm({...serviceForm,codigo_material:event.target.value})}/></Field><Field label="Calidad o clasificación"><Input value={serviceForm.calidad} onChange={(event)=>setServiceForm({...serviceForm,calidad:event.target.value})}/></Field><Field label="Técnico responsable"><Input value={serviceForm.tecnico} onChange={(event)=>setServiceForm({...serviceForm,tecnico:event.target.value})}/></Field><Field label="Proveedor o centro genético"><Input value={serviceForm.proveedor} onChange={(event)=>setServiceForm({...serviceForm,proveedor:event.target.value})}/></Field></div><Field label="Observaciones"><Textarea value={serviceForm.observaciones} onChange={(event)=>setServiceForm({...serviceForm,observaciones:event.target.value})}/></Field></div></Modal>:null}

    {pregnancyForm ? <Modal title={pregnancyForm.id_prenez ? 'Editar preñez' : 'Confirmar preñez'} wide onClose={() => setPregnancyForm(null)} footer={<><Button variant="ghost" onClick={() => setPregnancyForm(null)}>Cancelar</Button><Button loading={savePregnancy.isPending} onClick={() => savePregnancy.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Servicio de inseminación o embrión"><Select value={pregnancyForm.id_servicio_reproductivo} onChange={(event)=>{const service=services.data?.find((item)=>item.id_servicio_reproductivo===event.target.value);setPregnancyForm({...pregnancyForm,id_servicio_reproductivo:event.target.value,id_celo:service?.id_celo??'',id_vaca:service?.id_vaca??pregnancyForm.id_vaca,id_padre:service?.id_padre??'',padre_externo:service?.padre_externo??'',metodo_embarazo:service?.tipo??pregnancyForm.metodo_embarazo});}}><option value="">Sin servicio asistido relacionado</option>{services.data?.filter((item)=>(!item.tiene_prenez||item.id_servicio_reproductivo===pregnancyForm.id_servicio_reproductivo)&&isInOwnershipScope(item.categoria_codigo,ownershipScope)).map((item)=><option key={item.id_servicio_reproductivo} value={item.id_servicio_reproductivo}>{item.vaca} · {humanizeCode(item.tipo)} · {formatDate(item.fecha)}</option>)}</Select></Field><Field label="Confirmar desde un celo"><Select disabled={Boolean(pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.id_celo} onChange={(event) => { const heat = heats.data?.find((item) => item.id_celo === event.target.value); setPregnancyForm({ ...pregnancyForm, id_celo: event.target.value, id_vaca: heat?.id_vaca ?? pregnancyForm.id_vaca, id_padre: heat?.id_toro ?? pregnancyForm.id_padre }); }}><option value="">Registrar sin celo relacionado</option>{heats.data?.filter((item) => !item.es_falso && isInOwnershipScope(item.categoria_codigo, ownershipScope) && (!item.tiene_prenez || item.id_celo === pregnancyForm.id_celo)).map((item) => <option key={item.id_celo} value={item.id_celo}>{item.vaca} · celo del {formatDate(item.fecha_inicio)}</option>)}</Select></Field><div className="form-grid"><Field label="Vaca" required><AnimalSelect disabled={Boolean(pregnancyForm.id_celo||pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.id_vaca} options={scopedFemales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} onChange={(id)=>setPregnancyForm({...pregnancyForm,id_vaca:id})}/></Field><Field label="Padre registrado"><AnimalSelect disabled={Boolean(pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.id_padre} options={scopedMales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} emptyLabel="No registrado" onChange={(id)=>setPregnancyForm({...pregnancyForm,id_padre:id,padre_externo:id?'':pregnancyForm.padre_externo})}/></Field><Field label="Padre externo"><Input disabled={Boolean(pregnancyForm.id_padre||pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.padre_externo} onChange={(event)=>setPregnancyForm({...pregnancyForm,padre_externo:event.target.value})}/></Field><Field label="Método de embarazo"><Select disabled={Boolean(pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.metodo_embarazo} onChange={(event) => setPregnancyForm({ ...pregnancyForm, metodo_embarazo: event.target.value as PregnancyForm['metodo_embarazo'] })}>{['MONTA_NATURAL','INSEMINACION_ARTIFICIAL','TRANSFERENCIA_EMBRIONES','DESCONOCIDO'].map((item) => <option value={item} key={item}>{humanizeCode(item)}</option>)}</Select></Field><Field label="Método de confirmación"><Select value={pregnancyForm.metodo_confirmacion} onChange={(event) => setPregnancyForm({ ...pregnancyForm, metodo_confirmacion: event.target.value as PregnancyForm['metodo_confirmacion'] })}>{['PALPACION','ECOGRAFIA','ANALISIS_SANGRE','OBSERVACION','OTRO'].map((item) => <option value={item} key={item}>{humanizeCode(item)}</option>)}</Select></Field><Field label="Fecha de confirmación" required><Input type="date" value={pregnancyForm.fecha_confirmacion} onChange={(event) => setPregnancyForm({ ...pregnancyForm, fecha_confirmacion: event.target.value })} /></Field><Field label="Días de gestación al confirmar" hint={pregnancyForm.id_celo||pregnancyForm.id_servicio_reproductivo ? 'Se calculará desde el evento reproductivo.' : 'Opcional; permite calcular la fecha tentativa.'}><Input type="number" min="0" max="400" disabled={Boolean(pregnancyForm.id_celo||pregnancyForm.id_servicio_reproductivo)} value={pregnancyForm.dias_gestacion_confirmacion} onChange={(event) => setPregnancyForm({ ...pregnancyForm, dias_gestacion_confirmacion: event.target.value })} /></Field></div><Field label="Observaciones"><Textarea value={pregnancyForm.observaciones} onChange={(event) => setPregnancyForm({ ...pregnancyForm, observaciones: event.target.value })} /></Field></div></Modal> : null}

    {birthForm ? <BirthModal form={birthForm} setForm={setBirthForm} pregnancies={pendingPregnancies} species={species.data ?? []} origins={origins.data ?? []} colors={colors.data ?? []} breeds={breeds.data ?? []} owners={owners.data ?? []} groups={groups.data ?? []} locations={locations.data ?? []} saving={createBirth.isPending} onSave={() => createBirth.mutate()} onClose={() => setBirthForm(null)} /> : null}

    {birthEditForm ? <Modal title="Editar parto" wide onClose={() => setBirthEditForm(null)} footer={<><Button variant="ghost" onClick={() => setBirthEditForm(null)}>Cancelar</Button><Button loading={saveBirthEdit.isPending} onClick={() => saveBirthEdit.mutate()}>Guardar cambios</Button></>}><div className="form-stack"><div className="form-grid"><Field label="Fecha" required><Input type="date" value={birthEditForm.fecha_parto} onChange={(event) => setBirthEditForm({ ...birthEditForm, fecha_parto: event.target.value })} /></Field><Field label="Tipo de parto"><Select value={birthEditForm.tipo_parto} onChange={(event) => setBirthEditForm({ ...birthEditForm, tipo_parto: event.target.value })}>{['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO'].map((item) => <option key={item} value={item}>{humanizeCode(item)}</option>)}</Select></Field></div><Field label="Observaciones"><Textarea value={birthEditForm.observaciones} onChange={(event) => setBirthEditForm({ ...birthEditForm, observaciones: event.target.value })} /></Field><div className="form-alert"><strong>Historial protegido.</strong> La madre, el padre y las crías no se cambian desde esta edición porque ya forman parte del historial animal.</div></div></Modal> : null}

    {abortionForm ? <Modal title={abortionForm.id_aborto ? 'Editar aborto' : 'Registrar aborto'} onClose={() => setAbortionForm(null)} footer={<><Button variant="ghost" onClick={() => setAbortionForm(null)}>Cancelar</Button><Button loading={saveAbortion.isPending} onClick={() => saveAbortion.mutate()}>Guardar</Button></>}><div className="form-stack"><Field label="Preñez confirmada" hint="Opcional. También puedes registrar el aborto sin una preñez previa."><Select value={abortionForm.id_prenez} disabled={Boolean(abortionForm.id_aborto&&abortionForm.id_prenez)} onChange={(event) => { const pregnancy=pendingPregnancies.find((item)=>item.id_prenez===event.target.value);setAbortionForm({ ...abortionForm, id_prenez:event.target.value,id_vaca:pregnancy?.id_vaca??abortionForm.id_vaca }); }}><option value="">Sin preñez relacionada</option>{abortionForm.id_prenez&&!pendingPregnancies.some((item)=>item.id_prenez===abortionForm.id_prenez)?<option value={abortionForm.id_prenez}>Preñez relacionada (histórica)</option>:null}{pendingPregnancies.map((item)=><option key={item.id_prenez} value={item.id_prenez}>{item.vaca} · confirmada {formatDate(item.fecha_confirmacion)}</option>)}</Select></Field><Field label="Vaca" required><AnimalSelect disabled={Boolean(abortionForm.id_prenez)} value={abortionForm.id_vaca} options={scopedFemales.map((item)=>animalPickerOption(item,photoFor(item.id_animal)))} onChange={(id)=>setAbortionForm({...abortionForm,id_vaca:id})}/></Field><Field label="Fecha"><Input type="date" value={abortionForm.fecha} onChange={(event) => setAbortionForm({ ...abortionForm, fecha: event.target.value })} /></Field><Field label="Causa"><Input value={abortionForm.causa} onChange={(event) => setAbortionForm({ ...abortionForm, causa: event.target.value })} /></Field><Field label="Meses de gestación"><Input type="number" min="0" max="12" step="0.1" value={abortionForm.meses_gestacion} onChange={(event) => setAbortionForm({ ...abortionForm, meses_gestacion: event.target.value })} /></Field><Field label="Descripción"><Textarea value={abortionForm.descripcion} onChange={(event) => setAbortionForm({ ...abortionForm, descripcion: event.target.value })} /></Field></div></Modal> : null}
    {deleting ? <ConfirmDialog title={deleting.type === 'pregnancy' ? 'Cancelar preñez' : 'Eliminar registro'} message={deleting.type === 'pregnancy' ? 'La preñez dejará de aparecer en próximos partos.' : '¿Deseas eliminar este registro?'} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} /> : null}
    {pageAction()?<FloatingActionDock>{pageAction()}</FloatingActionDock>:null}
  </div>;
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Baby; label: string }) { return <button className={active ? 'active' : ''} onClick={onClick}><Icon size={17} />{label}</button>; }

function AssistedServicesList({query,items,photoFor,canEdit,onOpen,onEdit,onDelete}:{query:ReturnType<typeof useQuery<AssistedReproductionRecord[]>>;items:AssistedReproductionRecord[];photoFor:(id:unknown)=>string|null;canEdit:boolean;onOpen:(item:AssistedReproductionRecord)=>void;onEdit:(item:AssistedReproductionRecord)=>void;onDelete:(id:string)=>void}){
  if(query.isLoading)return <LoadingState/>;if(query.isError)return <ErrorState message={(query.error as Error).message} onRetry={()=>void query.refetch()}/>;
  if(!items.length)return <EmptyState icon={Syringe} title="Sin servicios reproductivos" description="Registra una inseminación artificial o una transferencia de embriones."/>;
  return <div className="reproduction-list">{items.map((item)=><Card className="reproduction-row reproduction-row-clickable" key={item.id_servicio_reproductivo} onClick={()=>onOpen(item)}><AnimalIdentity option={{id:item.id_vaca,name:item.vaca,photoUrl:photoFor(item.id_vaca),subtitle:item.padre?`Padre: ${item.padre}`:'Padre no registrado'}}/><div><small>{formatDate(item.fecha)}</small><strong>{humanizeCode(item.tipo)}</strong>{item.tipo==='TRANSFERENCIA_EMBRIONES'?<small>Donante: {item.donante||'no registrada'}</small>:null}</div><Badge tone={item.tiene_prenez?'success':'info'}>{item.tiene_prenez?'Preñez relacionada':'Registrado'}</Badge>{canEdit&&!item.tiene_prenez?<div className="inline-actions" onClick={(event)=>event.stopPropagation()}><IconButton label="Editar servicio" onClick={()=>onEdit(item)}><Edit3 size={16}/></IconButton><IconButton label="Eliminar servicio" onClick={()=>onDelete(item.id_servicio_reproductivo)}><Trash2 size={16}/></IconButton></div>:<span/>}</Card>)}</div>;
}

function HeatsList({ query, items, photoFor, canEdit, onOpen, onEdit, onDelete }: { query: ReturnType<typeof useQuery<HeatRecord[]>>; items: HeatRecord[]; photoFor:(id:unknown)=>string|null; canEdit: boolean; onOpen:(item:HeatRecord)=>void; onEdit: (value: HeatForm) => void; onDelete: (id: string) => void }) {
  if (query.isLoading) return <LoadingState />; if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  if (!items.length) return <EmptyState icon={HeartPulse} title="Sin coincidencias" description="Registra un celo o modifica la búsqueda." />;
  return <div className="reproduction-list">{items.map((item)=><Card className="reproduction-row heat-row reproduction-row-clickable" key={item.id_celo} onClick={()=>onOpen(item)}><AnimalIdentity option={{id:item.id_vaca,name:item.vaca,photoUrl:photoFor(item.id_vaca),subtitle:item.codigo_arete?`Arete ${item.codigo_arete}`:null}}/><div><small>Período del celo</small><strong>{formatDate(item.fecha_inicio)}{item.fecha_fin?` → ${formatDate(item.fecha_fin)}`:' · sin fecha de fin'}</strong><small>Toro: {item.toro||'no registrado'}</small></div><Badge tone={item.es_falso?'warning':item.tiene_prenez?'success':'info'}>{item.es_falso?'Celo falso':item.tiene_prenez?'Preñez relacionada':'Registrado'}</Badge>{canEdit&&!item.tiene_prenez?<div className="inline-actions" onClick={(event)=>event.stopPropagation()}><IconButton label="Editar celo" onClick={()=>onEdit({id_celo:item.id_celo,id_vaca:item.id_vaca,id_toro:item.id_toro??'',fecha_inicio:String(item.fecha_inicio).slice(0,10),fecha_fin:item.fecha_fin?String(item.fecha_fin).slice(0,10):'',es_falso:Boolean(item.es_falso),observaciones:item.observaciones??''})}><Edit3 size={16}/></IconButton><IconButton label="Eliminar celo" onClick={()=>onDelete(item.id_celo)}><Trash2 size={16}/></IconButton></div>:<span/>}</Card>)}</div>;
}

function PregnanciesList({ query, items, photoFor, heatFor, canEdit, onOpen, onEdit, onDelete }: { query: ReturnType<typeof useQuery<PregnancyRecord[]>>; items: PregnancyRecord[]; photoFor:(id:unknown)=>string|null; heatFor:(id:string|null)=>HeatRecord|undefined; canEdit: boolean; onOpen:(item:PregnancyRecord)=>void; onEdit: (value: PregnancyRecord) => void; onDelete: (id: string) => void }) {
  if (query.isLoading) return <LoadingState />; if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  if (!items.length) return <EmptyState icon={HeartPulse} title="Sin coincidencias" description="Confirma una preñez o modifica la búsqueda." />;
  return <div className="reproduction-list">{items.map((item) => {const heat=heatFor(item.id_celo);const heatStart=heat?.fecha_inicio??item.celo_inicio;const heatEnd=heat?.fecha_fin??heatStart;const min=heatStart?addDays(heatStart,278):null;const max=heatEnd?addDays(heatEnd,288):null;return <Card className="reproduction-row pregnancy-row reproduction-row-clickable" key={item.id_prenez} onClick={()=>onOpen(item)}><AnimalIdentity option={{id:item.id_vaca,name:item.vaca,photoUrl:photoFor(item.id_vaca),subtitle:item.padre?`Padre: ${item.padre}`:'Padre no registrado'}}/><div><small>{heatStart?`Celo relacionado · ${formatDate(heatStart)}`:`Confirmada · ${formatDate(item.fecha_confirmacion)}`}</small><strong>{min&&max?`Parto estimado entre ${formatDate(min)} y ${formatDate(max)}`:`Parto tentativo ${formatDate(item.fecha_parto_tentativa)}`}</strong></div><Badge tone={item.estado === 'CONFIRMADA' ? 'success' : item.estado === 'CANCELADA' ? 'danger' : 'neutral'}>{humanizeCode(item.estado)}</Badge>{canEdit && item.estado === 'CONFIRMADA' ? <div className="inline-actions" onClick={(event)=>event.stopPropagation()}><IconButton label="Editar preñez" onClick={() => onEdit(item)}><Edit3 size={16} /></IconButton><IconButton label="Cancelar preñez" onClick={() => onDelete(item.id_prenez)}><Trash2 size={16} /></IconButton></div> : <span/>}</Card>;})}</div>;
}

function UpcomingList({ query, items, photoFor, onOpen }: { query: ReturnType<typeof useQuery<UpcomingBirth[]>>; items: UpcomingBirth[]; photoFor:(id:unknown)=>string|null; onOpen:(item:UpcomingBirth)=>void }) {
  if (query.isLoading) return <LoadingState />; if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  if (!items.length) return <EmptyState icon={CalendarClock} title="Sin coincidencias" description="Aquí aparecerán las vacas con preñez confirmada." />;
  return <div className="reproduction-list">{items.map((item) => <Card className="reproduction-row upcoming-row reproduction-row-clickable" key={item.id_proximo_parto} onClick={()=>onOpen(item)}><AnimalIdentity option={{id:item.id_vaca,name:item.vaca,photoUrl:photoFor(item.id_vaca),subtitle:item.padre?`Padre: ${item.padre}`:'Padre no registrado'}}/><div className="upcoming-date-inline"><small>Fecha tentativa</small><strong>{formatDate(item.fecha_tentativa)}</strong></div><div><small>Confirmación</small><strong>{formatDate(item.fecha_confirmacion)}</strong></div><Badge tone={item.fecha_tentativa ? 'info' : 'warning'}>{item.fecha_tentativa ? 'Fecha calculada' : 'Sin fecha estimada'}</Badge></Card>)}</div>;
}

function BirthsList({ query, items, photoFor, canEdit, onOpen, onEdit }: { query: ReturnType<typeof useQuery<Birth[]>>; items: Birth[]; photoFor:(id:unknown)=>string|null; canEdit: boolean; onOpen: (birth: Birth) => void; onEdit: (birth: Birth) => void }) {
  if (query.isLoading) return <LoadingState />; if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  if (!items.length) return <EmptyState icon={Baby} title="Sin coincidencias" description="Registra un parto o modifica la búsqueda." />;
  return <Card className="record-list births-record-list"><div className="record-list-head"><span>Madre</span><span>Fecha</span><span>Padre</span><span>Crías</span><span>Tipo</span><span /></div>{items.map((birth) => <button type="button" className="record-list-row" key={birth.id_parto} onClick={() => onOpen(birth)}><AnimalIdentity option={{id:birth.id_madre,name:birth.madre,photoUrl:birth.madre_foto_perfil??photoFor(birth.id_madre),subtitle:birth.madre_arete?`Arete ${birth.madre_arete}`:null}}/><span><strong>{formatDate(birth.fecha_parto)}</strong></span><span><strong>{birth.padre || 'No registrado'}</strong><small>{birth.padre_arete ? `Arete ${birth.padre_arete}` : ''}</small></span><span className="birth-child-preview">{birth.crias[0]?.foto_perfil ? <img src={birth.crias[0].foto_perfil} alt="" /> : <span className="birth-child-placeholder"><Baby size={16} /></span>}<span><strong>{birth.crias.length} {birth.crias.length === 1 ? 'cría' : 'crías'}</strong><small>{birth.crias.slice(0,2).map((child) => child.cria).join(', ')}</small></span></span><span><Badge tone="success">{humanizeCode(birth.tipo_parto)}</Badge></span><span className="record-row-actions">{canEdit ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); onEdit(birth); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card>;
}

function AbortionsList({ query, items, photoFor, canEdit, onEdit, onDelete }: { query: ReturnType<typeof useQuery<GenericRecord[]>>; items: GenericRecord[]; photoFor:(id:unknown)=>string|null; canEdit: boolean; onEdit: (record: GenericRecord) => void; onDelete: (id: string) => void }) {
  if (query.isLoading) return <LoadingState />; if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  if (!items.length) return <EmptyState icon={HeartCrack} title="Sin coincidencias" description="No existen eventos con ese criterio." />;
  return <div className="reproduction-list">{items.map((item)=><Card className="reproduction-row abortion-row" key={String(item.id_aborto)}><AnimalIdentity option={{id:String(item.id_vaca??''),name:String(item.animal??'—'),photoUrl:photoFor(item.id_vaca),subtitle:item.id_prenez?'Preñez confirmada':'Sin preñez previa'}}/><div><small>{formatDate(item.fecha?String(item.fecha):null)}</small><strong>{String(item.causa??'Causa no registrada')}</strong><small>{item.meses_gestacion==null?'Gestación no registrada':`${formatNumber(item.meses_gestacion as number|string,1)} meses de gestación`}</small></div><Badge tone={item.id_prenez?'info':'neutral'}>{item.id_prenez?'Con preñez':'Sin preñez'}</Badge>{canEdit?<div className="inline-actions"><IconButton label="Editar aborto" onClick={()=>onEdit(item)}><Edit3 size={16}/></IconButton><IconButton label="Eliminar aborto" onClick={()=>onDelete(String(item.id_aborto))}><Trash2 size={16}/></IconButton></div>:<span/>}</Card>)}</div>;
}

function BirthDetail({ birth, onClose, onEdit, canUpload }: { birth: Birth; onClose: () => void; onEdit?: () => void; canUpload: boolean }) {
  const navigate=useNavigate();const toast=useToast();const client=useQueryClient();
  const inputRef=useRef<HTMLInputElement|null>(null);const [photos,setPhotos]=useState(birth.imagenes??[]);const [viewer,setViewer]=useState<number|null>(null);
  useEffect(()=>setPhotos(birth.imagenes??[]),[birth]);
  const upload=useMutation({
    mutationFn:async(files:File[])=>{const data=new FormData();files.forEach((file)=>data.append('imagenes',file));return apiRequest<Array<Birth['imagenes'][number]>>(`/partos/${birth.id_parto}/imagenes`,{method:'POST',body:data});},
    onSuccess:(created)=>{setPhotos((current)=>[...current,...created]);toast.show('Fotografías del parto guardadas.');void client.invalidateQueries({queryKey:['births']});},
    onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error'),
  });
  return <Modal title="Detalle del parto" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onEdit ? <Button onClick={onEdit}><Edit3 size={17} />Editar parto</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><Baby size={22} /></div><div><h2>{birth.madre}</h2><p>{birth.madre_arete ? `Arete ${birth.madre_arete}` : 'Madre sin arete'}</p></div><Badge tone="success">{humanizeCode(birth.tipo_parto)}</Badge></div><div className="detail-grid"><div><small>Fecha del parto</small><strong>{formatDate(birth.fecha_parto)}</strong></div><div><small>Padre</small><strong>{birth.padre || 'No registrado'}</strong></div><div><small>Crías registradas</small><strong>{birth.crias.length}</strong></div><div><small>Tipo de parto</small><strong>{humanizeCode(birth.tipo_parto)}</strong></div></div><section><h3>Crías</h3><div className="birth-detail-children">{birth.crias.map((child) => <button type="button" className="birth-child-link" key={child.id_parto_cria} onClick={()=>navigate(`/animales/${child.id_cria}`)}>{child.foto_perfil ? <img src={child.foto_perfil} alt={child.cria} /> : <span className="birth-detail-placeholder"><Baby size={24} /></span>}<span><strong>{child.cria}</strong><small>{child.codigo_arete ? `Arete ${child.codigo_arete}` : 'Sin arete'}</small><small>{child.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'} · {humanizeCode(child.estado_nacimiento)}{child.peso_nacimiento_kg ? ` · ${formatNumber(child.peso_nacimiento_kg)} kg` : ''}</small><small>Ver perfil del animal</small></span></button>)}</div></section><section><div className="section-heading-inline"><div><h3>Fotografías del parto</h3><p className="muted">Imágenes relacionadas con este nacimiento.</p></div>{canUpload?<><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event)=>{const files=Array.from(event.target.files??[]).slice(0,10);if(files.length)upload.mutate(files);event.currentTarget.value='';}}/><Button variant="secondary" loading={upload.isPending} onClick={()=>inputRef.current?.click()}><ImagePlus size={17}/>Agregar fotos</Button></>:null}</div>{photos.length?<div className="record-photo-grid">{photos.map((photo,index)=><button type="button" className="record-photo-view" key={photo.id_imagen} onClick={()=>setViewer(index)}><img src={photo.secure_url} alt={photo.descripcion||`Parto de ${birth.madre}`}/></button>)}</div>:<p className="muted">No hay fotografías relacionadas con este parto.</p>}</section>{birth.observaciones ? <section><h3>Observaciones</h3><p>{birth.observaciones}</p></section> : null}</div>{viewer!==null?<ImageLightbox items={photos.map((photo)=>({key:photo.id_imagen,url:photo.secure_url,title:`Parto de ${birth.madre}`,subtitle:photo.descripcion,date:photo.fecha_toma,filename:photo.nombre_original}))} initialIndex={viewer} onClose={()=>setViewer(null)}/>:null}</Modal>;
}

function BirthModal({ form, setForm, pregnancies, species, origins, colors, breeds, owners, groups, locations, saving, onSave, onClose }: { form: BirthForm; setForm: (form: BirthForm) => void; pregnancies: PregnancyRecord[]; species: CatalogItem[]; origins: CatalogItem[]; colors: CatalogItem[]; breeds: CatalogItem[]; owners: OwnerOption[]; groups: Group[]; locations: Location[]; saving: boolean; onSave: () => void; onClose: () => void }) {
  const selected = pregnancies.find((item) => item.id_prenez === form.id_prenez);
  const updateChild = (index: number, change: Partial<ChildForm>) => setForm({ ...form, crias: form.crias.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item) });
  return <Modal title="Registrar parto" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={onSave}>Guardar</Button></>}><div className="form-stack"><div className="form-section"><h3>Preñez y parto</h3><Field label="Preñez confirmada" required><Select value={form.id_prenez} onChange={(event) => { const pregnancy = pregnancies.find((item) => item.id_prenez === event.target.value); setForm({ ...form, id_prenez: event.target.value, crias: form.crias.map((child) => ({ ...child, id_especie: child.id_especie || pregnancy?.id_especie || '' })) }); }}><option value="">Selecciona</option>{pregnancies.map((item) => <option key={item.id_prenez} value={item.id_prenez}>{item.vaca} · confirmada {formatDate(item.fecha_confirmacion)}{item.fecha_parto_tentativa ? ` · parto ${formatDate(item.fecha_parto_tentativa)}` : ''}</option>)}</Select></Field>{selected ? <p className="form-alert">Madre: <strong>{selected.vaca}</strong> · Padre: <strong>{selected.padre || 'No registrado'}</strong></p> : null}<div className="form-grid"><Field label="Fecha" required><Input type="date" value={form.fecha_parto} onChange={(event) => setForm({ ...form, fecha_parto: event.target.value })} /></Field><Field label="Tipo"><Select value={form.tipo_parto} onChange={(event) => setForm({ ...form, tipo_parto: event.target.value })}>{['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO'].map((item) => <option key={item} value={item}>{humanizeCode(item)}</option>)}</Select></Field></div><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field></div><div className="form-section"><div className="section-heading-inline"><h3>Crías</h3><IconButton label="Agregar cría" onClick={() => setForm({ ...form, crias: [...form.crias, emptyChild()] })}><Plus size={18} /></IconButton></div><div className="nested-list">{form.crias.map((child, index) => <div className="nested-card" key={`child-${index}`}><div className="nested-card-header"><strong>Cría {index + 1}</strong>{form.crias.length > 1 ? <IconButton label="Quitar cría" onClick={() => setForm({ ...form, crias: form.crias.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></IconButton> : null}</div><div className="form-grid"><Field label="Nombre" required><Input value={child.nombre} onChange={(event) => updateChild(index, { nombre: event.target.value })} /></Field><Field label="Arete"><Input value={child.codigo_arete} onChange={(event) => updateChild(index, { codigo_arete: event.target.value })} /></Field><Field label="Especie" required><Select value={child.id_especie} onChange={(event) => updateChild(index, { id_especie: event.target.value, id_raza: '' })}><option value="">Selecciona</option>{species.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Sexo"><Select value={child.sexo} onChange={(event) => updateChild(index, { sexo: event.target.value as ChildForm['sexo'] })}><option value="HEMBRA">Hembra</option><option value="MACHO">Macho</option></Select></Field><Field label="Origen" required><Select value={child.id_origen} onChange={(event) => updateChild(index, { id_origen: event.target.value })}><option value="">Selecciona</option>{origins.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Color"><Select value={child.id_color} onChange={(event) => updateChild(index, { id_color: event.target.value })}><option value="">Sin registrar</option>{colors.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Raza"><Select value={child.id_raza} onChange={(event) => updateChild(index, { id_raza: event.target.value })}><option value="">Sin registrar</option>{breeds.filter((item) => !item.id_especie || item.id_especie === child.id_especie).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field><Field label="Grupo"><Select value={child.id_grupo_actual} onChange={(event) => { const group = groups.find((item) => item.id_grupo === event.target.value); updateChild(index, { id_grupo_actual: event.target.value, id_ubicacion_actual: group?.id_ubicacion_actual ?? child.id_ubicacion_actual }); }}><option value="">Sin grupo</option>{groups.filter((item) => !selected || item.id_categoria_animal === selected.id_categoria_animal).map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre} · {item.ubicacion || 'Sin ubicación'}</option>)}</Select></Field><Field label="Corral o potrero"><Select value={child.id_ubicacion_actual} onChange={(event) => updateChild(index, { id_ubicacion_actual: event.target.value, id_grupo_actual: '' })}><option value="">Sin ubicación</option>{locations.filter((item) => !selected || item.id_categoria_animal === selected.id_categoria_animal).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre}</option>)}</Select></Field><Field label="Estado al nacer"><Select value={child.estado_nacimiento} onChange={(event) => updateChild(index, { estado_nacimiento: event.target.value as ChildForm['estado_nacimiento'], estado: event.target.value === 'MUERTA' ? 'MUERTO' : 'ACTIVO' })}>{['VIVA','MUERTA','DEBIL','DESCONOCIDO'].map((item) => <option key={item} value={item}>{humanizeCode(item)}</option>)}</Select></Field><Field label="Peso (kg)"><Input type="number" min="0.01" step="0.001" value={child.peso_nacimiento_kg} onChange={(event) => updateChild(index, { peso_nacimiento_kg: event.target.value })} /></Field></div><div className="form-subsection"><h4>Propietarios</h4><p className="muted">Puedes seleccionar varios; uno de ellos puede ser el principal.</p><div className="choice-grid">{owners.map((owner) => { const ownerValue = child.propietarios.find((item) => item.id === owner.id_usuario); return <div className={`choice-card ${ownerValue ? 'selected' : ''}`} key={owner.id_usuario}><label><input type="checkbox" checked={Boolean(ownerValue)} onChange={() => { const next = ownerValue ? child.propietarios.filter((item) => item.id !== owner.id_usuario) : [...child.propietarios, { id: owner.id_usuario, porcentaje: '', principal: child.propietarios.length === 0 }]; updateChild(index, { propietarios: next }); }} /><span>{owner.nombre}<small>{owner.correo}</small></span></label>{ownerValue ? <><label className="radio-small"><input type="radio" name={`principal-owner-child-${index}`} checked={ownerValue.principal} onChange={() => updateChild(index, { propietarios: child.propietarios.map((item) => ({ ...item, principal: item.id === owner.id_usuario })) })} />Principal</label><Input type="number" min="0" max="100" step="0.01" placeholder="% de propiedad" value={ownerValue.porcentaje} onChange={(event) => updateChild(index, { propietarios: child.propietarios.map((item) => item.id === owner.id_usuario ? { ...item, porcentaje: event.target.value } : item) })} /></> : null}</div>; })}</div></div><Field label="Observaciones"><Input value={child.observaciones} onChange={(event) => updateChild(index, { observaciones: event.target.value })} /></Field><div className="birth-photo-fields"><Field label="Foto de perfil"><SinglePhotoPicker file={child.foto_perfil} onChange={(file) => updateChild(index, { foto_perfil: file })} /></Field><Field label="Otras fotografías" hint="Estas fotografías recibirán automáticamente la etiqueta Parto."><MultiplePhotoPicker files={child.fotos} onChange={(files) => updateChild(index, { fotos: files })} /></Field></div></div>)}</div></div></div></Modal>;
}

function useObjectUrl(file: File | null) { const [url, setUrl] = useState<string | null>(null); useEffect(() => { if (!file) { setUrl(null); return undefined; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]); return url; }
function SinglePhotoPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) { const url = useObjectUrl(file); const ref = useRef<HTMLInputElement | null>(null); return <div className="birth-profile-photo-picker"><input ref={ref} type="file" accept="image/*" hidden onChange={(event) => onChange(event.target.files?.[0] ?? null)} /><button type="button" className={url ? 'birth-profile-preview has-photo' : 'birth-profile-preview'} onClick={() => ref.current?.click()}>{url ? <img src={url} alt="Vista previa" /> : <span><Camera size={26} /><strong>Seleccionar foto</strong></span>}</button>{file ? <IconButton label="Quitar foto" onClick={() => onChange(null)}><X size={15} /></IconButton> : null}</div>; }
function MultiplePhotoPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) { const ref = useRef<HTMLInputElement | null>(null); return <div className="birth-extra-photo-picker"><input ref={ref} type="file" accept="image/*" multiple hidden onChange={(event) => { const selected = Array.from(event.target.files ?? []); onChange([...files, ...selected].slice(0, 10)); event.currentTarget.value = ''; }} /><button type="button" className="birth-extra-photo-button" onClick={() => ref.current?.click()}><ImagePlus size={22} /><span><strong>Agregar fotografías</strong><small>{files.length} seleccionada(s)</small></span></button>{files.length ? <div className="file-chip-list">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>)}</div> : null}</div>; }

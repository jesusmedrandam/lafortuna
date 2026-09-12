import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowUpDown, Ban, CheckCircle2, ChevronRight, CloudOff, Edit3, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { ImageLightbox } from '../../components/ImageLightbox';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, CompactToolbar, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Select, Textarea } from '../../components/ui';
import { useListControls } from '../../hooks/useListControls';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Group, Location, Movement, RecordImage, SelectableAnimal } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, humanizeCode } from '../../utils';

type MovementKind = 'UBICACION' | 'GRUPO' | 'PROPIEDAD' | 'COMBINADO';

interface MovementForm {
  kind: MovementKind;
  id_propiedad_origen: string;
  selection: AnimalSelectionValue;
  id_ubicacion_destino: string;
  id_grupo_destino: string;
  fecha_movimiento: string;
  id_motivo_movimiento: string;
  observaciones: string;
}

const MAIN_PROPERTY = 'PROPIEDAD_PRINCIPAL';

const emptyForm = (): MovementForm => ({
  kind: 'UBICACION',
  id_propiedad_origen: MAIN_PROPERTY,
  selection: { mode: 'GRUPO', groupId: '', animals: [] },
  id_ubicacion_destino: '',
  id_grupo_destino: '',
  fecha_movimiento: currentDateInput(),
  id_motivo_movimiento: '',
  observaciones: '',
});

function locationPropertyId(location?: Location | null) {
  if (!location) return '';
  return location.propiedad_es_principal ? MAIN_PROPERTY : location.id_propiedad;
}

function groupPropertyId(group?: Group | null) {
  if(!group)return '';
  return group.propiedad_es_principal ? MAIN_PROPERTY : group.id_propiedad ?? '';
}

function movementTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'COMPLETADO') return 'success';
  if (status === 'CANCELADO') return 'danger';
  if (status === 'EN_PROCESO') return 'info';
  return 'warning';
}

function groupPastureLabel(group?: string | null, pasture?: string | null) {
  if (group && pasture) return `${group} (${pasture})`;
  return group || pasture || '';
}

function movementRouteSide(item: Movement, side: 'origin' | 'destination') {
  const description = side === 'origin' ? item.origen_descripcion : item.destino_descripcion;
  const group = side === 'origin' ? item.grupo_origen : item.grupo_destino;
  const pasture = side === 'origin' ? item.ubicacion_origen : item.ubicacion_destino;
  const property = side === 'origin' ? item.propiedad_origen : item.propiedad_destino;
  if (item.tipo_movimiento === 'UBICACION') {
    return pasture || description || (side === 'origin' ? 'Origen no indicado' : 'Destino no indicado');
  }
  if (item.tipo_movimiento === 'GRUPO') {
    return description || groupPastureLabel(group,pasture) || (side === 'origin' ? 'Origen no indicado' : 'Destino no indicado');
  }
  if (item.tipo_movimiento === 'PROPIEDAD' || item.tipo_movimiento === 'COMBINADO') {
    const route = description || groupPastureLabel(group,pasture);
    return [property,route].filter(Boolean).join(' · ') || (side === 'origin' ? 'Origen no indicado' : 'Destino no indicado');
  }
  return property || pasture || group || (side === 'origin' ? 'Origen no indicado' : 'Destino no indicado');
}

function selectedAnimalRoutes(animals: SelectableAnimal[]) {
  return [...new Set(animals.filter((animal) => animal.seleccionado).map((animal) => groupPastureLabel(animal.grupo,animal.ubicacion)).filter(Boolean))].join(', ');
}

function selectedMovementDetails(item:Movement) {
  return (item.detalles??[]).filter((detail)=>detail.seleccionado);
}

function movementTitle(item:Movement) {
  const base=item.motivo_catalogo||item.motivo||'Movimiento de animales';
  if(item.tipo_movimiento!=='UBICACION')return base;
  const group=item.grupo_origen||item.grupo_destino||selectedMovementDetails(item).find((detail)=>detail.grupo)?.grupo;
  return group&&!base.includes(`(${group})`)?`${base} (${group})`:base;
}

function movementAnimalSummary(item:Movement) {
  const details=selectedMovementDetails(item);
  const total=details.length||item.total_seleccionados;
  if(item.tipo_movimiento==='UBICACION'||!details.length)return `${total} ${total===1?'animal':'animales'}`;
  const names:string[]=[];
  for(const detail of details){
    const name=(detail.nombre||detail.animal||'').trim();
    if(!name||names.includes(name))continue;
    const candidate=[...names,name].join(', ');
    if(names.length&&candidate.length>54)break;
    names.push(name);
    if(names.length===4)break;
  }
  const remaining=Math.max(0,total-names.length);
  return `${names.join(', ')}${remaining?` y ${remaining} más`:''}`;
}

export function MovementsPage() {
  const route = useLocation();
  const navigate = useNavigate();
  const [searchParams]=useSearchParams();
  const consumedInitialAnimal = useRef(false);
  const consumedDetail = useRef(false);
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [selected, setSelected] = useState<Movement | null>(null);
  const [form, setForm] = useState<MovementForm>(emptyForm);
  const [originFiles,setOriginFiles]=useState<File[]>([]);
  const [destinationFiles,setDestinationFiles]=useState<File[]>([]);
  const movements = useQuery({ queryKey: ['movements'], queryFn: () => apiRequest<Movement[]>('/movimientos') });
  const groups = useQuery({ queryKey: ['groups', 'movement'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'movement'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  useEffect(()=>{const target=searchParams.get('movimiento');if(consumedDetail.current||!target||!movements.data)return;const match=movements.data.find((item)=>item.id_movimiento===target);if(match){setSelected(match);consumedDetail.current=true;}},[movements.data,searchParams]);
  const reasons = useCatalog('motivos-movimiento');
  const externalProperties = locations.data?.filter((item) => item.tipo === 'OTRO' && item.activo) ?? [];
  const baseOperationCode = form.kind === 'UBICACION' ? 'MOVIMIENTO_UBICACION' : form.kind === 'GRUPO' ? 'MOVIMIENTO_GRUPO' : form.kind === 'PROPIEDAD' ? 'MOVIMIENTO_PROPIEDAD' : form.id_ubicacion_destino && locations.data?.find((item) => item.id_ubicacion === form.id_ubicacion_destino)?.tipo === 'OTRO' ? 'MOVIMIENTO_PROPIEDAD' : 'MOVIMIENTO_UBICACION';
  const operationCode = form.kind === 'GRUPO' ? baseOperationCode : [baseOperationCode, 'MOVIMIENTO_GRUPO'];
  const selectedLocationIds = [...new Set(form.selection.animals.filter((item) => item.seleccionado).map((item) => item.id_ubicacion_actual).filter(Boolean))];
  const sourceGroup = groups.data?.find((item) => item.id_grupo === form.selection.groupId);
  const sourceLocationId = sourceGroup?.id_ubicacion_actual || (selectedLocationIds.length === 1 ? selectedLocationIds[0] : null);
  const hasSelectedOrigin = Boolean(sourceGroup) || form.selection.animals.some((item) => item.seleccionado);
  const targetGroups = groups.data?.filter((item) => {
    if (!item.activo) return false;
    if (form.kind === 'UBICACION' && item.id_grupo === form.selection.groupId) return true;
    if (!item.id_ubicacion_actual) return false;
    if (form.kind === 'GRUPO') return item.id_grupo!==form.selection.groupId && groupPropertyId(item)===form.id_propiedad_origen;
    if (item.id_ubicacion_actual === form.id_ubicacion_destino) return true;
    return false;
  });

  useEffect(() => {
    if (consumedInitialAnimal.current) return;
    const initialState=route.state as {initialAnimal?:SelectableAnimal;initialKind?:MovementKind;initialGroupId?:string}|null;
    const initialAnimal = initialState?.initialAnimal;
    if (!initialAnimal) return;
    const initialKind=initialState?.initialKind??'GRUPO';
    if (!locations.data||(initialKind==='UBICACION'&&!groups.data)) return;
    consumedInitialAnimal.current = true;
    const initialGroupId=initialState?.initialGroupId??initialAnimal.id_grupo_actual??'';
    const initialGroup=groups.data?.find((item)=>item.id_grupo===initialGroupId);
    const initialLocation = locations.data.find((item) => item.id_ubicacion === (initialGroup?.id_ubicacion_actual??initialAnimal.id_ubicacion_actual));
    const propertyId=groupPropertyId(initialGroup)||locationPropertyId(initialLocation)||MAIN_PROPERTY;
    setForm(initialKind==='UBICACION'
      ?{...emptyForm(),kind:'UBICACION',id_propiedad_origen:propertyId,selection:{mode:'GRUPO',groupId:initialGroupId,animals:[]},id_grupo_destino:initialGroupId}
      :{...emptyForm(),kind:initialKind,id_propiedad_origen:propertyId,selection:{mode:'SELECCION_MANUAL',groupId:'',animals:[{...initialAnimal,seleccionado:true}]}});
    setCreating(true);
    navigate(route.pathname, { replace: true, state: null });
  }, [groups.data,locations.data,navigate,route.pathname,route.state]);

  useEffect(() => {
    if (!form.id_grupo_destino || !targetGroups || targetGroups.some((item) => item.id_grupo === form.id_grupo_destino)) return;
    setForm((current) => ({
      ...current,
      id_grupo_destino: '',
      id_ubicacion_destino: current.kind === 'GRUPO' ? '' : current.id_ubicacion_destino,
    }));
  }, [form.id_grupo_destino, form.kind, targetGroups]);

  const save = useMutation({
    mutationFn: async () => {
      const destinationGroup=groups.data?.find((item)=>item.id_grupo===form.id_grupo_destino);
      const destinationLocation=locations.data?.find((item)=>item.id_ubicacion===form.id_ubicacion_destino);
      const selectedAnimals=form.selection.animals.filter((animal)=>animal.seleccionado);
      const originDescription=form.kind==='UBICACION'
        ? sourceGroup?.ubicacion || (selectedLocationIds.length===1?selectedAnimals.find((animal)=>animal.id_ubicacion_actual===selectedLocationIds[0])?.ubicacion:null) || 'Origen no indicado'
        : selectedAnimalRoutes(selectedAnimals)
          || groupPastureLabel(sourceGroup?.nombre,sourceGroup?.ubicacion)
          || (form.id_propiedad_origen===MAIN_PROPERTY?'Propiedad principal':externalProperties.find((item)=>item.id_ubicacion===form.id_propiedad_origen)?.nombre)
          || 'Origen no indicado';
      const destinationDescription=form.kind==='UBICACION'
        ? destinationLocation?.nombre || 'Destino no indicado'
        : form.kind==='GRUPO'
          ? groupPastureLabel(destinationGroup?.nombre,destinationGroup?.ubicacion??destinationLocation?.nombre)
          : destinationLocation?.propiedad || destinationLocation?.nombre || groupPastureLabel(destinationGroup?.nombre,destinationGroup?.ubicacion) || 'Destino no indicado';
      const body = {
          tipo_movimiento: form.kind,
          propiedad_origen: form.id_propiedad_origen || null,
          modo_seleccion: form.selection.mode,
          id_grupo_filtro: form.selection.mode === 'GRUPO' ? form.selection.groupId : null,
          id_ubicacion_destino: form.id_ubicacion_destino || null,
          id_grupo_destino: form.id_grupo_destino || null,
          id_motivo_movimiento: form.id_motivo_movimiento || null,
          fecha_movimiento: form.fecha_movimiento,
          observaciones: form.observaciones.trim() || null,
          origen_descripcion: originDescription,
          destino_descripcion: destinationDescription,
          ubicacion_origen: selectedAnimals.length===1?selectedAnimals[0].ubicacion:sourceGroup?.ubicacion??null,
          ubicacion_destino: destinationLocation?.nombre??destinationGroup?.ubicacion??null,
          grupo_origen: selectedAnimals.length===1?selectedAnimals[0].grupo:sourceGroup?.nombre??null,
          grupo_destino: form.kind==='UBICACION'?sourceGroup?.nombre??null:destinationGroup?.nombre??null,
          animales: form.selection.animals.map((animal) => ({
            id_animal: animal.id_animal,
            nombre: animal.nombre,
            codigo_arete: animal.codigo_arete,
            id_grupo_actual: animal.id_grupo_actual,
            grupo: animal.grupo,
            id_ubicacion_actual: animal.id_ubicacion_actual,
            ubicacion: animal.ubicacion,
            seleccionado: animal.seleccionado,
            id_ubicacion_destino: form.id_ubicacion_destino || null,
            id_grupo_destino: form.id_grupo_destino || null,
            observaciones: animal.observaciones || null,
          })),
        };
      const movement = await apiRequest<Movement>(editing ? `/movimientos/${editing.id_movimiento}` : '/movimientos', {
        method: editing ? 'PATCH' : 'POST', body: editing ? { ...body, animales: undefined } : body,
      });
      if (editing?.estado === 'BORRADOR') await apiRequest(`/movimientos/${editing.id_movimiento}/seleccion`, { method: 'PUT', body: { animales: body.animales } });
      const movementId=editing?.id_movimiento??movement.id_movimiento;
      const uploadSide=async(side:'ORIGEN'|'DESTINO',files:File[])=>{
        if(!files.length)return;
        const data=new FormData();files.forEach((file)=>data.append('imagenes',file));
        await apiRequest(`/movimientos/${movementId}/imagenes/${side}`,{method:'POST',body:data});
      };
      if(form.kind==='UBICACION') {
        await uploadSide('ORIGEN',originFiles);
        await uploadSide('DESTINO',destinationFiles);
      }
      return movement;
    },
    onSuccess: () => {
      toast.show(editing ? 'Movimiento actualizado.' : 'Movimiento guardado como borrador.');
      setCreating(false);
      setEditing(null);
      setForm(emptyForm());
      setOriginFiles([]);setDestinationFiles([]);
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['movement-detail'] });
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const list = useListControls({ items: movements.data ?? [], storageKey: 'movements', searchText: (item) => `${item.motivo_catalogo ?? item.motivo ?? ''} ${item.origen_descripcion ?? ''} ${item.destino_descripcion ?? ''} ${item.propiedad_origen ?? ''} ${item.propiedad_destino ?? ''} ${item.ubicacion_origen ?? ''} ${item.ubicacion_destino ?? ''} ${item.grupo_origen ?? ''} ${item.grupo_destino ?? ''} ${(item.detalles ?? []).map((detail) => `${detail.animal} ${detail.arete ?? ''}`).join(' ')}`, dateValue: (item) => item.fecha_movimiento, nameValue: (item) => item.motivo_catalogo || item.motivo || item.ubicacion_destino || item.grupo_destino || item.propiedad_destino || '' });
  const editMovement = (item: Movement) => {
    const destination = locations.data?.find((location) => location.id_ubicacion === item.id_ubicacion_destino);
    const kind: MovementKind = item.tipo_movimiento ?? (item.id_ubicacion_destino && item.id_grupo_destino ? 'COMBINADO' : item.id_grupo_destino ? 'GRUPO' : destination?.tipo === 'OTRO' ? 'PROPIEDAD' : 'UBICACION');
    const legacyGroupId = item.id_grupo_filtro ?? item.id_grupo_origen ?? item.id_grupo_destino ?? '';
    const legacySourceGroup = groups.data?.find((group) => group.id_grupo === legacyGroupId);
    const legacySourceLocation = locations.data?.find((location) => location.id_ubicacion === item.id_ubicacion_origen);
    const sourceProperty = item.propiedad_origen_es_principal
      ? MAIN_PROPERTY
      : item.id_propiedad_origen ?? (legacySourceGroup ? groupPropertyId(legacySourceGroup) : locationPropertyId(legacySourceLocation));
    setForm({ kind, id_propiedad_origen: sourceProperty || MAIN_PROPERTY, selection: { mode: kind === 'UBICACION' ? 'GRUPO' : item.modo_seleccion, groupId: kind === 'UBICACION' ? legacyGroupId : item.id_grupo_filtro ?? '', animals: (item.detalles ?? []).map((detail) => ({ id_animal: detail.id_animal, nombre: detail.nombre ?? detail.animal, codigo_arete: detail.codigo_arete ?? detail.arete, sexo: detail.sexo ?? 'HEMBRA', id_categoria_animal: detail.id_categoria_animal ?? '', categoria: detail.categoria ?? '', id_grupo_actual: detail.id_grupo_actual ?? null, grupo: detail.grupo ?? null, id_ubicacion_actual: detail.id_ubicacion_actual ?? null, ubicacion: detail.ubicacion ?? null, seleccionado: kind === 'UBICACION' ? true : detail.seleccionado, observaciones: detail.observaciones ?? null })) }, id_ubicacion_destino: item.id_ubicacion_destino ?? '', id_grupo_destino: kind === 'UBICACION' ? legacyGroupId : item.id_grupo_destino ?? '', id_motivo_movimiento: item.id_motivo_movimiento ?? '', fecha_movimiento: dateInputValue(item.fecha_movimiento), observaciones: item.observaciones ?? '' });
    setEditing(item); setSelected(null); setCreating(true);
    setOriginFiles([]);setDestinationFiles([]);
  };

  const deletePhoto=useMutation({
    mutationFn:(image:RecordImage)=>apiRequest(`/movimientos/imagenes/${image.id_movimiento_imagen}`,{method:'DELETE'}),
    onSuccess:(_,image)=>{setEditing((current)=>current?{...current,fotos_origen:(current.fotos_origen??[]).filter((item)=>item.id_movimiento_imagen!==image.id_movimiento_imagen),fotos_destino:(current.fotos_destino??[]).filter((item)=>item.id_movimiento_imagen!==image.id_movimiento_imagen)}:current);toast.show('Fotografía eliminada.');void queryClient.invalidateQueries({queryKey:['movements']});void queryClient.invalidateQueries({queryKey:['movement-detail']});},
    onError:(error)=>toast.show((error as ApiError).message,'error'),
  });

  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'apply' | 'cancel' }) => apiRequest(`/movimientos/${id}/${kind === 'apply' ? 'aplicar' : 'cancelar'}`, { method: 'POST' }),
    onSuccess: (_, variables) => {
      toast.show(variables.kind === 'apply' ? 'Movimiento aplicado.' : 'Movimiento cancelado.');
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['movement-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['animals'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const wholeGroupRelocation = form.kind === 'UBICACION';
  const updateSelection = (selection: AnimalSelectionValue) => setForm((current) => {
    const normalizedSelection = current.kind === 'UBICACION'
      ? { ...selection, mode: 'GRUPO' as const, animals: selection.animals.map((animal) => ({ ...animal, seleccionado: true })) }
      : selection;
    const nextSource = groups.data?.find((item) => item.id_grupo === normalizedSelection.groupId);
    const preservesGroup = current.kind === 'UBICACION' && Boolean(normalizedSelection.groupId);
    const previousSourceWasDestination = current.id_grupo_destino === current.selection.groupId;
    return {
      ...current,
      selection: normalizedSelection,
      id_grupo_destino: preservesGroup ? normalizedSelection.groupId : previousSourceWasDestination ? '' : current.id_grupo_destino,
      id_ubicacion_destino: nextSource?.id_ubicacion_actual === current.id_ubicacion_destino ? '' : current.id_ubicacion_destino,
    };
  });

  const cycleOrder=()=>list.setOrder(list.order==='NEWEST'?'OLDEST':list.order==='OLDEST'?'AZ':list.order==='AZ'?'ZA':'NEWEST');
  return <div className="module-no-header">
    <CompactToolbar search={list.search} onSearch={list.setSearch} placeholder="Buscar movimiento…" count={list.visible.length} actions={<IconButton label="Cambiar orden" onClick={cycleOrder}><ArrowUpDown size={19}/></IconButton>}/>

    {movements.isLoading ? <LoadingState /> : movements.isError ? <ErrorState message={(movements.error as Error).message} onRetry={() => void movements.refetch()} /> : list.visible.length ? <Card className="record-list movements-record-list"><div className="record-list-head"><span>Movimiento</span><span>Fecha</span><span>Origen y destino</span><span>Estado</span><span /></div>{list.visible.map((movement) => {const pending=Boolean((movement as Movement&{__offline?:boolean;__sync_state?:string}).__offline||(movement as Movement&{__sync_state?:string}).__sync_state==='PENDING');const origin=movementRouteSide(movement,'origin');const destination=movementRouteSide(movement,'destination');return <button type="button" className="record-list-row movement-compact-route" key={movement.id_movimiento} onClick={() => setSelected(movement)}><span><strong>{movementTitle(movement)}</strong><small>{movementAnimalSummary(movement)}</small></span><span><strong>{formatDate(movement.fecha_movimiento)}</strong></span><span><strong className="route-summary"><ArrowLeftRight size={16}/>{origin} → {destination}</strong></span><span className="record-status-with-sync"><Badge tone={movementTone(movement.estado)}>{humanizeCode(movement.estado)}</Badge>{pending?<span className="inline-sync-pending" title="Cambio pendiente de sincronizar"><CloudOff size={15}/></span>:null}</span><span className="record-row-actions">{movement.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); editMovement(movement); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>;})}</Card> : <EmptyState icon={ArrowLeftRight} title="Aún no hay movimientos" description="Registra un cambio de grupo, potrero, corral u otra ubicación." />}

    {selected ? <MovementDetailModal item={selected} onClose={() => setSelected(null)} onEdit={selected.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? editMovement : undefined} onApply={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_CREAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'apply' }) : undefined} onCancel={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_ANULAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'cancel' }) : undefined} loading={action.isPending} /> : null}

    {creating ? <Modal title={editing ? 'Editar movimiento' : 'Nuevo movimiento'} wide onClose={() => { setCreating(false); setEditing(null); }} footer={<><Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>{editing ? 'Guardar cambios' : 'Guardar borrador'}</Button></>}>
      <div className="form-stack">
        <div className="form-section">
          <h3>1. Tipo de movimiento</h3>
          <Field label="Tipo de movimiento" required hint="La propiedad se gestiona mediante las ubicaciones externas registradas en Catálogos.">
            <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR')} value={form.kind} onChange={(event) => setForm((current) => {
              const kind = event.target.value as MovementKind;
              const groupId = kind === 'UBICACION' && current.selection.mode === 'GRUPO' ? current.selection.groupId : '';
              return { ...current, kind, selection: { ...current.selection, mode: kind === 'UBICACION' ? 'GRUPO' : current.selection.mode, groupId: kind === 'UBICACION' ? groupId : current.selection.groupId, animals: [] }, id_ubicacion_destino: '', id_grupo_destino: kind === 'UBICACION' ? groupId : '' };
            })}>
              <option value="UBICACION">Cambiar ubicación (potrero o corral)</option>
              <option value="GRUPO">Cambiar de grupo</option>
              <option value="PROPIEDAD">Trasladar a otra propiedad</option>
              {form.kind === 'COMBINADO' ? <option value="COMBINADO">Movimiento combinado anterior</option> : null}
            </Select>
          </Field>
        </div>

        {editing && editing.estado !== 'BORRADOR' ? <div className="form-alert"><strong>Movimiento aplicado.</strong> Puedes corregir fecha, motivo y observaciones. El recorrido y los animales se mantienen para conservar el historial.</div> : <div className="form-section">
          <h3>{form.kind === 'UBICACION' ? '2. Propiedad y grupo de origen' : '2. Propiedad y animales de origen'}</h3>
          <div className="form-grid">
            <Field label="Propiedad de origen" hint="Los grupos y animales se filtrarán únicamente por esta propiedad." required>
              <Select value={form.id_propiedad_origen} onChange={(event) => setForm((current) => ({
                ...current,
                id_propiedad_origen: event.target.value,
                selection: { mode: current.kind === 'UBICACION' ? 'GRUPO' : current.selection.mode, groupId: '', animals: [] },
                id_ubicacion_destino: '',
                id_grupo_destino: '',
              }))}>
                <option value={MAIN_PROPERTY}>Propiedad principal</option>
                {externalProperties.map((property) => <option key={property.id_ubicacion} value={property.id_ubicacion}>{property.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <AnimalSelectionBuilder
            value={form.selection}
            operationCode={operationCode}
            excludeLocationId={form.kind === 'GRUPO' ? undefined : form.id_ubicacion_destino || undefined}
            ownershipScope={form.id_propiedad_origen === MAIN_PROPERTY ? 'EN_PROPIEDAD' : 'FUERA_PROPIEDAD'}
            propertyScope={form.id_propiedad_origen}
            allowedModes={form.kind === 'UBICACION' ? ['GRUPO'] : undefined}
            lockAnimalSelection={form.kind === 'UBICACION'}
            autoLoadGroup={form.kind === 'UBICACION'}
            onChange={updateSelection}
          />
        </div>}

        <div className="form-section">
          <h3>{editing && editing.estado !== 'BORRADOR' ? 'Datos del movimiento' : '3. Destino y datos del movimiento'}</h3>
          <div className="form-grid">
            {form.kind !== 'GRUPO' ? <Field label={form.kind === 'PROPIEDAD' ? 'Destino en otra propiedad' : 'Potrero o corral de destino'} hint={editing && editing.estado !== 'BORRADOR' ? 'Se conserva porque el movimiento ya fue aplicado.' : hasSelectedOrigin ? 'Los lugares donde ya están los animales no aparecen en este listado.' : 'Primero selecciona y carga el grupo o los animales de origen.'} required>
              <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR') || !hasSelectedOrigin} value={form.id_ubicacion_destino} onChange={(event) => setForm((current) => {
                const destinationId = event.target.value;
                const destination = locations.data?.find((item) => item.id_ubicacion === destinationId);
                const destinationPropertyId = locationPropertyId(destination);
                const preservesGroup = current.kind === 'UBICACION' && Boolean(current.selection.groupId);
                return {
                  ...current,
                  id_ubicacion_destino: destinationId,
                  id_grupo_destino: preservesGroup ? current.selection.groupId : '',
                  selection: { ...current.selection, animals: current.selection.animals.filter((animal) => {
                    if (animal.id_ubicacion_actual === destinationId) return false;
                    if (current.kind !== 'PROPIEDAD' || !destinationPropertyId) return true;
                    const origin = locations.data?.find((item) => item.id_ubicacion === animal.id_ubicacion_actual);
                    const originPropertyId = locationPropertyId(origin);
                    return originPropertyId !== destinationPropertyId;
                  }) },
                };
              })}>
                <option value="">Selecciona</option>
                {locations.data?.filter((item) => {
                  if (!item.activo) return false;
                  if (item.id_ubicacion !== form.id_ubicacion_destino && (item.id_ubicacion === sourceLocationId || selectedLocationIds.includes(item.id_ubicacion))) return false;
                  if (item.id_ubicacion === form.id_ubicacion_destino) return true;
                  if (form.kind === 'UBICACION') {
                    return item.tipo !== 'OTRO' && locationPropertyId(item) === form.id_propiedad_origen;
                  }
                  if (form.kind === 'PROPIEDAD') {
                    return locationPropertyId(item) !== form.id_propiedad_origen;
                  }
                  return true;
                }).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.propiedad ? `${item.propiedad} · ` : ''}{item.nombre} · {item.tipo === 'OTRO' ? 'Ubicación general' : humanizeCode(item.tipo)}</option>)}
              </Select>
            </Field> : null}
            {wholeGroupRelocation ? <Field label="Grupo que se trasladará" hint="El grupo se conserva; todos sus animales pasarán juntos al nuevo potrero o corral." required><Input value={sourceGroup?.nombre ?? ''} placeholder="Selecciona primero el grupo de origen" readOnly /></Field> : <Field label="Grupo de destino" hint={form.kind === 'GRUPO' ? 'Solo aparecen otros grupos de la misma propiedad; el animal adoptará la ubicación fija del grupo elegido.' : 'El grupo y el destino siempre quedarán vinculados.'} required>
              <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR') || (form.kind !== 'GRUPO' && !form.id_ubicacion_destino)} value={form.id_grupo_destino} onChange={(event) => {
                const group = groups.data?.find((item) => item.id_grupo === event.target.value);
                setForm((current) => ({
                  ...current,
                  id_grupo_destino: event.target.value,
                  id_ubicacion_destino: current.kind === 'GRUPO' ? group?.id_ubicacion_actual ?? '' : current.id_ubicacion_destino,
                  selection: current.kind === 'GRUPO'
                    ? { ...current.selection, animals: current.selection.animals.filter((animal) => animal.id_grupo_actual !== event.target.value) }
                    : current.selection,
                }));
              }}>
                <option value="">Selecciona</option>
                {targetGroups?.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre} · {item.categoria} · {item.ubicacion}</option>)}
              </Select>
            </Field>}
            <Field label="Fecha" required><Input type="date" value={form.fecha_movimiento} onChange={(event) => setForm((current) => ({ ...current, fecha_movimiento: event.target.value }))} /></Field>
            <Field label="Motivo" hint="Si lo dejas pendiente, el borrador usará el motivo general correspondiente al tipo de traslado."><Select value={form.id_motivo_movimiento} onChange={(event) => setForm((current) => ({ ...current, id_motivo_movimiento: event.target.value }))}><option value="">Asignar automáticamente</option>{reasons.data?.filter((item) => item.activo !== false || itemId(item) === form.id_motivo_movimiento).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
          </div>
          <Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field>
          {form.kind==='UBICACION'?<div className="form-section nested"><h3>Fotografías del estado de los potreros</h3><p className="muted">Hasta tres del origen y tres del destino.</p><div className="form-grid"><MovementPhotoPicker label="Potrero de origen" existing={editing?.fotos_origen??[]} files={originFiles} onFiles={setOriginFiles} onDelete={(image)=>deletePhoto.mutate(image)}/><MovementPhotoPicker label="Potrero de destino" existing={editing?.fotos_destino??[]} files={destinationFiles} onFiles={setDestinationFiles} onDelete={(image)=>deletePhoto.mutate(image)}/></div></div>:null}
          {(!editing || editing.estado === 'BORRADOR') ? <p className="muted">Puedes guardar el borrador sin haber completado todavía los animales, el grupo, el motivo o la ubicación de destino. Todo se validará cuando apliques el movimiento.</p> : null}
        </div>
      </div>
    </Modal> : null}
    {hasPermission('MOVIMIENTO_CREAR')?<FloatingActionDock><IconButton label="Nuevo movimiento" onClick={()=>{setForm(emptyForm());setOriginFiles([]);setDestinationFiles([]);setCreating(true);}}><Plus size={23}/></IconButton></FloatingActionDock>:null}
  </div>;
}

function MovementDetailModal({ item, onClose, onEdit, onApply, onCancel, loading }: { item: Movement; onClose: () => void; onEdit?: (movement: Movement) => void; onApply?: () => void; onCancel?: () => void; loading: boolean }) {
  const navigate=useNavigate();
  const detail=useQuery({queryKey:['movement-detail',item.id_movimiento],queryFn:()=>apiRequest<Movement>(`/movimientos/${item.id_movimiento}`)});
  const current=detail.data??item;
  const implicated=selectedMovementDetails(current);
  return <Modal title="Detalle del movimiento" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onCancel ? <Button variant="ghost" onClick={onCancel} loading={loading}><Ban size={17} />Cancelar movimiento</Button> : null}{onEdit ? <Button variant="secondary" onClick={()=>onEdit(current)}><Edit3 size={17} />Editar</Button> : null}{onApply ? <Button onClick={onApply} loading={loading}><CheckCircle2 size={17} />Aplicar</Button> : null}</>}>
    <div className="record-detail">
      <div className="record-detail-heading"><div className="record-icon"><ArrowLeftRight size={22} /></div><div><h2>{movementTitle(current)}</h2><p>{formatDate(current.fecha_movimiento)}</p></div><Badge tone={movementTone(current.estado)}>{humanizeCode(current.estado)}</Badge></div>
      <div className="detail-grid"><div><small>Origen</small><strong>{movementRouteSide(current,'origin')}</strong></div><div><small>Destino</small><strong>{movementRouteSide(current,'destination')}</strong></div><div><small>Seleccionados</small><strong>{current.total_seleccionados}</strong></div><div><small>Candidatos</small><strong>{current.total_candidatos}</strong></div></div>
      {(current.fotos_origen??[]).length||(current.fotos_destino??[]).length?<section><h3>Estado de los potreros</h3><div className="comparison-photos"><PhotoGallery title="Origen" images={current.fotos_origen??[]}/><PhotoGallery title="Destino" images={current.fotos_destino??[]}/></div></section>:null}
      <details className="record-collapsible"><summary>Animales implicados ({implicated.length})</summary><div className="movement-animal-lines">{implicated.map((movementDetail) => <button type="button" key={movementDetail.id_detalle} onClick={()=>navigate(`/animales/${movementDetail.id_animal}`)}><span><strong>{movementDetail.animal}</strong><small>{movementDetail.arete ? `Arete ${movementDetail.arete}` : 'Sin arete'}</small></span><ChevronRight size={17}/></button>)}</div></details>
      {current.observaciones ? <section><h3>Observaciones</h3><p>{current.observaciones}</p></section> : null}
    </div>
  </Modal>;
}

function MovementPhotoPicker({label,existing,files,onFiles,onDelete}:{label:string;existing:RecordImage[];files:File[];onFiles:(files:File[])=>void;onDelete:(image:RecordImage)=>void}){
  const available=Math.max(0,3-existing.length);
  const full=files.length>=available;
  return <Field label={label}><div className="record-photo-picker"><div className="record-photo-grid">{existing.map((image)=><div key={image.id_movimiento_imagen}><img src={image.secure_url} alt=""/><button type="button" onClick={()=>onDelete(image)} aria-label="Eliminar fotografía"><Trash2 size={14}/></button></div>)}{files.map((file,index)=><div key={`${file.name}-${index}`}><FilePreview file={file}/><button type="button" onClick={()=>onFiles(files.filter((_,position)=>position!==index))} aria-label="Quitar fotografía"><Trash2 size={14}/></button></div>)}</div><label className={`photo-upload-button ${full?'disabled':''}`}><ImagePlus size={18}/>Agregar fotografías<input type="file" accept="image/*" multiple disabled={full} onChange={(event)=>{onFiles([...files,...Array.from(event.target.files??[]).slice(0,available-files.length)].slice(0,available));event.currentTarget.value='';}}/></label><small>{existing.length+files.length} de 3</small></div></Field>;
}

function FilePreview({file}:{file:File}){const [url,setUrl]=useState('');useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);return <img src={url} alt={file.name}/>;}
function PhotoGallery({title,images}:{title:string;images:RecordImage[]}){const [viewer,setViewer]=useState<number|null>(null);return <div className="comparison-photo-column"><strong>{title}</strong><div className="record-photo-grid record-photo-gallery">{images.length?images.map((image,index)=><button className="record-photo-view" type="button" key={image.id_movimiento_imagen??image.public_id} onClick={()=>setViewer(index)} aria-label={`Abrir fotografía ${index+1} del potrero de ${title.toLowerCase()}`}><img src={image.secure_url} alt={`${title} del potrero`}/><span>{title} · {index+1}</span></button>):<span className="muted">Sin fotografías</span>}</div>{viewer!==null?<ImageLightbox items={images.map((image,index)=>({key:image.id_movimiento_imagen??String(index),url:image.secure_url,title:`Potrero de ${title.toLowerCase()}`,subtitle:'Evidencia del movimiento',date:image.created_at,filename:image.nombre_original}))} initialIndex={viewer} onClose={()=>setViewer(null)}/>:null}</div>;}

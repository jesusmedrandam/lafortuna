import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Activity,
  Baby,
  Beef,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileImage,
  FileText,
  HeartCrack,
  HeartOff,
  HeartPulse,
  ImagePlus,
  History,
  MapPin,
  Milk,
  Search,
  Share2,
  ShoppingCart,
  Star,
  Stethoscope,
  Tag,
  Syringe,
  Trash2,
  UserRound,
  Users,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from '../../components/ui';
import type { Animal, AnimalHistoricalLocation, AnimalImage, CatalogItem, Group, Location } from '../../types/api';
import { currentDateInput, formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';
import { ImageLightbox } from '../../components/ImageLightbox';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { downloadAnimalFicha, type AnimalFichaData } from './animalFicha';

interface ViewerImage {
  key: string;
  url: string;
  alt: string;
  title: string;
  subtitle?:string;
  createdAt?: string;
  imageId?: string;
  isProfile: boolean;
  type: 'IMAGEN' | 'VIDEO';
}

interface UploadDraft {
  file: File;
  profile: boolean;
  purpose: 'profile' | 'cover' | 'gallery';
  previewUrl: string;
}

interface MediaEditDraft { image: AnimalImage; animalIds: string[]; tagIds: string[]; date: string }
interface AnimalShare { activo:boolean;token:string;url:string;created_at:string }
interface ActionAvailability{permitido:boolean;motivo:string|null}
interface AnimalOperationAvailability{
  produccion:{consultar:boolean;registrar:boolean;motivo:string|null};
  aplica_reproduccion:boolean;
  id_prenez_confirmada:string|null;
  celo:ActionAvailability&{solo_falso:boolean};
  prenez:ActionAvailability;
  inseminacion:ActionAvailability;
  embrion:ActionAvailability;
  parto:ActionAvailability;
  aborto:ActionAvailability;
  movimiento:ActionAvailability;
  sanidad:ActionAvailability;
  pesaje:ActionAvailability;
  venta:ActionAvailability;
  muerte:ActionAvailability;
}

type ConditionAction = 'DESACTIVAR' | 'REACTIVAR' | 'REPORTAR_DESAPARICION' | 'REGISTRAR_HALLAZGO';

export function AnimalDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission,user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filePurpose, setFilePurpose] = useState<'profile'|'cover'|'gallery'>('gallery');
  const [photoChoice, setPhotoChoice] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [relatedAnimalIds, setRelatedAnimalIds] = useState<string[]>([]);
  const [uploadTags,setUploadTags]=useState<string[]>([]);
  const [mediaEdit,setMediaEdit]=useState<MediaEditDraft|null>(null);
  const [expandedHistories,setExpandedHistories]=useState<Record<string,boolean>>({});
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [conditionAction, setConditionAction] = useState<ConditionAction | null>(null);
  const [conditionForm, setConditionForm] = useState({ fecha_evento: currentDateInput(), id_grupo_actual: '', id_ubicacion_actual: '', observaciones: '' });
  const [conditionPhoto,setConditionPhoto]=useState<File|null>(null);
  const [historicalDate,setHistoricalDate]=useState(currentDateInput());
  const [historicalOpen,setHistoricalOpen]=useState(false);
  const [shareOpen,setShareOpen]=useState(false);
  const [shareInfo,setShareInfo]=useState<AnimalShare|null>(null);
  const [downloadOpen,setDownloadOpen]=useState(false);
  const [downloading,setDownloading]=useState<'png'|'pdf'|null>(null);
  const [quickAction,setQuickAction]=useState<'movement'|'health'|'production'|'reproduction'|null>(null);
  const mediaTags=useCatalog('etiquetas-multimedia');

  const query = useQuery({
    queryKey: ['animal', id],
    queryFn: () => apiRequest<Animal>(`/animales/${id}`),
    enabled: Boolean(id),
  });
  const availability=useQuery({
    queryKey:['animal',id,'operation-availability',currentDateInput()],
    queryFn:()=>apiRequest<AnimalOperationAvailability>(`/reproduccion/disponibilidad/${id}?fecha=${currentDateInput()}`),
    enabled:Boolean(id&&query.data),
    staleTime:60_000,
    retry:1,
  });
  const groups = useQuery({
    queryKey: ['groups', 'animal-condition'],
    queryFn: () => apiRequest<Group[]>('/grupos?limit=100'),
    enabled: conditionAction === 'REGISTRAR_HALLAZGO',
  });
  const locations = useQuery({
    queryKey: ['locations', 'animal-condition'],
    queryFn: () => apiRequest<Location[]>('/ubicaciones'),
    enabled: conditionAction === 'REGISTRAR_HALLAZGO',
  });
  const historicalLocation=useQuery({queryKey:['animal',id,'historical-location',historicalDate],queryFn:()=>apiRequest<AnimalHistoricalLocation>(`/animales/${id}/ubicacion-historica?fecha=${encodeURIComponent(historicalDate)}`),enabled:Boolean(id&&historicalDate&&historicalOpen),staleTime:60_000});
  const hallazgoCategoryId = locations.data?.find((item) => item.id_ubicacion === conditionForm.id_ubicacion_actual)?.id_categoria_animal ?? query.data?.id_categoria_animal;

  const deleteAnimal = useMutation({
    mutationFn: () => apiRequest(`/animales/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.show('Animal eliminado.');
      void client.invalidateQueries({ queryKey: ['animals'] });
      navigate('/animales', { replace: true });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const upload = useMutation({
    mutationFn: async ({ file, profile, animalIds, tagIds }: { file: File; profile: boolean; animalIds: string[]; tagIds:string[] }) => {
      const data = new FormData();
      data.set('archivo', file);
      data.set('es_perfil', String(profile));
      data.set('id_animales', JSON.stringify(animalIds));
      data.set('id_etiquetas',JSON.stringify(tagIds));
      return apiRequest<AnimalImage>(`/animales/${id}/imagenes`, { method: 'POST', body: data });
    },
    onSuccess: () => {
      toast.show('Archivo subido y relacionado correctamente.');
      setUploadDraft(null);
      setUploadTags([]);
      void client.invalidateQueries({ queryKey: ['animal', id] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const updateMedia=useMutation({mutationFn:()=>apiRequest(`/imagenes/${mediaEdit?.image.id_imagen}`,{method:'PATCH',body:{id_animales:mediaEdit?.animalIds,fecha_toma:mediaEdit?.date,id_etiquetas:mediaEdit?.tagIds}}),onSuccess:()=>{toast.show('Relaciones y etiquetas actualizadas.');setMediaEdit(null);setViewerIndex(null);void client.invalidateQueries({queryKey:['animal',id]});void client.invalidateQueries({queryKey:['multimedia']});},onError:(error)=>toast.show((error as ApiError).message,'error')});

  const imageAction = useMutation({
    mutationFn: ({ imageId, action }: { imageId: string; action: 'profile' | 'delete' }) => apiRequest(
      `/imagenes/${imageId}${action === 'profile' ? '/perfil' : ''}`,
      { method: action === 'profile' ? 'PATCH' : 'DELETE' },
    ),
    onSuccess: (_data, variables) => {
      toast.show(variables.action === 'profile' ? 'Foto de perfil actualizada.' : 'Fotografía eliminada.');
      setViewerIndex(null);
      void client.invalidateQueries({ queryKey: ['animal', id] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const conditionMutation = useMutation({
    mutationFn: () => {
      const payload={
        accion: conditionAction,
        fecha_evento: conditionForm.fecha_evento,
        id_grupo_actual: conditionAction === 'REGISTRAR_HALLAZGO' ? conditionForm.id_grupo_actual || null : undefined,
        id_ubicacion_actual: conditionAction === 'REGISTRAR_HALLAZGO' ? conditionForm.id_ubicacion_actual || null : undefined,
        observaciones: conditionForm.observaciones.trim() || null,
      };
      if(conditionAction==='REGISTRAR_HALLAZGO'&&conditionPhoto){
        const data=new FormData();data.set('data',JSON.stringify(payload));data.set('imagen',conditionPhoto);
        return apiRequest(`/animales/${id}/condicion`,{method:'POST',body:data});
      }
      return apiRequest(`/animales/${id}/condicion`,{method:'POST',body:payload});
    },
    onSuccess: async () => {
      const message = conditionAction === 'REGISTRAR_HALLAZGO'
        ? 'Hallazgo registrado y animal reactivado.'
        : conditionAction === 'REPORTAR_DESAPARICION'
          ? 'Desaparición registrada.'
          : conditionAction === 'DESACTIVAR'
            ? 'Animal desactivado para operaciones.'
            : 'Animal reactivado para operaciones.';
      toast.show(message);
      setConditionAction(null);
      setConditionPhoto(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['animal', id] }),
        client.invalidateQueries({ queryKey: ['animals'] }),
        client.invalidateQueries({ queryKey: ['dashboard'] }),
        client.invalidateQueries({ queryKey: ['locations'] }),
        client.invalidateQueries({ queryKey: ['groups'] }),
        client.invalidateQueries({queryKey:['animal-status-news']}),
      ]);
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const createShare=useMutation({mutationFn:()=>apiRequest<AnimalShare>(`/animales/${id}/compartir`,{method:'POST'}),onSuccess:(value)=>setShareInfo(value),onError:(error)=>toast.show((error as ApiError).message,'error')});
  const revokeShare=useMutation({mutationFn:()=>apiRequest(`/animales/${id}/compartir`,{method:'DELETE'}),onSuccess:()=>{setShareInfo(null);setShareOpen(false);toast.show('El enlace público fue desactivado.');},onError:(error)=>toast.show((error as ApiError).message,'error')});

  const profileImage = useMemo(
    () => query.data?.imagenes?.find((item) => item.es_perfil),
    [query.data?.imagenes],
  );
  const profileUrl = query.data?.foto_perfil || profileImage?.secure_url || null;
  const gallery = useMemo(
    () => (query.data?.imagenes ?? [])
      .filter((item) => !item.es_perfil)
      .sort((a, b) => new Date(b.fecha_toma || b.created_at || 0).getTime() - new Date(a.fecha_toma || a.created_at || 0).getTime()),
    [query.data?.imagenes],
  );
  const viewerImages = useMemo<ViewerImage[]>(() => {
    const animalName = query.data?.nombre ?? 'animal';
    const items: ViewerImage[] = [];
    if (profileUrl) {
      items.push({
        key: profileImage?.id_imagen ?? 'profile',
        url: profileUrl,
        alt: `Foto de perfil de ${animalName}`,
        title: animalName,
        subtitle:`Animal relacionado: ${animalName}`,
        createdAt: profileImage?.created_at,
        imageId: profileImage?.id_imagen,
        isProfile: true,
        type: 'IMAGEN',
      });
    }
    for (const image of gallery) {
      const birthPhoto=image.etiquetas?.some((tag)=>tag.codigo==='PARTO');
      const childLabel=(image.parto_total_crias??0)>1?'Crías':'Cría';
      items.push({
        key: image.id_imagen,
        url: image.secure_url,
        alt: `Archivo de ${image.animales?.[0]?.nombre ?? animalName}`,
        title: birthPhoto?`Parto de ${image.parto_madre??image.animales?.[0]?.nombre??animalName}`:image.animales?.[0]?.nombre??animalName,
        subtitle:birthPhoto&&image.id_parto?[image.parto_crias?`${childLabel}: ${image.parto_crias}`:null,image.parto_fecha?`Fecha: ${formatDate(image.parto_fecha)}`:null,`Padre: ${image.parto_padre??'No registrado'}`].filter(Boolean).join('\n'):[image.animales?.length?`Animales: ${image.animales.map((item)=>item.nombre).join(', ')}`:`Animal: ${animalName}`,image.etiquetas?.length?`Etiquetas: ${image.etiquetas.map((item)=>item.nombre).join(', ')}`:null,image.descripcion].filter(Boolean).join(' · '),
        createdAt: birthPhoto&&image.id_parto?undefined:image.created_at,
        imageId: image.id_imagen,
        isProfile: false,
        type: image.tipo_archivo ?? 'IMAGEN',
      });
    }
    if (query.data?.marquilla_foto) {
      items.push({
        key: 'fierro',
        url: query.data.marquilla_foto,
        alt: `Fierro ${query.data.marquilla_codigo || query.data.marquilla || animalName}`,
        title: `Fierro ${query.data.marquilla_codigo || query.data.marquilla || animalName}`,
        isProfile: false,
        type: 'IMAGEN',
      });
    }
    return items;
  }, [gallery, profileImage, profileUrl, query.data?.marquilla, query.data?.marquilla_codigo, query.data?.marquilla_foto, query.data?.nombre]);

  useEffect(() => {
    if (galleryIndex >= gallery.length) setGalleryIndex(0);
  }, [gallery.length, galleryIndex]);

  useEffect(() => {
    const preview = uploadDraft?.previewUrl;
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [uploadDraft?.previewUrl]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;

  const animal = query.data!;
  const isActive=animal.estado==='ACTIVO';
  const isActiveFemale=isActive&&animal.sexo==='HEMBRA';
  const activePregnancy=animal.historial_preneces?.some(item=>item.rol==='VACA'&&item.estado==='CONFIRMADA')??false;
  const hasProductionHistory=Boolean(animal.historial_produccion?.length);
  const productionCanRegister=availability.data?.produccion?.registrar??Boolean(animal.en_ordeno&&isActive);
  const hasReproductionHistory=Boolean(animal.historial_celos?.length||animal.historial_preneces?.length||animal.historial_partos?.length||animal.historial_abortos?.length||animal.historial_servicios_reproductivos?.length);
  const canHeat=hasPermission('PARTO_ADMINISTRAR')&&(availability.data?.celo?.permitido??isActiveFemale);
  const canInseminate=hasPermission('PARTO_ADMINISTRAR')&&(availability.data?.inseminacion?.permitido??isActiveFemale);
  const canImplantEmbryo=hasPermission('PARTO_ADMINISTRAR')&&(availability.data?.embrion?.permitido??isActiveFemale);
  const canConfirmPregnancy=hasPermission('PARTO_ADMINISTRAR')&&(availability.data?.prenez?.permitido??isActiveFemale);
  const canRegisterBirth=hasPermission('PARTO_ADMINISTRAR')&&(availability.data?.parto?.permitido??Boolean(isActiveFemale&&activePregnancy));
  const canRegisterAbortion=hasPermission('ABORTO_ADMINISTRAR')&&(availability.data?.aborto?.permitido??Boolean(isActiveFemale&&activePregnancy));
  const reproductionCanAct=canHeat||canInseminate||canImplantEmbryo||canConfirmPregnancy||canRegisterBirth||canRegisterAbortion;
  const productionActionVisible=Boolean(animal.en_ordeno)&&(hasProductionHistory||hasPermission('PRODUCCION_ADMINISTRAR'));
  const canConsultReproduction=hasPermission('PARTO_CONSULTAR')||hasPermission('ABORTO_CONSULTAR');
  const currentGallery = gallery[galleryIndex];
  const ownerText = animal.propietarios?.length
    ? animal.propietarios.map((owner) => `${owner.nombre}${owner.porcentaje != null ? ` (${formatNumber(owner.porcentaje)}%)` : ''}`).join(', ')
    : 'Sin propietario registrado';
  const lastTreatment = animal.ultimo_tratamiento;
  const lastMovement = animal.ultimo_movimiento;
  const treatmentText = lastTreatment
    ? [
      lastTreatment.tipo,
      lastTreatment.medicamento,
      lastTreatment.dosis != null ? `${formatNumber(lastTreatment.dosis)} ${lastTreatment.unidad ?? ''}`.trim() : null,
      formatDate(lastTreatment.fecha),
    ].filter(Boolean).join(' · ')
    : '';
  const movementOrigin = lastMovement ? movementPlace(lastMovement.tipo??'',lastMovement.grupo_origen,lastMovement.ubicacion_origen) : 'Sin origen registrado';
  const movementDestination = lastMovement ? movementPlace(lastMovement.tipo??'',lastMovement.grupo_destino,lastMovement.ubicacion_destino) : 'Sin destino registrado';
  const movementText = lastMovement ? `${movementOrigin} → ${movementDestination} · ${formatDate(lastMovement.fecha)}` : '';

  function openIfAllowed(entry:ActionAvailability|undefined,action:()=>void) {
    if(entry&&!entry.permitido){toast.show(entry.motivo||'Esta operación no está habilitada para la propiedad actual.','error');return;}
    action();
  }

  function chooseFile(purpose: 'profile'|'cover'|'gallery') {
    setFilePurpose(purpose);
    setPhotoChoice(false);
    fileRef.current?.click();
  }
  function openProfileViewer() {
    if (profileUrl) setViewerIndex(0);
  }
  function openGalleryViewer(image: AnimalImage) {
    const index = viewerImages.findIndex((item) => item.imageId === image.id_imagen);
    if (index >= 0) setViewerIndex(index);
  }
  function openMarkViewer() {
    const index = viewerImages.findIndex((item) => item.key === 'fierro');
    if (index >= 0) setViewerIndex(index);
  }
  function openConditionAction(action: ConditionAction) {
    setConditionForm({ fecha_evento: currentDateInput(), id_grupo_actual: '', id_ubicacion_actual: '', observaciones: '' });
    setConditionPhoto(null);
    setConditionAction(action);
  }
  function openShare(){setShareOpen(true);setShareInfo(null);createShare.mutate();}
  async function copyShareLink(){if(!shareInfo)return;try{await navigator.clipboard.writeText(shareInfo.url);toast.show('Enlace copiado.');}catch{toast.show('No se pudo copiar el enlace.','error');}}
  async function shareAnimal(){
    if(!shareInfo)return;
    const title=`Ficha de ${animal.nombre}`;const text=`Mira la ficha de ${animal.nombre} en SGB.`;
    if(window.SGBAndroid?.shareText?.(title,text,shareInfo.url))return;
    if(navigator.share){try{await navigator.share({title,text,url:shareInfo.url});return;}catch(error){if((error as DOMException).name==='AbortError')return;}}
    await copyShareLink();
  }
  async function downloadFicha(format:'png'|'pdf'){
    setDownloading(format);
    try{await downloadAnimalFicha(animalFichaData(animal,profileUrl,gallery.find((image)=>image.tipo_archivo!=='VIDEO')?.secure_url??null,[user?.nombres,user?.apellidos].filter(Boolean).join(' ')||user?.correo||null),format);toast.show(`Ficha ${format.toUpperCase()} generada.`);setDownloadOpen(false);}
    catch(error){toast.show((error as Error).message,'error');}
    finally{setDownloading(null);}
  }
  function editMedia(image:AnimalImage){setMediaEdit({image,animalIds:image.animales?.map((item)=>item.id_animal)??[id],tagIds:image.etiquetas?.map((item)=>item.id_etiqueta)??[],date:(image.fecha_toma||image.created_at||currentDateInput()).slice(0,10)});}
  const preview=<T,>(key:string,items:T[])=>expandedHistories[key]?items:items.slice(0,3);
  const toggleHistory=(key:string)=>setExpandedHistories((current)=>({...current,[key]:!current[key]}));
  const childGaps=intervalMap(animal.crias_registradas??[],(item)=>item.id_animal,(item)=>item.fecha_nacimiento||item.fecha_parto);
  const previousChildren=previousItemMap(animal.crias_registradas??[],(item)=>item.id_animal,(item)=>item.fecha_nacimiento||item.fecha_parto,(item)=>item.nombre);
  const birthGaps=intervalMap(animal.historial_partos??[],(item)=>item.id_parto,(item)=>item.fecha);
  const historical=historicalLocation.data??historicalSnapshotFromAnimal(animal,historicalDate);
  const historicalReproduction=historical?.reproduccion;
  const movementAnimal={id_animal:animal.id_animal,codigo_arete:animal.codigo_arete,nombre:animal.nombre,sexo:animal.sexo,id_categoria_animal:animal.id_categoria_animal,categoria:animal.categoria??'',id_grupo_actual:animal.id_grupo_actual,grupo:animal.grupo,id_ubicacion_actual:animal.id_ubicacion_actual,ubicacion:animal.ubicacion,seleccionado:true};

  return <div className="animal-detail-page">
    <section className={`animal-social-cover ${currentGallery?'has-cover':''}`}>
      {currentGallery?<button type="button" className="animal-cover-media" onClick={()=>openGalleryViewer(currentGallery)}>{currentGallery.tipo_archivo==='VIDEO'?<video src={currentGallery.secure_url} muted preload="metadata"/>:<img src={currentGallery.secure_url} alt={animal.nombre}/>}</button>:<div className="animal-cover-placeholder"/>}
      <div className="animal-cover-shade"/>
      <div className="animal-cover-name"><h1>{animal.nombre}</h1>{animal.descripcion?<p>{animal.descripcion}</p>:null}</div>
      {gallery.length>1?<span className="animal-cover-counter">{galleryIndex+1}/{gallery.length}</span>:null}
      {currentGallery&&hasPermission('IMAGEN_ADMINISTRAR')?<IconButton className="animal-cover-edit" label="Editar relaciones y etiquetas de la portada" onClick={()=>editMedia(currentGallery)}><Edit3 size={18}/></IconButton>:null}
      <button className="animal-social-avatar" type="button" disabled={!profileUrl} onClick={openProfileViewer}>{profileUrl?<img src={profileUrl} alt={`Foto de perfil de ${animal.nombre}`}/>:<Beef size={48}/>}</button>
    </section>
    <div className="animal-profile-action-strip" aria-label="Acciones del animal">
      {hasPermission('IMAGEN_ADMINISTRAR')?<ProfileAction icon={Camera} label="Foto" onClick={()=>setPhotoChoice(true)}/>:null}
      {hasPermission('ANIMAL_MODIFICAR')?<ProfileAction icon={Edit3} label="Editar" onClick={()=>setEditing(true)}/>:null}
      {hasPermission('ANIMAL_MODIFICAR')?<ProfileAction icon={Share2} label="Compartir" onClick={openShare}/>:null}
      <ProfileAction icon={Download} label="Descargar ficha" onClick={()=>setDownloadOpen(true)}/>
      <ProfileAction icon={History} label="Perfil en una fecha" onClick={()=>setHistoricalOpen(true)}/>
      {isActive&&hasPermission('MOVIMIENTO_CREAR')?<ProfileAction icon={ArrowRightLeft} label="Movimiento" onClick={()=>openIfAllowed(availability.data?.movimiento,()=>setQuickAction('movement'))}/>:null}
      {isActive&&hasPermission('SANIDAD_ADMINISTRAR')?<ProfileAction icon={Syringe} label="Sanidad" onClick={()=>openIfAllowed(availability.data?.sanidad,()=>setQuickAction('health'))}/>:null}
      {isActive&&hasPermission('PESAJE_ADMINISTRAR')?<ProfileAction icon={Weight} label="Pesaje" onClick={()=>openIfAllowed(availability.data?.pesaje,()=>navigate(`/pesajes?animal=${animal.id_animal}&nuevo=1`))}/>:null}
      {hasPermission('PRODUCCION_CONSULTAR')&&productionActionVisible?<ProfileAction icon={Milk} label="Producción" onClick={()=>{const state=availability.data?.produccion;if(state&&!state.consultar&&!state.registrar){toast.show(state.motivo||'La producción no está habilitada para la propiedad actual.','error');return;}setQuickAction('production');}}/>:null}
      {(hasReproductionHistory||isActiveFemale)&&canConsultReproduction?<ProfileAction icon={Baby} label="Reproducción" onClick={()=>setQuickAction('reproduction')}/>:null}
      {isActive&&hasPermission('VENTA_CREAR')?<ProfileAction icon={ShoppingCart} label="Vender" onClick={()=>openIfAllowed(availability.data?.venta,()=>navigate(`/ventas?animal=${animal.id_animal}&nuevo=1`))}/>:null}
      {isActive&&hasPermission('MUERTE_CREAR')?<ProfileAction icon={HeartOff} label="Muerte" danger onClick={()=>openIfAllowed(availability.data?.muerte,()=>navigate(`/muertes?animal=${animal.id_animal}&nuevo=1`))}/>:null}
      {animal.estado==='ACTIVO'&&hasPermission('ANIMAL_MODIFICAR')?<ProfileAction icon={Search} label="Desaparecido" onClick={()=>openConditionAction('REPORTAR_DESAPARICION')}/>:null}
      {animal.estado==='INACTIVO'&&hasPermission('ANIMAL_MODIFICAR')?<ProfileAction icon={CheckCircle2} label="Reactivar" onClick={()=>openConditionAction('REACTIVAR')}/>:null}
      {animal.estado==='DESAPARECIDO'&&hasPermission('ANIMAL_MODIFICAR')?<ProfileAction icon={MapPin} label="Hallazgo" onClick={()=>openConditionAction('REGISTRAR_HALLAZGO')}/>:null}
      {hasPermission('ANIMAL_ELIMINAR')?<ProfileAction icon={Trash2} label="Eliminar" danger onClick={()=>setDeleting(true)}/>:null}
    </div>
    <input
      ref={fileRef}
      type="file"
      accept={filePurpose==='gallery'?'image/*,video/*':'image/*'}
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          if (filePurpose!=='gallery' && !file.type.startsWith('image/')) {
            toast.show('La foto seleccionada debe ser una imagen.', 'error');
            event.currentTarget.value = '';
            return;
          }
          setRelatedAnimalIds([id]);
          setUploadTags([]);
          setUploadDraft({ file, profile: filePurpose==='profile', purpose:filePurpose, previewUrl: URL.createObjectURL(file) });
        }
        event.currentTarget.value = '';
      }}
    />

    <Card className="animal-detail-summary-card animal-data-only-card">
      <div className="animal-summary-heading"><div><h2>Información</h2>{animal.codigo_arete?<p>Arete {animal.codigo_arete}</p>:null}</div><Badge tone={animal.estado==='ACTIVO'?'success':animal.estado==='MUERTO'?'danger':'warning'}>{animal.condicion||humanizeCode(animal.estado)}</Badge></div>
      <div className="animal-compact-info-grid">
        <CompactInfo icon={Beef} label="Especie / sexo" value={`${animal.especie} · ${animal.sexo==='HEMBRA'?'Hembra':'Macho'}`}/>
        {animal.grupo?<CompactInfo icon={Users} label="Grupo" value={animal.grupo}/>:null}
        {animal.ubicacion?<CompactInfo icon={MapPin} label="Ubicación actual" value={animal.ubicacion}/>:null}
        {animal.categoria?<CompactInfo icon={Tag} label="Categoría" value={animal.categoria}/>:null}
        {animal.clasificacion_codigo&&animal.clasificacion_codigo!=='SIN_CLASIFICAR'?<CompactInfo icon={Beef} label="Clasificación" value={humanizeCode(animal.clasificacion_codigo)}/>:null}
        {animal.origen?<CompactInfo icon={MapPin} label="Origen" value={animal.origen}/>:null}
        {animal.ultimo_pesaje?<CompactInfo icon={Weight} label="Último peso" value={`${formatNumber(animal.ultimo_pesaje.peso_kg)} kg · ${formatDate(animal.ultimo_pesaje.fecha)}`}/>:null}
        {animal.propietarios?.length?<CompactInfo icon={UserRound} label="Propietario(s)" value={ownerText} wide/>:null}
        {animal.fecha_nacimiento?<><CompactInfo icon={CalendarDays} label="Nacimiento" value={formatDate(animal.fecha_nacimiento)}/><CompactInfo icon={CalendarDays} label="Edad" value={formatAge(animal.fecha_nacimiento)}/></>:null}
        {animal.marquilla?<CompactInfo icon={Tag} label="Fierro" value={<span className="animal-mark-inline"><span>{animal.marquilla_codigo||animal.marquilla}</span>{animal.marquilla_foto?<button type="button" className="animal-mark-thumb" onClick={openMarkViewer} aria-label="Ver imagen del fierro"><img src={animal.marquilla_foto} alt="Fierro"/></button>:null}</span>}/>:null}
        {animal.madre||animal.padre?<CompactInfo icon={UserRound} label="Padres" value={[animal.madre?`Madre: ${animal.madre}`:null,animal.padre?`Padre: ${animal.padre}`:null].filter(Boolean).join(' · ')} wide/>:null}
        {lastTreatment?<CompactInfo icon={Syringe} label="Último tratamiento" value={treatmentText} wide/>:null}
        {lastMovement?<CompactInfo icon={ArrowRightLeft} label="Último traslado" value={movementText} wide/>:null}
      </div>
      {animal.razas?.length||animal.colores?.length?<div className="animal-compact-tags">{animal.razas?.length?<span><strong>Razas:</strong> {animal.razas.map((item)=>`${item.nombre}${item.porcentaje!=null?` ${item.porcentaje}%`:''}`).join(', ')}</span>:null}{animal.colores?.length?<span><strong>Colores:</strong> {animal.colores.map((item)=>item.nombre).join(', ')}</span>:null}</div>:null}
    </Card>

    <div className="animal-profile-history-grid">
      {animal.crias_registradas?.length?<HistoryPreview title="Crías" icon={Baby} count={animal.crias_registradas.length} expanded={expandedHistories.crias} onToggle={()=>toggleHistory('crias')}><div className="history-stack">{preview('crias',animal.crias_registradas).map((child)=><button type="button" className="history-entry history-entry-link" key={`${child.id_parto}-${child.id_animal}`} onClick={()=>navigate(`/animales/${child.id_animal}`)}><span><strong>{child.nombre}{child.fecha_nacimiento?` · ${formatDate(child.fecha_nacimiento)}`:''}</strong><small>{[child.codigo_arete?`Arete ${child.codigo_arete}`:null,child.sexo==='HEMBRA'?'Hembra':'Macho',childGaps.get(child.id_animal)?`${childGaps.get(child.id_animal)?.replaceAll(',','')} desde cría anterior (${previousChildren.get(child.id_animal)})`:null].filter(Boolean).join(' · ')}</small></span><ChevronRight size={18}/></button>)}</div></HistoryPreview>:null}
      {animal.historial_partos?.length?<HistoryPreview title="Partos" icon={CalendarDays} count={animal.historial_partos.length} expanded={expandedHistories.partos} onToggle={()=>toggleHistory('partos')} onOpenAll={()=>navigate(`/partos?animal=${animal.id_animal}&tab=births`)}><div className="history-stack">{preview('partos',animal.historial_partos).map((birth)=><button type="button" className="history-entry history-entry-link" key={birth.id_parto} onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=births&parto=${birth.id_parto}`)}><span><strong>{birth.rol==='MADRE'?`Padre: ${birth.contraparte||'no registrado'}`:`Madre: ${birth.contraparte||'no registrada'}`} · {humanizeCode(birth.tipo)}</strong><small>{[birth.crias?.length?`Cría${birth.crias.length===1?'':'s'}: ${birth.crias.map((child)=>child.nombre).join(', ')}`:`${birth.total_crias} cría${birth.total_crias===1?'':'s'}`,birthGaps.get(birth.id_parto)?`${birthGaps.get(birth.id_parto)} desde el parto anterior`:null].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(birth.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_celos?.length?<HistoryPreview title="Celos" icon={HeartPulse} count={animal.historial_celos.length} expanded={expandedHistories.celos} onToggle={()=>toggleHistory('celos')} onOpenAll={()=>navigate(`/partos?animal=${animal.id_animal}&tab=heats`)}><div className="history-stack">{preview('celos',animal.historial_celos).map((heat)=><button type="button" className="history-entry history-entry-link" key={heat.id_celo} onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=heats&celo=${heat.id_celo}`)}><span><strong>{heat.rol==='VACA'?'Celo registrado':'Relacionado con celo'}</strong><small>{[heat.contraparte?`Con ${heat.contraparte}`:null,heat.fecha_fin?`Finalizó ${formatDate(heat.fecha_fin)}`:null,heat.observaciones].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(heat.fecha_inicio)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_preneces?.length?<HistoryPreview title="Preñeces" icon={HeartPulse} count={animal.historial_preneces.length} expanded={expandedHistories.preneces} onToggle={()=>toggleHistory('preneces')} onOpenAll={()=>navigate(`/partos?animal=${animal.id_animal}&tab=pregnancies`)}><div className="history-stack">{preview('preneces',animal.historial_preneces).map((pregnancy)=><button type="button" className="history-entry history-entry-link" key={pregnancy.id_prenez} onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=pregnancies&prenez=${pregnancy.id_prenez}`)}><span><strong>{humanizeCode(pregnancy.estado)}</strong><small>{[humanizeCode(pregnancy.metodo),pregnancy.contraparte?`Con ${pregnancy.contraparte}`:pregnancy.rol==='PADRE'?'Como padre':null,pregnancy.fecha_parto_tentativa?`Parto tentativo ${formatDate(pregnancy.fecha_parto_tentativa)}`:null].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(pregnancy.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_abortos?.length?<HistoryPreview title="Abortos" icon={HeartCrack} count={animal.historial_abortos.length} expanded={expandedHistories.abortos} onToggle={()=>toggleHistory('abortos')} onOpenAll={()=>navigate(`/partos?animal=${animal.id_animal}&tab=abortions`)}><div className="history-stack">{preview('abortos',animal.historial_abortos).map((abortion)=><button type="button" className="history-entry history-entry-link" key={abortion.id_aborto} onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=abortions&aborto=${abortion.id_aborto}`)}><span><strong>{abortion.causa||'Aborto registrado'}</strong><small>{[abortion.meses_gestacion!=null?`${formatNumber(abortion.meses_gestacion,1)} meses de gestación`:null,abortion.descripcion,abortion.id_prenez?'Con preñez relacionada':null].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(abortion.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_produccion?.length?<HistoryPreview title="Producción" icon={Milk} count={animal.historial_produccion.length} expanded={expandedHistories.produccion} onToggle={()=>toggleHistory('produccion')} onOpenAll={()=>navigate(`/produccion?animal=${animal.id_animal}`)}><div className="history-stack">{preview('produccion',animal.historial_produccion).map((production)=><button type="button" className="history-entry history-entry-link" key={production.id_produccion} onClick={()=>navigate(`/produccion?animal=${animal.id_animal}&registro=${production.id_produccion}`)}><span><strong>{formatNumber(production.litros,3)} L</strong><small>{[production.turno?humanizeCode(production.turno):null,production.fuente].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(production.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_pesajes?.length?<HistoryPreview title="Pesajes" icon={Weight} count={animal.historial_pesajes.length} expanded={expandedHistories.pesajes} onToggle={()=>toggleHistory('pesajes')} onOpenAll={()=>navigate(`/pesajes?animal=${animal.id_animal}`)}><div className="history-stack">{preview('pesajes',animal.historial_pesajes).map((weighing)=><button type="button" className="history-entry history-entry-link" key={weighing.id_pesaje} onClick={()=>navigate(`/pesajes?animal=${animal.id_animal}&registro=${weighing.id_pesaje}`)}><span><strong>{formatNumber(weighing.peso_kg,3)} kg</strong><small>{[weighing.metodo,weighing.observaciones].filter(Boolean).join(' · ')||'Sin detalles adicionales'}</small></span><strong>{formatDate(weighing.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_movimientos?.length?<HistoryPreview title="Traslados" icon={ArrowRightLeft} count={animal.historial_movimientos.length} expanded={expandedHistories.traslados} onToggle={()=>toggleHistory('traslados')} onOpenAll={()=>navigate(`/movimientos?animal=${animal.id_animal}`)}><div className="history-stack">{preview('traslados',animal.historial_movimientos).map((movement)=><button type="button" className="history-entry history-entry-link" key={movement.id_movimiento} onClick={()=>navigate(`/movimientos?animal=${animal.id_animal}&movimiento=${movement.id_movimiento}`)}><span><strong>{movement.motivo||humanizeCode(movement.tipo)}</strong><small>{movementPlace(movement.tipo,movement.grupo_origen,movement.ubicacion_origen)} → {movementPlace(movement.tipo,movement.grupo_destino,movement.ubicacion_destino)}</small></span><strong>{formatDate(movement.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_servicios_reproductivos?.length?<HistoryPreview title="Reproducción asistida" icon={Syringe} count={animal.historial_servicios_reproductivos.length} expanded={expandedHistories.servicios} onToggle={()=>toggleHistory('servicios')} onOpenAll={()=>navigate(`/partos?animal=${animal.id_animal}&tab=services`)}><div className="history-stack">{preview('servicios',animal.historial_servicios_reproductivos).map((service)=><button type="button" className="history-entry history-entry-link" key={service.id_servicio_reproductivo} onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=services`)}><span><strong>{humanizeCode(service.tipo)}</strong><small>{[service.rol!=='RECEPTORA'?`Receptora: ${service.receptora}`:null,service.padre?`Padre: ${service.padre}`:null,service.donante?`Donante: ${service.donante}`:null,service.codigo_material?`Material: ${service.codigo_material}`:null].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(service.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.historial_tratamientos?.length?<HistoryPreview title="Tratamientos y salud" icon={Syringe} count={animal.historial_tratamientos.length} expanded={expandedHistories.salud} onToggle={()=>toggleHistory('salud')} onOpenAll={()=>navigate(`/sanidad?animal=${animal.id_animal}`)}><div className="history-stack">{preview('salud',animal.historial_tratamientos).map((treatment)=><button type="button" className="history-entry history-entry-link" key={treatment.id_tratamiento} onClick={()=>navigate(`/sanidad?animal=${animal.id_animal}&tratamiento=${treatment.id_tratamiento}`)}><span><strong>{treatment.tipo} · {treatment.medicamento}</strong><small>{[`${formatNumber(treatment.dosis)} ${treatment.unidad??''}`.trim(),treatment.via,treatment.observaciones].filter(Boolean).join(' · ')}</small></span><strong>{formatDate(treatment.fecha)}</strong></button>)}</div></HistoryPreview>:null}
      {animal.eventos_condicion?.length?<HistoryPreview title="Condiciones y novedades" icon={Activity} count={animal.eventos_condicion.length} expanded={expandedHistories.condiciones} onToggle={()=>toggleHistory('condiciones')}><div className="history-stack">{preview('condiciones',animal.eventos_condicion).map((event)=><div className="history-entry" key={event.id_evento}><span><strong>{humanizeCode(event.tipo_evento)}</strong><small>{[event.ubicacion,event.grupo,event.observaciones].filter(Boolean).join(' · ')||`${humanizeCode(event.estado_anterior)} → ${humanizeCode(event.estado_nuevo)}`}</small></span><strong>{formatDate(event.fecha_evento)}</strong></div>)}</div></HistoryPreview>:null}
    </div>

    {hasPermission('IMAGEN_ADMINISTRAR')?<div className="animal-cover-add"><Button variant="secondary" onClick={()=>chooseFile('gallery')}><ImagePlus size={18}/>Agregar foto o video</Button></div>:null}

    {viewerIndex!==null?<ImageLightbox
      items={viewerImages.map((image)=>({key:image.key,url:image.url,type:image.type,title:image.title,subtitle:image.subtitle,date:image.createdAt}))}
      initialIndex={viewerIndex}
      onClose={()=>setViewerIndex(null)}
      minimalControls
      actions={(media)=>{const image=viewerImages.find((item)=>item.key===media.key);const original=gallery.find((item)=>item.id_imagen===image?.imageId);return hasPermission('IMAGEN_ADMINISTRAR')&&image?.imageId?<div className="lightbox-actions">{original?<IconButton label="Editar relaciones y etiquetas" onClick={()=>{setViewerIndex(null);editMedia(original);}}><Edit3 size={18}/></IconButton>:null}{!image.isProfile&&image.type==='IMAGEN'?<IconButton label="Usar como foto de perfil" onClick={()=>imageAction.mutate({imageId:image.imageId!,action:'profile'})}><Star size={18}/></IconButton>:null}<IconButton className="detail-action-danger" label="Eliminar fotografía" onClick={()=>imageAction.mutate({imageId:image.imageId!,action:'delete'})}><Trash2 size={18}/></IconButton></div>:null;}}
    />:null}

    {photoChoice?<Modal title="Actualizar fotografía" onClose={()=>setPhotoChoice(false)}><div className="animal-photo-choice"><button type="button" onClick={()=>chooseFile('profile')}><Camera size={25}/><span><strong>Foto de perfil</strong><small>Solo identifica a este animal.</small></span></button><button type="button" onClick={()=>chooseFile('cover')}><ImagePlus size={25}/><span><strong>Foto de portada</strong><small>Permite etiquetas y relacionar otros animales.</small></span></button></div></Modal>:null}

    {quickAction==='movement'?<Modal title={`Movimiento de ${animal.nombre}`} onClose={()=>setQuickAction(null)}><div className="profile-quick-action-list"><button type="button" onClick={()=>navigate('/movimientos',{state:{initialAnimal:movementAnimal,initialKind:'GRUPO'}})}><Users size={21}/><span><strong>Cambiar de grupo</strong><small>{animal.nombre} quedará seleccionado automáticamente.</small></span><ChevronRight size={18}/></button><button type="button" onClick={()=>navigate('/movimientos',{state:{initialAnimal:movementAnimal,initialKind:'PROPIEDAD'}})}><MapPin size={21}/><span><strong>Cambiar de propiedad</strong><small>{animal.nombre} quedará seleccionado automáticamente.</small></span><ChevronRight size={18}/></button>{animal.id_grupo_actual?<button type="button" onClick={()=>navigate('/movimientos',{state:{initialAnimal:movementAnimal,initialKind:'UBICACION',initialGroupId:animal.id_grupo_actual}})}><ArrowRightLeft size={21}/><span><strong>Rotación de potrero</strong><small>Se trasladará todo el grupo {animal.grupo||'actual'}.</small></span><ChevronRight size={18}/></button>:null}</div></Modal>:null}
    {quickAction==='health'?<Modal title={`Sanidad de ${animal.nombre}`} onClose={()=>setQuickAction(null)}><div className="profile-quick-action-list"><button type="button" onClick={()=>navigate(`/sanidad?animal=${animal.id_animal}&nuevo=1&modo=preventivo`)}><Syringe size={21}/><span><strong>Aplicar tratamiento preventivo</strong><small>Vacunas, vitaminas u otro manejo sin condición relacionada.</small></span><ChevronRight size={18}/></button>{animal.condiciones_salud_activas?.map((condition)=><button type="button" key={condition.id_condicion_salud} onClick={()=>navigate(`/sanidad?animal=${animal.id_animal}&nuevo=1&condicion=${condition.id_condicion_salud}`)}><Stethoscope size={21}/><span><strong>Tratar {condition.tipo||'condición de salud'}</strong><small>{condition.descripcion}</small></span><ChevronRight size={18}/></button>)}<button type="button" onClick={()=>navigate(`/sanidad?animal=${animal.id_animal}&nuevo=condicion`)}><HeartPulse size={21}/><span><strong>Crear condición de salud</strong><small>Registrar una enfermedad, lesión o problema detectado.</small></span><ChevronRight size={18}/></button></div></Modal>:null}
    {quickAction==='production'?<Modal title={`Producción de ${animal.nombre}`} onClose={()=>setQuickAction(null)}><div className="profile-quick-action-list">{hasProductionHistory?<button type="button" onClick={()=>navigate(`/produccion?animal=${animal.id_animal}`)}><History size={21}/><span><strong>Ver producción</strong><small>Consultar únicamente los registros y lactancias de {animal.nombre}.</small></span><ChevronRight size={18}/></button>:null}{productionCanRegister&&hasPermission('PRODUCCION_ADMINISTRAR')?<button type="button" onClick={()=>navigate(`/produccion?animal=${animal.id_animal}&nuevo=1`)}><Milk size={21}/><span><strong>Registrar producción</strong><small>{animal.nombre} quedará seleccionada automáticamente.</small></span><ChevronRight size={18}/></button>:null}{!hasProductionHistory&&!(productionCanRegister&&hasPermission('PRODUCCION_ADMINISTRAR'))?<p className="muted">{availability.data?.produccion?.motivo||'No hay acciones de producción disponibles para este animal.'}</p>:null}</div></Modal>:null}
    {quickAction==='reproduction'?<Modal title={`Reproducción de ${animal.nombre}`} onClose={()=>setQuickAction(null)}><div className="profile-quick-action-list">{hasReproductionHistory?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=${activePregnancy?'pregnancies':'heats'}`)}><History size={21}/><span><strong>Ver historial reproductivo</strong><small>Mostrar solo los eventos relacionados con {animal.nombre}.</small></span><ChevronRight size={18}/></button>:null}{canHeat?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=heats&nuevo=celo`)}><HeartPulse size={21}/><span><strong>Registrar celo</strong><small>{availability.data?.celo?.solo_falso?'Solo puede registrarse como celo falso o aparente.':'Registrar el celo de este animal.'}</small></span><ChevronRight size={18}/></button>:null}{canInseminate?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=services&nuevo=inseminacion`)}><Syringe size={21}/><span><strong>Registrar inseminación</strong><small>Identifica pajilla, padre, técnico y proveedor.</small></span><ChevronRight size={18}/></button>:null}{canImplantEmbryo?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=services&nuevo=embrion`)}><Baby size={21}/><span><strong>Implantar embrión</strong><small>Registra receptora, padre, donante y material.</small></span><ChevronRight size={18}/></button>:null}{canConfirmPregnancy?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=pregnancies&nuevo=prenez`)}><CheckCircle2 size={21}/><span><strong>Confirmar preñez</strong><small>Disponible porque no tiene una preñez confirmada activa.</small></span><ChevronRight size={18}/></button>:null}{canRegisterBirth?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=births&nuevo=parto`)}><Baby size={21}/><span><strong>Registrar parto</strong><small>Disponible por la preñez confirmada actual.</small></span><ChevronRight size={18}/></button>:null}{canRegisterAbortion?<button type="button" onClick={()=>navigate(`/partos?animal=${animal.id_animal}&tab=abortions&nuevo=aborto`)}><HeartCrack size={21}/><span><strong>Registrar aborto</strong><small>Finaliza la preñez confirmada actual.</small></span><ChevronRight size={18}/></button>:null}{!hasReproductionHistory&&!reproductionCanAct?<p className="muted">{availability.data?.celo?.motivo||'No hay acciones reproductivas disponibles para este animal.'}</p>:null}</div></Modal>:null}

    {uploadDraft ? <Modal
      title={uploadDraft.purpose==='profile' ? 'Cambiar foto de perfil' : uploadDraft.purpose==='cover'?'Cambiar foto de portada':'Agregar foto o video'}
      onClose={() => setUploadDraft(null)}
      footer={<>
        <Button variant="ghost" onClick={() => setUploadDraft(null)}>Cancelar</Button>
        <Button disabled={!uploadDraft.profile&&!relatedAnimalIds.length} loading={upload.isPending} onClick={() => upload.mutate({ file: uploadDraft.file, profile: uploadDraft.profile, animalIds: uploadDraft.profile?[id]:relatedAnimalIds,tagIds:uploadTags })}>Subir archivo</Button>
      </>}
    >
      <div className="animal-upload-dialog">
        {uploadDraft.file.type.startsWith('video/')?<video src={uploadDraft.previewUrl} controls/>:<img src={uploadDraft.previewUrl} alt="Vista previa del archivo" />}
      </div>
      {!uploadDraft.profile?<MediaTagPicker value={uploadTags} onChange={setUploadTags} tags={mediaTags.data??[]}/>:null}
      {!uploadDraft.profile?<Field label="Animales relacionados" required hint="El archivo aparecerá en la ficha de todos los animales marcados."><AnimalMultiPicker value={relatedAnimalIds} onChange={setRelatedAnimalIds}/></Field>:null}
    </Modal> : null}

    {mediaEdit?<Modal title="Editar foto de portada" wide onClose={()=>setMediaEdit(null)} footer={<><Button variant="ghost" onClick={()=>setMediaEdit(null)}>Cancelar</Button><Button disabled={!mediaEdit.animalIds.length} loading={updateMedia.isPending} onClick={()=>updateMedia.mutate()}>Guardar cambios</Button></>}><div className="form-stack"><div className="animal-upload-dialog">{mediaEdit.image.tipo_archivo==='VIDEO'?<video src={mediaEdit.image.secure_url} controls/>:<img src={mediaEdit.image.secure_url} alt="Portada"/>}</div><Field label="Fecha de toma"><Input type="date" value={mediaEdit.date} onChange={(event)=>setMediaEdit({...mediaEdit,date:event.target.value})}/></Field><MediaTagPicker value={mediaEdit.tagIds} onChange={(tagIds)=>setMediaEdit({...mediaEdit,tagIds})} tags={mediaTags.data??[]}/><Field label="Animales relacionados" required><AnimalMultiPicker value={mediaEdit.animalIds} onChange={(animalIds)=>setMediaEdit({...mediaEdit,animalIds})}/></Field></div></Modal>:null}

    {historicalOpen?<Modal title={`Perfil de ${animal.nombre} en una fecha`} wide onClose={()=>setHistoricalOpen(false)} footer={<Button variant="ghost" onClick={()=>setHistoricalOpen(false)}>Cerrar</Button>}>
      <div className="form-stack">
        <Field label="Fecha a consultar"><Input type="date" max={currentDateInput()} value={historicalDate} onChange={(event)=>setHistoricalDate(event.target.value)}/></Field>
        {historicalLocation.isLoading?<LoadingState text="Reconstruyendo el perfil…"/>:historical?<>
          {historicalLocation.isError?<div className="form-alert">Sin conexión: se muestra la información que puede reconstruirse con los datos descargados.</div>:null}
          {historical.encontrado?<Card className="animal-data-only-card">
            <div className="animal-summary-heading"><div><h2>{formatDate(historical.fecha)}</h2><p>Evolución e información conocida hasta esa fecha</p></div><Badge tone={historical.estado==='ACTIVO'?'success':'warning'}>{humanizeCode(historical.estado||'SIN DATO')}</Badge></div>
            <div className="animal-compact-info-grid">
              <CompactInfo icon={Beef} label="Especie y sexo" value={`${animal.especie} · ${animal.sexo==='HEMBRA'?'Hembra':'Macho'}`}/>
              <CompactInfo icon={CalendarDays} label="Edad en esa fecha" value={animal.fecha_nacimiento?formatAge(animal.fecha_nacimiento,new Date(`${historical.fecha}T12:00:00`)):'Sin fecha de nacimiento'}/>
              <CompactInfo icon={Tag} label="Raza" value={animal.razas?.map((item)=>item.nombre).join(', ')||'Sin registrar'}/>
              <CompactInfo icon={Tag} label="Color" value={animal.colores?.map((item)=>item.nombre).join(', ')||'Sin registrar'}/>
              <CompactInfo icon={UserRound} label="Padres" value={[animal.madre?`Madre: ${animal.madre}`:null,animal.padre?`Padre: ${animal.padre}`:null].filter(Boolean).join(' · ')||'Sin registrar'} wide/>
              <CompactInfo icon={MapPin} label="Propiedad" value={historical.propiedad||'Sin dato registrado'}/>
              <CompactInfo icon={MapPin} label="Potrero o ubicación" value={historical.ubicacion||'Sin ubicación registrada'}/>
              <CompactInfo icon={Users} label="Grupo" value={historical.grupo||'Sin grupo registrado'}/>
              <CompactInfo icon={Weight} label="Último peso conocido" value={historical.ultimo_pesaje?`${formatNumber(historical.ultimo_pesaje.peso_kg)} kg · ${formatDate(historical.ultimo_pesaje.fecha)}`:'Sin pesajes hasta la fecha'}/>
              <CompactInfo icon={Syringe} label="Último tratamiento" value={historical.ultimo_tratamiento?`${historical.ultimo_tratamiento.tipo} · ${historical.ultimo_tratamiento.medicamento} · ${formatDate(historical.ultimo_tratamiento.fecha)}`:'Sin tratamientos hasta la fecha'} wide/>
              <CompactInfo icon={HeartPulse} label="Reproducción" value={historicalReproduction?.prenez?`Preñez confirmada${historicalReproduction.prenez.fecha_parto_tentativa?` · parto tentativo ${formatDate(historicalReproduction.prenez.fecha_parto_tentativa)}`:''}`:historicalReproduction?.ultimo_parto?`Último parto ${formatDate(historicalReproduction.ultimo_parto.fecha)} · ${historicalReproduction.ultimo_parto.total_crias} cría${historicalReproduction.ultimo_parto.total_crias===1?'':'s'}`:historicalReproduction?.ultimo_celo?`${historicalReproduction.ultimo_celo.es_falso?'Celo falso':'Último celo'} · ${formatDate(historicalReproduction.ultimo_celo.fecha)}`:'Sin eventos reproductivos hasta la fecha'} wide/>
              <CompactInfo icon={Milk} label="Producción del día" value={`${formatNumber(historical.produccion_dia??0,3)} L · ${historical.registros_produccion??0} registro${(historical.registros_produccion??0)===1?'':'s'}`}/>
              <CompactInfo icon={CalendarDays} label="Lactancia" value={historical.lactancia?`${historical.lactancia.activa?'Activa':'Finalizada'} · desde ${formatDate(historical.lactancia.fecha_inicio)}`:'Sin lactancia registrada'}/>
            </div>
          </Card>:<div className="form-alert">El animal todavía no constaba en SGB en esta fecha. No se mostrarán datos actuales como si fueran históricos.</div>}
        </>:<div className="form-alert">No hay información descargada para reconstruir el perfil en esa fecha.</div>}
      </div>
    </Modal>:null}

    {shareOpen?<Modal title={`Compartir a ${animal.nombre}`} onClose={()=>setShareOpen(false)} footer={<Button variant="ghost" onClick={()=>setShareOpen(false)}>Cerrar</Button>}>
      {createShare.isPending?<LoadingState text="Creando enlace seguro…"/>:shareInfo?<div className="animal-share-dialog"><div className="form-alert">Quien tenga este enlace podrá ver la ficha básica sin iniciar sesión. No se mostrarán movimientos, potreros, grupos, propietarios ni tratamientos.</div><Field label="Enlace público"><div className="share-link-field"><Input value={shareInfo.url} readOnly/><IconButton label="Copiar enlace" onClick={()=>void copyShareLink()}><Copy size={18}/></IconButton></div></Field><div className="share-dialog-actions"><Button onClick={()=>void shareAnimal()}><Share2 size={17}/>Compartir por aplicaciones</Button><Button variant="secondary" onClick={()=>void copyShareLink()}><Copy size={17}/>Copiar enlace</Button></div><Button variant="danger" loading={revokeShare.isPending} onClick={()=>revokeShare.mutate()}>Desactivar enlace público</Button></div>:<ErrorState message="No se pudo preparar el enlace." onRetry={()=>createShare.mutate()}/>} 
    </Modal>:null}

    {downloadOpen?<Modal title="Descargar ficha del animal" onClose={()=>setDownloadOpen(false)} footer={<Button variant="ghost" onClick={()=>setDownloadOpen(false)}>Cancelar</Button>}><div className="animal-ficha-options"><p>La ficha incluye la foto de perfil, la última foto de portada, identificación, edad, raza, colores, peso, padres y resumen reproductivo.</p><button type="button" disabled={Boolean(downloading)} onClick={()=>void downloadFicha('png')}><FileImage size={28}/><span><strong>Imagen PNG</strong><small>Ideal para enviar por WhatsApp o redes sociales.</small></span>{downloading==='png'?<span className="spin">↻</span>:null}</button><button type="button" disabled={Boolean(downloading)} onClick={()=>void downloadFicha('pdf')}><FileText size={28}/><span><strong>Documento PDF</strong><small>Ideal para imprimir, archivar o enviar formalmente.</small></span>{downloading==='pdf'?<span className="spin">↻</span>:null}</button></div></Modal>:null}

    {editing ? <AnimalFormModal animal={animal} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void query.refetch(); }} /> : null}
    {conditionAction ? <Modal
      title={conditionAction === 'DESACTIVAR' ? 'Desactivar animal' : conditionAction === 'REACTIVAR' ? 'Reactivar animal' : conditionAction === 'REPORTAR_DESAPARICION' ? 'Reportar desaparición' : 'Registrar hallazgo'}
      onClose={() => setConditionAction(null)}
      footer={<><Button variant="ghost" onClick={() => setConditionAction(null)}>Cancelar</Button><Button onClick={() => conditionMutation.mutate()} loading={conditionMutation.isPending}>{conditionAction === 'REGISTRAR_HALLAZGO' ? 'Registrar hallazgo' : 'Confirmar'}</Button></>}
    >
      <div className="form-stack">
        <div className="form-alert">
          {conditionAction === 'DESACTIVAR' ? 'El animal dejará de estar disponible para movimientos, ventas, sanidad y reproducción.' : null}
          {conditionAction === 'REACTIVAR' ? 'El animal volverá a estar disponible para las operaciones del sistema.' : null}
          {conditionAction === 'REPORTAR_DESAPARICION' ? 'Se cerrará su ubicación y grupo actuales hasta que se registre el hallazgo.' : null}
          {conditionAction === 'REGISTRAR_HALLAZGO' ? 'El animal volverá a estado activo. Puedes indicar dónde fue encontrado y el grupo al que se reincorpora.' : null}
        </div>
        <Field label="Fecha" required><Input type="date" value={conditionForm.fecha_evento} onChange={(event) => setConditionForm((current) => ({ ...current, fecha_evento: event.target.value }))} /></Field>
        {conditionAction === 'REGISTRAR_HALLAZGO' ? <div className="form-grid">
          <Field label="Ubicación del hallazgo"><Select value={conditionForm.id_ubicacion_actual} onChange={(event) => setConditionForm((current) => ({ ...current, id_ubicacion_actual: event.target.value, id_grupo_actual: '' }))}><option value="">Sin ubicación específica</option>{locations.data?.filter((item) => item.activo).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {item.categoria}</option>)}</Select></Field>
          <Field label="Grupo al reincorporarse"><Select value={conditionForm.id_grupo_actual} onChange={(event) => setConditionForm((current) => ({ ...current, id_grupo_actual: event.target.value }))}><option value="">Sin grupo</option>{groups.data?.filter((item) => item.activo && (!hallazgoCategoryId || item.id_categoria_animal === hallazgoCategoryId)).map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre} · {item.categoria}</option>)}</Select></Field>
        </div> : null}
        {conditionAction==='REGISTRAR_HALLAZGO'?<Field label="Fotografía de la recuperación" hint="Opcional. Se admite una sola imagen."><label className="photo-upload-button"><ImagePlus size={18}/>{conditionPhoto?'Cambiar fotografía':'Seleccionar fotografía'}<input type="file" accept="image/*" onChange={(event)=>{setConditionPhoto(event.target.files?.[0]??null);event.currentTarget.value='';}}/></label>{conditionPhoto?<small>{conditionPhoto.name}</small>:null}</Field>:null}
        <Field label="Motivo u observaciones"><Textarea rows={3} value={conditionForm.observaciones} onChange={(event) => setConditionForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field>
      </div>
    </Modal> : null}
    {deleting ? <ConfirmDialog title="Eliminar animal" message={`¿Seguro que deseas eliminar a ${animal.nombre}? El registro se desactivará, pero su historial permanecerá.`} onClose={() => setDeleting(false)} loading={deleteAnimal.isPending} onConfirm={() => deleteAnimal.mutate()} /> : null}
  </div>;
}

function movementPlace(type:string,group:string|null|undefined,location:string|null|undefined){
  if(type==='UBICACION')return location||'Sin potrero registrado';
  if(group&&location)return `${group} (${location})`;
  return group||location||'Sin origen registrado';
}

function animalFichaData(animal:Animal,profileUrl:string|null,coverUrl:string|null,generatedBy:string|null):AnimalFichaData{return{
  nombre:animal.nombre,codigoArete:animal.codigo_arete,descripcion:animal.descripcion,fotoPerfil:profileUrl,fotoPortada:coverUrl,
  especie:animal.especie,sexo:animal.sexo,fechaNacimiento:animal.fecha_nacimiento,estado:animal.estado,origen:animal.origen,
  razas:animal.razas,colores:animal.colores,peso:animal.ultimo_pesaje??null,madre:animal.madre,padre:animal.padre,
  totalPartos:animal.total_partos,totalCrias:animal.total_crias,
  prenezConfirmada:Boolean(animal.historial_preneces?.some((item)=>item.rol==='VACA'&&item.estado==='CONFIRMADA')),
  marquilla:animal.marquilla_codigo||animal.marquilla,
  generatedBy,
};}

function CompactInfo({ icon: Icon, label, value, wide = false }: { icon: LucideIcon; label: string; value: ReactNode; wide?: boolean }) {
  return <div className={`animal-compact-info ${wide ? 'animal-compact-info-wide' : ''}`}><Icon size={17} /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function ProfileAction({icon:Icon,label,onClick,danger=false}:{icon:LucideIcon;label:string;onClick:()=>void;danger?:boolean}){
  return <button type="button" aria-label={label} title={label} className={danger?'profile-action danger':'profile-action'} onClick={onClick}><span><Icon size={21}/></span><small>{label}</small></button>;
}

function intervalMap<T>(items:T[],id:(item:T)=>string,date:(item:T)=>string|null|undefined){
  const ordered=items.map((item)=>({item,value:date(item)})).filter((entry):entry is {item:T;value:string}=>Boolean(entry.value&&!Number.isNaN(Date.parse(entry.value)))).sort((a,b)=>Date.parse(a.value)-Date.parse(b.value));
  const result=new Map<string,string>();
  for(let index=1;index<ordered.length;index+=1){const days=Math.max(0,Math.round((Date.parse(ordered[index].value)-Date.parse(ordered[index-1].value))/86400000));const years=Math.floor(days/365);const months=Math.floor((days%365)/30);const rest=days-years*365-months*30;const label=[years?`${years} año${years===1?'':'s'}`:null,months?`${months} mes${months===1?'':'es'}`:null,!years&&!months?`${rest} día${rest===1?'':'s'}`:null].filter(Boolean).join(', ');result.set(id(ordered[index].item),label);}
  return result;
}

function previousItemMap<T>(items:T[],id:(item:T)=>string,date:(item:T)=>string|null|undefined,label:(item:T)=>string){
  const ordered=items.map((item)=>({item,value:date(item)})).filter((entry):entry is {item:T;value:string}=>Boolean(entry.value&&!Number.isNaN(Date.parse(entry.value)))).sort((a,b)=>Date.parse(a.value)-Date.parse(b.value));
  const result=new Map<string,string>();
  for(let index=1;index<ordered.length;index+=1)result.set(id(ordered[index].item),label(ordered[index-1].item));
  return result;
}

function historicalSnapshotFromAnimal(animal:Animal,date:string):AnimalHistoricalLocation|null{
  if(!date)return null;
  const createdDate=animal.created_at?.slice(0,10)??null;
  if(createdDate&&date<createdDate)return {fecha:date,encontrado:false,propiedad:null,id_propiedad:null,ubicacion:null,id_ubicacion:null,tipo_ubicacion:null,grupo:null,id_grupo:null,periodo_ubicacion:null,periodo_grupo:null,estado:null,ultimo_pesaje:null,ultimo_tratamiento:null,reproduccion:{ultimo_celo:null,prenez:null,ultimo_parto:null,ultimo_aborto:null,total_partos:0},lactancia:null,produccion_dia:0,registros_produccion:0,total_tratamientos:0};
  const onOrBefore=(value:string|null|undefined)=>Boolean(value&&value.slice(0,10)<=date);
  const latest=<T,>(items:T[],getDate:(item:T)=>string|null|undefined)=>items.filter((item)=>onOrBefore(getDate(item))).sort((a,b)=>String(getDate(b)).localeCompare(String(getDate(a))))[0]??null;
  const movementHistory=animal.historial_movimientos??[];
  const movement=latest(movementHistory,(item)=>item.fecha);
  const nextMovement=movementHistory.filter((item)=>item.fecha.slice(0,10)>date).sort((a,b)=>a.fecha.localeCompare(b.fecha))[0]??null;
  const treatment=latest(animal.historial_tratamientos??[],(item)=>item.fecha);
  const heat=latest(animal.historial_celos??[],(item)=>item.fecha_inicio);
  const pregnancy=latest((animal.historial_preneces??[]).filter((item)=>item.rol==='VACA'&&item.estado==='CONFIRMADA'),(item)=>item.fecha);
  const birth=latest(animal.historial_partos??[],(item)=>item.fecha);
  const abortion=latest(animal.historial_abortos??[],(item)=>item.fecha);
  const productions=(animal.historial_produccion??[]).filter((item)=>onOrBefore(item.fecha));
  const condition=latest(animal.eventos_condicion??[],(item)=>item.fecha_evento);
  const weight=latest(animal.historial_pesajes??[],(item)=>item.fecha)??(animal.ultimo_pesaje&&onOrBefore(animal.ultimo_pesaje.fecha)?animal.ultimo_pesaje:null);
  const lactation=latest(animal.historial_lactancias??[],(item)=>item.fecha_inicio);
  const today=date===currentDateInput();
  const known=Boolean((createdDate&&date>=createdDate)||movement||condition||weight||treatment||heat||pregnancy||birth||abortion||lactation||productions.length||today);
  return {fecha:date,encontrado:known,propiedad:movement?.propiedad_destino??nextMovement?.propiedad_origen??animal.propiedad??null,id_propiedad:movement?.id_propiedad_destino??nextMovement?.id_propiedad_origen??null,ubicacion:movement?.ubicacion_destino??nextMovement?.ubicacion_origen??animal.ubicacion??null,id_ubicacion:null,tipo_ubicacion:null,grupo:movement?.grupo_destino??nextMovement?.grupo_origen??animal.grupo??null,id_grupo:null,periodo_ubicacion:null,periodo_grupo:null,estado:condition?.estado_nuevo??(known?'ACTIVO':null),ultimo_pesaje:weight?{peso_kg:weight.peso_kg,fecha:weight.fecha,metodo:weight.metodo??null}:null,ultimo_tratamiento:treatment?{fecha:treatment.fecha,tipo:treatment.tipo,medicamento:treatment.medicamento,via:treatment.via,dosis:treatment.dosis,unidad:treatment.unidad}:null,reproduccion:{ultimo_celo:heat?{fecha:heat.fecha_inicio,fecha_fin:heat.fecha_fin,es_falso:Boolean(heat.es_falso)}:null,prenez:pregnancy?{fecha_confirmacion:pregnancy.fecha,fecha_parto_tentativa:pregnancy.fecha_parto_tentativa,metodo_confirmacion:pregnancy.metodo,padre:pregnancy.contraparte}:null,ultimo_parto:birth?{fecha:birth.fecha,tipo:birth.tipo,total_crias:birth.total_crias}:null,ultimo_aborto:abortion?{fecha:abortion.fecha,causa:abortion.causa}:null,total_partos:(animal.historial_partos??[]).filter((item)=>onOrBefore(item.fecha)).length},lactancia:lactation?{fecha_inicio:lactation.fecha_inicio,fecha_fin:lactation.fecha_fin,activa:!lactation.fecha_fin||lactation.fecha_fin.slice(0,10)>=date,en_ordeno:Boolean(lactation.en_ordeno)}:null,produccion_dia:productions.filter((item)=>item.fecha.slice(0,10)===date).reduce((sum,item)=>sum+Number(item.litros||0),0),registros_produccion:productions.filter((item)=>item.fecha.slice(0,10)===date).length,total_tratamientos:(animal.historial_tratamientos??[]).filter((item)=>onOrBefore(item.fecha)).length};
}

function HistoryPreview({title,icon:Icon,count,expanded,onToggle,onOpenAll,children}:{title:string;icon:LucideIcon;count:number;expanded?:boolean;onToggle:()=>void;onOpenAll?:()=>void;children:ReactNode}){
  return <Card className="animal-history-preview"><header><span className="history-count">{count}</span><h2><Icon size={19}/>{title}</h2>{onOpenAll?<IconButton label={`Abrir ${title}`} onClick={onOpenAll}><ChevronRight size={19}/></IconButton>:null}</header>{children}{count>3?<button type="button" className="history-toggle" onClick={onToggle}>{expanded?'Mostrar solo 3':`Mostrar todo (${count})`}</button>:null}</Card>;
}

function MediaTagPicker({value,onChange,tags}:{value:string[];onChange:(value:string[])=>void;tags:CatalogItem[]}){
  return <Field label="Etiquetas"><div className="tag-picker">{tags.filter((item)=>item.activo!==false).map((item)=>{const tagId=itemId(item);return <label key={tagId} className={value.includes(tagId)?'selected':''}><input type="checkbox" checked={value.includes(tagId)} onChange={(event)=>onChange(event.target.checked?[...value,tagId]:value.filter((current)=>current!==tagId))}/>{itemLabel(item)}</label>;})}</div></Field>;
}

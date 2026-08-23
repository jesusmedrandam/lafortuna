import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRightLeft,
  Baby,
  Ban,
  Beef,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Expand,
  HeartPulse,
  ImagePlus,
  MapPin,
  Milk,
  Search,
  Star,
  Syringe,
  Tag,
  Trash2,
  UserRound,
  Users,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';
import { ImageLightbox } from '../../components/ImageLightbox';
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
import type { Animal, AnimalImage, Group, Location } from '../../types/api';
import { currentDateInput, formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';

interface ViewerImage {
  key: string;
  url: string;
  alt: string;
  title: string;
  createdAt?: string;
  imageId?: string;
  isProfile: boolean;
  type: 'IMAGEN' | 'VIDEO';
}

interface UploadDraft {
  file: File;
  profile: boolean;
  previewUrl: string;
}

interface HistoryItem {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  date?: string | null;
  onClick?: () => void;
}

type ConditionAction = 'DESACTIVAR' | 'REACTIVAR' | 'REPORTAR_DESAPARICION' | 'REGISTRAR_HALLAZGO';

export function AnimalDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const touchStart = useRef<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageProfile, setImageProfile] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [relatedAnimalIds, setRelatedAnimalIds] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [conditionAction, setConditionAction] = useState<ConditionAction | null>(null);
  const [conditionForm, setConditionForm] = useState({ fecha_evento: currentDateInput(), id_grupo_actual: '', id_ubicacion_actual: '', observaciones: '' });

  const query = useQuery({
    queryKey: ['animal', id],
    queryFn: () => apiRequest<Animal>(`/animales/${id}`),
    enabled: Boolean(id),
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
    mutationFn: async ({ file, profile, animalIds }: { file: File; profile: boolean; animalIds: string[] }) => {
      const data = new FormData();
      data.set('archivo', file);
      data.set('es_perfil', String(profile));
      data.set('id_animales', JSON.stringify(animalIds));
      return apiRequest<AnimalImage>(`/animales/${id}/imagenes`, { method: 'POST', body: data });
    },
    onSuccess: () => {
      toast.show('Archivo subido y relacionado correctamente.');
      setUploadDraft(null);
      void client.invalidateQueries({ queryKey: ['animal', id] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

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
    mutationFn: () => apiRequest(`/animales/${id}/condicion`, {
      method: 'POST',
      body: {
        accion: conditionAction,
        fecha_evento: conditionForm.fecha_evento,
        id_grupo_actual: conditionAction === 'REGISTRAR_HALLAZGO' ? conditionForm.id_grupo_actual || null : undefined,
        id_ubicacion_actual: conditionAction === 'REGISTRAR_HALLAZGO' ? conditionForm.id_ubicacion_actual || null : undefined,
        observaciones: conditionForm.observaciones.trim() || null,
      },
    }),
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
      await Promise.all([
        client.invalidateQueries({ queryKey: ['animal', id] }),
        client.invalidateQueries({ queryKey: ['animals'] }),
        client.invalidateQueries({ queryKey: ['dashboard'] }),
        client.invalidateQueries({ queryKey: ['locations'] }),
        client.invalidateQueries({ queryKey: ['groups'] }),
      ]);
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const profileImage = useMemo(
    () => query.data?.imagenes?.find((item) => item.es_perfil),
    [query.data?.imagenes],
  );
  const profileUrl = query.data?.foto_perfil || profileImage?.secure_url || null;
  const gallery = useMemo(
    () => (query.data?.imagenes ?? [])
      .filter((item) => !item.es_perfil)
      .sort((a, b) => new Date(b.fecha_toma ?? b.created_at ?? 0).getTime() - new Date(a.fecha_toma ?? a.created_at ?? 0).getTime()),
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
        title: `${animalName} · foto de perfil`,
        createdAt: profileImage?.fecha_toma ?? profileImage?.created_at,
        imageId: profileImage?.id_imagen,
        isProfile: true,
        type: 'IMAGEN',
      });
    }
    for (const image of gallery) {
      items.push({
        key: image.id_imagen,
        url: image.secure_url,
        alt: `Archivo de ${image.animales?.[0]?.nombre ?? animalName}`,
        title: image.animales?.[0]?.nombre ?? animalName,
        createdAt: image.fecha_toma ?? image.created_at,
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
  const currentCover = gallery[galleryIndex];
  const ownerText = animal.propietarios?.map((owner) => `${owner.nombre}${owner.porcentaje != null ? ` (${formatNumber(owner.porcentaje)}%)` : ''}`).join(', ');
  const animalSelection = {
    id_animal: animal.id_animal,
    codigo_arete: animal.codigo_arete,
    nombre: animal.nombre,
    sexo: animal.sexo,
    id_grupo_actual: animal.id_grupo_actual,
    grupo: animal.grupo,
    id_ubicacion_actual: animal.id_ubicacion_actual,
    ubicacion: animal.ubicacion,
    categoria_codigo: animal.categoria_codigo,
    seleccionado: true,
  };

  function chooseFile(profile: boolean) {
    setImageProfile(profile);
    fileRef.current?.click();
  }
  function nextPhoto() {
    if (gallery.length) setGalleryIndex((current) => (current + 1) % gallery.length);
  }
  function previousPhoto() {
    if (gallery.length) setGalleryIndex((current) => (current - 1 + gallery.length) % gallery.length);
  }
  function openProfileViewer() {
    if (profileUrl) setViewerIndex(0);
    else if (hasPermission('IMAGEN_ADMINISTRAR')) chooseFile(true);
  }
  function openGalleryViewer(image?: AnimalImage) {
    if (image) {
      const index = viewerImages.findIndex((item) => item.imageId === image.id_imagen);
      if (index >= 0) setViewerIndex(index);
      return;
    }
    if (profileUrl) setViewerIndex(0);
    else if (hasPermission('IMAGEN_ADMINISTRAR')) chooseFile(false);
  }
  function openMarkViewer() {
    const index = viewerImages.findIndex((item) => item.key === 'fierro');
    if (index >= 0) setViewerIndex(index);
  }
  function openConditionAction(action: ConditionAction) {
    setConditionForm({ fecha_evento: currentDateInput(), id_grupo_actual: '', id_ubicacion_actual: '', observaciones: '' });
    setConditionAction(action);
  }

  const movementItems: HistoryItem[] = (animal.historial_movimientos ?? []).map((movement) => ({
    key: movement.id_movimiento,
    title: movement.motivo || humanizeCode(movement.tipo),
    detail: `${movement.ubicacion_origen || movement.grupo_origen || 'Sin origen'} → ${movement.ubicacion_destino || movement.grupo_destino || 'Sin destino'}`,
    date: movement.fecha,
  }));
  const birthItems: HistoryItem[] = (animal.historial_partos ?? []).map((birth) => ({
    key: birth.id_parto,
    title: `${humanizeCode(birth.tipo)} · ${birth.total_crias} cría(s)`,
    detail: [birth.rol === 'MADRE' ? 'Como madre' : 'Como padre', birth.contraparte].filter(Boolean).join(' · '),
    date: birth.fecha,
  }));
  const productionItems: HistoryItem[] = (animal.historial_produccion ?? []).map((production) => ({
    key: production.id_produccion,
    title: `${formatNumber(production.litros, 3)} litros`,
    detail: [production.turno ? humanizeCode(production.turno) : null, production.fuente ? humanizeCode(production.fuente) : null, production.observaciones].filter(Boolean).join(' · '),
    date: production.fecha,
  }));
  const childItems: HistoryItem[] = (animal.crias_registradas ?? []).map((child) => ({
    key: child.id_animal,
    title: child.nombre,
    detail: [child.codigo_arete ? `Arete ${child.codigo_arete}` : null, child.sexo === 'HEMBRA' ? 'Hembra' : 'Macho', child.parentesco === 'MADRE' ? 'Hijo/a de esta madre' : 'Hijo/a de este padre'].filter(Boolean).join(' · '),
    date: child.fecha_nacimiento ?? child.fecha_parto,
    onClick: () => navigate(`/animales/${child.id_animal}`),
  }));
  const heatItems: HistoryItem[] = (animal.historial_celos ?? []).map((heat) => ({
    key: heat.id_celo,
    title: heat.rol === 'VACA' ? 'Celo registrado' : 'Implicado como toro',
    detail: [heat.contraparte, heat.observaciones].filter(Boolean).join(' · '),
    date: heat.fecha_inicio,
  }));
  const pregnancyItems: HistoryItem[] = (animal.historial_preneces ?? []).map((pregnancy) => ({
    key: pregnancy.id_prenez,
    title: `${pregnancy.rol === 'VACA' ? 'Preñez' : 'Implicado como padre'} · ${humanizeCode(pregnancy.estado)}`,
    detail: [pregnancy.metodo ? humanizeCode(pregnancy.metodo) : null, pregnancy.contraparte, pregnancy.fecha_parto_tentativa ? `Parto estimado: ${formatDate(pregnancy.fecha_parto_tentativa)}` : null].filter(Boolean).join(' · '),
    date: pregnancy.fecha,
  }));
  const abortionItems: HistoryItem[] = (animal.historial_abortos ?? []).map((abortion) => ({
    key: abortion.id_aborto,
    title: abortion.causa || 'Aborto registrado',
    detail: [abortion.meses_gestacion != null ? `${formatNumber(abortion.meses_gestacion)} meses de gestación` : null, abortion.descripcion].filter(Boolean).join(' · '),
    date: abortion.fecha,
  }));
  const treatmentItems: HistoryItem[] = (animal.historial_tratamientos ?? []).map((treatment) => ({
    key: treatment.id_tratamiento,
    title: `${treatment.tipo} · ${treatment.medicamento}`,
    detail: [`${formatNumber(treatment.dosis)} ${treatment.unidad ?? ''}`.trim(), treatment.via, treatment.observaciones].filter(Boolean).join(' · '),
    date: treatment.fecha,
  }));
  const activityItems: HistoryItem[] = (animal.historial_actividades ?? []).map((activity) => ({
    key: activity.id_actividad,
    title: activity.tipo,
    detail: [activity.fierro_codigo ? `Fierro ${activity.fierro_codigo}` : null, activity.descripcion].filter(Boolean).join(' · '),
    date: activity.fecha,
  }));
  const conditionItems: HistoryItem[] = (animal.eventos_condicion ?? []).map((event) => ({
    key: event.id_evento,
    title: humanizeCode(event.tipo_evento),
    detail: [event.ubicacion, event.grupo, event.observaciones].filter(Boolean).join(' · ') || `${humanizeCode(event.estado_anterior)} → ${humanizeCode(event.estado_nuevo)}`,
    date: event.fecha_evento,
  }));

  return <div className="animal-detail-page animal-detail-redesign">
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          if (imageProfile && !file.type.startsWith('image/')) {
            toast.show('La foto de perfil debe ser una imagen.', 'error');
            event.currentTarget.value = '';
            return;
          }
          setRelatedAnimalIds([id]);
          setUploadDraft({ file, profile: imageProfile, previewUrl: URL.createObjectURL(file) });
        }
        event.currentTarget.value = '';
      }}
    />

    <section className="animal-cover-hero">
      <div
        className="animal-cover-stage"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
          if (delta > 45) previousPhoto();
          else if (delta < -45) nextPhoto();
          touchStart.current = null;
        }}
      >
        <button className="animal-cover-open" type="button" onClick={() => openGalleryViewer(currentCover)}>
          {currentCover?.tipo_archivo === 'VIDEO'
            ? <video src={currentCover.secure_url} muted preload="metadata" />
            : currentCover
              ? <img src={currentCover.secure_url} alt={`Portada de ${animal.nombre}`} />
              : profileUrl
                ? <img className="animal-cover-fallback" src={profileUrl} alt={`Portada de ${animal.nombre}`} />
                : <span className="animal-cover-empty"><Beef size={70} /><small>{hasPermission('IMAGEN_ADMINISTRAR') ? 'Agregar primera fotografía' : 'Sin fotografías'}</small></span>}
          {(currentCover || profileUrl) ? <span className="animal-cover-expand"><Expand size={20} /></span> : null}
        </button>
        <div className="animal-cover-shade" />
        <h1>{animal.nombre}</h1>
        <Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{animal.condicion || humanizeCode(animal.estado)}</Badge>
        {gallery.length > 1 ? <>
          <IconButton className="animal-cover-arrow animal-cover-arrow-left" label="Portada anterior" onClick={previousPhoto}><ChevronLeft size={28} /></IconButton>
          <IconButton className="animal-cover-arrow animal-cover-arrow-right" label="Portada siguiente" onClick={nextPhoto}><ChevronRight size={28} /></IconButton>
        </> : null}
        {gallery.length ? <div className="animal-cover-dots">{gallery.map((image, index) => <button key={image.id_imagen} type="button" className={index === galleryIndex ? 'active' : ''} onClick={() => setGalleryIndex(index)} aria-label={`Ver portada ${index + 1}`} />)}</div> : null}
      </div>
      <button className="animal-profile-overlap" type="button" onClick={openProfileViewer} aria-label={profileUrl ? 'Ver foto de perfil' : 'Agregar foto de perfil'}>
        {profileUrl ? <img src={profileUrl} alt={`Foto de perfil de ${animal.nombre}`} /> : <Beef size={45} />}
        {profileUrl ? <span><Expand size={16} /></span> : null}
      </button>
    </section>

    <div className="animal-detail-actions animal-detail-primary-actions">
      {animal.estado === 'ACTIVO' && hasPermission('MOVIMIENTO_CREAR') ? <Button variant="ghost" onClick={() => navigate('/movimientos', { state: { initialAnimal: animalSelection } })}><ArrowRightLeft size={18} />Traslado</Button> : null}
      {animal.estado === 'ACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <Button variant="ghost" onClick={() => openConditionAction('DESACTIVAR')}><Ban size={18} />Inactivar</Button> : null}
      {animal.estado === 'INACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <Button variant="ghost" onClick={() => openConditionAction('REACTIVAR')}><CheckCircle2 size={18} />Reactivar</Button> : null}
      {animal.estado === 'DESAPARECIDO' && hasPermission('ANIMAL_MODIFICAR') ? <Button variant="ghost" onClick={() => openConditionAction('REGISTRAR_HALLAZGO')}><MapPin size={18} />Registrar hallazgo</Button> : null}
      {animal.estado === 'ACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <Button variant="ghost" onClick={() => openConditionAction('REPORTAR_DESAPARICION')}><Search size={18} />Reportar desaparición</Button> : null}
      {hasPermission('ANIMAL_MODIFICAR') ? <Button variant="ghost" onClick={() => setEditing(true)}><Edit3 size={18} />Editar</Button> : null}
      {hasPermission('ANIMAL_ELIMINAR') ? <Button variant="ghost" className="detail-action-danger" onClick={() => setDeleting(true)}><Trash2 size={18} />Eliminar</Button> : null}
      {animal.estado === 'ACTIVO' && hasPermission('SANIDAD_ADMINISTRAR') ? <Button variant="ghost" onClick={() => navigate('/sanidad', { state: { initialTreatmentAnimal: animalSelection } })}><Syringe size={18} />Registrar tratamiento</Button> : null}
      {animal.estado !== 'MUERTO' && hasPermission('MUERTE_ADMINISTRAR') ? <Button variant="ghost" onClick={() => navigate('/muertes', { state: { initialDeathAnimal: animalSelection } })}><HeartPulse size={18} />Registrar muerte</Button> : null}
    </div>

    <Card className="animal-detail-summary-card">
      <div className="animal-summary-heading animal-summary-heading-compact">
        <h2>Datos del animal</h2>
        {animal.descripcion ? <p>{animal.descripcion}</p> : null}
      </div>
      <div className="animal-compact-info-grid">
        <CompactInfo icon={Beef} label="Especie / sexo" value={`${animal.especie} · ${animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'}`} />
        {animal.codigo_arete ? <CompactInfo icon={Tag} label="Arete" value={animal.codigo_arete} /> : null}
        {animal.grupo ? <CompactInfo icon={Users} label="Grupo" value={animal.grupo} /> : null}
        {animal.ubicacion ? <CompactInfo icon={MapPin} label="Ubicación actual" value={animal.ubicacion} /> : null}
        {animal.categoria ? <CompactInfo icon={Tag} label="Categoría" value={animal.categoria} /> : null}
        {animal.ultimo_pesaje ? <CompactInfo icon={Weight} label="Último peso" value={`${formatNumber(animal.ultimo_pesaje.peso_kg)} kg · ${formatDate(animal.ultimo_pesaje.fecha)}`} /> : null}
        {ownerText ? <CompactInfo icon={UserRound} label="Propietario(s)" value={ownerText} wide /> : null}
        {animal.fecha_nacimiento ? <CompactInfo icon={CalendarDays} label="Fecha de nacimiento" value={formatDate(animal.fecha_nacimiento)} /> : null}
        {animal.fecha_nacimiento ? <CompactInfo icon={CalendarDays} label="Edad" value={formatAge(animal.fecha_nacimiento)} /> : null}
        {animal.origen ? <CompactInfo icon={MapPin} label="Origen" value={animal.origen} /> : null}
        {animal.sexo === 'HEMBRA' && (animal.total_partos ?? 0) > 0 ? <CompactInfo icon={Baby} label="Partos registrados" value={String(animal.total_partos)} /> : null}
        {(animal.total_crias ?? 0) > 0 ? <CompactInfo icon={Baby} label="Crías registradas" value={String(animal.total_crias)} /> : null}
        {animal.marquilla ? <CompactInfo icon={Tag} label="Fierro" value={<span className="animal-mark-inline"><span>{animal.marquilla_codigo || animal.marquilla}</span>{animal.marquilla_foto ? <button type="button" className="animal-mark-thumb" onClick={openMarkViewer} aria-label="Ver imagen del fierro"><img src={animal.marquilla_foto} alt={`Fierro ${animal.marquilla_codigo || animal.marquilla}`} /></button> : null}</span>} /> : null}
        {animal.madre ? <CompactInfo icon={UserRound} label="Madre" value={animal.madre} /> : null}
        {animal.padre ? <CompactInfo icon={UserRound} label="Padre" value={animal.padre} /> : null}
        {animal.razas?.length ? <CompactInfo icon={Tag} label="Raza(s)" value={animal.razas.map((item) => `${item.nombre}${item.porcentaje != null ? ` ${item.porcentaje}%` : ''}`).join(', ')} wide /> : null}
        {animal.colores?.length ? <CompactInfo icon={Tag} label="Color(es)" value={animal.colores.map((item) => item.nombre).join(', ')} wide /> : null}
      </div>
    </Card>

    <div className="animal-history-grid">
      <HistorySection title="Movimientos" icon={ArrowRightLeft} items={movementItems} />
      <HistorySection title="Partos" icon={Baby} items={birthItems} />
      <HistorySection title="Producción" icon={Milk} items={productionItems} />
      <HistorySection title="Crías" icon={Baby} items={childItems} />
      <HistorySection title="Celos" icon={HeartPulse} items={heatItems} />
      <HistorySection title="Abortos" icon={Ban} items={abortionItems} />
      <HistorySection title="Preñeces" icon={Baby} items={pregnancyItems} />
      <HistorySection title="Tratamientos" icon={Syringe} items={treatmentItems} />
      <HistorySection title="Otras actividades" icon={Activity} items={activityItems} />
      <HistorySection title="Cambios de estado y hallazgos" icon={Search} items={conditionItems} />
    </div>

    {viewerIndex !== null ? <ImageLightbox
      items={viewerImages.map((image) => ({ key: image.key, url: image.url, type: image.type, title: image.title, date: image.createdAt }))}
      initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)}
      actions={(media) => {
        const image = viewerImages.find((item) => item.key === media.key);
        if (!hasPermission('IMAGEN_ADMINISTRAR')) return null;
        return <div className="lightbox-actions">
          <IconButton label="Cambiar foto de perfil" onClick={() => chooseFile(true)}><Camera size={18} /></IconButton>
          <IconButton label="Agregar foto o video de portada" onClick={() => chooseFile(false)}><ImagePlus size={18} /></IconButton>
          {image?.imageId && !image.isProfile && image.type === 'IMAGEN' ? <IconButton label="Usar como foto de perfil" onClick={() => imageAction.mutate({ imageId: image.imageId!, action: 'profile' })}><Star size={18} /></IconButton> : null}
          {image?.imageId ? <IconButton className="detail-action-danger" label="Eliminar fotografía" onClick={() => imageAction.mutate({ imageId: image.imageId!, action: 'delete' })}><Trash2 size={18} /></IconButton> : null}
        </div>;
      }}
    /> : null}

    {uploadDraft ? <Modal
      title={uploadDraft.profile ? 'Cambiar foto de perfil' : 'Agregar foto o video'}
      onClose={() => setUploadDraft(null)}
      footer={<>
        <Button variant="ghost" onClick={() => setUploadDraft(null)}>Cancelar</Button>
        <Button disabled={!uploadDraft.profile && !relatedAnimalIds.length} loading={upload.isPending} onClick={() => upload.mutate({ file: uploadDraft.file, profile: uploadDraft.profile, animalIds: uploadDraft.profile ? [id] : relatedAnimalIds })}>Subir archivo</Button>
      </>}
    >
      <div className="animal-upload-dialog">
        {uploadDraft.file.type.startsWith('video/') ? <video src={uploadDraft.previewUrl} controls /> : <img src={uploadDraft.previewUrl} alt="Vista previa del archivo" />}
      </div>
      {!uploadDraft.profile ? <Field label="Animales relacionados" required hint="El archivo aparecerá en la ficha de todos los animales marcados."><AnimalMultiPicker value={relatedAnimalIds} onChange={setRelatedAnimalIds} /></Field> : null}
    </Modal> : null}

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
        <Field label="Motivo u observaciones"><Textarea rows={3} value={conditionForm.observaciones} onChange={(event) => setConditionForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field>
      </div>
    </Modal> : null}
    {deleting ? <ConfirmDialog title="Eliminar animal" message={`¿Seguro que deseas eliminar a ${animal.nombre}? El registro se desactivará, pero su historial permanecerá.`} onClose={() => setDeleting(false)} loading={deleteAnimal.isPending} onConfirm={() => deleteAnimal.mutate()} /> : null}
  </div>;
}

function CompactInfo({ icon: Icon, label, value, wide = false }: { icon: LucideIcon; label: string; value: ReactNode; wide?: boolean }) {
  return <div className={`animal-compact-info ${wide ? 'animal-compact-info-wide' : ''}`}><Icon size={17} /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function HistorySection({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: HistoryItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const visible = expanded ? items : items.slice(0, 3);
  return <Card className="animal-history-card">
    <div className="animal-history-heading">
      <h2><Icon size={19} />{title}<Badge tone="info">{items.length}</Badge></h2>
      {items.length > 3 ? <Button variant="ghost" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Ver menos' : 'Ver todo'}</Button> : null}
    </div>
    <div className="history-stack">
      {visible.map((item) => {
        const content = <><span><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>{item.date ? <strong>{formatDate(item.date)}</strong> : null}</>;
        return item.onClick
          ? <button type="button" className="history-entry history-entry-link" key={item.key} onClick={item.onClick}>{content}</button>
          : <div className="history-entry" key={item.key}>{content}</div>;
      })}
    </div>
  </Card>;
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Beef,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Expand,
  ImagePlus,
  MapPin,
  Search,
  Star,
  Tag,
  Syringe,
  Trash2,
  UserRound,
  Users,
  Weight,
  X,
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
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from '../../components/ui';
import type { Animal, AnimalImage, Group, Location } from '../../types/api';
import { currentDateInput, formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';

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

type ConditionAction = 'DESACTIVAR' | 'REACTIVAR' | 'REPORTAR_DESAPARICION' | 'REGISTRAR_HALLAZGO';

export function AnimalDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const touchStart = useRef<number | null>(null);
  const viewerTouchStart = useRef<number | null>(null);
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
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()),
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
        createdAt: profileImage?.created_at,
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
        createdAt: image.created_at,
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

  useEffect(() => {
    if (viewerIndex === null) return undefined;
    if (!viewerImages.length) {
      setViewerIndex(null);
      return undefined;
    }
    if (viewerIndex >= viewerImages.length) setViewerIndex(viewerImages.length - 1);
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewerIndex(null);
      if (event.key === 'ArrowRight') setViewerIndex((current) => current === null ? null : (current + 1) % viewerImages.length);
      if (event.key === 'ArrowLeft') setViewerIndex((current) => current === null ? null : (current - 1 + viewerImages.length) % viewerImages.length);
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [viewerImages.length, viewerIndex]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;

  const animal = query.data!;
  const currentGallery = gallery[galleryIndex];
  const currentViewer = viewerIndex === null ? null : viewerImages[viewerIndex];
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
  const movementOrigin = lastMovement?.ubicacion_origen || lastMovement?.grupo_origen || 'Sin origen registrado';
  const movementDestination = lastMovement?.ubicacion_destino || lastMovement?.grupo_destino || 'Sin destino registrado';
  const movementText = lastMovement ? `${movementOrigin} → ${movementDestination} · ${formatDate(lastMovement.fecha)}` : '';

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
  }
  function openGalleryViewer(image: AnimalImage) {
    const index = viewerImages.findIndex((item) => item.imageId === image.id_imagen);
    if (index >= 0) setViewerIndex(index);
  }
  function openMarkViewer() {
    const index = viewerImages.findIndex((item) => item.key === 'fierro');
    if (index >= 0) setViewerIndex(index);
  }
  function nextViewer() {
    if (viewerImages.length > 1) setViewerIndex((current) => current === null ? 0 : (current + 1) % viewerImages.length);
  }
  function previousViewer() {
    if (viewerImages.length > 1) setViewerIndex((current) => current === null ? 0 : (current - 1 + viewerImages.length) % viewerImages.length);
  }
  function openConditionAction(action: ConditionAction) {
    setConditionForm({ fecha_evento: currentDateInput(), id_grupo_actual: '', id_ubicacion_actual: '', observaciones: '' });
    setConditionAction(action);
  }

  return <div className="animal-detail-page">
    <button className="back-link" onClick={() => navigate('/animales')}><ArrowLeft size={18} />Volver a animales</button>
    <PageHeader
      title={animal.nombre}
      description={animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Animal sin código de arete'}
      action={<div className="animal-detail-actions">
        {animal.estado === 'ACTIVO' && hasPermission('MOVIMIENTO_CREAR') ? <IconButton label="Mover animal" onClick={() => navigate('/movimientos', { state: { initialAnimal: { id_animal: animal.id_animal, codigo_arete: animal.codigo_arete, nombre: animal.nombre, sexo: animal.sexo, id_grupo_actual: animal.id_grupo_actual, grupo: animal.grupo, id_ubicacion_actual: animal.id_ubicacion_actual, ubicacion: animal.ubicacion, seleccionado: true } } })}><ArrowRightLeft size={19} /></IconButton> : null}
        {animal.estado === 'ACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <IconButton label="Desactivar operaciones" onClick={() => openConditionAction('DESACTIVAR')}><Ban size={19} /></IconButton> : null}
        {animal.estado === 'ACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <IconButton label="Reportar desaparición" onClick={() => openConditionAction('REPORTAR_DESAPARICION')}><Search size={19} /></IconButton> : null}
        {animal.estado === 'INACTIVO' && hasPermission('ANIMAL_MODIFICAR') ? <IconButton label="Reactivar operaciones" onClick={() => openConditionAction('REACTIVAR')}><CheckCircle2 size={19} /></IconButton> : null}
        {animal.estado === 'DESAPARECIDO' && hasPermission('ANIMAL_MODIFICAR') ? <IconButton label="Registrar hallazgo" onClick={() => openConditionAction('REGISTRAR_HALLAZGO')}><MapPin size={19} /></IconButton> : null}
        {hasPermission('ANIMAL_MODIFICAR') ? <IconButton label="Editar animal" onClick={() => setEditing(true)}><Edit3 size={19} /></IconButton> : null}
        {hasPermission('ANIMAL_ELIMINAR') ? <IconButton className="detail-action-danger" label="Eliminar animal" onClick={() => setDeleting(true)}><Trash2 size={19} /></IconButton> : null}
      </div>}
    />
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

    <Card className="animal-detail-summary-card">
      <div className="animal-detail-summary-layout">
        <div className="animal-profile-compact-wrap">
          <button className="animal-profile-compact" type="button" disabled={!profileUrl} onClick={openProfileViewer}>
            {profileUrl ? <img src={profileUrl} alt={`Foto de perfil de ${animal.nombre}`} /> : <Beef size={52} />}
            {profileUrl ? <span className="compact-expand-indicator"><Expand size={16} /></span> : null}
          </button>
          {hasPermission('IMAGEN_ADMINISTRAR') ? <IconButton className="profile-camera-overlay" label="Cambiar foto de perfil" onClick={() => chooseFile(true)}><Camera size={18} /></IconButton> : null}
        </div>

        <div className="animal-summary-content">
          <div className="animal-summary-heading">
            <div>
              <h2>{animal.nombre}</h2>
              <p>{animal.descripcion || 'Sin descripción registrada.'}</p>
            </div>
            <Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{animal.condicion || humanizeCode(animal.estado)}</Badge>
          </div>

          <div className="animal-compact-info-grid">
            <CompactInfo icon={Beef} label="Especie / sexo" value={`${animal.especie} · ${animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'}`} />
            <CompactInfo icon={Users} label="Grupo" value={animal.grupo || 'Sin grupo'} />
            <CompactInfo icon={MapPin} label="Ubicación actual" value={animal.ubicacion || 'Sin ubicación actual'} />
            <CompactInfo icon={Tag} label="Categoría" value={animal.categoria || 'Sin categoría'} />
            <CompactInfo icon={Weight} label="Último peso" value={animal.ultimo_pesaje ? `${formatNumber(animal.ultimo_pesaje.peso_kg)} kg · ${formatDate(animal.ultimo_pesaje.fecha)}` : 'Sin pesaje'} />
            <CompactInfo icon={UserRound} label="Propietario(s)" value={ownerText} wide />
            <CompactInfo icon={CalendarDays} label="Fecha de nacimiento" value={formatDate(animal.fecha_nacimiento)} />
            {animal.fecha_nacimiento ? <CompactInfo icon={CalendarDays} label="Edad" value={formatAge(animal.fecha_nacimiento)} /> : null}
            {animal.marquilla ? <CompactInfo icon={Tag} label="Fierro" value={<span className="animal-mark-inline"><span>{animal.marquilla_codigo || animal.marquilla}</span>{animal.marquilla_foto ? <button type="button" className="animal-mark-thumb" onClick={openMarkViewer} aria-label="Ver imagen del fierro en grande"><img src={animal.marquilla_foto} alt={`Fierro ${animal.marquilla_codigo || animal.marquilla}`} /></button> : null}</span>} /> : null}
            <CompactInfo icon={UserRound} label="Padres" value={`Madre: ${animal.madre || '—'} · Padre: ${animal.padre || '—'}`} wide />
            {lastTreatment ? <CompactInfo icon={Syringe} label="Último tratamiento" value={treatmentText} wide /> : null}
            {lastMovement ? <CompactInfo icon={ArrowRightLeft} label="Último traslado" value={movementText} wide /> : null}
          </div>

          <div className="animal-compact-tags">
            <span><strong>Razas:</strong> {animal.razas?.length ? animal.razas.map((item) => `${item.nombre}${item.porcentaje != null ? ` ${item.porcentaje}%` : ''}`).join(', ') : 'Sin registrar'}</span>
            <span><strong>Colores:</strong> {animal.colores?.length ? animal.colores.map((item) => item.nombre).join(', ') : 'Sin registrar'}</span>
          </div>
        </div>
      </div>
    </Card>

    {animal.eventos_condicion?.length ? <Card className="animal-condition-history">
      <div className="section-heading-inline"><div><h2>Actividad y hallazgos</h2><p className="muted">Historial de cambios que habilitan o bloquean operaciones.</p></div></div>
      <div className="detail-lines compact">
        {animal.eventos_condicion.slice(0, 8).map((event) => <div key={event.id_evento}>
          <span><strong>{humanizeCode(event.tipo_evento)}</strong><small>{[event.ubicacion, event.grupo, event.observaciones].filter(Boolean).join(' · ') || `${humanizeCode(event.estado_anterior)} → ${humanizeCode(event.estado_nuevo)}`}</small></span>
          <strong>{formatDate(event.fecha_evento)}</strong>
        </div>)}
      </div>
    </Card> : null}

    <section className="animal-gallery-compact-section">
      <div className="animal-gallery-compact-header">
        <div><h2>Fotos y videos</h2><p>Cada archivo puede relacionarse con uno o varios animales.</p></div>
        {hasPermission('IMAGEN_ADMINISTRAR') ? <IconButton label="Agregar archivo" onClick={() => chooseFile(false)}><ImagePlus size={20} /></IconButton> : null}
      </div>
      {currentGallery ? <Card className="animal-carousel-card animal-carousel-compact-card">
        <div
          className="animal-carousel-stage animal-carousel-compact-stage"
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (delta > 45) nextPhoto();
            else if (delta < -45) previousPhoto();
            touchStart.current = null;
          }}
        >
          <strong className="animal-media-title">{currentGallery.animales?.[0]?.nombre ?? animal.nombre}</strong>
          <button className="carousel-image-button" type="button" onClick={() => openGalleryViewer(currentGallery)}>
            {currentGallery.tipo_archivo==='VIDEO'?<video src={currentGallery.secure_url} muted preload="metadata"/>:<img src={currentGallery.secure_url} alt={currentGallery.animales?.[0]?.nombre ?? animal.nombre} />}
            <span><Expand size={18} /></span>
          </button>
          <span className="carousel-counter">{galleryIndex + 1} / {gallery.length}</span>
          {gallery.length > 1 ? <>
            <IconButton className="carousel-arrow carousel-arrow-left" label="Fotografía anterior" onClick={previousPhoto}><ChevronLeft size={26} /></IconButton>
            <IconButton className="carousel-arrow carousel-arrow-right" label="Fotografía siguiente" onClick={nextPhoto}><ChevronRight size={26} /></IconButton>
          </> : null}
        </div>
        <div className="carousel-dots">{gallery.map((image, index) => <button key={image.id_imagen} type="button" className={index === galleryIndex ? 'active' : ''} onClick={() => setGalleryIndex(index)} aria-label={`Ver fotografía ${index + 1}`} />)}</div>
      </Card> : <EmptyState icon={ImagePlus} title="Sin archivos adicionales" description="Agrega fotos o videos para conservar el historial visual del animal." action={hasPermission('IMAGEN_ADMINISTRAR') ? <IconButton label="Subir archivo" onClick={() => chooseFile(false)}><ImagePlus size={22} /></IconButton> : undefined} />}
    </section>

    {currentViewer ? <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setViewerIndex(null); }}
      onTouchStart={(event) => { viewerTouchStart.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (viewerTouchStart.current === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? viewerTouchStart.current) - viewerTouchStart.current;
        if (delta > 45) nextViewer();
        else if (delta < -45) previousViewer();
        viewerTouchStart.current = null;
      }}
    >
      <IconButton className="lightbox-close" label="Cerrar imagen" onClick={() => setViewerIndex(null)}><X size={28} /></IconButton>
      {viewerImages.length > 1 ? <>
        <IconButton className="lightbox-arrow lightbox-arrow-left" label="Imagen anterior" onClick={previousViewer}><ChevronLeft size={34} /></IconButton>
        <IconButton className="lightbox-arrow lightbox-arrow-right" label="Imagen siguiente" onClick={nextViewer}><ChevronRight size={34} /></IconButton>
      </> : null}
      <div className="image-lightbox-content">
        {currentViewer.type==='VIDEO'?<video src={currentViewer.url} controls autoPlay/>:<img src={currentViewer.url} alt={currentViewer.alt} />}
        <div className="image-lightbox-details">
          <div>
            <strong>{currentViewer.title}</strong>
            <small>{currentViewer.createdAt ? formatDate(currentViewer.createdAt) : ''}{viewerImages.length > 1 ? ` · ${(viewerIndex ?? 0) + 1} de ${viewerImages.length}` : ''}</small>
          </div>
          {hasPermission('IMAGEN_ADMINISTRAR') && currentViewer.imageId ? <div className="lightbox-actions">
            {!currentViewer.isProfile&&currentViewer.type==='IMAGEN' ? <IconButton label="Usar como foto de perfil" onClick={() => imageAction.mutate({ imageId: currentViewer.imageId!, action: 'profile' })}><Star size={18} /></IconButton> : null}
            <IconButton className="detail-action-danger" label="Eliminar fotografía" onClick={() => imageAction.mutate({ imageId: currentViewer.imageId!, action: 'delete' })}><Trash2 size={18} /></IconButton>
          </div> : null}
        </div>
      </div>
    </div> : null}

    {uploadDraft ? <Modal
      title={uploadDraft.profile ? 'Cambiar foto de perfil' : 'Agregar foto o video'}
      onClose={() => setUploadDraft(null)}
      footer={<>
        <Button variant="ghost" onClick={() => setUploadDraft(null)}>Cancelar</Button>
        <Button disabled={!uploadDraft.profile&&!relatedAnimalIds.length} loading={upload.isPending} onClick={() => upload.mutate({ file: uploadDraft.file, profile: uploadDraft.profile, animalIds: uploadDraft.profile?[id]:relatedAnimalIds })}>Subir archivo</Button>
      </>}
    >
      <div className="animal-upload-dialog">
        {uploadDraft.file.type.startsWith('video/')?<video src={uploadDraft.previewUrl} controls/>:<img src={uploadDraft.previewUrl} alt="Vista previa del archivo" />}
      </div>
      {!uploadDraft.profile?<Field label="Animales relacionados" required hint="El archivo aparecerá en la ficha de todos los animales marcados."><AnimalMultiPicker value={relatedAnimalIds} onChange={setRelatedAnimalIds}/></Field>:null}
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

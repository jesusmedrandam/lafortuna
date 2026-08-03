import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Beef, CalendarDays, Camera, ChevronLeft, ChevronRight, Edit3, Expand, ImagePlus, MapPin, Star, Trash2, Upload, UserRound, Users, Weight, X, type LucideIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, PageHeader } from '../../components/ui';
import type { Animal, AnimalImage } from '../../types/api';
import { formatDate, formatNumber } from '../../utils';
import { AnimalFormModal } from './AnimalFormModal';

interface ViewerImage {
  key: string;
  url: string;
  alt: string;
  description: string | null;
  createdAt?: string;
  imageId?: string;
  isProfile: boolean;
}

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
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['animal', id],
    queryFn: () => apiRequest<Animal>(`/animales/${id}`),
    enabled: Boolean(id),
  });

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
    mutationFn: async ({ file, profile }: { file: File; profile: boolean }) => {
      const data = new FormData();
      data.set('imagen', file);
      data.set('es_perfil', String(profile));
      return apiRequest<AnimalImage>(`/animales/${id}/imagenes`, { method: 'POST', body: data });
    },
    onSuccess: () => {
      toast.show('Imagen subida correctamente.');
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
        description: profileImage?.descripcion ?? 'Foto de perfil',
        createdAt: profileImage?.created_at,
        imageId: profileImage?.id_imagen,
        isProfile: true,
      });
    }
    for (const image of gallery) {
      items.push({
        key: image.id_imagen,
        url: image.secure_url,
        alt: image.descripcion || `Fotografía de ${animalName}`,
        description: image.descripcion,
        createdAt: image.created_at,
        imageId: image.id_imagen,
        isProfile: false,
      });
    }
    return items;
  }, [gallery, profileImage, profileUrl, query.data?.nombre]);

  useEffect(() => {
    if (galleryIndex >= gallery.length) setGalleryIndex(0);
  }, [gallery.length, galleryIndex]);

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
  function nextViewer() {
    if (viewerImages.length > 1) setViewerIndex((current) => current === null ? 0 : (current + 1) % viewerImages.length);
  }
  function previousViewer() {
    if (viewerImages.length > 1) setViewerIndex((current) => current === null ? 0 : (current - 1 + viewerImages.length) % viewerImages.length);
  }

  return <div>
    <button className="back-link" onClick={() => navigate('/animales')}><ArrowLeft size={18} />Volver a animales</button>
    <PageHeader
      title={animal.nombre}
      description={animal.codigo_arete ? `Arete ${animal.codigo_arete}` : 'Animal sin código de arete'}
      action={<div className="header-actions">
        {hasPermission('IMAGEN_ADMINISTRAR') ? <Button variant="secondary" onClick={() => chooseFile(true)}><Camera size={18} />Cambiar foto</Button> : null}
        {hasPermission('ANIMAL_MODIFICAR') ? <Button onClick={() => setEditing(true)}><Edit3 size={18} />Editar</Button> : null}
        {hasPermission('ANIMAL_ELIMINAR') ? <Button variant="danger" onClick={() => setDeleting(true)}><Trash2 size={18} />Eliminar</Button> : null}
      </div>}
    />
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) upload.mutate({ file, profile: imageProfile });
        event.currentTarget.value = '';
      }}
    />

    <div className="animal-current-layout">
      <Card className="animal-profile-card">
        <button className="animal-profile-square" type="button" disabled={!profileUrl} onClick={openProfileViewer}>
          {profileUrl ? <img src={profileUrl} alt={`Foto de perfil de ${animal.nombre}`} /> : <Beef size={72} />}
          {profileUrl ? <span><Expand size={18} />Ver completa</span> : null}
        </button>
        <div className="identity-title"><h2>{animal.nombre}</h2><Badge tone={animal.estado === 'ACTIVO' ? 'success' : animal.estado === 'MUERTO' ? 'danger' : 'warning'}>{animal.estado}</Badge></div>
        <p>{animal.descripcion || 'Sin descripción registrada.'}</p>
      </Card>

      <Card className="animal-current-summary">
        <h2 className="card-title">Información actual</h2>
        <div className="current-info-grid">
          <Info icon={Beef} label="Especie y sexo" value={`${animal.especie} · ${animal.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'}`} />
          <Info icon={Users} label="Grupo actual" value={animal.grupo || 'Sin grupo'} />
          <Info icon={MapPin} label="Corral o potrero" value={animal.ubicacion || 'Sin corral o potrero actual'} />
          <Info icon={Weight} label="Último peso" value={animal.ultimo_pesaje ? `${formatNumber(animal.ultimo_pesaje.peso_kg)} kg` : 'Sin pesaje'} />
          <Info icon={UserRound} label="Propietario(s)" value={ownerText} wide />
          <Info icon={CalendarDays} label="Nacimiento" value={formatDate(animal.fecha_nacimiento)} />
          <Info icon={CalendarDays} label="Ingreso" value={formatDate(animal.fecha_ingreso)} />
          <Info icon={UserRound} label="Madre" value={animal.madre || 'Sin registrar'} />
          <Info icon={UserRound} label="Padre" value={animal.padre || 'Sin registrar'} />
        </div>
        <div className="current-tags">
          <div><strong>Razas</strong><span>{animal.razas?.length ? animal.razas.map((item) => <Badge key={item.id_raza} tone="info">{item.nombre}{item.porcentaje != null ? ` ${item.porcentaje}%` : ''}</Badge>) : <em>Sin razas</em>}</span></div>
          <div><strong>Colores</strong><span>{animal.colores?.length ? animal.colores.map((item) => <Badge key={item.id_color} tone={item.es_principal ? 'success' : 'neutral'}>{item.nombre}</Badge>) : <em>Sin colores</em>}</span></div>
        </div>
      </Card>
    </div>

    <section className="animal-carousel-section">
      <PageHeader
        title="Otras fotografías"
        description="Se muestra primero la fotografía más reciente. Usa las flechas o desliza para recorrerlas."
        action={hasPermission('IMAGEN_ADMINISTRAR') ? <Button variant="secondary" onClick={() => chooseFile(false)} loading={upload.isPending}><Upload size={18} />Agregar fotografía</Button> : undefined}
      />
      {currentGallery ? <Card className="animal-carousel-card">
        <div
          className="animal-carousel-stage"
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (delta > 45) nextPhoto();
            else if (delta < -45) previousPhoto();
            touchStart.current = null;
          }}
        >
          <button className="carousel-image-button" type="button" onClick={() => openGalleryViewer(currentGallery)}>
            <img src={currentGallery.secure_url} alt={currentGallery.descripcion || animal.nombre} />
            <span><Expand size={20} />Pantalla completa</span>
          </button>
          <span className="carousel-counter">{galleryIndex + 1} / {gallery.length}</span>
          {gallery.length > 1 ? <>
            <IconButton className="carousel-arrow carousel-arrow-left" label="Fotografía anterior" onClick={previousPhoto}><ChevronLeft size={28} /></IconButton>
            <IconButton className="carousel-arrow carousel-arrow-right" label="Fotografía siguiente" onClick={nextPhoto}><ChevronRight size={28} /></IconButton>
          </> : null}
        </div>
        <div className="carousel-dots">{gallery.map((image, index) => <button key={image.id_imagen} type="button" className={index === galleryIndex ? 'active' : ''} onClick={() => setGalleryIndex(index)} aria-label={`Ver fotografía ${index + 1}`} />)}</div>
      </Card> : <EmptyState icon={ImagePlus} title="Sin fotografías adicionales" description="La foto de perfil se conserva por separado. Aquí aparecerán las demás fotos, desde la más reciente." action={hasPermission('IMAGEN_ADMINISTRAR') ? <Button onClick={() => chooseFile(false)}><Upload size={18} />Subir imagen</Button> : undefined} />}
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
        <img src={currentViewer.url} alt={currentViewer.alt} />
        <div className="image-lightbox-details">
          <div>
            <strong>{currentViewer.description || 'Fotografía sin descripción'}</strong>
            <small>{currentViewer.createdAt ? formatDate(currentViewer.createdAt) : ''}{viewerImages.length > 1 ? ` · ${(viewerIndex ?? 0) + 1} de ${viewerImages.length}` : ''}</small>
          </div>
          {hasPermission('IMAGEN_ADMINISTRAR') && currentViewer.imageId && !currentViewer.isProfile ? <div className="lightbox-actions">
            <Button variant="secondary" onClick={() => imageAction.mutate({ imageId: currentViewer.imageId!, action: 'profile' })} loading={imageAction.isPending}><Star size={17} />Usar como perfil</Button>
            <Button variant="danger" onClick={() => imageAction.mutate({ imageId: currentViewer.imageId!, action: 'delete' })} loading={imageAction.isPending}><Trash2 size={17} />Eliminar</Button>
          </div> : null}
        </div>
      </div>
    </div> : null}

    {editing ? <AnimalFormModal animal={animal} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void query.refetch(); }} /> : null}
    {deleting ? <ConfirmDialog title="Eliminar animal" message={`¿Seguro que deseas eliminar a ${animal.nombre}? El registro se desactivará, pero su historial permanecerá.`} onClose={() => setDeleting(false)} loading={deleteAnimal.isPending} onConfirm={() => deleteAnimal.mutate()} /> : null}
  </div>;
}

function Info({ icon: Icon, label, value, wide = false }: { icon: LucideIcon; label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'current-info-wide' : ''}><Icon size={18} /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

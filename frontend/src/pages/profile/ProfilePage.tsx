import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Camera, Mail, Phone, Save, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { clearSession } from '../../api/storage';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ErrorState, Field, Input, LoadingState, PageHeader } from '../../components/ui';
import type { Profile } from '../../types/api';
import { formatDateTime, nullIfEmpty } from '../../utils';

interface ProfileUpdateResult {
  correo: string;
  message: string;
  emailVerificationRequired: boolean;
}

export function ProfilePage() {
  const { refreshUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ['profile'], queryFn: () => apiRequest<Profile>('/auth/me') });
  const [form, setForm] = useState({ nombres: '', apellidos: '', correo: '', telefono: '', fecha_nacimiento: '' });

  useEffect(() => {
    if (query.data) {
      setForm({
        nombres: query.data.nombres,
        apellidos: query.data.apellidos,
        correo: query.data.correo,
        telefono: query.data.telefono ?? '',
        fecha_nacimiento: query.data.fecha_nacimiento ?? '',
      });
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () => apiRequest<ProfileUpdateResult>('/auth/me', {
      method: 'PATCH',
      body: {
        nombres: form.nombres,
        apellidos: form.apellidos,
        correo: form.correo,
        telefono: nullIfEmpty(form.telefono),
        fecha_nacimiento: form.fecha_nacimiento || null,
      },
    }),
    onSuccess: async (result) => {
      toast.show(result.message);
      if (result.emailVerificationRequired) {
        clearSession();
        window.dispatchEvent(new CustomEvent('mm-session-expired'));
        navigate(`/activar?correo=${encodeURIComponent(result.correo)}`, { replace: true });
        return;
      }
      await client.invalidateQueries({ queryKey: ['profile'] });
      await refreshUser();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('imagen', file);
      return apiRequest<{ foto_perfil_url: string }>('/auth/me/photo', { method: 'POST', body: formData });
    },
    onSuccess: async () => {
      toast.show('Foto de perfil actualizada.');
      await client.invalidateQueries({ queryKey: ['profile'] });
      await refreshUser();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;

  const profile = query.data!;
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  function selectPhoto(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.show('Selecciona un archivo de imagen.', 'error'); return; }
    photoMutation.mutate(file);
  }

  return (
    <div>
      <PageHeader title="Mi perfil" description="Actualiza tus datos, correo y fotografía personal." />
      <div className="profile-layout">
        <Card className="profile-summary">
          <div className="profile-avatar-large profile-avatar-photo">
            {profile.foto_perfil_url
              ? <img src={profile.foto_perfil_url} alt={`Foto de ${profile.nombres}`} />
              : <span>{profile.nombres[0]}{profile.apellidos[0]}</span>}
            <button type="button" className="avatar-camera" onClick={() => fileInput.current?.click()} aria-label="Cambiar foto">
              <Camera size={17} />
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => selectPhoto(event.target.files?.[0])}
          />
          <Button variant="secondary" loading={photoMutation.isPending} onClick={() => fileInput.current?.click()}>
            <Upload size={17} />Cambiar fotografía
          </Button>
          <h2>{profile.nombres} {profile.apellidos}</h2>
          <p>{profile.correo}</p>
          <div className="profile-meta">
            <span><Mail size={17} />{profile.correo}</span>
            <span><Phone size={17} />{profile.telefono || 'Sin teléfono'}</span>
            <span><CalendarDays size={17} />Último acceso: {formatDateTime(profile.ultimo_acceso)}</span>
          </div>
          <div className="role-list">
            <h3><ShieldCheck size={18} /> Roles</h3>
            {profile.auth?.roles.length
              ? profile.auth.roles.map((role) => <Badge key={role} tone="info">{role}</Badge>)
              : <Badge tone="warning">Sin rol asignado</Badge>}
          </div>
        </Card>

        <Card>
          <form onSubmit={submit} className="form-stack">
            <div className="section-heading">
              <UserRound size={20} />
              <div>
                <h2>Información personal</h2>
                <p>Al cambiar el correo se enviará un nuevo código de verificación y se cerrará la sesión.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Nombres" required><Input value={form.nombres} onChange={(e) => setForm((x) => ({ ...x, nombres: e.target.value }))} required /></Field>
              <Field label="Apellidos" required><Input value={form.apellidos} onChange={(e) => setForm((x) => ({ ...x, apellidos: e.target.value }))} required /></Field>
              <Field label="Correo electrónico" hint="Un correo nuevo deberá verificarse." required><Input type="email" value={form.correo} onChange={(e) => setForm((x) => ({ ...x, correo: e.target.value }))} required /></Field>
              <Field label="Teléfono"><Input value={form.telefono} onChange={(e) => setForm((x) => ({ ...x, telefono: e.target.value }))} /></Field>
              <Field label="Fecha de nacimiento"><Input type="date" value={form.fecha_nacimiento} onChange={(e) => setForm((x) => ({ ...x, fecha_nacimiento: e.target.value }))} /></Field>
            </div>
            <div className="form-actions"><Button type="submit" loading={mutation.isPending}><Save size={18} />Guardar cambios</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

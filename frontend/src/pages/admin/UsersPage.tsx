import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Edit3, MailCheck, Search, Shield, UserCog, UserRound } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, SearchBox } from '../../components/ui';
import type { AdminUser, RoleItem } from '../../types/api';
import { formatDateTime, nullIfEmpty } from '../../utils';

interface UserUpdateResult {
  message: string;
  emailVerificationRequired: boolean;
}

export function UsersPage() {
  const { user: currentUser, hasPermission } = useAuth();
  const canAdmin = hasPermission('USUARIO_ADMINISTRAR');
  const toast = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => apiRequest<AdminUser[]>('/usuarios') });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => apiRequest<RoleItem[]>('/roles') });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return usersQuery.data ?? [];
    return (usersQuery.data ?? []).filter((item) =>
      `${item.nombres} ${item.apellidos} ${item.correo}`.toLowerCase().includes(term),
    );
  }, [search, usersQuery.data]);

  if (usersQuery.isLoading || rolesQuery.isLoading) return <LoadingState />;
  if (usersQuery.isError) return <ErrorState message={(usersQuery.error as Error).message} onRetry={() => void usersQuery.refetch()} />;
  if (rolesQuery.isError) return <ErrorState message={(rolesQuery.error as Error).message} onRetry={() => void rolesQuery.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Las cuentas nuevas quedan sin rol y sin acceso a los datos hasta que un administrador las autorice."
      />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nombre o correo…" />
        <Badge tone="info">{visible.length} usuarios</Badge>
      </div>

      {!visible.length ? (
        <Card><EmptyState icon={Search} title="No hay coincidencias" description="No encontramos usuarios con ese criterio." /></Card>
      ) : (
        <div className="user-admin-grid">
          {visible.map((item) => (
            <Card key={item.id_usuario} className="user-admin-card">
              <div className="user-admin-header">
                <div className="admin-avatar">
                  {item.foto_perfil_url
                    ? <img src={item.foto_perfil_url} alt="" />
                    : <span>{item.nombres[0]}{item.apellidos[0]}</span>}
                </div>
                <div className="user-admin-title">
                  <h3>{item.nombres} {item.apellidos}</h3>
                  <span>{item.correo}</span>
                </div>
                <Badge tone={item.activo ? 'success' : 'danger'}>{item.activo ? 'Activa' : 'Inactiva'}</Badge>
              </div>

              <div className="user-status-row">
                <span><MailCheck size={16} />{item.correo_verificado ? 'Correo verificado' : 'Correo pendiente'}</span>
                <span>Último acceso: {formatDateTime(item.ultimo_acceso)}</span>
              </div>

              <div className="assigned-roles">
                <strong><Shield size={16} /> Roles asignados</strong>
                <div>
                  {item.roles.length
                    ? item.roles.map((role) => <Badge key={role.id_rol} tone="info">{role.nombre}</Badge>)
                    : <Badge tone="warning">Sin rol</Badge>}
                </div>
              </div>

              {canAdmin ? (
                <Button
                  variant="secondary"
                  disabled={item.id_usuario === currentUser?.id}
                  title={item.id_usuario === currentUser?.id ? 'Modifica tus datos desde Mi perfil.' : undefined}
                  onClick={() => setEditing(item)}
                >
                  <Edit3 size={17} />{item.id_usuario === currentUser?.id ? 'Mi cuenta: usar Mi perfil' : 'Editar cuenta y roles'}
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <UserEditor
          user={editing}
          roles={rolesQuery.data ?? []}
          isCurrentUser={editing.id_usuario === currentUser?.id}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            toast.show(message);
            setEditing(null);
            await client.invalidateQueries({ queryKey: ['users'] });
          }}
          onError={(message) => toast.show(message, 'error')}
        />
      ) : null}
    </div>
  );
}

function UserEditor({
  user,
  roles,
  isCurrentUser,
  onClose,
  onSaved,
  onError,
}: {
  user: AdminUser;
  roles: RoleItem[];
  isCurrentUser: boolean;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    nombres: user.nombres,
    apellidos: user.apellidos,
    correo: user.correo,
    telefono: user.telefono ?? '',
    fecha_nacimiento: user.fecha_nacimiento ?? '',
    activo: user.activo,
  });
  const [selectedRoles, setSelectedRoles] = useState(() => new Set(user.roles.map((role) => role.id_rol)));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest<UserUpdateResult>(`/usuarios/${user.id_usuario}`, {
        method: 'PATCH',
        body: {
          nombres: form.nombres,
          apellidos: form.apellidos,
          correo: form.correo,
          telefono: nullIfEmpty(form.telefono),
          fecha_nacimiento: form.fecha_nacimiento || null,
          activo: form.activo,
        },
      });
      const rolesResult = await apiRequest<{ message: string }>(`/usuarios/${user.id_usuario}/roles`, {
        method: 'PUT',
        body: { roles: [...selectedRoles] },
      });
      return {
        message: result.emailVerificationRequired
          ? `${result.message} ${rolesResult.message}`
          : rolesResult.message,
      };
    },
    onSuccess: (result) => void onSaved(result.message),
    onError: (error) => onError((error as ApiError).message),
  });

  function submit(event: FormEvent) { event.preventDefault(); saveMutation.mutate(); }
  function toggleRole(id: string) {
    setSelectedRoles((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      title={`Editar usuario: ${user.nombres} ${user.apellidos}`}
      onClose={onClose}
      wide
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}><Check size={17} />Guardar cambios</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="form-stack">
        <div className="section-heading"><UserRound size={20} /><div><h2>Datos de la cuenta</h2><p>Si cambias el correo, la cuenta deberá verificarlo antes de volver a iniciar sesión.</p></div></div>
        <div className="form-grid">
          <Field label="Nombres" required><Input value={form.nombres} onChange={(e) => setForm((x) => ({ ...x, nombres: e.target.value }))} required /></Field>
          <Field label="Apellidos" required><Input value={form.apellidos} onChange={(e) => setForm((x) => ({ ...x, apellidos: e.target.value }))} required /></Field>
          <Field label="Correo" required><Input type="email" value={form.correo} onChange={(e) => setForm((x) => ({ ...x, correo: e.target.value }))} required /></Field>
          <Field label="Teléfono"><Input value={form.telefono} onChange={(e) => setForm((x) => ({ ...x, telefono: e.target.value }))} /></Field>
          <Field label="Fecha de nacimiento"><Input type="date" value={form.fecha_nacimiento} onChange={(e) => setForm((x) => ({ ...x, fecha_nacimiento: e.target.value }))} /></Field>
          <Field label="Estado" hint={isCurrentUser ? 'Ten cuidado al desactivar tu propia cuenta.' : undefined}>
            <label className="switch-row"><input type="checkbox" checked={form.activo} onChange={(e) => setForm((x) => ({ ...x, activo: e.target.checked }))} /><span>{form.activo ? 'Cuenta activa' : 'Cuenta desactivada'}</span></label>
          </Field>
        </div>

        <div className="section-heading"><UserCog size={20} /><div><h2>Roles</h2><p>Es válido guardar la cuenta sin ningún rol; en ese estado no podrá ver datos de la finca.</p></div></div>
        <div className="role-selector-grid">
          {roles.filter((role) => role.activo).map((role) => (
            <label className={`role-option ${selectedRoles.has(role.id_rol) ? 'selected' : ''}`} key={role.id_rol}>
              <input type="checkbox" checked={selectedRoles.has(role.id_rol)} onChange={() => toggleRole(role.id_rol)} />
              <div><strong>{role.nombre}</strong><span>{role.descripcion || role.codigo}</span></div>
            </label>
          ))}
        </div>
      </form>
    </Modal>
  );
}

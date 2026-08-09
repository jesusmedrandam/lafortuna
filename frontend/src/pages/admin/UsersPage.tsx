import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Edit3, Search, Shield, UserCog, UserRound } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListToolbar, LoadingState, Modal, PageHeader } from '../../components/ui';
import { useListControls } from '../../hooks/useListControls';
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
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => apiRequest<AdminUser[]>('/usuarios') });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => apiRequest<RoleItem[]>('/roles') });

  const list = useListControls({ items: usersQuery.data ?? [], storageKey: 'users', searchText: (item) => `${item.nombres} ${item.apellidos} ${item.correo} ${item.telefono ?? ''} ${item.roles.map((role) => role.nombre).join(' ')}`, dateValue: (item) => item.created_at, nameValue: (item) => `${item.nombres} ${item.apellidos}` });

  if (usersQuery.isLoading || rolesQuery.isLoading) return <LoadingState />;
  if (usersQuery.isError) return <ErrorState message={(usersQuery.error as Error).message} onRetry={() => void usersQuery.refetch()} />;
  if (rolesQuery.isError) return <ErrorState message={(rolesQuery.error as Error).message} onRetry={() => void rolesQuery.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Las cuentas nuevas quedan sin rol y sin acceso a los datos hasta que un administrador las autorice."
      />
      <ListToolbar search={list.search} onSearch={list.setSearch} order={list.order} onOrder={list.setOrder} placeholder="Buscar nombre, correo, teléfono o rol…" count={list.visible.length} />

      {!list.visible.length ? (
        <Card><EmptyState icon={Search} title="No hay coincidencias" description="No encontramos usuarios con ese criterio." /></Card>
      ) : (
        <Card className="record-list users-record-list"><div className="record-list-head"><span>Usuario</span><span>Correo</span><span>Roles</span><span>Último acceso</span><span>Estado</span><span /></div>{list.visible.map((item) => <button type="button" className="record-list-row" key={item.id_usuario} onClick={() => setSelected(item)}><span className="record-person"><span className="admin-avatar">{item.foto_perfil_url ? <img src={item.foto_perfil_url} alt="" /> : <span>{item.nombres[0]}{item.apellidos[0]}</span>}</span><span><strong>{item.nombres} {item.apellidos}</strong><small>{item.telefono || 'Sin teléfono'}</small></span></span><span><strong>{item.correo}</strong><small>{item.correo_verificado ? 'Verificado' : 'Pendiente'}</small></span><span><strong>{item.roles.length ? item.roles.map((role) => role.nombre).join(', ') : 'Sin rol'}</strong></span><span><strong>{formatDateTime(item.ultimo_acceso)}</strong></span><span><Badge tone={item.activo ? 'success' : 'danger'}>{item.activo ? 'Activa' : 'Inactiva'}</Badge></span><span className="record-row-actions">{canAdmin && item.id_usuario !== currentUser?.id ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); setEditing(item); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card>
      )}

      {selected ? <UserDetail user={selected} onClose={() => setSelected(null)} onEdit={canAdmin && selected.id_usuario !== currentUser?.id ? () => { setEditing(selected); setSelected(null); } : undefined} /> : null}

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

function UserDetail({ user, onClose, onEdit }: { user: AdminUser; onClose: () => void; onEdit?: () => void }) {
  return <Modal title="Detalle del usuario" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onEdit ? <Button onClick={onEdit}><Edit3 size={17} />Editar cuenta y roles</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="admin-avatar large">{user.foto_perfil_url ? <img src={user.foto_perfil_url} alt="" /> : <span>{user.nombres[0]}{user.apellidos[0]}</span>}</div><div><h2>{user.nombres} {user.apellidos}</h2><p>{user.correo}</p></div><Badge tone={user.activo ? 'success' : 'danger'}>{user.activo ? 'Activa' : 'Inactiva'}</Badge></div><div className="detail-grid"><div><small>Teléfono</small><strong>{user.telefono || 'Sin registrar'}</strong></div><div><small>Fecha de nacimiento</small><strong>{user.fecha_nacimiento || 'Sin registrar'}</strong></div><div><small>Correo</small><strong>{user.correo_verificado ? 'Verificado' : 'Pendiente de verificación'}</strong></div><div><small>Último acceso</small><strong>{formatDateTime(user.ultimo_acceso)}</strong></div><div><small>Cuenta creada</small><strong>{formatDateTime(user.created_at)}</strong></div></div><section><h3><Shield size={17} /> Roles asignados</h3><div className="badge-list">{user.roles.length ? user.roles.map((role) => <Badge key={role.id_rol} tone="info">{role.nombre}</Badge>) : <Badge tone="warning">Sin rol</Badge>}</div></section></div></Modal>;
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

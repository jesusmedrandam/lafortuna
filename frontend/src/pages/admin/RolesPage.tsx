import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Edit3, Plus, Save, Search, ShieldCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListToolbar, LoadingState, Modal, PageHeader, Textarea } from '../../components/ui';
import { useListControls } from '../../hooks/useListControls';
import type { PermissionItem, RoleItem } from '../../types/api';
import { nullIfEmpty } from '../../utils';

export function RolesPage() {
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission('ROL_ADMINISTRAR');
  const toast = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState<RoleItem | 'new' | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleItem | null>(null);

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => apiRequest<RoleItem[]>('/roles') });
  const permissionsQuery = useQuery({ queryKey: ['permissions'], queryFn: () => apiRequest<PermissionItem[]>('/roles/permisos') });
  const list = useListControls({ items: rolesQuery.data ?? [], storageKey: 'roles', searchText: (role) => `${role.nombre} ${role.codigo} ${role.descripcion ?? ''} ${role.permisos.map((permission) => `${permission.nombre} ${permission.codigo}`).join(' ')}`, nameValue: (role) => role.nombre, defaultOrder: 'AZ' });

  if (rolesQuery.isLoading || permissionsQuery.isLoading) return <LoadingState />;
  if (rolesQuery.isError) return <ErrorState message={(rolesQuery.error as Error).message} onRetry={() => void rolesQuery.refetch()} />;
  if (permissionsQuery.isError) return <ErrorState message={(permissionsQuery.error as Error).message} onRetry={() => void permissionsQuery.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Roles y permisos"
        description="Define exactamente qué módulos puede consultar o administrar cada rol."
        action={canAdmin ? <Button onClick={() => setEditing('new')}><Plus size={18} />Nuevo rol</Button> : undefined}
      />
      <ListToolbar search={list.search} onSearch={list.setSearch} order={list.order} onOrder={list.setOrder} placeholder="Buscar rol, código o permiso…" count={list.visible.length} />
      {list.visible.length ? <Card className="record-list roles-record-list"><div className="record-list-head"><span>Rol</span><span>Descripción</span><span>Permisos</span><span>Protección</span><span>Estado</span><span /></div>{list.visible.map((role) => <button type="button" className="record-list-row" key={role.id_rol} onClick={() => setSelectedRole(role)}><span className="record-person"><span className="record-icon"><ShieldCheck size={20} /></span><span><strong>{role.nombre}</strong><small>{role.codigo}</small></span></span><span><strong>{role.descripcion || 'Sin descripción'}</strong></span><span><strong>{role.permisos.length} permisos</strong><small>{role.permisos.slice(0, 2).map((permission) => permission.nombre).join(', ')}</small></span><span><strong>{role.protegido ? 'Rol protegido' : 'Editable'}</strong></span><span><Badge tone={role.activo ? 'success' : 'danger'}>{role.activo ? 'Activo' : 'Inactivo'}</Badge></span><span className="record-row-actions">{canAdmin ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); setEditing(role); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card> : <Card><EmptyState icon={Search} title="No hay coincidencias" description="No encontramos roles con ese criterio." /></Card>}

      {selectedRole ? <RoleDetail role={selectedRole} onClose={() => setSelectedRole(null)} onEdit={canAdmin ? () => { setEditing(selectedRole); setSelectedRole(null); } : undefined} /> : null}

      {editing ? (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          permissions={permissionsQuery.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            toast.show(message);
            setEditing(null);
            await client.invalidateQueries({ queryKey: ['roles'] });
            await client.invalidateQueries({ queryKey: ['permissions'] });
          }}
          onError={(message) => toast.show(message, 'error')}
        />
      ) : null}
    </div>
  );
}

function RoleDetail({ role, onClose, onEdit }: { role: RoleItem; onClose: () => void; onEdit?: () => void }) {
  const grouped = role.permisos.reduce<Record<string, PermissionItem[]>>((result, permission) => { (result[permission.modulo] ??= []).push(permission); return result; }, {});
  return <Modal title="Detalle del rol" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onEdit ? <Button onClick={onEdit}><Edit3 size={17} />Editar rol y permisos</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><ShieldCheck size={22} /></div><div><h2>{role.nombre}</h2><p>{role.codigo}</p></div><Badge tone={role.activo ? 'success' : 'danger'}>{role.activo ? 'Activo' : 'Inactivo'}</Badge></div><div className="detail-grid"><div><small>Descripción</small><strong>{role.descripcion || 'Sin descripción'}</strong></div><div><small>Permisos</small><strong>{role.permisos.length}</strong></div><div><small>Tipo</small><strong>{role.protegido ? 'Rol protegido' : 'Rol editable'}</strong></div></div><section><h3>Permisos asignados</h3><div className="permission-detail-groups">{Object.entries(grouped).map(([module, permissions]) => <div key={module}><strong>{module}</strong><div className="badge-list">{permissions.map((permission) => <Badge key={permission.id_permiso}>{permission.nombre}</Badge>)}</div></div>)}</div></section></div></Modal>;
}

function RoleEditor({
  role,
  permissions,
  onClose,
  onSaved,
  onError,
}: {
  role: RoleItem | null;
  permissions: PermissionItem[];
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    codigo: role?.codigo ?? '',
    nombre: role?.nombre ?? '',
    descripcion: role?.descripcion ?? '',
    activo: role?.activo ?? true,
  });
  const [selected, setSelected] = useState(() => new Set(role?.permisos.map((item) => item.id_permiso) ?? []));
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const permission of permissions) {
      const items = map.get(permission.modulo) ?? [];
      items.push(permission);
      map.set(permission.modulo, items);
    }
    return [...map.entries()];
  }, [permissions]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!role) {
        await apiRequest('/roles', {
          method: 'POST',
          body: {
            codigo: form.codigo,
            nombre: form.nombre,
            descripcion: nullIfEmpty(form.descripcion),
            activo: form.activo,
            permisos: [...selected],
          },
        });
        return 'Rol creado correctamente.';
      }
      await apiRequest(`/roles/${role.id_rol}`, {
        method: 'PATCH',
        body: { nombre: form.nombre, descripcion: nullIfEmpty(form.descripcion), activo: form.activo },
      });
      await apiRequest(`/roles/${role.id_rol}/permisos`, {
        method: 'PUT',
        body: { permisos: [...selected] },
      });
      return 'Rol actualizado correctamente.';
    },
    onSuccess: (message) => void onSaved(message),
    onError: (error) => onError((error as ApiError).message),
  });

  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      title={role ? `Editar rol: ${role.nombre}` : 'Crear nuevo rol'}
      onClose={onClose}
      wide
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}><Save size={17} />Guardar</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="form-stack">
        <div className="form-grid">
          <Field label="Código" hint="Se guarda en mayúsculas y se usa internamente." required>
            <Input value={form.codigo} disabled={Boolean(role)} onChange={(e) => setForm((x) => ({ ...x, codigo: e.target.value }))} required />
          </Field>
          <Field label="Nombre" required><Input value={form.nombre} onChange={(e) => setForm((x) => ({ ...x, nombre: e.target.value }))} required /></Field>
          <Field label="Descripción"><Textarea value={form.descripcion} onChange={(e) => setForm((x) => ({ ...x, descripcion: e.target.value }))} /></Field>
          <Field label="Estado"><label className="switch-row"><input type="checkbox" checked={form.activo} onChange={(e) => setForm((x) => ({ ...x, activo: e.target.checked }))} /><span>{form.activo ? 'Rol activo' : 'Rol inactivo'}</span></label></Field>
        </div>

        <div className="section-heading"><ShieldCheck size={20} /><div><h2>Permisos del rol</h2><p>Marca únicamente las acciones que realmente debe poder realizar.</p></div></div>
        <div className="permission-groups">
          {grouped.map(([module, items]) => (
            <section key={module} className="permission-group">
              <header><strong>{module}</strong><span>{items.filter((item) => selected.has(item.id_permiso)).length}/{items.length}</span></header>
              <div>
                {items.map((permission) => (
                  <label key={permission.id_permiso} className={`permission-option ${selected.has(permission.id_permiso) ? 'selected' : ''}`}>
                    <input type="checkbox" checked={selected.has(permission.id_permiso)} onChange={() => toggle(permission.id_permiso)} />
                    <div><strong>{permission.nombre}</strong><span>{permission.codigo}</span></div>
                    {selected.has(permission.id_permiso) ? <Check size={17} /> : null}
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </form>
    </Modal>
  );
}

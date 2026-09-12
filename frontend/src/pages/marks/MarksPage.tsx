import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, CheckSquare2, Edit3, ImagePlus, Plus, Square, Tag, Trash2, UserRound, X } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Textarea } from '../../components/ui';
import type { Mark, OwnerOption } from '../../types/api';

interface Form {
  id?: string;
  id_usuarios: string[];
  codigo: string;
  nombre: string;
  descripcion: string;
  activo: boolean;
  foto: File | null;
  foto_actual: string | null;
}
const emptyForm = (): Form => ({ id_usuarios: [], codigo: '', nombre: '', descripcion: '', activo: true, foto: null, foto_actual: null });

export function MarksPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [deleteItem, setDeleteItem] = useState<Mark | null>(null);
  const [search, setSearch] = useState('');
  const [descending, setDescending] = useState(false);
  const marks = useQuery({ queryKey: ['marks'], queryFn: () => apiRequest<Mark[]>('/marquillas') });
  const users = useQuery({ queryKey: ['marks', 'users'], queryFn: () => apiRequest<OwnerOption[]>('/marquillas/usuarios') });
  const visibleMarks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (marks.data ?? []).filter((mark) => !term || `${mark.nombre} ${mark.codigo} ${mark.usuario ?? ''}`.toLocaleLowerCase('es').includes(term)).sort((a, b) => {
      const result = a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
      return descending ? -result : result;
    });
  }, [descending, marks.data, search]);
  const save = useMutation({
    mutationFn: () => {
      if (!form?.id_usuarios.length || !form.codigo.trim() || !form.nombre.trim()) throw new Error('Completa usuarios, código y nombre.');
      const data = new FormData();
      data.set('data', JSON.stringify({
        id_usuarios: form.id_usuarios,
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        activo: form.activo,
      }));
      if (form.foto) data.set('foto', form.foto);
      return apiRequest<Mark>(`/marquillas${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PATCH' : 'POST', body: data });
    },
    onSuccess: () => {
      toast.show(form?.id ? 'Fierro actualizado.' : 'Fierro registrado.');
      setForm(null);
      void client.invalidateQueries({ queryKey: ['marks'] });
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/marquillas/${deleteItem?.id_marquilla}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.show('Fierro desactivado.');
      setDeleteItem(null);
      void client.invalidateQueries({ queryKey: ['marks'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  function edit(mark: Mark) {
    setForm({
      id: mark.id_marquilla,
      id_usuarios: mark.usuarios?.map((user) => user.id_usuario) ?? [],
      codigo: mark.codigo,
      nombre: mark.nombre,
      descripcion: mark.descripcion ?? '',
      activo: mark.activo,
      foto: null,
      foto_actual: mark.secure_url,
    });
  }

  function toggleUser(id: string) {
    setForm((current) => current ? { ...current, id_usuarios: current.id_usuarios.includes(id) ? current.id_usuarios.filter((item) => item !== id) : [...current.id_usuarios, id] } : current);
  }

  return <div className="module-no-header">
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar fierro, código o propietario…" count={visibleMarks.length} actions={<IconButton label={descending ? 'Orden Z a A' : 'Orden A a Z'} onClick={() => setDescending((value) => !value)}><ArrowUpDown size={18}/></IconButton>}/>
    {marks.isLoading ? <LoadingState /> : marks.isError ? <ErrorState message={(marks.error as Error).message} onRetry={() => void marks.refetch()} /> : visibleMarks.length ? <div className="mark-list">
      {visibleMarks.map((mark) => <Card className="mark-row" key={mark.id_marquilla}>
        <div className="mark-photo mark-photo-43">{mark.secure_url ? <img src={mark.secure_url} alt={mark.nombre} /> : <Tag size={25} />}</div>
        <div><strong>{mark.nombre}</strong><small>Código {mark.codigo}</small></div>
        <div className="mark-owner"><UserRound size={16} /><span>{mark.usuario}<small>{mark.usuarios?.length ?? 0} usuario(s)</small></span></div>
        <div><Badge tone={mark.activo ? 'success' : 'neutral'}>{mark.activo ? 'Activo' : 'Inactivo'}</Badge><small>{mark.total_animales ?? 0} animales</small></div>
        {hasPermission('CATALOGO_ADMINISTRAR') ? <div className="inline-actions"><IconButton label="Editar fierro" onClick={() => edit(mark)}><Edit3 size={16} /></IconButton><IconButton label="Desactivar fierro" onClick={() => setDeleteItem(mark)}><Trash2 size={16} /></IconButton></div> : null}
      </Card>)}
    </div> : <EmptyState icon={Tag} title="Sin fierros" description="Registra el primer fierro y relaciónalo con sus usuarios." />}

    {form ? <Modal title={form.id ? 'Editar fierro' : 'Nuevo fierro'} onClose={() => setForm(null)} footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="form-stack">
        <div className="form-grid"><Field label="Código" required><Input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} /></Field><Field label="Nombre" required><Input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></Field></div>
        <Field label="Usuarios relacionados" required hint="Un mismo fierro puede pertenecer a varias personas.">
          {users.isLoading ? <div className="mark-users-status">Cargando usuarios…</div> : users.isError ? <ErrorState message={(users.error as Error).message} onRetry={() => void users.refetch()} /> : users.data?.length ? <div className="choice-grid mark-user-grid">{users.data.map((user) => { const selected=form.id_usuarios.includes(user.id_usuario); return <button type="button" aria-pressed={selected} className={`choice-card ${selected ? 'selected' : ''}`} key={user.id_usuario} onClick={() => toggleUser(user.id_usuario)}>{selected?<CheckSquare2 size={19}/>:<Square size={19}/>}<span>{user.nombre}<small>{user.correo}</small></span></button>; })}</div> : <div className="mark-users-status">No hay usuarios activos disponibles.</div>}
        </Field>
        <Field label="Descripción"><Textarea value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></Field>
        <Field label="Foto del fierro" hint="La imagen se recortará automáticamente a formato 4:3."><MarkPhotoPicker current={form.foto_actual} file={form.foto} onChange={(foto) => setForm({ ...form, foto })} /></Field>
        <label className="checkbox"><input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} />Activo</label>
      </div>
    </Modal> : null}
    {hasPermission('CATALOGO_ADMINISTRAR') ? <FloatingActionDock><IconButton label="Agregar fierro" onClick={() => setForm(emptyForm())}><Plus size={22}/></IconButton></FloatingActionDock> : null}
    {deleteItem ? <ConfirmDialog title="Desactivar fierro" message={`Se desactivará ${deleteItem.nombre}; los animales relacionados conservarán el dato.`} onClose={() => setDeleteItem(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} /> : null}
  </div>;
}

function MarkPhotoPicker({ current, file, onChange }: { current: string | null; file: File | null; onChange: (file: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(current);
  useEffect(() => {
    if (!file) { setPreview(current); return undefined; }
    const next = URL.createObjectURL(file);
    setPreview(next);
    return () => URL.revokeObjectURL(next);
  }, [file, current]);
  return <div className="mark-photo-picker"><label>{preview ? <img src={preview} alt="Vista previa del fierro" /> : <span><ImagePlus size={28} /><strong>Seleccionar imagen 4:3</strong></span>}<input type="file" accept="image/*" hidden onChange={(event) => onChange(event.target.files?.[0] ?? null)} /></label>{file ? <IconButton label="Quitar cambio de imagen" onClick={() => onChange(null)}><X size={15} /></IconButton> : null}</div>;
}

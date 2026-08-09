import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Save, Scale, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useToast } from '../../components/ToastContext';
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, Group, Location, Mark, OwnerOption } from '../../types/api';
import { dateInputValue, isAtLeastOneYear, nullIfEmpty, numberOrNull } from '../../utils';

interface AnimalFormModalProps {
  animal?: Animal | null;
  onClose: () => void;
  onSaved: (id?: string) => void;
}

interface FormState {
  codigo_arete: string;
  nombre: string;
  descripcion: string;
  id_especie: string;
  sexo: 'MACHO' | 'HEMBRA';
  fecha_nacimiento: string;
  id_madre: string;
  id_padre: string;
  id_origen: string;
  id_categoria_animal: string;
  id_marquilla: string;
  id_grupo_actual: string;
  id_ubicacion_actual: string;
  fecha_ingreso: string;
  estado: Animal['estado'];
  colores: { id: string; principal: boolean }[];
  razas: { id: string; porcentaje: string }[];
  propietarios: { id: string; porcentaje: string; principal: boolean }[];
  peso_inicial_kg: string;
  fecha_pesaje_inicial: string;
  metodo_pesaje_inicial: string;
  observaciones_pesaje_inicial: string;
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    codigo_arete: '',
    nombre: '',
    descripcion: '',
    id_especie: '',
    sexo: 'HEMBRA',
    fecha_nacimiento: '',
    id_madre: '',
    id_padre: '',
    id_origen: '',
    id_categoria_animal: '',
    id_marquilla: '',
    id_grupo_actual: '',
    id_ubicacion_actual: '',
    fecha_ingreso: '',
    estado: 'ACTIVO',
    colores: [],
    razas: [],
    propietarios: [],
    peso_inicial_kg: '',
    fecha_pesaje_inicial: localToday(),
    metodo_pesaje_inicial: '',
    observaciones_pesaje_inicial: '',
  };
}

export function AnimalFormModal({ animal, onClose, onSaved }: AnimalFormModalProps) {
  const toast = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);

  const species = useCatalog('especies');
  const origins = useCatalog('origenes');
  const categories = useCatalog('categorias-animales');
  const conditions = useCatalog('condiciones-animales');
  const colors = useCatalog('colores');
  const breeds = useCatalog('razas');
  const marks = useQuery({ queryKey: ['marks'], queryFn: () => apiRequest<Mark[]>('/marquillas') });
  const groups = useQuery({
    queryKey: ['groups', 'select'],
    queryFn: () => apiRequest<Group[]>('/grupos?limit=100'),
  });
  const locations = useQuery({ queryKey: ['locations', 'animal-form'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  const owners = useQuery({
    queryKey: ['animal-owner-options'],
    queryFn: () => apiRequest<OwnerOption[]>('/animales/opciones/propietarios'),
  });
  const mothers = useQuery({
    queryKey: ['animals', 'mothers'],
    queryFn: () => apiRequest<Animal[]>('/animales?limit=100&sexo=HEMBRA'),
  });
  const fathers = useQuery({
    queryKey: ['animals', 'fathers'],
    queryFn: () => apiRequest<Animal[]>('/animales?limit=100&sexo=MACHO'),
  });

  useEffect(() => {
    setProfileFile(null);
    setProfilePreview(null);
    if (!animal) {
      setForm(emptyForm());
      return;
    }
    setForm({
      codigo_arete: animal.codigo_arete ?? '',
      nombre: animal.nombre,
      descripcion: animal.descripcion ?? '',
      id_especie: animal.id_especie,
      sexo: animal.sexo,
      fecha_nacimiento: dateInputValue(animal.fecha_nacimiento),
      id_madre: animal.id_madre ?? '',
      id_padre: animal.id_padre ?? '',
      id_origen: animal.id_origen,
      id_categoria_animal: animal.id_categoria_animal,
      id_marquilla: animal.id_marquilla ?? '',
      id_grupo_actual: animal.id_grupo_actual ?? '',
      id_ubicacion_actual: animal.id_ubicacion_actual ?? '',
      fecha_ingreso: dateInputValue(animal.fecha_ingreso),
      estado: animal.estado,
      colores: animal.colores?.map((item) => ({ id: item.id_color, principal: item.es_principal })) ?? [],
      razas: animal.razas?.map((item) => ({ id: item.id_raza, porcentaje: item.porcentaje?.toString() ?? '' })) ?? [],
      propietarios: animal.propietarios?.map((item) => ({ id: item.id_usuario, porcentaje: item.porcentaje?.toString() ?? '', principal: item.es_principal })) ?? [],
      peso_inicial_kg: '',
      fecha_pesaje_inicial: localToday(),
      metodo_pesaje_inicial: '',
      observaciones_pesaje_inicial: '',
    });
  }, [animal]);

  useEffect(() => () => {
    if (profilePreview?.startsWith('blob:')) URL.revokeObjectURL(profilePreview);
  }, [profilePreview]);

  useEffect(() => {
    if (animal) return;
    if (!form.id_especie && species.data?.length) {
      setForm((current) => ({ ...current, id_especie: itemId(species.data![0]) }));
    }
    if (!form.id_origen && origins.data?.length) {
      setForm((current) => ({ ...current, id_origen: itemId(origins.data![0]) }));
    }
    if (!form.id_categoria_animal && categories.data?.length) {
      const preferred = categories.data.find((item) => item.codigo === 'EN_PROPIEDAD' && item.activo !== false) ?? categories.data.find((item) => item.activo !== false);
      if (preferred) setForm((current) => ({ ...current, id_categoria_animal: itemId(preferred) }));
    }
  }, [animal, species.data, origins.data, categories.data, form.id_especie, form.id_origen, form.id_categoria_animal]);

  const filteredBreeds = useMemo(
    () => breeds.data?.filter((item) => !item.id_especie || item.id_especie === form.id_especie) ?? [],
    [breeds.data, form.id_especie],
  );

  const availableLocations = useMemo(() => (locations.data ?? [])
    .filter((item) => item.activo && item.id_categoria_animal === form.id_categoria_animal)
    .map((item) => ({ id: item.id_ubicacion, label: `${item.nombre} · ${item.tipo === 'OTRO' ? 'Otra propiedad' : item.tipo === 'POTRERO' ? 'Potrero' : 'Corral'}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [locations.data, form.id_categoria_animal]);

  function baseBody() {
    return {
      codigo_arete: nullIfEmpty(form.codigo_arete),
      nombre: form.nombre.trim(),
      descripcion: nullIfEmpty(form.descripcion),
      id_especie: form.id_especie,
      sexo: form.sexo,
      fecha_nacimiento: form.fecha_nacimiento || null,
      id_madre: form.id_madre || null,
      id_padre: form.id_padre || null,
      id_origen: form.id_origen,
      id_categoria_animal: form.id_categoria_animal,
      id_marquilla: form.id_marquilla || null,
      id_grupo_actual: form.id_grupo_actual || null,
      id_ubicacion_actual: form.id_ubicacion_actual || null,
      fecha_ingreso: form.fecha_ingreso || null,
      estado: form.estado,
      colores: form.colores.map((item) => ({ id: item.id, principal: item.principal })),
      razas: form.razas.map((item) => ({ id: item.id, porcentaje: numberOrNull(item.porcentaje) })),
      propietarios: form.propietarios.map((item) => ({ id: item.id, porcentaje: numberOrNull(item.porcentaje), principal: item.principal })),
    };
  }

  function editableBody() {
    const {
      id_categoria_animal: _category,
      id_grupo_actual: _group,
      id_ubicacion_actual: _location,
      fecha_ingreso: _entryDate,
      estado: _condition,
      ...editable
    } = baseBody();
    return editable;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (animal) {
        return apiRequest<Animal>(`/animales/${animal.id_animal}`, {
          method: 'PATCH',
          body: editableBody(),
        });
      }

      const weight = numberOrNull(form.peso_inicial_kg);
      if (form.peso_inicial_kg.trim() && (weight === null || weight <= 0)) {
        throw new ApiError(400, 'INVALID_INITIAL_WEIGHT', 'El peso inicial debe ser mayor que cero.');
      }

      const data = {
        ...baseBody(),
        peso_inicial_kg: weight,
        fecha_pesaje_inicial: weight ? form.fecha_pesaje_inicial || localToday() : null,
        metodo_pesaje_inicial: weight ? nullIfEmpty(form.metodo_pesaje_inicial) : null,
        observaciones_pesaje_inicial: weight ? nullIfEmpty(form.observaciones_pesaje_inicial) : null,
      };

      const multipart = new FormData();
      multipart.append('data', JSON.stringify(data));
      if (profileFile) multipart.append('foto_perfil', profileFile);

      return apiRequest<Animal>('/animales', {
        method: 'POST',
        body: multipart,
      });
    },
    onSuccess: async (result) => {
      toast.show(animal ? 'Animal actualizado.' : 'Animal registrado con su foto y peso inicial.');
      await client.invalidateQueries({ queryKey: ['animals'] });
      await client.invalidateQueries({ queryKey: ['animal'] });
      await client.invalidateQueries({ queryKey: ['animal-filter-options'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
      onSaved(result?.id_animal ?? animal?.id_animal);
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  function chooseProfile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.show('Selecciona un archivo de imagen.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.show('La imagen no puede superar 8 MB.', 'error');
      return;
    }
    if (profilePreview?.startsWith('blob:')) URL.revokeObjectURL(profilePreview);
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
  }

  function removeProfile() {
    if (profilePreview?.startsWith('blob:')) URL.revokeObjectURL(profilePreview);
    setProfileFile(null);
    setProfilePreview(null);
  }

  const toggleColor = (id: string) => setForm((current) => ({
    ...current,
    colores: current.colores.some((item) => item.id === id)
      ? current.colores.filter((item) => item.id !== id)
      : [...current.colores, { id, principal: current.colores.length === 0 }],
  }));

  const setPrincipalColor = (id: string) => setForm((current) => ({
    ...current,
    colores: current.colores.map((item) => ({ ...item, principal: item.id === id })),
  }));

  const toggleBreed = (id: string) => setForm((current) => ({
    ...current,
    razas: current.razas.some((item) => item.id === id)
      ? current.razas.filter((item) => item.id !== id)
      : [...current.razas, { id, porcentaje: '' }],
  }));

  const toggleOwner = (id: string) => setForm((current) => {
    const exists = current.propietarios.some((item) => item.id === id);
    const next = exists
      ? current.propietarios.filter((item) => item.id !== id)
      : [...current.propietarios, { id, porcentaje: '', principal: current.propietarios.length === 0 }];
    if (next.length && !next.some((item) => item.principal)) next[0] = { ...next[0], principal: true };
    return { ...current, propietarios: next };
  });

  const setPrincipalOwner = (id: string) => setForm((current) => ({
    ...current,
    propietarios: current.propietarios.map((item) => ({ ...item, principal: item.id === id })),
  }));

  return (
    <Modal
      title={animal ? `Editar ${animal.nombre}` : 'Registrar animal'}
      onClose={onClose}
      wide
      footer={(
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="animal-form" loading={mutation.isPending}>
            {animal ? <Save size={18} /> : <Plus size={18} />}
            {animal ? 'Guardar cambios' : 'Registrar animal'}
          </Button>
        </>
      )}
    >
      <form id="animal-form" onSubmit={submit} className="form-stack">
        {!animal ? (
          <div className="form-section">
            <h3>Foto de perfil y peso inicial</h3>
            <div className="animal-create-media">
              <div className="animal-photo-column">
                <label className={`animal-photo-picker ${profilePreview ? 'has-photo' : ''}`}>
                  {profilePreview ? (
                    <img src={profilePreview} alt="Vista previa del animal" />
                  ) : (
                    <span>
                      <ImagePlus size={34} />
                      <strong>Seleccionar foto</strong>
                      <small>JPG, PNG o WebP · máximo 8 MB</small>
                    </span>
                  )}
                  <input type="file" accept="image/*" onChange={chooseProfile} />
                </label>
                {profileFile ? <>
                  <Button type="button" variant="ghost" onClick={removeProfile}>
                    <Trash2 size={16} /> Quitar foto
                  </Button>
                </> : null}
              </div>

              <div className="animal-weight-panel">
                <div className="animal-weight-title">
                  <Scale size={22} />
                  <div>
                    <strong>Peso inicial</strong>
                    <small>Se guardará como el primer pesaje del historial.</small>
                  </div>
                </div>
                <div className="form-grid">
                  <Field label="Peso (kg)">
                    <Input
                      type="number"
                      min="0.001"
                      step="0.001"
                      placeholder="Ej. 325.5"
                      value={form.peso_inicial_kg}
                      onChange={(event) => setForm((current) => ({ ...current, peso_inicial_kg: event.target.value }))}
                    />
                  </Field>
                  <Field label="Fecha del pesaje">
                    <Input
                      type="date"
                      value={form.fecha_pesaje_inicial}
                      onChange={(event) => setForm((current) => ({ ...current, fecha_pesaje_inicial: event.target.value }))}
                      disabled={!form.peso_inicial_kg.trim()}
                    />
                  </Field>
                  <Field label="Método">
                    <Input
                      placeholder="Báscula, cinta, estimado…"
                      value={form.metodo_pesaje_inicial}
                      onChange={(event) => setForm((current) => ({ ...current, metodo_pesaje_inicial: event.target.value }))}
                      disabled={!form.peso_inicial_kg.trim()}
                    />
                  </Field>
                  <Field label="Observaciones">
                    <Input
                      placeholder="Opcional"
                      value={form.observaciones_pesaje_inicial}
                      onChange={(event) => setForm((current) => ({ ...current, observaciones_pesaje_inicial: event.target.value }))}
                      disabled={!form.peso_inicial_kg.trim()}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="form-section">
          <h3>Identificación</h3>
          <div className="form-grid">
            <Field label="Nombre" required>
              <Input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required />
            </Field>
            <Field label="Código o arete">
              <Input value={form.codigo_arete} onChange={(event) => setForm((current) => ({ ...current, codigo_arete: event.target.value }))} />
            </Field>
            <Field label="Especie" required>
              <Select value={form.id_especie} onChange={(event) => setForm((current) => ({ ...current, id_especie: event.target.value, razas: [] }))} required>
                <option value="">Selecciona</option>
                {species.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="Sexo" required>
              <Select value={form.sexo} onChange={(event) => setForm((current) => ({ ...current, sexo: event.target.value as FormState['sexo'] }))}>
                <option value="HEMBRA">Hembra</option>
                <option value="MACHO">Macho</option>
              </Select>
            </Field>
            <Field label="Fecha de nacimiento">
              <Input type="date" value={form.fecha_nacimiento} onChange={(event) => setForm((current) => ({ ...current, fecha_nacimiento: event.target.value }))} />
            </Field>
            <Field label="Origen" required>
              <Select value={form.id_origen} onChange={(event) => setForm((current) => ({ ...current, id_origen: event.target.value }))} required>
                <option value="">Selecciona</option>
                {origins.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="Fierro">
              <Select value={form.id_marquilla} onChange={(event) => setForm((current) => ({ ...current, id_marquilla: event.target.value }))}>
                <option value="">Sin fierro</option>
                {marks.data?.filter((item) => item.activo || item.id_marquilla === form.id_marquilla).map((item) => <option key={item.id_marquilla} value={item.id_marquilla}>{item.nombre} · {item.codigo}{item.usuario ? ` · ${item.usuario}` : ''}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Descripción">
            <Textarea rows={3} value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} />
          </Field>
        </div>

        {!animal ? <div className="form-section">
          <h3>Clasificación y lugar actual</h3>
          <div className="form-grid">
            <Field label="Situación de propiedad" required hint="Indica si el animal está dentro de la finca o en otra propiedad.">
              <Select value={form.id_categoria_animal} onChange={(event) => setForm((current) => ({ ...current, id_categoria_animal: event.target.value, id_ubicacion_actual: '' }))} required>
                <option value="">Selecciona</option>
                {categories.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="Grupo actual">
              <Select value={form.id_grupo_actual} onChange={(event) => setForm((current) => ({ ...current, id_grupo_actual: event.target.value }))}>
                <option value="">Sin grupo</option>
                {groups.data?.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Ubicación actual">
              <Select value={form.id_ubicacion_actual} onChange={(event) => setForm((current) => ({ ...current, id_ubicacion_actual: event.target.value }))}>
                <option value="">Sin ubicación específica</option>
                {availableLocations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </Select>
            </Field>
            <Field label="Fecha de ingreso">
              <Input type="date" value={form.fecha_ingreso} onChange={(event) => setForm((current) => ({ ...current, fecha_ingreso: event.target.value }))} />
            </Field>
            <Field label="Actividad del animal" hint="Un animal inactivo no estará disponible para movimientos, ventas, sanidad ni reproducción.">
              <Select value={form.estado} onChange={(event) => setForm((current) => ({ ...current, estado: event.target.value as Animal['estado'] }))}>
                {conditions.data?.filter((item) => item.activo !== false && ['ACTIVO', 'INACTIVO'].includes(String(item.codigo))).map((item) => <option key={String(item.codigo)} value={String(item.codigo)}>{itemLabel(item)}</option>)}
              </Select>
            </Field>
          </div>
        </div> : null}

        <div className="form-section">
          <h3>Genealogía</h3>
          <div className="form-grid">
            <Field label="Madre">
              <Select value={form.id_madre} onChange={(event) => setForm((current) => ({ ...current, id_madre: event.target.value }))}>
                <option value="">Sin registrar</option>
                {mothers.data?.filter((item) => item.id_animal !== animal?.id_animal).map((item) => (
                  <option key={item.id_animal} value={item.id_animal}>{item.nombre}{item.codigo_arete ? ` · ${item.codigo_arete}` : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label="Padre">
              <Select value={form.id_padre} onChange={(event) => setForm((current) => ({ ...current, id_padre: event.target.value }))}>
                <option value="">Sin registrar</option>
                {fathers.data?.filter((item) => item.id_animal !== animal?.id_animal && isAtLeastOneYear(item.fecha_nacimiento)).map((item) => (
                  <option key={item.id_animal} value={item.id_animal}>{item.nombre}{item.codigo_arete ? ` · ${item.codigo_arete}` : ''}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Propietarios</h3>
          <p className="muted">Selecciona uno o varios propietarios. Solo uno puede quedar como principal.</p>
          <div className="choice-grid">
            {owners.data?.map((owner) => {
              const selected = form.propietarios.find((item) => item.id === owner.id_usuario);
              return <div className={`choice-card ${selected ? 'selected' : ''}`} key={owner.id_usuario}>
                <label><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleOwner(owner.id_usuario)} /><span>{owner.nombre}<small>{owner.correo}</small></span></label>
                {selected ? <>
                  <label className="radio-small"><input type="radio" name="principal-owner" checked={selected.principal} onChange={() => setPrincipalOwner(owner.id_usuario)} />Principal</label>
                  <Input type="number" min="0" max="100" step="0.01" placeholder="% de propiedad" value={selected.porcentaje} onChange={(event) => setForm((current) => ({ ...current, propietarios: current.propietarios.map((item) => item.id === owner.id_usuario ? { ...item, porcentaje: event.target.value } : item) }))} />
                </> : null}
              </div>;
            })}
          </div>
        </div>

        <div className="form-section">
          <h3>Colores</h3>
          <div className="choice-grid">
            {colors.data?.map((item) => {
              const id = itemId(item);
              const selected = form.colores.find((entry) => entry.id === id);
              return (
                <div className={`choice-card ${selected ? 'selected' : ''}`} key={id}>
                  <label>
                    <input type="checkbox" checked={Boolean(selected)} onChange={() => toggleColor(id)} />
                    <span>{itemLabel(item)}</span>
                  </label>
                  {selected ? (
                    <label className="radio-small">
                      <input type="radio" name="principal-color" checked={selected.principal} onChange={() => setPrincipalColor(id)} />
                      Principal
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="form-section">
          <h3>Razas</h3>
          <div className="choice-grid">
            {filteredBreeds.map((item) => {
              const id = itemId(item);
              const selected = form.razas.find((entry) => entry.id === id);
              return (
                <div className={`choice-card ${selected ? 'selected' : ''}`} key={id}>
                  <label>
                    <input type="checkbox" checked={Boolean(selected)} onChange={() => toggleBreed(id)} />
                    <span>{itemLabel(item)}</span>
                  </label>
                  {selected ? (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="%"
                      value={selected.porcentaje}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        razas: current.razas.map((entry) => entry.id === id ? { ...entry, porcentaje: event.target.value } : entry),
                      }))}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </form>
    </Modal>
  );
}

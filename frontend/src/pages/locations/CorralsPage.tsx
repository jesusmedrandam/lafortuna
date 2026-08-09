import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Edit3, Plus, Warehouse } from "lucide-react";
import { apiRequest, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/ToastContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../../components/ui";
import { itemId, itemLabel, useCatalog } from "../../hooks/useCatalog";
import type { Corral, Location } from "../../types/api";
import { formatNumber, nullIfEmpty, numberOrNull } from "../../utils";

interface CorralForm {
  nombre: string;
  codigo: string;
  id_propiedad_padre: string;
  descripcion: string;
  activo: boolean;
  id_tipo_corral: string;
  area: string;
  id_unidad_area: string;
  capacidad: string;
  material_piso: string;
  cubierto: boolean;
  disponibilidad_agua: boolean;
  observaciones: string;
}
const MAIN_PROPERTY = "PROPIEDAD_PRINCIPAL";
const empty: CorralForm = {
  nombre: "",
  codigo: "",
  id_propiedad_padre: MAIN_PROPERTY,
  descripcion: "",
  activo: true,
  id_tipo_corral: "",
  area: "",
  id_unidad_area: "",
  capacidad: "",
  material_piso: "",
  cubierto: false,
  disponibilidad_agua: true,
  observaciones: "",
};

function CorralModal({
  corral,
  onClose,
}: {
  corral?: Corral | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<CorralForm>(empty);
  const types = useCatalog("tipos-corral");
  const units = useCatalog("unidades");
  const properties = useQuery({
    queryKey: ["locations", "properties", "corral-form"],
    queryFn: () => apiRequest<Location[]>("/ubicaciones?tipo=OTRO"),
  });
  useEffect(
    () =>
      setForm(
        corral
          ? {
              nombre: corral.nombre,
              codigo: corral.codigo ?? "",
              id_propiedad_padre:
                corral.propiedad_es_principal ? MAIN_PROPERTY : corral.id_propiedad,
              descripcion: corral.descripcion ?? "",
              activo: corral.activo,
              id_tipo_corral: corral.id_tipo_corral,
              area: corral.area?.toString() ?? "",
              id_unidad_area: corral.id_unidad_area ?? "",
              capacidad: corral.capacidad?.toString() ?? "",
              material_piso: corral.material_piso ?? "",
              cubierto: corral.cubierto ?? false,
              disponibilidad_agua: corral.disponibilidad_agua ?? false,
              observaciones: corral.observaciones ?? "",
            }
          : empty,
      ),
    [corral],
  );
  useEffect(() => {
    if (!form.id_tipo_corral && types.data?.length)
      setForm((x) => ({ ...x, id_tipo_corral: itemId(types.data![0]) }));
  }, [types.data, form.id_tipo_corral]);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(corral ? `/corrales/${corral.id_corral}` : "/corrales", {
        method: corral ? "PATCH" : "POST",
        body: {
          ubicacion: {
            nombre: form.nombre,
            codigo: nullIfEmpty(form.codigo),
            id_propiedad_padre:
              form.id_propiedad_padre === MAIN_PROPERTY
                ? null
                : form.id_propiedad_padre,
            descripcion: nullIfEmpty(form.descripcion),
            activo: form.activo,
          },
          id_tipo_corral: form.id_tipo_corral,
          area: numberOrNull(form.area),
          id_unidad_area: form.id_unidad_area || null,
          capacidad: numberOrNull(form.capacidad),
          material_piso: nullIfEmpty(form.material_piso),
          cubierto: form.cubierto,
          disponibilidad_agua: form.disponibilidad_agua,
          observaciones: nullIfEmpty(form.observaciones),
        },
      }),
    onSuccess: async () => {
      toast.show(corral ? "Corral actualizado." : "Corral creado.");
      await client.invalidateQueries({ queryKey: ["corrals"] });
      await client.invalidateQueries({ queryKey: ["locations"] });
      onClose();
    },
    onError: (error) => toast.show((error as ApiError).message, "error"),
  });
  return (
    <Modal
      title={corral ? "Editar corral" : "Nuevo corral"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="corral-form" loading={mutation.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="corral-form"
        className="form-stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <Field label="Nombre" required>
            <Input
              value={form.nombre}
              onChange={(e) =>
                setForm((x) => ({ ...x, nombre: e.target.value }))
              }
              required
            />
          </Field>
          <Field label="Código">
            <Input
              value={form.codigo}
              onChange={(e) =>
                setForm((x) => ({ ...x, codigo: e.target.value }))
              }
            />
          </Field>
          <Field
            label="Propiedad"
            required
            hint="El corral quedará disponible únicamente para grupos de esta propiedad."
          >
            <Select
              disabled={Boolean(corral && Number(corral.total_animales) > 0)}
              value={form.id_propiedad_padre}
              onChange={(e) =>
                setForm((x) => ({
                  ...x,
                  id_propiedad_padre: e.target.value,
                }))
              }
            >
              <option value={MAIN_PROPERTY}>Propiedad principal</option>
              {properties.data
                ?.filter(
                  (item) =>
                    item.activo ||
                    item.id_ubicacion === form.id_propiedad_padre,
                )
                .map((item) => (
                  <option key={item.id_ubicacion} value={item.id_ubicacion}>
                    {item.nombre}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Tipo de corral" required>
            <Select
              value={form.id_tipo_corral}
              onChange={(e) =>
                setForm((x) => ({ ...x, id_tipo_corral: e.target.value }))
              }
            >
              {types.data?.map((item) => (
                <option key={itemId(item)} value={itemId(item)}>
                  {itemLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Capacidad">
            <Input
              type="number"
              min="0"
              value={form.capacidad}
              onChange={(e) =>
                setForm((x) => ({ ...x, capacidad: e.target.value }))
              }
            />
          </Field>
          <Field label="Área">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.area}
              onChange={(e) => setForm((x) => ({ ...x, area: e.target.value }))}
            />
          </Field>
          <Field label="Unidad de área">
            <Select
              value={form.id_unidad_area}
              onChange={(e) =>
                setForm((x) => ({ ...x, id_unidad_area: e.target.value }))
              }
            >
              <option value="">Sin unidad</option>
              {units.data?.map((item) => (
                <option key={itemId(item)} value={itemId(item)}>
                  {itemLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Material del piso">
            <Input
              value={form.material_piso}
              onChange={(e) =>
                setForm((x) => ({ ...x, material_piso: e.target.value }))
              }
              placeholder="Tierra, cemento, madera…"
            />
          </Field>
          <Field label="Cubierto">
            <Select
              value={String(form.cubierto)}
              onChange={(e) =>
                setForm((x) => ({ ...x, cubierto: e.target.value === "true" }))
              }
            >
              <option value="true">Sí</option>
              <option value="false">No</option>
            </Select>
          </Field>
          <Field label="Disponibilidad de agua">
            <Select
              value={String(form.disponibilidad_agua)}
              onChange={(e) =>
                setForm((x) => ({
                  ...x,
                  disponibilidad_agua: e.target.value === "true",
                }))
              }
            >
              <option value="true">Sí</option>
              <option value="false">No</option>
            </Select>
          </Field>
          <Field label="Estado">
            <Select
              value={String(form.activo)}
              onChange={(e) =>
                setForm((x) => ({ ...x, activo: e.target.value === "true" }))
              }
            >
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </Select>
          </Field>
        </div>
        <Field label="Descripción">
          <Textarea
            rows={2}
            value={form.descripcion}
            onChange={(e) =>
              setForm((x) => ({ ...x, descripcion: e.target.value }))
            }
          />
        </Field>
        <Field label="Observaciones">
          <Textarea
            rows={2}
            value={form.observaciones}
            onChange={(e) =>
              setForm((x) => ({ ...x, observaciones: e.target.value }))
            }
          />
        </Field>
      </form>
    </Modal>
  );
}

export function CorralsPage() {
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState<Corral | null | undefined>(undefined);
  const query = useQuery({
    queryKey: ["corrals"],
    queryFn: () => apiRequest<Corral[]>("/corrales"),
  });
  return (
    <div>
      <PageHeader
        title="Corrales"
        description="Registra corrales de ordeño, manejo, maternidad, engorde o aislamiento."
        action={
          hasPermission("CORRAL_ADMINISTRAR") ? (
            <Button onClick={() => setEditing(null)}>
              <Plus size={18} />
              Nuevo corral
            </Button>
          ) : undefined
        }
      />
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data?.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="Sin corrales"
          description="Registra el primer corral de la propiedad."
        />
      ) : (
        <div className="record-grid">
          {query.data?.map((corral) => (
            <Card key={corral.id_corral} className="record-card">
              <div className="record-card-header">
                <div className="record-icon">
                  <Warehouse size={22} />
                </div>
                <div>
                  <h3>{corral.nombre}</h3>
                  <span>
                    {corral.propiedad || "Propiedad principal"} · {corral.tipo_corral}
                  </span>
                </div>
                <Badge tone={corral.activo ? "success" : "neutral"}>
                  {corral.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <div className="record-details">
                <span>
                  <small>Área</small>
                  <strong>
                    {corral.area != null ? formatNumber(corral.area) : "—"}
                  </strong>
                </span>
                <span>
                  <small>Capacidad</small>
                  <strong>{corral.capacidad ?? "—"}</strong>
                </span>
                <span>
                  <small>Cubierto</small>
                  <strong>{corral.cubierto ? "Sí" : "No"}</strong>
                </span>
                <span>
                  <small>Agua</small>
                  <strong>
                    {corral.disponibilidad_agua ? (
                      <>
                        <Droplets size={15} /> Sí
                      </>
                    ) : (
                      "No"
                    )}
                  </strong>
                </span>
              </div>
              <p>
                {corral.descripcion ||
                  corral.observaciones ||
                  "Sin descripción."}
              </p>
              {hasPermission("CORRAL_ADMINISTRAR") ? (
                <div className="record-actions">
                  <Button variant="ghost" onClick={() => setEditing(corral)}>
                    <Edit3 size={17} />
                    Editar
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {editing !== undefined ? (
        <CorralModal corral={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}

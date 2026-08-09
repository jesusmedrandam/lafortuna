import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Settings2, ShieldCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';

interface AnimalCategory { id_categoria_animal: string; codigo: string; nombre: string }
interface AnimalOperation { codigo: string; nombre: string; grupo: string }
interface OperationSetting { id_categoria_animal: string; codigo_operacion: string; permitido: boolean }
interface OperationPolicyData { categorias: AnimalCategory[]; operaciones: AnimalOperation[]; configuracion: OperationSetting[] }

function settingKey(categoryId: string, operationCode: string) {
  return `${categoryId}:${operationCode}`;
}

export function SettingsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const query = useQuery({
    queryKey: ['animal-operation-policy'],
    queryFn: () => apiRequest<OperationPolicyData>('/configuracion/operaciones-animales'),
  });

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, boolean> = {};
    for (const category of query.data.categorias) {
      for (const operation of query.data.operaciones) {
        const current = query.data.configuracion.find((item) => item.id_categoria_animal === category.id_categoria_animal && item.codigo_operacion === operation.codigo);
        next[settingKey(category.id_categoria_animal, operation.codigo)] = current?.permitido ?? true;
      }
    }
    setDraft(next);
  }, [query.data]);

  const groupedOperations = useMemo(() => {
    const groups = new Map<string, AnimalOperation[]>();
    for (const operation of query.data?.operaciones ?? []) {
      groups.set(operation.grupo, [...(groups.get(operation.grupo) ?? []), operation]);
    }
    return [...groups.entries()];
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => apiRequest('/configuracion/operaciones-animales', {
      method: 'PUT',
      body: {
        configuracion: (query.data?.categorias ?? []).flatMap((category) => (query.data?.operaciones ?? []).map((operation) => ({
          id_categoria_animal: category.id_categoria_animal,
          codigo_operacion: operation.codigo,
          permitido: category.codigo === 'FUERA_PROPIEDAD' && ['LACTANCIA', 'PRODUCCION_LECHE'].includes(operation.codigo)
            ? false
            : draft[settingKey(category.id_categoria_animal, operation.codigo)] ?? true,
        }))),
      },
    }),
    onSuccess: async () => {
      toast.show('Configuración de operaciones actualizada.');
      await client.invalidateQueries({ queryKey: ['animal-operation-policy'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const canEdit = hasPermission('CATALOGO_ADMINISTRAR');
  return <div>
    <PageHeader
      title="Configuración"
      description="Define operaciones adicionales para la propiedad principal y las demás propiedades."
      action={canEdit ? <Button onClick={() => save.mutate()} loading={save.isPending}><Save size={18} />Guardar cambios</Button> : undefined}
    />
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : !query.data?.categorias.length ? <EmptyState icon={Settings2} title="Sin categorías" description="Crea primero las categorías de animales desde Catálogos." /> : <Card>
      <div className="form-alert"><ShieldCheck size={18} /><span>La propiedad principal se selecciona en Propiedades. Lactancias y ordeño están reservados para esa propiedad; en las demás sí se permiten los cambios de grupo, potrero y los traslados.</span></div>
      <div className="table-responsive">
        <table className="data-table">
          <thead><tr><th>Operación</th>{query.data.categorias.map((category) => <th key={category.id_categoria_animal}>{category.codigo === 'EN_PROPIEDAD' ? 'Propiedad principal' : category.codigo === 'FUERA_PROPIEDAD' ? 'Otras propiedades' : category.nombre}</th>)}</tr></thead>
          <tbody>{groupedOperations.flatMap(([group, operations]) => [
            <tr key={`group-${group}`}><td colSpan={query.data!.categorias.length + 1}><Badge tone="info">{group}</Badge></td></tr>,
            ...operations.map((operation) => <tr key={operation.codigo}>
              <td><strong>{operation.nombre}</strong></td>
              {query.data!.categorias.map((category) => {
                const key = settingKey(category.id_categoria_animal, operation.codigo);
                const allowed = draft[key] ?? true;
                const fixedByProperty = category.codigo === 'FUERA_PROPIEDAD' && ['LACTANCIA', 'PRODUCCION_LECHE'].includes(operation.codigo);
                return <td key={category.id_categoria_animal}>
                  <label className="checkbox-field"><input type="checkbox" checked={fixedByProperty ? false : allowed} disabled={!canEdit || fixedByProperty} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} /><span>{fixedByProperty ? 'Solo principal' : allowed ? 'Permitido' : 'Bloqueado'}</span></label>
                </td>;
              })}
            </tr>),
          ])}</tbody>
        </table>
      </div>
    </Card>}
  </div>;
}

import { Home, MapPinned } from 'lucide-react';

export type OwnershipScope = 'EN_PROPIEDAD' | 'FUERA_PROPIEDAD';

export function isInOwnershipScope(code: string | null | undefined, scope: OwnershipScope) {
  return scope === 'EN_PROPIEDAD' ? code === 'EN_PROPIEDAD' : code !== 'EN_PROPIEDAD';
}

export function OwnershipScopeFilter({ value, onChange }: { value: OwnershipScope; onChange: (value: OwnershipScope) => void }) {
  return <div className="page-tabs ownership-scope-filter" aria-label="Situación de los animales">
    <button type="button" className={value === 'EN_PROPIEDAD' ? 'active' : ''} onClick={() => onChange('EN_PROPIEDAD')}>
      <Home size={17} />En la propiedad
    </button>
    <button type="button" className={value === 'FUERA_PROPIEDAD' ? 'active' : ''} onClick={() => onChange('FUERA_PROPIEDAD')}>
      <MapPinned size={17} />Fuera de la propiedad
    </button>
  </div>;
}

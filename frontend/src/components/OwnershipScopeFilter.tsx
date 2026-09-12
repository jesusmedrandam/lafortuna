import { Home, MapPinned } from 'lucide-react';

export type OwnershipScope = 'EN_PROPIEDAD' | 'FUERA_PROPIEDAD';

export function isInOwnershipScope(code: string | null | undefined, scope: OwnershipScope) {
  return scope === 'EN_PROPIEDAD' ? code === 'EN_PROPIEDAD' : code !== 'EN_PROPIEDAD';
}

export function OwnershipScopeFilter({ value, onChange, compact = false }: { value: OwnershipScope; onChange: (value: OwnershipScope) => void; compact?: boolean }) {
  if (compact) return <button type="button" className={`icon-button compact-icon-filter active ownership-cycle-${value.toLowerCase()}`} aria-label={value === 'EN_PROPIEDAD' ? 'Mostrando animales en la propiedad. Pulsa para ver fuera.' : 'Mostrando animales fuera de la propiedad. Pulsa para ver dentro.'} title={value === 'EN_PROPIEDAD' ? 'En la propiedad' : 'Fuera de la propiedad'} onClick={() => onChange(value === 'EN_PROPIEDAD' ? 'FUERA_PROPIEDAD' : 'EN_PROPIEDAD')}>
    {value === 'EN_PROPIEDAD' ? <Home size={19} /> : <MapPinned size={19} />}
  </button>;
  return <div className="page-tabs ownership-scope-filter" aria-label="Situación de los animales">
    <button type="button" className={value === 'EN_PROPIEDAD' ? 'active' : ''} onClick={() => onChange('EN_PROPIEDAD')}>
      <Home size={17} />En la propiedad
    </button>
    <button type="button" className={value === 'FUERA_PROPIEDAD' ? 'active' : ''} onClick={() => onChange('FUERA_PROPIEDAD')}>
      <MapPinned size={17} />Fuera de la propiedad
    </button>
  </div>;
}

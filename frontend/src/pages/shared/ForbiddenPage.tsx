import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';
export function ForbiddenPage() { return <EmptyState icon={ShieldX} title="Acceso restringido" description="Tu cuenta no tiene permiso para consultar este módulo." action={<Button><Link to="/">Volver al panel</Link></Button>} />; }

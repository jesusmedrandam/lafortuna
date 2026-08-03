import { MapPinned } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';
export function NotFoundPage() { return <EmptyState icon={MapPinned} title="Página no encontrada" description="La dirección que abriste no pertenece al sistema." action={<Button><Link to="/">Ir al panel</Link></Button>} />; }

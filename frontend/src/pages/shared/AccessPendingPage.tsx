import { Clock3, ShieldAlert, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, PageHeader } from '../../components/ui';

export function AccessPendingPage() {
  return (
    <div>
      <PageHeader title="Cuenta sin acceso asignado" description="Tu correo ya fue verificado, pero todavía no tienes un rol." />
      <Card className="coming-card access-pending-card">
        <div className="coming-icon"><ShieldAlert size={36} /></div>
        <span className="eyebrow">Protección de datos</span>
        <h2>Un administrador debe autorizar tu cuenta</h2>
        <p>Mientras no tengas un rol, no podrás consultar animales, ubicaciones, producción ni otros datos de la finca.</p>
        <div className="coming-list">
          <span><Clock3 size={18} /> Espera a que un administrador te asigne uno o varios roles.</span>
          <span><UserRound size={18} /> Mientras tanto, puedes completar tu perfil y fotografía.</span>
        </div>
        <Button><Link to="/perfil">Ir a mi perfil</Link></Button>
      </Card>
    </div>
  );
}

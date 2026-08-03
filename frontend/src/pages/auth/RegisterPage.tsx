import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { Button, Field, Input } from '../../components/ui';

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ nombres: '', apellidos: '', correo: '', telefono: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const update = (name: keyof typeof form, value: string) => setForm((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true); setError('');
    try {
      await apiRequest('/auth/register', { method: 'POST', auth: false, body: { nombres: form.nombres, apellidos: form.apellidos, correo: form.correo, telefono: form.telefono || undefined, password: form.password } });
      navigate(`/activar?correo=${encodeURIComponent(form.correo)}`, { replace: true });
    } catch (reason) { setError((reason as ApiError).message); }
    finally { setLoading(false); }
  }

  return <div className="auth-card auth-card-wide"><div className="auth-card-heading"><span className="eyebrow">Nueva cuenta</span><h2>Registrarte</h2><p>Recibirás un código de seis dígitos. Después de verificar, un administrador deberá asignarte un rol.</p></div>{error ? <div className="form-alert form-alert-error">{error}</div> : null}<form onSubmit={submit} className="form-stack"><div className="form-grid"><Field label="Nombres" required><Input value={form.nombres} onChange={(e) => update('nombres', e.target.value)} required /></Field><Field label="Apellidos" required><Input value={form.apellidos} onChange={(e) => update('apellidos', e.target.value)} required /></Field><Field label="Correo" required><Input type="email" value={form.correo} onChange={(e) => update('correo', e.target.value)} required /></Field><Field label="Teléfono"><Input value={form.telefono} onChange={(e) => update('telefono', e.target.value)} /></Field><Field label="Contraseña" hint="Mínimo 8 caracteres, una letra y un número." required><Input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} minLength={8} required /></Field><Field label="Confirmar contraseña" required><Input type="password" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} minLength={8} required /></Field></div><Button type="submit" loading={loading}><UserPlus size={18} />Crear cuenta</Button></form><div className="auth-footer">¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link></div></div>;
}

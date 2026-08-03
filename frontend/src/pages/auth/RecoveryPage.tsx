import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { Button, Field, Input } from '../../components/ui';

export function RecoveryPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [form, setForm] = useState({ correo: '', codigo: '', password: '', confirm: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function requestCode(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try { const result = await apiRequest<{ message: string }>('/auth/forgot-password', { method: 'POST', auth: false, body: { correo: form.correo } }); setMessage(result.message); setStep('reset'); }
    catch (reason) { setError((reason as ApiError).message); }
    finally { setLoading(false); }
  }
  async function reset(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true); setError('');
    try { await apiRequest('/auth/reset-password', { method: 'POST', auth: false, body: { correo: form.correo, codigo: form.codigo, password: form.password } }); navigate('/login', { replace: true }); }
    catch (reason) { setError((reason as ApiError).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-heading">
        <span className="eyebrow">Recuperación</span>
        <h2>Restablecer contraseña</h2>
        <p>{step === 'email' ? 'Te enviaremos un código de seguridad.' : 'Ingresa el código y tu nueva contraseña.'}</p>
      </div>
      {message ? <div className="form-alert form-alert-success">{message}</div> : null}
      {error ? <div className="form-alert form-alert-error">{error}</div> : null}
      {step === 'email' ? (
        <form onSubmit={requestCode} className="form-stack">
          <Field label="Correo" required>
            <Input type="email" value={form.correo} onChange={(event) => update('correo', event.target.value)} required />
          </Field>
          <Button type="submit" loading={loading}><KeyRound size={18} />Enviar código</Button>
        </form>
      ) : (
        <form onSubmit={reset} className="form-stack">
          <Field label="Correo" required>
            <Input type="email" value={form.correo} onChange={(event) => update('correo', event.target.value)} required />
          </Field>
          <Field label="Código" required>
            <Input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.codigo} onChange={(event) => update('codigo', event.target.value.replace(/\D/g, ''))} required />
          </Field>
          <Field label="Nueva contraseña" required>
            <Input type="password" minLength={8} value={form.password} onChange={(event) => update('password', event.target.value)} required />
          </Field>
          <Field label="Confirmar contraseña" required>
            <Input type="password" minLength={8} value={form.confirm} onChange={(event) => update('confirm', event.target.value)} required />
          </Field>
          <Button type="submit" loading={loading}>Cambiar contraseña</Button>
        </form>
      )}
      <div className="auth-footer"><Link to="/login">Volver al inicio de sesión</Link></div>
    </div>
  );
}

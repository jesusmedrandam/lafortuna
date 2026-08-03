import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { Button, Field, Input } from '../../components/ui';

export function VerifyPage() {
  const [params] = useSearchParams();
  const initialEmail = useMemo(() => params.get('correo') ?? '', [params]);
  const navigate = useNavigate();
  const [correo, setCorreo] = useState(initialEmail);
  const [codigo, setCodigo] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try { await apiRequest('/auth/verify-email', { method: 'POST', auth: false, body: { correo, codigo } }); setMessage('Correo verificado. Ya puedes iniciar sesión; el acceso a los datos dependerá del rol que te asigne un administrador.'); window.setTimeout(() => navigate('/login'), 1200); }
    catch (reason) { setError((reason as ApiError).message); }
    finally { setLoading(false); }
  }
  async function resend() {
    setResending(true); setError('');
    try { const result = await apiRequest<{ message: string }>('/auth/resend-verification', { method: 'POST', auth: false, body: { correo } }); setMessage(result.message); }
    catch (reason) { setError((reason as ApiError).message); }
    finally { setResending(false); }
  }

  return <div className="auth-card"><div className="auth-card-heading"><span className="eyebrow">Verificación</span><h2>Activar tu cuenta</h2><p>Escribe el código que enviamos a tu correo.</p></div>{message ? <div className="form-alert form-alert-success"><CheckCircle2 size={18} />{message}</div> : null}{error ? <div className="form-alert form-alert-error">{error}</div> : null}<form onSubmit={submit} className="form-stack"><Field label="Correo" required><Input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required /></Field><Field label="Código de 6 dígitos" required><Input className="input code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="000000" required /></Field><Button type="submit" loading={loading}><MailCheck size={18} />Activar cuenta</Button><Button type="button" variant="ghost" loading={resending} onClick={resend}>Reenviar código</Button></form><div className="auth-footer"><Link to="/login">Volver al inicio de sesión</Link></div></div>;
}

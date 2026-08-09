import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Field, Input } from '../../components/ui';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(correo, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === 'EMAIL_NOT_VERIFIED') {
        navigate(`/activar?correo=${encodeURIComponent(correo)}`);
        return;
      }
      setError(apiError.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-heading">
        <span className="eyebrow">Bienvenido</span>
        <h2>Iniciar sesión</h2>
        <p>Ingresa con tu cuenta del Sistema de Gestión Bovina.</p>
      </div>
      {error ? <div className="form-alert form-alert-error">{error}</div> : null}
      <form onSubmit={submit} className="form-stack">
        <Field label="Correo electrónico" required>
          <Input
            type="email"
            autoComplete="email"
            value={correo}
            onChange={(event) => setCorreo(event.target.value)}
            placeholder="nombre@correo.com"
            required
          />
        </Field>
        <Field label="Contraseña" required>
          <div className="password-input">
            <Input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        <div className="form-row-between">
          <label className="checkbox">
            <input type="checkbox" defaultChecked />
            <span>Mantener sesión</span>
          </label>
          <Link to="/recuperar">Olvidé mi contraseña</Link>
        </div>
        <Button type="submit" loading={loading}>
          <LogIn size={18} />
          Entrar
        </Button>
      </form>
      <div className="auth-footer">
        ¿No tienes cuenta? <Link to="/registro">Crear cuenta</Link>
      </div>
    </div>
  );
}

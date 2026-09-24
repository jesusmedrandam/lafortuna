import {useEffect,useState,type FormEvent} from 'react';
import {Eye,EyeOff,KeyRound,LogIn,UserPlus} from 'lucide-react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Field,Input} from '../components/ui';
import {register,requestPasswordReset,resendVerification,resetPassword,verifyEmail} from './api';
import {useV2Session} from './V2Session';

const failure=(reason:unknown)=>reason instanceof Error?reason.message:'No se pudo completar la solicitud.';

export function V2Login(){
  const {signIn}=useV2Session();const navigate=useNavigate();
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{await signIn(email,password);navigate('/',{replace:true});}
    catch(reason){setError(failure(reason));}finally{setBusy(false);}
  }
  return <div className="auth-card"><div className="auth-card-heading"><span className="eyebrow">Bienvenido</span>
    <h2>Iniciar sesión</h2><p>Ingresa con tu cuenta del Sistema de Gestión Bovina.</p></div>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={submit}>
      <Field label="Correo electrónico" required><Input type="email" autoComplete="email" value={email}
        onChange={event=>setEmail(event.target.value)} required/></Field>
      <Field label="Contraseña" required><div className="password-input"><Input
        type={show?'text':'password'} autoComplete="current-password" value={password}
        onChange={event=>setPassword(event.target.value)} required/>
        <button type="button" aria-label={show?'Ocultar contraseña':'Mostrar contraseña'}
          onClick={()=>setShow(value=>!value)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></Field>
      <div className="form-row-between"><span>Sesión protegida</span><Link to="/recuperar">Olvidé mi contraseña</Link></div>
      <Button type="submit" loading={busy}><LogIn size={18}/>Entrar</Button>
    </form><div className="auth-footer">¿No tienes cuenta? <Link to="/registro">Crear cuenta</Link></div>
  </div>;
}

export function V2Register(){
  const navigate=useNavigate();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [values,setValues]=useState({displayName:'',propertyName:'',email:'',password:'',confirmation:''});
  function update(key:keyof typeof values,value:string){setValues(current=>({...current,[key]:value}));}
  async function submit(event:FormEvent){
    event.preventDefault();if(values.password!==values.confirmation){setError('Las contraseñas no coinciden.');return;}
    setBusy(true);setError('');try{
      await register({displayName:values.displayName,propertyName:values.propertyName,
        email:values.email,password:values.password});
      navigate(`/activar?correo=${encodeURIComponent(values.email)}`,{replace:true});
    }catch(reason){setError(failure(reason));}finally{setBusy(false);}
  }
  return <div className="auth-card auth-card-wide"><div className="auth-card-heading"><span className="eyebrow">Nueva cuenta</span>
    <h2>Registrarte</h2><p>Registra tu primera propiedad y verifica tu correo para acceder.</p></div>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={submit}><div className="form-grid">
      <Field label="Nombre completo" required><Input value={values.displayName} onChange={event=>update('displayName',event.target.value)} minLength={2} required/></Field>
      <Field label="Primera propiedad" required><Input value={values.propertyName} onChange={event=>update('propertyName',event.target.value)} minLength={2} required/></Field>
      <Field label="Correo electrónico" required><Input type="email" autoComplete="email" value={values.email} onChange={event=>update('email',event.target.value)} required/></Field>
      <Field label="Contraseña" hint="Al menos 12 caracteres, una letra y un número." required><Input type="password" autoComplete="new-password" minLength={12} value={values.password} onChange={event=>update('password',event.target.value)} required/></Field>
      <Field label="Confirmar contraseña" required><Input type="password" autoComplete="new-password" minLength={12} value={values.confirmation} onChange={event=>update('confirmation',event.target.value)} required/></Field>
    </div><Button type="submit" loading={busy}><UserPlus size={18}/>Crear cuenta</Button></form>
    <div className="auth-footer"><Link to="/login">Ya tengo cuenta</Link></div>
  </div>;
}

export function V2Verify(){
  const [params]=useSearchParams();const token=params.get('verify-email');
  const [email,setEmail]=useState(params.get('correo')??'');const [busy,setBusy]=useState(Boolean(token));
  const [message,setMessage]=useState('Revisa el enlace de verificación que llegó a tu correo.');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!token)return;let active=true;
    void verifyEmail(token).then(()=>{if(active)setMessage('Correo verificado. Ya puedes iniciar sesión.');})
      .catch(reason=>{if(active)setError(failure(reason));}).finally(()=>{
        if(active){setBusy(false);const url=new URL(window.location.href);
          url.searchParams.delete('verify-email');window.history.replaceState({},'',url.pathname+url.search);}
      });
    return()=>{active=false;};
  },[token]);
  async function resend(event:FormEvent){event.preventDefault();setBusy(true);setError('');
    try{await resendVerification(email);setMessage('Si corresponde, recibirás un enlace nuevo.');}
    catch(reason){setError(failure(reason));}finally{setBusy(false);}}
  return <div className="auth-card"><div className="auth-card-heading"><h2>Verificar correo</h2><p>{message}</p></div>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={resend}><Field label="Correo"><Input type="email" value={email}
      onChange={event=>setEmail(event.target.value)} required/></Field>
      <Button type="submit" loading={busy}>Reenviar enlace</Button></form>
    <div className="auth-footer"><Link to="/login">Iniciar sesión</Link></div></div>;
}

export function V2Recovery(){
  const [params]=useSearchParams();const navigate=useNavigate();const token=params.get('reset-password');
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');
    try{
      if(token){if(password!==confirmation)throw new Error('Las contraseñas no coinciden.');
        await resetPassword(token,password);navigate('/login',{replace:true});}
      else{await requestPasswordReset(email);setMessage('Si existe la cuenta, recibirás un enlace de recuperación.');}
    }catch(reason){setError(failure(reason));}finally{setBusy(false);}
  }
  return <div className="auth-card"><div className="auth-card-heading"><span className="eyebrow">Recuperación</span>
    <h2>Restablecer contraseña</h2><p>{token?'Escribe tu contraseña nueva.':'Te enviaremos un enlace de recuperación.'}</p></div>
    {message&&<div className="form-alert form-alert-success">{message}</div>}
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={submit}>{token?<>
      <Field label="Contraseña nueva" hint="Al menos 12 caracteres, una letra y un número." required><Input type="password" autoComplete="new-password" minLength={12} value={password} onChange={event=>setPassword(event.target.value)} required/></Field>
      <Field label="Confirmar contraseña" required><Input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={event=>setConfirmation(event.target.value)} required/></Field>
    </>:<Field label="Correo electrónico" required><Input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required/></Field>}
      <Button type="submit" loading={busy}><KeyRound size={18}/>{token?'Cambiar contraseña':'Enviar enlace'}</Button>
    </form><div className="auth-footer"><Link to="/login">Volver al inicio de sesión</Link></div></div>;
}

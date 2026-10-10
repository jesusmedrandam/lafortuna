import {useState,type ReactNode,type FormEvent} from 'react';
import {Camera,ChevronRight,UserCircle} from 'lucide-react';
import {Button,Card,Field,Input,PasswordInput} from '../components/ui';
import {changeUserPassword,requestUserEmailChange} from './api';
import {useV2Session} from './V2Session';
import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {AccountSessions} from './AccountSessions';

export function UserProfileEditor({footer}:{footer?:ReactNode}){
  const {session,saveProfile}=useV2Session();const user=session!.overview.user;
  const [params,setParams]=useSearchParams();const section=params.get('opcion');
  const navigate=useNavigate();const location=useLocation();
  const editing=section==='perfil';
  const setSection=(value:string|null)=>{
    if(!value&&location.state?.accountOption){navigate(-1);return;}
    const next=new URLSearchParams(params);if(value)next.set('opcion',value);else next.delete('opcion');
    setParams(next,{replace:!value,state:{...location.state,accountOption:Boolean(value)}});
  };
  const setEditing=(value:boolean)=>setSection(value?'perfil':null);const [displayName,setDisplayName]=useState(user.displayName);
  const [photo,setPhoto]=useState<string|null|undefined>(undefined);
  const [photoBusy,setPhotoBusy]=useState(false);const [profileBusy,setProfileBusy]=useState(false);
  const [profileError,setProfileError]=useState('');const [profileMessage,setProfileMessage]=useState('');
  const [currentPassword,setCurrentPassword]=useState('');const [newPassword,setNewPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');const [passwordBusy,setPasswordBusy]=useState(false);
  const [passwordError,setPasswordError]=useState('');const [passwordMessage,setPasswordMessage]=useState('');
  const [emailBusy,setEmailBusy]=useState(false);const [emailError,setEmailError]=useState('');const [emailMessage,setEmailMessage]=useState('');
  const selectedPhoto=photo===undefined?user.profilePhoto:photo;
  const selectPhoto=async(file:File)=>{
    setProfileError('');setPhotoBusy(true);
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)
        throw new Error('Elige una foto JPG, PNG o WebP de hasta 10 MB.');
      const image=await createImageBitmap(file);
      try{
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
        const size=Math.min(image.width,image.height);const context=canvas.getContext('2d');
        if(!context)throw new Error('No se pudo preparar la foto.');
        context.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,256,256);
        setPhoto(canvas.toDataURL('image/jpeg',0.85));
      }finally{image.close();}
    }catch(reason){setProfileError(reason instanceof Error?reason.message:'No se pudo abrir la foto.');}
    finally{setPhotoBusy(false);}
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();setProfileError('');setProfileMessage('');setProfileBusy(true);
    try{await saveProfile({displayName:displayName.trim(),...(photo===undefined?{}:{profilePhoto:photo})});
      setEditing(false);setPhoto(undefined);setProfileMessage('Tu perfil se guardó.');}
    catch(reason){setProfileError(reason instanceof Error?reason.message:'No se pudo guardar tu perfil.');}
    finally{setProfileBusy(false);}
  };
  const password=async(event:FormEvent)=>{
    event.preventDefault();setPasswordError('');setPasswordMessage('');
    if(newPassword!==confirmation){setPasswordError('Las contraseñas nuevas no coinciden.');return;}
    setPasswordBusy(true);
    try{await changeUserPassword(session!.accessToken,currentPassword,newPassword);
      setCurrentPassword('');setNewPassword('');setConfirmation('');
      setSection(null);
      setPasswordMessage('Tu contraseña se cambió. Se cerraron tus otras sesiones.');}
    catch(reason){setPasswordError(reason instanceof Error?reason.message:'No se pudo cambiar la contraseña.');}
    finally{setPasswordBusy(false);}
  };
  const email=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const data=new FormData(event.currentTarget);setEmailError('');setEmailMessage('');setEmailBusy(true);
    try{await requestUserEmailChange(session!.accessToken,String(data.get('email')).trim(),String(data.get('emailPassword')));
      setSection(null);setEmailMessage('Revisa tu nuevo correo y confirma el enlace. Hasta entonces seguirás entrando con el correo actual.');}
    catch(reason){setEmailError(reason instanceof Error?reason.message:'No se pudo solicitar el cambio.');}
    finally{setEmailBusy(false);}
  };
  const option=(label:string,key:string,action?:()=>void)=><Button variant="ghost" className="account-option"
    disabled={profileBusy||photoBusy||passwordBusy||emailBusy}
    onClick={()=>{if(section===key)setSection(null);else if(action)action();else setSection(key);}}>
    <span>{label}</span><ChevronRight size={18}/></Button>;
  return <div className="user-profile-editor">
    <Card>{(!section||editing)&&<div className="v2-account-heading"><div className="account-avatar">
      {selectedPhoto?<img src={selectedPhoto} alt="Tu foto de perfil"/>:<UserCircle size={52}/>}</div>
      <div><strong>{user.displayName}</strong><p>{user.email}</p></div></div>}
      {!section&&option('Editar perfil','perfil',()=>{setDisplayName(user.displayName);setPhoto(undefined);setProfileError('');setProfileMessage('');setEditing(true);})}
      {editing&&<form id="account-perfil" onSubmit={save}>
        <fieldset disabled={profileBusy||photoBusy}>
          <Field label="Nombre"><Input name="displayName" autoComplete="name" required minLength={2} maxLength={160}
            value={displayName} onChange={event=>setDisplayName(event.target.value)}/></Field>
          <Field label="Foto de perfil" hint="JPG, PNG o WebP. Hasta 10 MB."><Input type="file" accept="image/jpeg,image/png,image/webp"
            onChange={event=>{const file=event.target.files?.[0];if(file)void selectPhoto(file);event.target.value='';}}/></Field>
          {photoBusy&&<p role="status"><Camera size={16}/>Preparando foto…</p>}
          <div className="inline-actions">{selectedPhoto&&<Button type="button" variant="ghost" onClick={()=>setPhoto(null)}>Quitar foto</Button>}
            <Button type="submit" loading={profileBusy}>Guardar perfil</Button>
            <Button type="button" variant="secondary" onClick={()=>{setEditing(false);setPhoto(undefined);setProfileError('');}}>Cancelar</Button></div>
        </fieldset></form>}
      {(!section||section==='perfil')&&profileError&&<p className="form-error" role="alert">{profileError}</p>}
      {(!section||section==='perfil')&&profileMessage&&<p className="form-success" role="status">{profileMessage}</p>}
      {!section&&option('Cambiar contraseña','clave')}
      {section==='clave'&&<form id="account-clave" onSubmit={password}><p>Usa al menos 12 caracteres, con letras y números.</p><fieldset disabled={passwordBusy}>
        <Field label="Contraseña actual"><PasswordInput name="currentPassword" autoComplete="current-password" required maxLength={128}
          value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></Field>
        <Field label="Nueva contraseña"><PasswordInput name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128}
          pattern="(?=.*[A-Za-zÁÉÍÓÚáéíóúÑñ])(?=.*[0-9]).{12,128}" value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></Field>
        <Field label="Confirmar nueva contraseña"><PasswordInput name="confirmPassword" autoComplete="new-password" required maxLength={128}
          value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></Field>
        <Button type="submit" loading={passwordBusy}>Guardar contraseña</Button>
        <Button type="button" variant="secondary" onClick={()=>{setSection(null);setCurrentPassword('');setNewPassword('');setConfirmation('');setPasswordError('');}}>Cancelar</Button>
      </fieldset></form>}
      {(!section||section==='clave')&&passwordError&&<p className="form-error" role="alert">{passwordError}</p>}
      {(!section||section==='clave')&&passwordMessage&&<p className="form-success" role="status">{passwordMessage}</p>}
      {!section&&option('Cambiar correo electrónico','correo')}
      {section==='correo'&&<form id="account-correo" onSubmit={email}><p>Confirma tu contraseña y verifica el nuevo correo. Al confirmar se cerrarán tus sesiones para proteger tu cuenta.</p>
        <fieldset disabled={emailBusy}><Field label="Nuevo correo electrónico"><Input name="email" type="email" autoComplete="email" maxLength={254} required/></Field>
          <Field label="Contraseña actual"><PasswordInput name="emailPassword" autoComplete="current-password" maxLength={128} required/></Field>
          <div className="inline-actions"><Button type="submit" loading={emailBusy}>Enviar confirmación</Button>
            <Button type="button" variant="secondary" onClick={()=>{setSection(null);setEmailError('');}}>Cancelar</Button></div></fieldset></form>}
      {(!section||section==='correo')&&emailError&&<p className="form-error" role="alert">{emailError}</p>}
      {(!section||section==='correo')&&emailMessage&&<p className="form-success" role="status">{emailMessage}</p>}
      {!section&&option('Sesiones activas','sesiones')}{section==='sesiones'&&<div id="account-sesiones"><AccountSessions/></div>}{!section&&footer}</Card>
  </div>;
}

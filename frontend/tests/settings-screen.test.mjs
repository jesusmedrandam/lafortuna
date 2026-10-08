import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const deadline=setTimeout(()=>{console.error('Browser test timed out');process.exit(1);},45000);
const mockApi=`
export class ApiRequestError extends Error{}
window.settingsRequests=0;
export const getPropertySettings=async()=>{window.settingsRequests++;return {account:{name:'Cuenta de prueba',usedProperties:1,maxProperties:2},canCreate:false,canManageModules:false,
  modules:[{code:'TASKS',name:'Actividades',enabled:true,isCore:false,accountEnabled:true}]};};
export const createAccountProperty=async()=>{};export const updatePropertyModule=async()=>{};
window.passwordCalls=[];
export const changeUserPassword=async(token,currentPassword,newPassword)=>{window.passwordCalls.push({token,currentPassword,newPassword});return {changed:true};};
window.emailCalls=[];
export const requestUserEmailChange=async(token,email,currentPassword)=>{window.emailCalls.push({token,email,currentPassword});return {accepted:true};};
window.emailConfirmations=[];
export const confirmUserEmailChange=async token=>{window.emailConfirmations.push(token);return {changed:true};};
export const register=async()=>{};export const requestPasswordReset=async()=>{};
export const resendVerification=async()=>{};export const resetPassword=async()=>{};export const verifyEmail=async()=>{};
let sessions=[{id:'session-a',deviceName:'Android · SGB',current:true,createdAt:'2026-10-01T12:00:00Z',lastSeenAt:'2026-10-07T12:00:00Z'},
  {id:'session-b',deviceName:'Windows · Chrome',current:false,createdAt:'2026-10-02T12:00:00Z',lastSeenAt:'2026-10-03T12:00:00Z'},
  {id:'session-c',deviceName:'iPhone · Safari',current:false,createdAt:'2026-10-02T12:00:00Z',lastSeenAt:'2026-10-03T12:00:00Z'}];
export const getUserSessions=async()=>sessions;
export const closeUserSession=async(_token,id)=>{sessions=sessions.filter(item=>item.id!==id);return {closed:1,currentSessionClosed:id==='session-a'};};
export const closeOtherUserSessions=async()=>{sessions=sessions.filter(item=>item.current);return {closed:2,currentSessionClosed:false};};
export const getAudit=async(_token,page,action)=>({page,hasMore:false,items:[
  {id:'event-a',entityId:'11111111-1111-4111-8111-111111111111',occurredAt:'2026-10-01T12:00:00Z',action:'ANIMAL_DESCRIPTION_UPDATED',
    entityType:'ANIMAL',actorName:'Ana',beforeData:{name:'Lucera',description:'Antes de la visita',availability_status_code:'MISSING',version:1},
    afterData:{name:'Lucera',description:'Después de la visita',availability_status_code:'ACTIVE',version:2},ipAddress:'203.0.113.15',userAgent:'Technical-browser'},
  {id:'event-b',entityId:'22222222-2222-4222-8222-222222222222',occurredAt:'2026-10-01T13:00:00Z',action:'GROUP_LOCATION_CHANGED',
    entityType:'LIVESTOCK_GROUP',actorName:'Sistema · soporte',actorDisplayName:'José',superadminAccess:true,
    beforeData:{name:'Vacas',locationId:'11111111-1111-4111-8111-111111111111'},
    afterData:{name:'Vacas',locationId:'22222222-2222-4222-8222-222222222222'},ipAddress:'203.0.113.15'}
].filter(item=>!action||item.action===action)});
`;
const mockSession=`
import {useState} from 'react';
export const useV2Session=()=>{const [,refresh]=useState(0);return ({session:{accessToken:'test',overview:{user:{id:window.settingsUser??'user-a',displayName:'Ana',email:'ana@example.test',
  ...window.settingsProfile,isSuperadmin:Boolean(window.settingsAdmin)},
  activeContext:{propertyId:'property-a',roleId:'role-a'},properties:[{id:'property-a',name:'Finca de prueba',roles:[{id:'role-a',name:'Colaborador'}]}]}},
  hasPermission:permission=>window.settingsRestricted?false:['MODULE_VIEW','CATALOG_VIEW','AUDIT_VIEW'].includes(permission),
  reloadOverview:async()=>{},selectContext:async()=>{},signOut:async()=>{window.settingsSignedOut=true;},
  saveProfile:async input=>{window.settingsProfile={...window.settingsProfile,...input};refresh(value=>value+1);}});};
`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import {ThemeProvider,defaultAppearance} from './src/theme/ThemeContext';
import {V2SettingsPage} from './src/sgb-v2/V2SettingsPage';
import {V2AuditPage} from './src/sgb-v2/V2AuditPage';
import {V2EmailChange} from './src/sgb-v2/AuthPages';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(condition){for(let n=0;n<120;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition.toString());}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const change=(node,value)=>{Object.getOwnPropertyDescriptor(node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);
  node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
const root=createRoot(document.getElementById('root'));
function renderApp(userId='user-a'){
  window.settingsUser=userId;
  root.render(h(BrowserRouter,null,h(ThemeProvider,{key:userId,userId},h('div',{className:'sgb-v2-shell'},h(Routes,null,
    h(Route,{path:'/',element:h(V2SettingsPage)}),h(Route,{path:'/sin-conexion',element:h('p',{id:'download-route'},'Descargas')}),
    h(Route,{path:'/roles-permisos',element:h('p',{id:'role-route'},'Roles y permisos')}),h(Route,{path:'/auditoria',element:h(V2AuditPage)}),
    h(Route,{path:'/cambiar-correo',element:h(V2EmailChange)}))))));
}
const color=name=>document.querySelector('input[aria-label="'+name+'"]');
const saved=user=>JSON.parse(localStorage.getItem('sgb.appearance.v1:'+user));
const css=key=>document.documentElement.style.getPropertyValue(key);
const back=()=>history.back();
try{
  window.SGBAndroid={setSystemBarColors:(status,navigation)=>{window.settingsNativeBars={status,navigation};}};
  renderApp();await until(()=>document.querySelectorAll('.settings-hub-section').length===4);
  check(window.settingsRequests===0,'Property data is lazy loaded only when its section opens');
  check(!document.querySelector('.dashboard-settings'),'Panel is in its own section');
  check(document.querySelectorAll('button.settings-hub-card').length===8,'Settings hub uses accessible category buttons');
  check(document.documentElement.scrollWidth<=innerWidth,'Mobile hub has no overflow');
  [...document.querySelectorAll('.settings-hub-card')].find(node=>node.textContent.startsWith('Mi cuenta')).click();await until(()=>document.querySelector('.v2-account-settings'));
  check(document.querySelector('.v2-account-settings').textContent.includes('ana@example.test'),'Account displays current user');
  check(document.querySelector('.v2-account-settings').textContent.includes('Colaborador'),'Account preserves actual role');
  check(!button('Configuración'),'Account has no duplicate back button');
  check(!document.querySelector('.user-profile-editor form'),'Account initially shows options with all forms collapsed');
  button('Editar perfil').click();await until(()=>document.querySelector('input[name="displayName"]'));
  change(document.querySelector('input[name="displayName"]'),'Ana editada');
  const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;canvas.getContext('2d').fillRect(0,0,40,40);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const transfer=new DataTransfer();transfer.items.add(new File([blob],'foto.png',{type:'image/png'}));
  const photo=document.querySelector('input[type=file]');photo.files=transfer.files;photo.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>document.querySelector('.account-avatar img'));
  button('Guardar perfil').click();await until(()=>!document.querySelector('input[name="displayName"]'));
  check(window.settingsProfile.displayName==='Ana editada'&&window.settingsProfile.profilePhoto.startsWith('data:image/jpeg;base64,'),'Name and resized photo submitted');
  check(document.querySelector('.v2-account-heading').textContent.includes('Ana editada'),'Saved name appears immediately');
  button('Cambiar contraseña').click();await until(()=>document.querySelector('input[name="currentPassword"]'));
  change(document.querySelector('input[name="currentPassword"]'),'Clave-actual-2026');
  change(document.querySelector('input[name="newPassword"]'),'Nueva-clave-2026');
  change(document.querySelector('input[name="confirmPassword"]'),'Otra-clave-2026');
  button('Guardar contraseña').click();await until(()=>document.querySelector('[role="alert"]'));
  check(window.passwordCalls.length===0,'Password confirmation is checked before sending');
  change(document.querySelector('input[name="confirmPassword"]'),'Nueva-clave-2026');
  button('Guardar contraseña').click();await until(()=>window.passwordCalls.length===1&&!document.querySelector('input[name="currentPassword"]'));
  check(window.passwordCalls[0].currentPassword==='Clave-actual-2026','Current password submitted');
  button('Cambiar contraseña').click();await until(()=>document.querySelector('input[name="currentPassword"]'));
  check(document.querySelector('input[name="newPassword"]').value===''&&document.querySelector('input[name="confirmPassword"]').value==='','Passwords cleared after success');
  button('Editar perfil').click();await until(()=>button('Quitar foto'));button('Quitar foto').click();
  await until(()=>!document.querySelector('.account-avatar img'));
  button('Guardar perfil').click();await until(()=>window.settingsProfile.profilePhoto===null&&!document.querySelector('input[name="displayName"]'));
  check(!document.querySelector('.account-avatar img'),'Removing the photo is saved');
  button('Cambiar correo electrónico').click();await until(()=>document.querySelector('input[name="email"]'));
  check(!document.querySelector('input[name="currentPassword"]')&&!document.querySelector('input[name="displayName"]'),'Only the selected form is expanded');
  change(document.querySelector('input[name="email"]'),'nuevo@example.test');change(document.querySelector('input[name="emailPassword"]'),'Clave-actual-2026');
  button('Enviar confirmación').click();await until(()=>window.emailCalls.length===1&&!document.querySelector('input[name="email"]'));
  check(document.querySelector('.v2-account-heading').textContent.includes('ana@example.test'),'Email remains unchanged while verification is pending');
  button('Sesiones activas').click();await until(()=>document.querySelectorAll('.account-sessions article').length===3);
  check(document.querySelector('.account-sessions').textContent.includes('Este dispositivo'),'Current device identified');
  check(document.querySelector('.account-sessions').textContent.includes('7 oct 2026'),'Dates use month names');
  const otherSession=document.querySelectorAll('.account-sessions article')[1];otherSession.querySelector('button').click();await until(()=>document.querySelector('[role="dialog"]'));
  button('Confirmar').click();await until(()=>document.querySelectorAll('.account-sessions article').length===2);
  button('Cerrar las otras sesiones').click();await until(()=>document.querySelector('[role="dialog"]'));button('Confirmar').click();
  await until(()=>document.querySelectorAll('.account-sessions article').length===1);
  check(!window.settingsSignedOut,'Closing other sessions preserves this device');
  back();await until(()=>!document.querySelector('.account-sessions'));
  // Saving forms replaces their open option; return to the settings hub through browser history.
  for(let n=0;n<20&&!document.querySelector('.settings-hub-section');n++){back();await tick();}
  await until(()=>document.querySelector('.settings-hub-section'));
  [...document.querySelectorAll('.settings-hub-card')].find(node=>node.textContent.startsWith('Apariencia')).click();await until(()=>color('Color principal'));
  button('Claro').click();await until(()=>document.documentElement.dataset.theme==='light');
  change(color('Color principal'),'#2563eb');await until(()=>css('--primary')==='#2563eb');
  change(color('Fondo y barra superior'),'#f2f6ff');await until(()=>css('--bg')==='#f2f6ff');
  check(css('--page-bg')==='#f2f6ff'&&css('--topbar-bg')==='#f2f6ff','Screen and topbar share chosen background');
  check(window.settingsNativeBars.status==='#f2f6ff'&&window.settingsNativeBars.navigation==='#f2f6ff','Android bars receive the chosen color');
  change(color('Contenedores'),'#f8f8ff');await until(()=>css('--surface')==='#f8f8ff');
  change(color('Menú lateral'),'#101827');await until(()=>css('--sidebar-bg')==='#101827');
  check(saved('user-a').primaryColor==='#2563eb','Custom colors persist');
  check(document.documentElement.scrollWidth<=innerWidth,'Appearance has no horizontal overflow');
  button('Oscuro').click();await until(()=>document.documentElement.dataset.theme==='dark');
  change(color('Fondo y barra superior'),'#18181b');await until(()=>css('--bg')==='#18181b');
  check(saved('user-a').lightBackground==='#f2f6ff','Editing dark background retains light settings');
  check(localStorage.getItem('mm.theme:user-a')==='dark','User theme persists');
  renderApp('user-b');await until(()=>css('--primary')===defaultAppearance.primaryColor);
  check(saved('user-b').primaryColor===defaultAppearance.primaryColor,'Other users do not inherit custom colors');
  renderApp('user-a');await until(()=>css('--primary')==='#2563eb');
  check(document.documentElement.dataset.theme==='dark'&&css('--bg')==='#18181b','Returning user restores saved theme and colors');
  button('Claro').click();await until(()=>css('--bg')==='#f2f6ff');
  change(color('Color principal'),'#ffffff');await until(()=>css('--primary')==='#ffffff');
  check(getComputedStyle(button('Botón principal')).color==='rgb(23, 35, 29)','White primary buttons use readable dark text');
  button('Restablecer colores').click();await until(()=>css('--primary')===defaultAppearance.primaryColor);
  check(saved('user-a').lightBackground===defaultAppearance.lightBackground,'Reset persists default design');
  back();await until(()=>document.querySelector('.settings-hub-section'));
  [...document.querySelectorAll('.settings-hub-card')].find(node=>node.textContent.startsWith('Mi panel')).click();await until(()=>document.querySelector('.dashboard-settings'));
  document.querySelector('.dashboard-settings input').click();button('Guardar mi panel').click();await until(()=>document.querySelector('[role="status"]'));
  check(JSON.parse(localStorage.getItem('sgb:dashboard:user-a')).sections[0].visible===false,'Personal panel settings are preserved');
  back();await until(()=>document.querySelector('.settings-hub-section'));
  [...document.querySelectorAll('.settings-hub-card')].find(node=>node.textContent.startsWith('Propiedad y módulos')).click();await until(()=>window.settingsRequests===1);
  await until(()=>document.querySelector('.property-module-row'));
  check(document.querySelector('.property-module-row input').disabled,'Property permissions remain enforced');
  window.settingsRestricted=true;renderApp();await until(()=>document.querySelector('.settings-hub-section'));
  check(!document.querySelector('.property-settings-panel'),'Restricted section cannot be forced with query URL');
  check(document.querySelectorAll('button.settings-hub-card').length===5,'Restricted users see only allowed cards');
  [...document.querySelectorAll('.settings-hub-card')].find(node=>node.textContent.startsWith('Descargas')).click();await until(()=>document.getElementById('download-route'));
  check(location.pathname==='/sin-conexion','Downloads card opens offline content');
  history.pushState(null,'','/auditoria');window.dispatchEvent(new PopStateEvent('popstate'));await until(()=>document.querySelectorAll('.audit-event').length===2);
  const rootText=()=>document.getElementById('root').textContent;
  check(rootText().includes('Editó la descripción del animal')&&rootText().includes('Equipo de soporte · José'),'Readable actions and accountable support actor');
  check(!rootText().includes('ANIMAL_DESCRIPTION_UPDATED')&&!rootText().includes('203.0.113.15'),'Technical codes and IP hidden in the list');
  document.querySelector('[aria-label="Ver cambio: Lucera"]').click();await until(()=>document.querySelector('.audit-readable-change'));
  check(rootText().includes('Antes: Antes de la visita')&&rootText().includes('Ahora: Después de la visita'),'Before and after comparison in Spanish');
  check(rootText().includes('Antes: Desaparecido')&&rootText().includes('Ahora: Activo'),'Database field names and status codes are translated');
  check(!document.querySelector('.audit-technical')&&!document.querySelector('.json-compare'),'Technical view unavailable to ordinary users');
  button('Cerrar').click();await until(()=>!document.querySelector('.audit-readable-change'));
  const search=document.querySelector('input[placeholder="Buscar persona, animal o cambio"]');change(search,'Lucera');await until(()=>document.querySelectorAll('.audit-event').length===1);
  change(search,'');await until(()=>document.querySelectorAll('.audit-event').length===2);
  document.querySelector('[aria-label="Ver cambio: Vacas"]').click();await until(()=>document.querySelector('.audit-readable-change'));
  check(!rootText().includes('11111111-1111')&&!rootText().includes('22222222-2222'),'Record UUIDs hidden in readable comparison');
  button('Cerrar').click();window.settingsAdmin=true;renderApp();await tick();
  document.querySelector('[aria-label="Ver cambio: Lucera"]').click();await until(()=>document.querySelector('.audit-technical'));
  document.querySelector('.audit-technical').open=true;
  check(document.querySelector('.json-compare')&&rootText().includes('ANIMAL_DESCRIPTION_UPDATED')&&rootText().includes('203.0.113.15'),'Superadministrator keeps technical details');
  check(document.documentElement.scrollWidth<=innerWidth,'Profile and history fit the mobile screen');
  history.pushState(null,'','/cambiar-correo?change-email=confirmation-test-token');window.dispatchEvent(new PopStateEvent('popstate'));
  await until(()=>button('Confirmar nuevo correo'));await tick();
  check(window.emailConfirmations.length===0,'Opening an email link does not change the account automatically');
  button('Confirmar nuevo correo').click();await until(()=>window.settingsSignedOut&&!location.search);
  check(window.emailConfirmations[0]==='confirmation-test-token'&&rootText().includes('Tu correo se actualizó'),'Explicit confirmation closes this session and clears the link token');
  document.getElementById('result').textContent='PASS: browser back, profile, password, email request/confirmation, session management, readable audit and permissions at 412px';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'settings-screen-test-api',enforce:'pre',
  resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(/(?:^|\/)theme\/ThemeContext(?:\.tsx)?$/.test(id))return root.replaceAll('\\','/')+'src/theme/ThemeContext.tsx';
    if(id==='settings-screen-test'||id===root+'settings-screen-test')return '\0settings-screen-test';
    if(id==='./api'&&importer?.includes('/src/sgb-v2/'))return '\0settings-screen-api';
    if(id==='./V2Session'&&['V2SettingsPage.tsx','UserProfileEditor.tsx','AccountSessions.tsx','V2AuditPage.tsx','AuthPages.tsx'].some(file=>importer?.endsWith('/'+file)))return '\0settings-screen-session';
    if(importer==='\0settings-screen-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0settings-screen-test')return entry;if(id==='\0settings-screen-api')return mockApi;if(id==='\0settings-screen-session')return mockSession;},
}],build:{write:false,minify:false,lib:{entry:'settings-screen-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
console.log('Settings/history test compiled');
const css=(await Promise.all(['src/sgb-v2/styles.css','src/sgb-v2/shell.css','src/styles/global.css',
  'src/styles/device.css','src/styles/radical-ui.css','src/styles/restored-ui.css','src/styles/settings-hub.css',
  'src/styles/patch-1.2.8.35.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-settings-'));
let browser;let socket;
try{
  const chrome=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=spawn(chrome,['--headless','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--disable-background-networking','--disable-component-update',
    '--user-data-dir='+join(temporary,'profile'),'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let port;
  for(let attempt=0;attempt<100;attempt++){try{port=(await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert.ok(port,'Chrome did not start');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id){const handler=pending.get(response.id);
    if(handler){pending.delete(response.id);response.error?handler.reject(new Error(response.error.message)):handler.resolve(response.result);}}});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await command('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true});
  await command('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  let outcome='PENDING';
  for(let attempt=0;attempt<300;attempt++){
    const response=await command('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});
    outcome=response.result?.value??'PENDING';if(outcome.startsWith('PASS:')||outcome.startsWith('FAIL:'))break;await pause(50);
  }
  assert.ok(outcome.startsWith('PASS:'),outcome);console.log(outcome);
  await command('Browser.close');
}finally{clearTimeout(deadline);socket?.close();browser?.kill();server.close();await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}

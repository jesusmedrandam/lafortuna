import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const deadline=setTimeout(()=>{console.error('Browser test timed out');process.exit(1);},90000);
import {mockApi,mockSession,entry} from './reproduction-browser-source.mjs';
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'reproduction-browser-test-api',enforce:'pre',
  resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(/(?:^|\/)theme\/ThemeContext(?:\.tsx)?$/.test(id))return root.replaceAll('\\','/')+'src/theme/ThemeContext.tsx';
    if(id==='reproduction-browser-test'||id===root+'reproduction-browser-test')return '\0reproduction-browser-test';
    if(id==='./api'&&importer?.includes('/src/sgb-v2/'))return '\0reproduction-browser-api';
    if(id==='./V2Session'&&['ReproductionPanel.tsx'].some(file=>importer?.endsWith('/'+file)))return '\0reproduction-browser-session';
    if(importer==='\0reproduction-browser-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0reproduction-browser-test')return entry;if(id==='\0reproduction-browser-api')return mockApi;if(id==='\0reproduction-browser-session')return mockSession;},
}],build:{write:false,minify:false,lib:{entry:'reproduction-browser-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
console.log('Reproduction test compiled');
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
  for(let attempt=0;attempt<600;attempt++){try{port=(await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
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
  if(process.env.BIRTH_SCREENSHOT){await command('Page.enable');await command('Page.addScriptToEvaluateOnNewDocument',{source:'window.pauseBirthPreview=true;'});}
  await command('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  let outcome='PENDING';
  for(let attempt=0;attempt<300;attempt++){
    if(process.env.BIRTH_SCREENSHOT){const ready=await command('Runtime.evaluate',{expression:'window.birthPreviewReady&&window.pauseBirthPreview',returnByValue:true});
      if(ready.result?.value){const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(process.env.BIRTH_SCREENSHOT,Buffer.from(shot.data,'base64'));await command('Runtime.evaluate',{expression:'window.pauseBirthPreview=false'});}}
    const response=await command('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});
    outcome=response.result?.value??'PENDING';if(outcome.startsWith('PASS:')||outcome.startsWith('FAIL:'))break;await pause(50);
  }
  assert.ok(outcome.startsWith('PASS:'),outcome);console.log(outcome);
  await command('Browser.close');
}finally{clearTimeout(deadline);socket?.close();browser?.kill();server.close();await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}

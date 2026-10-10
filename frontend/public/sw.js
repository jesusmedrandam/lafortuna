const SHELL_CACHE='sgb-v2-shell-2026-10-10-alpha15';
const SHELL=['/','/index.html','/manifest.webmanifest','/favicon.png','/branding/logo-sgb-icon.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sgb-v2-shell-')&&
    key!==SHELL_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(!response.ok)throw new Error('No se pudo actualizar la página.');
        const copy=response.clone();
        event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.put('/index.html',copy)).catch(()=>undefined));
        return response;
      }catch{
        return await caches.match('/index.html')??new Response('SGB no está disponible todavía sin conexión.',
          {status:503,headers:{'content-type':'text/plain; charset=utf-8'}});
      }
    })());return;
  }
  event.respondWith(caches.match(request).then(cached=>cached??fetch(request).then(response=>{
    if(response.ok&&(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/branding/')||
      /\.(?:js|css|png|jpg|jpeg|svg|woff2?)$/i.test(url.pathname))){const copy=response.clone();
      void caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy));}
    return response;
  })));
});

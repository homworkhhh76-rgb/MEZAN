const BUILD='737';
const SCOPE_KEY=(new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'root');
const CACHE=`almezan-pro-${SCOPE_KEY}-v737-instant-cache`;
const FILES=[
  './index.html?v='+BUILD,'./dashboard.html?v='+BUILD,'./cashier.html?v='+BUILD,'./reports.html?v='+BUILD,'./README.html?v='+BUILD,'./admin.html?v='+BUILD,
  './app.css?v='+BUILD,'./activation-runtime.js?v='+BUILD,'./app.js?v='+BUILD,'./bluetooth-printer.js?v='+BUILD,'./almezan-sync.js?v='+BUILD,'./views.js?v='+BUILD,'./admin.js?v='+BUILD,'./master-admin.js?v='+BUILD,
  './pricing.js?v='+BUILD,'./cashier.js?v='+BUILD,'./enterprise.js?v='+BUILD,'./advanced.js?v='+BUILD,'./finance-pro.js?v='+BUILD,'./inventory-restaurant.js?v='+BUILD,'./variants-pro.js?v='+BUILD,'./variant-transfer.js?v='+BUILD,
  './app-icon-192.png?v='+BUILD,'./app-icon-512.png?v='+BUILD,'./app-icon.svg?v='+BUILD,'./brand-logo.png?v='+BUILD,'./barcode-scan.mp3?v='+BUILD,'./manifest.webmanifest?v='+BUILD
];

async function putFresh(cache,url){
  try{
    const r=await fetch(url,{cache:'no-cache'});
    if(r&&r.ok)await cache.put(url,r.clone());
  }catch(_){}
}

self.addEventListener('install',event=>{
  // Do not block the UI with any updater page. Cache every application file silently.
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled(FILES.map(url=>putFresh(cache,url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(`almezan-pro-${SCOPE_KEY}-`)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

async function matchLocal(cache,request){
  return (await cache.match(request))||(await cache.match(request,{ignoreSearch:true}))||null;
}

async function fetchAndStore(cache,request){
  const fresh=await fetch(new Request(request,{cache:'no-cache'}));
  if(fresh&&fresh.ok)await cache.put(request,fresh.clone());
  return fresh;
}

async function instantCache(request,event){
  const cache=await caches.open(CACHE);
  const cached=await matchLocal(cache,request);
  if(cached){
    // Open instantly from local cache, then refresh that same file silently in background.
    event.waitUntil(fetchAndStore(cache,request).catch(()=>{}));
    return cached;
  }
  try{
    // First visit: load normally from GitHub/hosting and save immediately for the next open.
    return await fetchAndStore(cache,request);
  }catch(_){
    if(request.mode==='navigate'){
      return (await cache.match('./index.html?v='+BUILD))||(await cache.match('./index.html',{ignoreSearch:true}))||Response.error();
    }
    return new Response('',{status:503,statusText:'Offline'});
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin&&request.destination!=='image')return;
  event.respondWith(instantCache(request,event));
});

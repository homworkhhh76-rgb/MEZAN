const CACHE='almezan-pro-v734-20260901-shift-balances-account-tree';
const FILES=[
  './','./index.html','./dashboard.html','./cashier.html','./reports.html','./README.html','./admin.html',
  './app.css','./activation-runtime.js','./app.js','./bluetooth-printer.js','./almezan-sync.js','./views.js','./admin.js','./master-admin.js',
  './pricing.js','./cashier.js','./enterprise.js','./advanced.js','./finance-pro.js','./inventory-restaurant.js','./variants-pro.js','./variant-transfer.js',
  './app-icon-192.png','./app-icon-512.png','./app-icon.svg','./brand-logo.png','./barcode-scan.mp3','./manifest.webmanifest'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached){
    // Keep startup instant/offline-first while refreshing the static copy silently.
    fetch(request).then(response=>{if(response&&response.ok)cache.put(request,response.clone())}).catch(()=>{});
    return cached;
  }
  try{
    const response=await fetch(request);
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(_){
    if(request.mode==='navigate')return (await cache.match('./index.html'))||Response.error();
    return new Response('',{status:503,statusText:'Offline'});
  }
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin&&event.request.destination!=='image')return;
  event.respondWith(cacheFirst(event.request));
});

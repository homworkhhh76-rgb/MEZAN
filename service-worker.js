const BUILD='736';
const SCOPE_KEY=(new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'root');
const CACHE=`almezan-pro-${SCOPE_KEY}-v736-github-pages-routing`;
const FILES=[
  './index.html?v='+BUILD,'./dashboard.html?v='+BUILD,'./cashier.html?v='+BUILD,'./reports.html?v='+BUILD,'./README.html?v='+BUILD,'./admin.html?v='+BUILD,
  './app.css?v='+BUILD,'./activation-runtime.js?v='+BUILD,'./app.js?v='+BUILD,'./bluetooth-printer.js?v='+BUILD,'./almezan-sync.js?v='+BUILD,'./views.js?v='+BUILD,'./admin.js?v='+BUILD,'./master-admin.js?v='+BUILD,
  './pricing.js?v='+BUILD,'./cashier.js?v='+BUILD,'./enterprise.js?v='+BUILD,'./advanced.js?v='+BUILD,'./finance-pro.js?v='+BUILD,'./inventory-restaurant.js?v='+BUILD,'./variants-pro.js?v='+BUILD,'./variant-transfer.js?v='+BUILD,
  './app-icon-192.png?v='+BUILD,'./app-icon-512.png?v='+BUILD,'./app-icon.svg?v='+BUILD,'./brand-logo.png?v='+BUILD,'./barcode-scan.mp3?v='+BUILD,'./manifest.webmanifest?v='+BUILD
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    for(const url of FILES){try{const r=await fetch(url,{cache:'reload'});if(r.ok)await cache.put(url,r.clone())}catch(_){}}
  }).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(`almezan-pro-${SCOPE_KEY}-`)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

async function cachedFallback(request){
  const cache=await caches.open(CACHE);
  return (await cache.match(request))||(await cache.match(request,{ignoreSearch:true}))||null;
}

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const fresh=await fetch(new Request(request,{cache:'no-cache'}));
    if(fresh&&fresh.ok)await cache.put(request,fresh.clone());
    return fresh;
  }catch(_){
    const cached=await cachedFallback(request);
    if(cached)return cached;
    if(request.mode==='navigate')return (await cache.match('./index.html?v='+BUILD))||Response.error();
    return new Response('',{status:503,statusText:'Offline'});
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const cached=await cachedFallback(request);
  if(cached)return cached;
  try{const response=await fetch(request);if(response&&response.ok)await cache.put(request,response.clone());return response}catch(_){return new Response('',{status:503,statusText:'Offline'})}
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin&&event.request.destination!=='image')return;
  const codeLike=event.request.mode==='navigate'||['script','style','manifest','worker'].includes(event.request.destination);
  // GitHub Pages/CDN deployments must prefer the newest HTML/JS/CSS when online.
  // Offline mode still falls back to the complete local cache.
  event.respondWith(codeLike?networkFirst(event.request):cacheFirst(event.request));
});

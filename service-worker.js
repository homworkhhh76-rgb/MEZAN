const BUILD='749';
const SCOPE_KEY=(new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'root');
const CACHE=`almezan-pro-${SCOPE_KEY}-v749-single-print-new-receipt`;
const PAGE_FILES=[
  './index.html',
  './dashboard.html',
  './cashier.html',
  './sales.html',
  './purchases.html',
  './debts.html',
  './installments.html',
  './products.html',
  './stock.html',
  './units.html',
  './transfers.html',
  './barcodes.html',
  './accounts.html',
  './vouchers.html',
  './cheques.html',
  './journals.html',
  './expenses.html',
  './reports.html',
  './customers.html',
  './customer-groups.html',
  './price-groups.html',
  './suppliers.html',
  './representatives.html',
  './messaging.html',
  './branches.html',
  './warehouses.html',
  './employees.html',
  './audit.html',
  './settings.html',
  './README.html',
  './admin.html'
];
const ASSET_FILES=[
  './app.css?v='+BUILD,'./activation-runtime.js?v='+BUILD,'./app.js?v='+BUILD,'./bluetooth-printer.js?v='+BUILD,'./almezan-sync.js?v='+BUILD,'./pages-bundle-v749.js?v='+BUILD,'./master-admin.js?v='+BUILD,
  './views.js?v='+BUILD,'./admin.js?v='+BUILD,'./pricing.js?v='+BUILD,'./cashier.js?v='+BUILD,'./enterprise.js?v='+BUILD,'./advanced.js?v='+BUILD,'./finance-pro.js?v='+BUILD,'./inventory-restaurant.js?v='+BUILD,'./variants-pro.js?v='+BUILD,'./variant-transfer.js?v='+BUILD,
  './app-icon-192.png?v='+BUILD,'./app-icon-512.png?v='+BUILD,'./app-icon.svg?v='+BUILD,'./brand-logo.png?v='+BUILD,'./barcode-scan.mp3?v='+BUILD,'./manifest.webmanifest?v='+BUILD
];
const FILES=[...PAGE_FILES,...ASSET_FILES];

async function putFresh(cache,url){
  try{const r=await fetch(url,{cache:'no-cache'});if(r&&r.ok)await cache.put(url,r.clone())}catch(_){}
}
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled(FILES.map(url=>putFresh(cache,url)));
  await self.skipWaiting();
})())});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(`almezan-pro-${SCOPE_KEY}-`)&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})())});
async function matchLocal(cache,request){return (await cache.match(request))||(await cache.match(request,{ignoreSearch:true}))||null}
async function fetchAndStore(cache,request){const fresh=await fetch(new Request(request,{cache:'no-cache'}));if(fresh&&fresh.ok)await cache.put(request,fresh.clone());return fresh}
async function instantCache(request,event){
  const cache=await caches.open(CACHE);const cached=await matchLocal(cache,request);
  if(cached){event.waitUntil(fetchAndStore(cache,request).catch(()=>{}));return cached}
  try{return await fetchAndStore(cache,request)}catch(_){
    // كل صفحة مستقلة: لا نحول accounts.html أو branches.html إلى index.html أبداً.
    if(request.mode==='navigate'){
      const u=new URL(request.url);const basename=u.pathname.split('/').pop()||'index.html';
      const direct=await cache.match('./'+basename,{ignoreSearch:true});if(direct)return direct;
      if(!basename||basename==='index.html')return (await cache.match('./index.html',{ignoreSearch:true}))||Response.error();
      return new Response('<!doctype html><meta charset="utf-8"><title>غير متصل</title><body dir="rtl" style="font-family:sans-serif;padding:24px">هذه الصفحة لم تُحفظ بعد على هذا الجهاز. افتحها مرة واحدة أثناء الاتصال بالإنترنت.</body>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    return new Response('',{status:503,statusText:'Offline'})
  }
}
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==self.location.origin&&request.destination!=='image')return;event.respondWith(instantCache(request,event))});

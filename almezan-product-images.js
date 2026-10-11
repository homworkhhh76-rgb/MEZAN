/* AlMeezan Pro product images v2 — Cash Top style Telegram photo storage + IndexedDB fallback. */
(()=>{
  'use strict';
  const BOT_TOKEN='8893463288:AAHn77qegDsR3Yu1LYGicM0Dfh1Fznw4agg';
  const LEGACY_BOT_TOKEN='8901874566:AAG3TAC6xSl-YHmEnQTpvBrxZpoBwyyx6nY';
  const CHAT_ID='6764610810';
  const API=`https://api.telegram.org/bot${BOT_TOKEN}`;
  const FILE_ROOT=`https://api.telegram.org/file/bot${BOT_TOKEN}`;
  const LEGACY_API=`https://api.telegram.org/bot${LEGACY_BOT_TOKEN}`;
  const LEGACY_FILE_ROOT=`https://api.telegram.org/file/bot${LEGACY_BOT_TOKEN}`;
  const DB_NAME='almezan_product_images_v2',STORE='pending';
  const CACHE_TTL=45*60*1000;
  let syncing=false,timer=null,idbPromise=null,hydrating=null;
  const cache=new Map();
  const clean=v=>String(v??'').trim();
  const isData=v=>/^data:image\/(png|jpe?g|webp);base64,/i.test(clean(v));
  const offline=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
  const tenant=()=>clean(window.AlMezanActivation?.readRuntime?.()?.companyId||window.AlMezanActivation?.readRuntime?.()?.tenantId||'default');
  const key=id=>tenant()+'\u0001'+clean(id);
  function err(message,code='generic'){const e=new Error(message);e.code=code;return e}
  function isOfflineError(e){const m=clean(e?.message||e).toLowerCase();return e?.code==='offline'||offline()||m.includes('network')||m.includes('failed to fetch')||m.includes('internet')||m.includes('الإنترنت')}

  function openDb(){
    if(idbPromise)return idbPromise;
    idbPromise=new Promise((resolve,reject)=>{if(!('indexedDB'in window))return resolve(null);const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;let st;if(!db.objectStoreNames.contains(STORE))st=db.createObjectStore(STORE,{keyPath:'id'});else st=req.transaction.objectStore(STORE);if(!st.indexNames.contains('tenantId'))st.createIndex('tenantId','tenantId',{unique:false})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{idbPromise=null;reject(req.error)}});return idbPromise
  }
  async function rememberPending(productId,state){
    const pid=clean(productId),dataUrl=clean(state?.imageData);if(!pid||!isData(dataUrl))return false;
    try{const db=await openDb();if(!db)return false;await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({id:key(pid),tenantId:tenant(),productId:pid,dataUrl,name:clean(state?.imagePendingName)||'product.jpg',savedAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});return true}catch(e){console.warn('[AlMeezan product image] IndexedDB queue failed',e);return false}
  }
  async function forgetPending(productId){const pid=clean(productId);if(!pid)return;try{const db=await openDb();if(!db)return;await new Promise(resolve=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key(pid));tx.oncomplete=tx.onerror=tx.onabort=resolve})}catch(_){}}
  async function hydratePending(){
    if(hydrating)return hydrating;
    hydrating=(async()=>{const db=await openDb().catch(()=>null);if(!db||!window.AlMezan?.db)return 0;const t=tenant(),rows=await new Promise(resolve=>{try{const tx=db.transaction(STORE,'readonly'),st=tx.objectStore(STORE),req=st.index('tenantId').getAll(t);req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>resolve([])}catch(_){resolve([])}});let n=0;for(const row of rows){const p=window.AlMezan.db.products?.find?.(x=>String(x.id)===String(row.productId));if(!p){forgetPending(row.productId);continue}if(isData(row.dataUrl)){Object.assign(p,pendingState(row.dataUrl,row.name||'product.jpg'));n++}}return n})().finally(()=>{hydrating=null});return hydrating
  }

  async function telegram(method,body,api=API){
    if(offline())throw err('لا يوجد اتصال بالإنترنت حالياً.','offline');
    let r;try{r=await fetch(`${api}/${method}`,{method:'POST',body,cache:'no-store'})}catch(_){throw err('تعذر الاتصال بخدمة حفظ الصور.','offline')}
    const data=await r.json().catch(()=>null);if(!r.ok||data?.ok!==true)throw err(data?.description||`Telegram HTTP ${r.status}`,r.status>=500?'telegram':'generic');return data
  }
  async function resolve(fileId,{force=false}={}){
    fileId=clean(fileId);if(!fileId)return'';const cached=cache.get(fileId);if(!force&&cached&&cached.expiresAt>Date.now())return cached.url;
    const body=new URLSearchParams({file_id:fileId});let data,root=FILE_ROOT;
    try{data=await telegram('getFile',body,API)}catch(primary){try{data=await telegram('getFile',new URLSearchParams({file_id:fileId}),LEGACY_API);root=LEGACY_FILE_ROOT}catch(_){throw primary}}
    const path=clean(data?.result?.file_path);if(!path)throw err('تعذر الحصول على رابط الصورة.');const url=`${root}/${path}`;cache.set(fileId,{url,expiresAt:Date.now()+CACHE_TTL});return url
  }
  function src(product){
    if(product?.imagePendingUpload&&isData(product?.imageData))return product.imageData;
    const id=clean(product?.imageTelegramFileId),cached=id?cache.get(id):null;
    if(cached?.url&&cached.expiresAt>Date.now())return cached.url;
    const existing=clean(product?.imageTelegramUrl||product?.imageUrl||product?.imageData||'');
    if(id&&!existing&&!offline())resolve(id).then(url=>{if(!url)return;product.imageTelegramUrl=url;try{window.dispatchEvent(new CustomEvent('almezan:product-image-updated',{detail:{productId:product.id}}))}catch(_){}}).catch(()=>{});
    return existing
  }
  function pendingState(dataUrl,name='product.jpg'){return{imageData:clean(dataUrl),imagePendingUpload:true,imagePendingName:clean(name).slice(0,140)||'product.jpg',imageTelegramFileId:'',imageTelegramUniqueId:'',imageTelegramUrl:'',imageUrl:'',imageStorage:'telegram-pending',imageUpdatedAt:new Date().toISOString()}}
  function uploadedState(up){return{imageData:'',imagePendingUpload:false,imagePendingName:'',imageTelegramFileId:clean(up?.fileId),imageTelegramUniqueId:clean(up?.fileUniqueId),imageTelegramUrl:clean(up?.url),imageUrl:'',imageStorage:'telegram-photo',imageUpdatedAt:new Date().toISOString()}}
  function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||err('تعذر قراءة الصورة.'));r.readAsDataURL(file)})}
  function imageFrom(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(err('تعذر فتح الصورة.'));im.src=src})}
  async function prepareFile(file,{maxSide=1280,quality=.82}={}){if(!file||!/^image\//i.test(file.type||''))throw err('اختر ملف صورة صالحاً.');const raw=await readFile(file),im=await imageFrom(raw),ratio=Math.min(1,maxSide/Math.max(im.naturalWidth||im.width,im.naturalHeight||im.height)),w=Math.max(1,Math.round((im.naturalWidth||im.width)*ratio)),h=Math.max(1,Math.round((im.naturalHeight||im.height)*ratio)),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(im,0,0,w,h);return c.toDataURL('image/jpeg',Math.max(.55,Math.min(.9,Number(quality)||.82)))}
  async function upload(dataUrl,filename='product.jpg'){
    if(!isData(dataUrl))throw err('صورة الصنف غير صالحة.');if(offline())throw err('لا يوجد اتصال بالإنترنت حالياً.','offline');
    let blob;try{blob=await(await fetch(dataUrl)).blob()}catch(_){throw err('تعذر تجهيز صورة الصنف.');}
    const base=(clean(filename)||'product').replace(/[\\/:*?"<>|]+/g,'-').replace(/\.[a-z0-9]+$/i,'').slice(0,100)||'product',form=new FormData();form.append('chat_id',CHAT_ID);form.append('photo',blob,`${base}.jpg`);form.append('disable_notification','true');const data=await telegram('sendPhoto',form,API),photos=Array.isArray(data?.result?.photo)?data.result.photo:[],best=photos[photos.length-1];if(!best?.file_id)throw err('لم يرجع البوت معرّف الصورة.');let url='';try{url=await resolve(best.file_id,{force:true})}catch(_){}return{fileId:clean(best.file_id),fileUniqueId:clean(best.file_unique_id),url,width:Number(best.width||0),height:Number(best.height||0)}
  }
  async function uploadOrQueue(productId,dataUrl,name='product.jpg'){
    const pid=clean(productId),pending=pendingState(dataUrl,name);if(!pid)throw err('معرّف الصنف غير جاهز.');
    if(!offline())try{const up=await upload(dataUrl,name);await forgetPending(pid);return{state:uploadedState(up),uploaded:true,queued:false}}catch(e){console.warn('[AlMeezan product image] direct upload failed; queued locally',e)}
    const kept=await rememberPending(pid,pending);if(!kept)throw err('تعذر حفظ الصورة محلياً لإعادة رفعها.');return{state:pending,uploaded:false,queued:true}
  }
  async function syncPending({limit=12}={}){
    if(syncing||offline()||!window.AlMezan?.db)return{processed:0};syncing=true;let processed=0;
    try{await hydratePending();const list=(window.AlMezan.db.products||[]).filter(p=>p?.imagePendingUpload&&isData(p.imageData)).slice(0,Math.max(1,Number(limit)||12));for(const p of list){try{const up=await upload(p.imageData,`${clean(p.name||p.sku||p.id||'product')}-${Date.now()}.jpg`);Object.assign(p,uploadedState(up),{updatedAt:new Date().toISOString()});await forgetPending(p.id);window.AlMezan.saveDB?.(true,{defer:true});processed++}catch(e){if(isOfflineError(e))break;console.warn('[AlMeezan product image] retry upload failed',e)}}if(processed)requestAnimationFrame(()=>{try{if(!document.querySelector('#modalRoot .modal'))window.AlMezan?.renderCurrent?.()}catch(_){}});return{processed}}finally{syncing=false}
  }
  function scheduleSync(delay=350){clearTimeout(timer);timer=setTimeout(()=>syncPending().catch(()=>{}),Math.max(80,Number(delay)||350))}
  function removeState(product){if(product?.id)forgetPending(product.id);return{...product,imageData:'',imagePendingUpload:false,imagePendingName:'',imageTelegramFileId:'',imageTelegramUniqueId:'',imageTelegramUrl:'',imageUrl:'',imageStorage:'',imageUpdatedAt:new Date().toISOString()}}
  window.addEventListener('online',()=>scheduleSync(80));window.addEventListener('focus',()=>scheduleSync(220));document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync(160)});window.addEventListener('almezan:local-save',()=>scheduleSync(500));
  window.AlMezanProductImages={src,pendingState,uploadedState,prepareFile,upload,uploadOrQueue,resolve,syncPending,scheduleSync,removeState,rememberPending,forgetPending,hydratePending,isDataImage:isData,isOfflineError};
  setTimeout(()=>{hydratePending().then(()=>scheduleSync(120)).catch(()=>{})},250);
})();

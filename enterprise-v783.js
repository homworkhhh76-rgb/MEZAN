/* Al-Meezan Pro v7.84.3 — expiry/wastage + fixed 6-digit phone scanner link. */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;
const S=A.state,D=()=>A.db,num=A.num,esc=A.esc;
const PHONE_KEY='almezan_phone_scanner_6digit_v7843';
const css=`
#phoneScannerSettingsV783{scroll-margin-top:78px}
.phone-scanner-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.phone-scanner-dot{width:9px;height:9px;border-radius:50%;background:#9ca3af;box-shadow:0 0 0 3px rgba(156,163,175,.14)}
.phone-scanner-status.connected .phone-scanner-dot{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.14)}
.phone-scanner-status.connecting .phone-scanner-dot{background:#d97706}
.phone-scanner-status.error .phone-scanner-dot{background:#dc2626}
.phone-scanner-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.phone-scanner-note{font-size:12px;line-height:1.8;color:var(--muted,#697587);margin-top:8px}
.phone-code-wrap{display:grid;grid-template-columns:minmax(180px,260px) auto;gap:8px;align-items:end}
.phone-six-code{direction:ltr!important;text-align:center!important;letter-spacing:7px!important;font-weight:800!important;font-size:18px!important}
.phone-pair-status{margin-top:10px;padding:9px 11px;border:1px solid #dce3ea;border-radius:10px;background:#f8fafc}
.expiry-alert-group{border:1px solid rgba(220,38,38,.18);border-radius:12px;overflow:hidden;margin-bottom:10px}
.expiry-alert-toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px;background:rgba(220,38,38,.06)}
.expiry-alert-item{border-top:1px solid rgba(220,38,38,.1)}
.purchase-lines-table .pur-line-expiry{min-width:138px}.purchase-lines-table .pur-line-batch{min-width:110px}.purchase-add-row{align-items:end}
@media(max-width:700px){.phone-code-wrap{grid-template-columns:1fr}.expiry-alert-toolbar{align-items:stretch;flex-direction:column}.expiry-alert-item{align-items:flex-start;flex-wrap:wrap}.expiry-alert-item .btn{margin-inline-start:auto}}
`;
const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
function loadPhone(){try{return JSON.parse(localStorage.getItem(PHONE_KEY)||'{}')}catch(_){return{}}}
function savePhone(patch){const next={...loadPhone(),...patch,updatedAt:Date.now()};localStorage.setItem(PHONE_KEY,JSON.stringify(next));try{updatePhoneUi()}catch(_){}return next}
function branchExpiredLots(){const d=D(),ids=new Set((d.warehouses||[]).filter(w=>!S.activeBranchId||w.branchId===S.activeBranchId).map(w=>w.id));return(d.productBatches||[]).filter(b=>ids.has(b.warehouseId)&&b.expiryDate&&b.expiryDate<A.today()&&num(b.qtyBase)>0)}
function ensureInventoryCollections(){const d=D();d.productBatches=d.productBatches||[];d.wastageDocs=d.wastageDocs||[];d.sequences=d.sequences||{};d.sequences.wastage=num(d.sequences.wastage)||0}
function disposeExpired(ids=null){ensureInventoryCollections();const d=D(),wanted=ids?new Set(ids):null,lots=branchExpiredLots().filter(l=>!wanted||wanted.has(l.id));if(!lots.length){A.toast('لا توجد كميات منتهية قابلة للإتلاف.','warning');return false}
  const groups=new Map();let skipped=0,totalRemoved=0;
  for(const lot of lots){const p=d.products.find(x=>x.id===lot.productId);if(!p)continue;const inStock=Math.max(0,num(A.stockQty(lot.productId,lot.warehouseId))),requested=Math.max(0,num(lot.qtyBase)),qty=Math.min(requested,inStock);if(qty<=1e-8){skipped++;continue}const cost=num(lot.cost||p.cost||0),lineCost=Number((qty*cost).toFixed(2));lot.qtyBase=Number((requested-qty).toFixed(8));A.adjustStock(lot.productId,lot.warehouseId,-qty);totalRemoved+=qty;const g=groups.get(lot.warehouseId)||{warehouseId:lot.warehouseId,lines:[],totalCost:0};g.lines.push({productId:p.id,productName:p.name,qtyBase:qty,consumptions:[{productId:p.id,warehouseId:lot.warehouseId,batchId:lot.id,batchNo:lot.batchNo||'',expiryDate:lot.expiryDate||'',qtyBase:qty,unitCost:cost,totalCost:lineCost}],costTotal:lineCost});g.totalCost+=lineCost;groups.set(lot.warehouseId,g)}
  if(!groups.size){A.toast('تعذر نقل المنتهي للتالف لأن الرصيد الفعلي لا يغطي التشغيلات. راجع تسوية المخزون.','warning',5500);return false}
  for(const g of groups.values()){const number=`WST-${String(++d.sequences.wastage).padStart(6,'0')}`,totalCost=Number(g.totalCost.toFixed(2)),doc={id:A.uid('WST'),number,date:A.today(),warehouseId:g.warehouseId,reason:'منتهي الصلاحية',notes:'إضافة منتهيات الصلاحية تلقائياً من مركز التنبيهات',lines:g.lines,totalCost,createdAt:A.now()};d.wastageDocs.unshift(doc);if(totalCost>.009)A.postJournal(`سند إتلاف ${number}`,number,[{accountId:'ACC-5230',debit:totalCost,credit:0},{accountId:'ACC-1300',debit:0,credit:totalCost}],doc.date,true);A.audit('إتلاف منتهي الصلاحية','المخزون',`${number} — ${g.lines.length} تشغيلة`)}
  A.saveDB(true);A.closeModal?.();A.renderCurrent();A.toast(`تمت إضافة المنتهي للتالف وخصمه من المخزون${skipped?' — توجد تشغيلات تحتاج مراجعة رصيد':''}`,'success',4500);return totalRemoved>0
}
A.registerAction('v783-expire-all-wastage',()=>A.confirmDialog('إضافة كل المنتهي للتالف','سيتم إنشاء سند/سندات إتلاف وخصم الكميات المنتهية من المخزون وترحيل تكلفتها محاسبياً.',()=>disposeExpired()));
A.registerAction('v783-expire-lot-wastage',b=>{const lot=(D().productBatches||[]).find(x=>x.id===b.dataset.id),p=D().products.find(x=>x.id===lot?.productId);if(!lot)return;A.confirmDialog('إضافة للتالف',`سيتم خصم الكمية المنتهية من ${p?.name||'الصنف'} ونقلها إلى سجل التالف.`,()=>disposeExpired([lot.id]))});


function loadScript(urls,check,key){
  if(check())return Promise.resolve(check());
  if(window[key])return window[key];
  window[key]=(async()=>{
    let last;
    for(const src of urls){
      try{
        await new Promise((resolve,reject)=>{
          const el=document.createElement('script');
          el.src=src;el.async=true;el.crossOrigin='anonymous';
          el.onload=resolve;el.onerror=reject;document.head.appendChild(el);
        });
        if(check())return check();
      }catch(e){last=e}
    }
    throw last||Error('تعذر تحميل محرك الربط');
  })().finally(()=>window[key]=null);
  return window[key];
}
function loadPeerJs(){
  return loadScript(
    ['https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js','https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js'],
    ()=>window.Peer,
    '__almezanPeerLoading'
  );
}
const PEER_OPTIONS={
  host:'0.peerjs.com',
  port:443,
  path:'/',
  secure:true,
  debug:0,
  config:{
    iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun1.l.google.com:19302'},
      {urls:'stun:stun2.l.google.com:19302'}
    ],
    sdpSemantics:'unified-plan'
  }
};
const recentScanIds=new Map();
let hostPeer=null,hostConn=null,hostReadyPromise=null,hostAuthenticated=false,hostStarting=false,hostCode='',hostRetryTimer=0,hostGeneration=0;

function normalizeSixCode(v){return String(v||'').replace(/\D/g,'').slice(0,6)}
function randomSixCode(){return String(Math.floor(100000+Math.random()*900000))}
function ensurePhoneCode(){
  let c=loadPhone(),code=normalizeSixCode(c.code);
  if(!/^\d{6}$/.test(code)){
    code=randomSixCode();
    c=savePhone({code,enabled:true,pairedAt:'',lastError:''});
  }
  return code;
}
function phoneStatus(){
  const c=loadPhone();
  if(c.enabled===false)return{tone:'',label:'الربط متوقف'};
  const code=ensurePhoneCode();
  if(hostAuthenticated&&hostConn?.open)return{tone:'connected',label:`متصل — كود ${code}`};
  if(hostPeer?.open)return{tone:'connecting',label:`جاهز — بانتظار القارئ على الكود ${code}`};
  if(hostStarting)return{tone:'connecting',label:'جاري تشغيل ربط القارئ...'};
  return c.lastError?{tone:'error',label:String(c.lastError)}:{tone:'',label:`غير متصل — الكود ${code}`};
}
function updatePhoneUi(){
  const st=phoneStatus(),markup=`<span class="phone-scanner-dot"></span><b>${esc(st.label)}</b>`,code=ensurePhoneCode();
  document.querySelectorAll('[data-phone-scanner-status]').forEach(el=>{
    const cls=`phone-scanner-status ${st.tone}`.trim();
    if(el.className!==cls)el.className=cls;
    if(el.innerHTML!==markup)el.innerHTML=markup;
  });
  document.querySelectorAll('[data-phone-scanner-code]').forEach(el=>{
    if(document.activeElement!==el&&el.value!==code)el.value=code;
  });
  const modal=document.querySelector('#phonePairLiveStatus');
  if(modal){
    const cls=`phone-pair-status phone-scanner-status ${st.tone}`.trim();
    if(modal.className!==cls)modal.className=cls;
    if(modal.innerHTML!==markup)modal.innerHTML=markup;
  }
}
function destroyHost(){
  ++hostGeneration;
  clearTimeout(hostRetryTimer);
  try{hostConn?.close?.()}catch(_){}
  try{hostPeer?.destroy?.()}catch(_){}
  hostConn=null;hostPeer=null;hostReadyPromise=null;hostAuthenticated=false;hostStarting=false;hostCode='';
  updatePhoneUi();
}
function scheduleHostRetry(delay=3200){
  clearTimeout(hostRetryTimer);
  const c=loadPhone();
  if(c.enabled===false)return;
  hostRetryTimer=setTimeout(()=>ensureHost(false).catch(()=>scheduleHostRetry(Math.min(9000,delay+900))),delay);
}
function seenScan(id){
  if(!id)return false;
  const now=Date.now();
  for(const [k,t] of recentScanIds)if(now-t>10000)recentScanIds.delete(k);
  if(recentScanIds.has(id))return true;
  recentScanIds.set(id,now);
  return false;
}
function sendHost(data){try{if(hostConn?.open)hostConn.send(data)}catch(_){}}
async function addPhoneScannedProduct(code,hit){
  if(!hit?.product)return false;
  if(S.view!=='cashier')A.navigate('cashier');
  for(let i=0;i<8;i++){
    try{
      let ok=false;
      if(typeof A.cashierAddProductDirect==='function')
        ok=!!A.cashierAddProductDirect(hit.product.id,hit.unit?.id||hit.product.defaultCashierUnitId||'',1);
      else if(typeof A.cashierAddScannedCode==='function')
        ok=!!A.cashierAddScannedCode(code);
      if(ok){try{A.playBarcodeSound?.()}catch(_){}return true}
      if(typeof A.cashierAddProductDirect==='function'||typeof A.cashierAddScannedCode==='function')return false;
    }catch(e){console.error('Phone scanner add failed',e)}
    await new Promise(r=>setTimeout(r,80));
  }
  return false;
}
async function handleBarcodeMessage(msg){
  const code=String(msg?.code||'').trim();
  if(!code||seenScan(msg?.id))return;
  const hit=A.findProductByBarcode?.(code);
  if(!hit){
    A.toast?.(`الباركود غير مسجل: ${code}`,'warning',3200);
    sendHost({type:'scan-result',id:msg.id||'',ok:false,code,productName:'',unitName:'',message:'الباركود غير مسجل',at:Date.now()});
    return;
  }
  const ok=await addPhoneScannedProduct(code,hit);
  if(ok)A.toast?.(`تمت إضافة ${hit.product.name} إلى الفاتورة`,'success',1800);
  sendHost({
    type:'scan-result',id:msg.id||'',ok,code,
    productName:hit.product?.name||'',unitName:hit.unit?.name||'',
    message:ok?'تمت الإضافة إلى الفاتورة':'تعذر إضافة الصنف إلى السلة — راجع المخزون أو الوحدة',
    at:Date.now()
  });
}
function acceptConnection(conn,code){
  if(hostConn&&hostConn!==conn){try{hostConn.close()}catch(_){}}
  hostConn=conn;hostAuthenticated=false;updatePhoneUi();
  let authTimer=setTimeout(()=>{if(!hostAuthenticated)try{conn.close()}catch(_){}},9000);
  conn.on('open',()=>updatePhoneUi());
  conn.on('data',msg=>{
    if(!hostAuthenticated){
      if(msg?.type==='hello'&&normalizeSixCode(msg.code||msg.room)===code){
        clearTimeout(authTimer);hostAuthenticated=true;
        savePhone({pairedAt:Date.now(),lastError:'',enabled:true});
        sendHost({type:'paired',companyName:D().company?.name||'الميزان',at:Date.now()});
        updatePhoneUi();A.toast('تم ربط قارئ الجوال بنجاح','success');
        return;
      }
      sendHost({type:'auth-error',message:'كود الربط غير صحيح'});
      try{conn.close()}catch(_){}
      return;
    }
    if(msg?.type==='ping'){sendHost({type:'pong',at:Date.now()});return}
    if(msg?.type==='barcode')handleBarcodeMessage(msg).catch(e=>{console.error('Phone scanner message failed',e);sendHost({type:'scan-result',id:msg?.id||'',ok:false,code:String(msg?.code||''),message:'تعذر معالجة الباركود',at:Date.now()})});
  });
  conn.on('close',()=>{
    if(hostConn===conn){hostConn=null;hostAuthenticated=false;updatePhoneUi()}
  });
  conn.on('error',err=>{
    savePhone({lastError:String(err?.message||err||'خطأ اتصال')});
    updatePhoneUi();
  });
}
async function ensureHost(force=false){
  const cfg=loadPhone();
  if(cfg.enabled===false)return false;
  const code=ensurePhoneCode();
  if(!force&&hostPeer?.open&&hostCode===code)return hostPeer;
  if(hostReadyPromise&&!force)return hostReadyPromise;
  if(force||hostCode!==code)destroyHost();
  hostStarting=true;hostCode=code;savePhone({lastError:'',enabled:true});updatePhoneUi();
  const gen=++hostGeneration;
  hostReadyPromise=(async()=>{
    const Peer=await loadPeerJs();
    const roomId='sixlink-'+code;
    const peer=new Peer(roomId,PEER_OPTIONS);
    hostPeer=peer;
    peer.on('connection',incoming=>{
      if(gen!==hostGeneration){try{incoming.close()}catch(_){};return}
      if(incoming?.metadata?.room&&normalizeSixCode(incoming.metadata.room)!==code){
        try{incoming.close()}catch(_){}
        return;
      }
      acceptConnection(incoming,code);
    });
    peer.on('disconnected',()=>{
      if(gen!==hostGeneration)return;
      hostAuthenticated=false;updatePhoneUi();
      if(peer&&!peer.destroyed){try{peer.reconnect()}catch(_){}}
    });
    peer.on('close',()=>{
      if(gen!==hostGeneration)return;
      hostAuthenticated=false;hostStarting=false;updatePhoneUi();
      scheduleHostRetry();
    });
    peer.on('error',err=>{
      if(gen!==hostGeneration)return;
      hostStarting=false;
      const type=String(err?.type||'');
      const msg=type==='unavailable-id'
        ?'الكود مستخدم على جهاز كاشير آخر — غيّر الكود'
        :String(err?.message||type||'تعذر تشغيل الربط');
      savePhone({lastError:msg});updatePhoneUi();
      if(type!=='unavailable-id')scheduleHostRetry();
    });
    await new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(Error('انتهت مهلة تشغيل ربط القارئ')),12000);
      peer.once('open',()=>{clearTimeout(t);resolve()});
      peer.once('error',err=>{if(err?.type==='unavailable-id'){clearTimeout(t);reject(err)}});
    });
    hostStarting=false;savePhone({lastError:'',enabled:true});updatePhoneUi();
    return peer;
  })().catch(err=>{
    hostStarting=false;updatePhoneUi();throw err;
  }).finally(()=>{hostReadyPromise=null});
  return hostReadyPromise;
}
async function setPhoneCode(raw){
  const code=normalizeSixCode(raw);
  if(!/^\d{6}$/.test(code))throw Error('اكتب 6 أرقام بالضبط');
  savePhone({code,enabled:true,pairedAt:'',lastError:''});
  destroyHost();
  await ensureHost(true);
  updatePhoneUi();
  return code;
}
function scannerUrl(){return new URL('mobile-scanner.html',location.href).href}
function phoneSettingsMarkup(){
  const code=ensurePhoneCode();
  return `<div class="phone-code-wrap">
    <label class="field"><span>كود الربط المحلي</span><input data-phone-scanner-code class="phone-six-code" inputmode="numeric" maxlength="6" value="${esc(code)}" autocomplete="off"></label>
    <button type="button" class="btn btn-primary" data-action="v783-phone-code-save">حفظ وتشغيل</button>
  </div>
  <div data-phone-scanner-status class="phone-scanner-status"></div>
  <div class="phone-scanner-actions">
    <button type="button" class="btn btn-secondary" data-action="v783-phone-code-random">كود جديد</button>
    <button type="button" class="btn btn-secondary" data-action="v783-phone-reconnect">إعادة اتصال</button>
    <button type="button" class="btn btn-secondary" data-action="v783-phone-open-scanner">فتح القارئ</button>
  </div>
  <div class="phone-scanner-note">اكتب نفس 6 أرقام في تطبيق القارئ. الكود محفوظ محلياً على جهاز الكاشير ويمكن تغييره في أي وقت.</div>`;
}
function mountPhoneSettings(root){
  if(!root||root.querySelector('#phoneScannerSettingsV783'))return;
  const form=root.querySelector('#settingsForm'),grid=form?.querySelector('.grid-equal');
  if(!grid)return;
  const section=document.createElement('section');
  section.id='phoneScannerSettingsV783';section.className='settings-section settings-subsection';
  section.innerHTML=`<div class="settings-section-head"><div><h3>قارئ باركود الجوال</h3><small>ربط مباشر بكود ثابت من 6 أرقام</small></div></div>${phoneSettingsMarkup()}`;
  grid.appendChild(section);A.injectIcons?.(section);updatePhoneUi();
}
A.registerAction('v783-phone-code-save',b=>{
  const input=b?.closest?.('.s784-card,section,.modal-form')?.querySelector?.('[data-phone-scanner-code]')||document.querySelector('[data-phone-scanner-code]');
  setPhoneCode(input?.value||'').then(code=>A.toast(`تم حفظ كود الربط ${code} وتشغيله`,'success')).catch(e=>A.toast(String(e?.message||e),'error',6000));
});
A.registerAction('v783-phone-code-random',b=>{
  const code=randomSixCode(),input=b?.closest?.('.s784-card,section,.modal-form')?.querySelector?.('[data-phone-scanner-code]')||document.querySelector('[data-phone-scanner-code]');
  if(input)input.value=code;
  setPhoneCode(code).then(()=>A.toast(`تم اعتماد الكود الجديد ${code}`,'success')).catch(e=>A.toast(String(e?.message||e),'error',6000));
});
A.registerAction('v783-phone-pair',b=>{
  const input=b?.closest?.('.s784-card,section')?.querySelector?.('[data-phone-scanner-code]')||document.querySelector('[data-phone-scanner-code]');
  setPhoneCode(input?.value||ensurePhoneCode()).then(()=>A.toast('الربط جاهز — اكتب نفس الكود في القارئ','success')).catch(e=>A.toast(String(e?.message||e),'error',6000));
});
A.registerAction('v783-phone-open-scanner',()=>window.open(scannerUrl(),'_blank','noopener'));
A.registerAction('v783-phone-reconnect',()=>{destroyHost();ensureHost(true).then(()=>A.toast('تم تشغيل ربط قارئ الجوال','success')).catch(e=>A.toast(String(e?.message||e),'error',7000))});
A.registerAction('v783-phone-unpair',()=>A.confirmDialog('إيقاف ربط قارئ الجوال','سيبقى الكود محفوظاً محلياً ويمكن تشغيله لاحقاً.',()=>{
  destroyHost();savePhone({enabled:false,lastError:'',pairedAt:''});A.toast('تم إيقاف الربط');updatePhoneUi();
}));
const baseSettings=A.state?.views?.settings;
if(baseSettings)A.state.views.settings=root=>{
  baseSettings(root);
  try{mountPhoneSettings(root)}catch(e){console.error('Phone scanner settings mount failed',e)}
};
let phoneSettingsMountQueued=false;
const phoneSettingsRoot=document.querySelector('#workspace')||document.body;
const observer=new MutationObserver(()=>{
  if(S.view!=='settings'||phoneSettingsMountQueued)return;
  phoneSettingsMountQueued=true;
  requestAnimationFrame(()=>{
    phoneSettingsMountQueued=false;
    if(S.view!=='settings')return;
    try{mountPhoneSettings(document.querySelector('#workspace'));updatePhoneUi()}catch(e){console.error('Phone scanner settings observer failed',e)}
  });
});
observer.observe(phoneSettingsRoot,{childList:true,subtree:false});
window.AlMezanPhoneScanner={
  ensureHost,disposeExpired,mountPhoneSettings,updateUi:updatePhoneUi,
  getCode:ensurePhoneCode,setCode:setPhoneCode,restart:()=>ensureHost(true),
  get status(){return phoneStatus()},
  get settings(){return loadPhone()}
};
window.addEventListener('online',()=>{const c=loadPhone();if(c.enabled!==false)ensureHost(false).catch(()=>{})});
setTimeout(()=>{const c=loadPhone();if(c.enabled!==false)ensureHost(false).catch(()=>{})},1100);
})();

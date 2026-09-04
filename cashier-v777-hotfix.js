/* Al-Meezan Pro v7.77 — instant cashier search + continuous voice cart based on the user's proven Web Speech flow */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;
const S=A.state,D=()=>A.db,num=A.num;

/* ---------- Instant cashier search ---------- */
function latinDigits(v){return String(v??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))}
function normalizeText(v){return latinDigits(v).toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'').replace(/ـ/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}.]+/gu,' ').replace(/\s+/g,' ').trim()}
function repProductAllowed(productId){const u=A.currentUser?.();if(!u?.representativeId)return true;const rep=D().representatives?.find(r=>r.id===u.representativeId&&r.active!==false);if(!rep)return false;const qty=A.repStockQty?A.repStockQty(rep.id,productId):(D().repStock||[]).filter(r=>r.repId===rep.id&&r.productId===productId).reduce((n,r)=>n+num(r.qtyBase),0);return qty>1e-9}
function applyInstantSearch(value=''){
  if(S.view!=='cashier')return 0;
  const root=document.getElementById('workspace');if(!root)return 0;
  const raw=String(value??''),q=normalizeText(raw),tokens=q.split(' ').filter(Boolean),cards=[...root.querySelectorAll('.product-card[data-id]')];let shown=0;
  for(const card of cards){
    const hay=normalizeText(card.dataset.search||card.textContent||''),match=!q||hay.includes(q)||(tokens.length>1&&tokens.every(t=>hay.includes(t))),allowed=repProductAllowed(card.dataset.id),show=match&&allowed;
    card.hidden=!show;if(show)card.style.removeProperty('display');else card.style.setProperty('display','none','important');if(show)shown++;
  }
  let empty=root.querySelector('.cashier-search-empty-v777');const grid=root.querySelector('.product-grid');
  if(q&&grid&&!shown){if(!empty){empty=document.createElement('div');empty.className='empty-state compact-empty cashier-search-empty-v777';empty.innerHTML='<div class="empty-icon">⌕</div><h3>لا يوجد صنف مطابق</h3><p>جرّب جزءاً آخر من الاسم أو الباركود.</p>';grid.insertAdjacentElement('afterend',empty)}}else empty?.remove();
  for(const id of ['cashierSearch','cashierSearchDesktop','cashierCatalogSearch']){const el=document.getElementById(id);if(el&&el!==document.activeElement&&el.value!==raw)el.value=raw}
  return shown;
}
A.cashierApplySearch=applyInstantSearch;
function cashierSearchEvent(e){const input=e.target;if(!input?.matches?.('#cashierSearch,#cashierSearchDesktop,#cashierCatalogSearch')||S.view!=='cashier')return;S.cashierSearch=input.value||'';applyInstantSearch(S.cashierSearch)}
for(const ev of ['input','keyup','change','compositionend','search'])document.addEventListener(ev,cashierSearchEvent,true);
document.addEventListener('paste',e=>{if(e.target?.matches?.('#cashierSearch,#cashierSearchDesktop,#cashierCatalogSearch'))setTimeout(()=>cashierSearchEvent({target:e.target}),0)},true);
const ws=document.getElementById('workspace');
const searchObserver=new MutationObserver(()=>{if(S.view==='cashier'&&S.cashierSearch)requestAnimationFrame(()=>applyInstantSearch(S.cashierSearch))});
if(ws)searchObserver.observe(ws,{childList:true,subtree:true});

/* ---------- Continuous voice cashier — same proven Web Speech programming model ---------- */
const SpeechCtor=window.SpeechRecognition||window.webkitSpeechRecognition;
const NUMBER_WORDS=new Map(Object.entries({
  'نص':.5,'نصف':.5,'ربع':.25,
  'واحد':1,'واحده':1,'احد':1,'اثنين':2,'اتنين':2,'تنين':2,'ثنين':2,'اثنان':2,
  'ثلاث':3,'ثلاثه':3,'تلات':3,'تلاته':3,'اربع':4,'اربعه':4,'خمس':5,'خمسه':5,
  'ست':6,'سته':6,'سبع':7,'سبعه':7,'ثمان':8,'ثمانيه':8,'تمانيه':8,'تسع':9,'تسعه':9,
  'عشر':10,'عشره':10,'حداشر':11,'احداشر':11,'اثنعشر':12,'اتناشر':12,'تلتاشر':13,
  'اربعتاشر':14,'خمستاشر':15,'ستاشر':16,'سبعتاشر':17,'تمنتاشر':18,'تسعتاشر':19,
  'عشرين':20,'ثلاثين':30,'اربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تمانين':80,'تسعين':90,'ميه':100,'مئه':100
}).map(([k,v])=>[normalizeText(k),v]));
const UNIT_WORDS=new Set([
  'حبه','حبة','حبات','حبتين','وحده','وحدة','وحدات','كرتونه','كرتونة','كرتون','كراتين','كرتونتين',
  'علبه','علبة','علب','علبتين','كيلو','كلو','كيلوين','كيلوغرام','كغ','كغم','غرام','جرام','غم',
  'كيس','كياس','كيسين','باكيت','باكت','بكيت','باكيتات','باكتين','صندوق','صناديق','صندوقين',
  'ربطه','ربطة','ربطات','ربطتين','شده','شدة','شدات','شدتين','متر','امتار','مترين','لتر','لترات','لترين','طن','اطنان','طنين'
].map(normalizeText));
const COMMAND_WORDS=new Set(['و','ثم','بعدين','بعدها','حط','حطي','ضيف','ضيفلي','اضف','اضيف','اعطيني','اعطنا','هات','هاتلي','زيد','من','لو سمحت'].map(normalizeText));
const voice={active:false,recognition:null,restartTimer:null,lastTranscript:'',lastTranscriptAt:0,networkWarned:false};

function updateVoiceButton(status=''){
  document.querySelectorAll('.cashier-voice-button').forEach(btn=>{
    btn.classList.toggle('listening',voice.active);
    btn.setAttribute('aria-pressed',voice.active?'true':'false');
    btn.title=voice.active?(status||'المايك يعمل — اضغط للإيقاف'):'إضافة المنتجات بالصوت';
    const dot=btn.querySelector('.voice-live-dot');if(dot)dot.hidden=!voice.active;
  });
}
function heardToast(text){text=String(text||'').trim();if(text)A.toast(`🎙 سمعت: ${text}`,'success',2600)}
function pricingCustomer(){const c=A.cashierSelectedCustomer?.();if(!c)return c;const gid=S.cashierCustomerGroupId||c.customerGroupId;if(!gid||gid===c.customerGroupId)return c;return {...c,customerGroupId:gid,priceGroupIdOverride:''}}
function currentDefaultUnit(p){return A.productUnit(p,p?.defaultCashierUnitId)||(p?.units||[])[0]||null}
function addVoiceLine(p,u,qty){
  if(!p||!u)return false;qty=Math.max(.00000001,num(qty)||1);const factor=Math.max(.00000001,num(u.factor)||1),need=qty*factor;
  if(!repProductAllowed(p.id)){A.toast(`الصنف ${p.name} غير موجود في مخزون المندوب.`,'warning',3000);return false}
  if(p.trackStock!==false&&!p.useRecipe){const available=A.cashierVisualStock?.(p);if(Number.isFinite(available)&&available+1e-8<need){A.toast(`المتوفر من ${p.name} لا يكفي للكمية المطلوبة.`,'warning',3200);return false}}
  const price=A.priceForCustomer?A.priceForCustomer(p,u,pricingCustomer()):num(u.salePrice),existing=S.cart.find(x=>x.productId===p.id&&x.unitId===u.id&&num(x.unitPrice)===num(price));
  if(existing)existing.qty=num(existing.qty)+qty;else S.cart.push({id:A.uid('CART'),productId:p.id,unitId:u.id,qty,unitPrice:num(price),discount:0});
  return true;
}
function isNumberToken(t){const n=normalizeText(t);return /^\d+(?:\.\d+)?$/.test(n)||NUMBER_WORDS.has(n)}
function isModifierToken(t){const n=normalizeText(t);return isNumberToken(n)||UNIT_WORDS.has(n)||COMMAND_WORDS.has(n)}
function maxProductWords(){let max=1;for(const p of D().products||[]){if(p.active===false||p.retiredVariant||(!p.isVariant&&p.hasVariants))continue;max=Math.max(max,normalizeText(p.name||'').split(' ').filter(Boolean).length)}return Math.min(7,Math.max(2,max+1))}

/*
   Find product names one after another inside one speech result.
   Example: "شامبو 3 شورما 5 لبن" => [شامبو x3, شورما x5, لبن x1].
   Matching still uses the cashier's real fuzzy product matcher, so names come from the actual database.
*/
function detectProductMentions(text){
  const api=A.cashierVoice,normalized=normalizeText(text),tokens=normalized.split(' ').filter(Boolean);if(!api?.match||!tokens.length)return{tokens,mentions:[]};
  const mentions=[],maxWords=maxProductWords();let i=0;
  while(i<tokens.length){
    const tok=tokens[i];if(isNumberToken(tok)||UNIT_WORDS.has(tok)||COMMAND_WORDS.has(tok)){i++;continue}
    let best=null;
    for(let len=1;len<=maxWords&&i+len<=tokens.length;len++){
      const slice=tokens.slice(i,i+len);
      if(len>1&&slice.slice(1).some(x=>isNumberToken(x)||COMMAND_WORDS.has(x)))break;
      const q=slice.join(' '),hit=api.match(q);if(!hit||hit.ambiguous||!hit.product)continue;
      const score=Number.isFinite(Number(hit.score))?Number(hit.score):.99;
      const exact=normalizeText(hit.alias||hit.product.name||'')===q;
      const candidate={start:i,end:i+len,product:hit.product,matchedUnit:hit.unit||null,score,exact};
      if(!best||candidate.score<best.score-.015||(Math.abs(candidate.score-best.score)<=.015&&candidate.end-candidate.start>best.end-best.start))best=candidate;
    }
    if(best&&((best.exact)||(best.score<=((best.end-best.start)>1?.46:.40)))){mentions.push(best);i=best.end}else i++;
  }
  return{tokens,mentions};
}
function segmentForMention(tokens,mentions,index){
  const m=mentions[index],next=mentions[index+1];let from=m.start,to=next?next.start:tokens.length;
  // Quantity/unit before the FIRST product is allowed: "3 كرتونة شامبو".
  if(index===0&&from>0&&tokens.slice(0,from).every(isModifierToken))from=0;
  return tokens.slice(from,to).join(' ');
}
function processSingleFallback(text){
  const api=A.cashierVoice;if(!api?.parse||!api?.match)return[];const parsed=api.parse(text),hit=api.match(parsed.query||text);if(!hit||hit.ambiguous||!hit.product)return[];
  const p=hit.product,u=hit.unit||api.selectUnit?.(p,parsed.tokens,parsed.unitCanon)||currentDefaultUnit(p),qty=Math.max(.00000001,num(parsed.qty)||1);return u?[{product:p,unit:u,qty}]:[];
}
function parseContinuousOrders(text){
  const api=A.cashierVoice,{tokens,mentions}=detectProductMentions(text);if(!mentions.length)return processSingleFallback(text);
  const orders=[];
  for(let i=0;i<mentions.length;i++){
    const m=mentions[i],segment=segmentForMention(tokens,mentions,i),parsed=api?.parse?.(segment)||{tokens:segment.split(' '),qty:1,unitCanon:''};
    const p=m.product,u=m.matchedUnit||api?.selectUnit?.(p,parsed.tokens||[],parsed.unitCanon)||currentDefaultUnit(p),qty=Math.max(.00000001,num(parsed.qty)||1);
    if(u)orders.push({product:p,unit:u,qty,segment});
  }
  return orders;
}
function processContinuousTranscript(rawTranscript){
  const text=String(rawTranscript||'').trim();if(!text||S.view!=='cashier')return false;
  const norm=normalizeText(text),now=Date.now();heardToast(text);
  if(norm===voice.lastTranscript&&now-voice.lastTranscriptAt<1400)return true;
  voice.lastTranscript=norm;voice.lastTranscriptAt=now;
  const orders=parseContinuousOrders(text);if(!orders.length){A.toast(`سمعت: ${text} — لم أجد صنفاً مطابقاً في الكاشير`,'warning',3400);return false}
  const added=[];for(const o of orders){if(addVoiceLine(o.product,o.unit,o.qty))added.push(o)}
  if(!added.length)return false;
  A.persistCart();A.renderCurrent('cashier');
  requestAnimationFrame(()=>{updateVoiceButton('يستمع للطلب التالي');if(S.cashierSearch)applyInstantSearch(S.cashierSearch)});
  if(added.length===1){const o=added[0];A.toast(`تمت إضافة ${o.qty} ${o.unit.name} — ${o.product.name}`,'success',2500)}
  else A.toast(`تمت إضافة ${added.length} أصناف: ${added.map(o=>`${o.product.name} × ${o.qty}`).join('، ')}`,'success',3600);
  return true;
}
function createRecognition(){
  if(!SpeechCtor)return null;const r=new SpeechCtor();
  r.continuous=true;             // نفس برمجة الملف المرفق: استماع مستمر
  r.interimResults=false;        // نفس الملف: نعتمد الكلمات النهائية الواضحة فقط
  r.lang='ar-SA';
  r.maxAlternatives=1;
  r.onstart=()=>{if(!voice.active)return;updateVoiceButton('المايك يعمل ويستمع...');A.toast('🎙 المايك يعمل — احكِ المنتجات وراء بعض','success',2200)};
  r.onresult=event=>{
    if(!voice.active||S.view!=='cashier')return;
    for(let i=event.resultIndex;i<event.results.length;i++){
      const result=event.results[i];if(!result?.isFinal)continue;
      const raw=String(result[0]?.transcript||'').trim();if(raw)processContinuousTranscript(raw);
    }
  };
  r.onerror=e=>{
    if(!voice.active)return;const code=String(e?.error||'');
    if(code==='not-allowed'||code==='service-not-allowed'){A.toast('اسمح للموقع باستخدام الميكروفون ثم شغّل المايك مرة أخرى.','error',5200);stopVoiceCashier777();return}
    if(code==='audio-capture'){A.toast('تعذر الوصول إلى الميكروفون على الجهاز.','error',4500);stopVoiceCashier777();return}
    if(code==='network'&&!voice.networkWarned){voice.networkWarned=true;A.toast('خدمة التعرف الصوتي تحتاج اتصال إنترنت على هذا المتصفح، وسأعيد التشغيل تلقائياً.','warning',4200)}
    if(code!=='aborted'&&code!=='no-speech'&&code!=='network')A.toast(`خطأ مؤقت في الصوت: ${code}`,'warning',2600);
  };
  r.onend=()=>{
    if(!voice.active||S.view!=='cashier')return;
    clearTimeout(voice.restartTimer);voice.restartTimer=setTimeout(()=>{if(!voice.active||S.view!=='cashier')return;try{r.start()}catch(_){voice.restartTimer=setTimeout(()=>{try{r.start()}catch(__){}},450)}},140);
  };
  return r;
}
function startVoiceCashier777(){
  if(voice.active)return true;
  if(!SpeechCtor){A.toast('التعرف الصوتي غير مدعوم هنا. استخدم Chrome أو Edge حديث.','warning',5200);return false}
  if(!window.isSecureContext&&location.protocol!=='file:'){A.toast('الميكروفون يحتاج فتح البرنامج عبر HTTPS.','warning',5000);return false}
  voice.active=true;voice.networkWarned=false;voice.recognition=createRecognition();updateVoiceButton('جاري تشغيل المايك...');
  try{voice.recognition.start();return true}catch(_){voice.active=false;voice.recognition=null;updateVoiceButton();A.toast('تعذر تشغيل المايكروفون. أعد المحاولة.','error',3500);return false}
}
function stopVoiceCashier777(){
  voice.active=false;clearTimeout(voice.restartTimer);const r=voice.recognition;voice.recognition=null;try{r?.stop?.()}catch(_){}updateVoiceButton();
}
function toggleVoiceCashier777(){return voice.active?stopVoiceCashier777():startVoiceCashier777()}
A.registerAction('voice-cashier',toggleVoiceCashier777);
A.cashierVoiceV777={start:startVoiceCashier777,stop:stopVoiceCashier777,toggle:toggleVoiceCashier777,process:processContinuousTranscript,parseMany:parseContinuousOrders,search:applyInstantSearch,get active(){return voice.active}};

document.addEventListener('click',e=>{const nav=e.target.closest?.('[data-view]');if(nav&&nav.dataset.view&&nav.dataset.view!=='cashier'&&voice.active)stopVoiceCashier777()},true);
window.addEventListener('beforeunload',stopVoiceCashier777);

/* Keep the v7.77 action/search attached after cashier rerenders. */
const uiObserver=new MutationObserver(()=>{if(S.view!=='cashier')return;requestAnimationFrame(()=>{A.cashierApplySearch=applyInstantSearch;A.registerAction('voice-cashier',toggleVoiceCashier777);updateVoiceButton();if(S.cashierSearch)applyInstantSearch(S.cashierSearch)})});
if(ws)uiObserver.observe(ws,{childList:true,subtree:true});
})();

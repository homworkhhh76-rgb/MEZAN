/* Al-Meezan Pro v7.81.6 — robust cashier product + customer live search fix */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;const S=A.state,D=()=>A.db;
const ids='#cashierSearch,#cashierSearchDesktop,#cashierCatalogSearch';
function norm(v){return String(v??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'').replace(/ـ/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}.]+/gu,' ').replace(/\s+/g,' ').trim()}
function productHay(p){if(!p)return'';const vars=p.hasVariants?(D().products||[]).filter(v=>v.parentId===p.id&&v.active!==false):[];return norm([p.name,p.sku,p.category,...(p.units||[]).flatMap(u=>[u.name,u.barcode,u.code]),...vars.flatMap(v=>[v.name,v.sku,...(v.units||[]).flatMap(u=>[u.name,u.barcode,u.code])])].filter(Boolean).join(' '))}
function showCatalog(root){const layout=root.querySelector('.cashier-layout');if(layout){layout.classList.remove('show-invoice');layout.classList.add('show-catalog')}root.querySelectorAll('.cashier-mobile-split-tabs .split-tab').forEach(b=>b.classList.toggle('active',b.dataset.pane==='catalog'));S.cashierMobilePane='catalog'}
function apply(value='',opts={}){
 if(S.view!=='cashier')return 0;const root=document.getElementById('workspace');if(!root)return 0;const raw=String(value??''),q=norm(raw),tokens=q.split(' ').filter(Boolean);S.cashierSearch=raw;if(q&&S.cashierCategory&&S.cashierCategory!=='all'&&!S._v7815SearchRerender){S.cashierCategory='all';S._v7815SearchRerender=true;const activeId=document.activeElement?.id||'cashierSearch';setTimeout(()=>{try{A.renderCurrent('cashier')}finally{S._v7815SearchRerender=false}requestAnimationFrame(()=>{const n=document.getElementById(activeId)||document.querySelector(ids);if(n){n.value=raw;try{n.focus({preventScroll:true})}catch(_){n.focus()}}apply(raw,{showCatalog:true})})},0);return 0}if(q&&opts.showCatalog===true)showCatalog(root);let shown=0;
 root.querySelectorAll('.product-card[data-id]').forEach(card=>{const p=(D().products||[]).find(x=>x.id===card.dataset.id),hay=productHay(p)||norm(card.dataset.search||card.textContent||''),ok=!q||hay.includes(q)||tokens.every(t=>hay.includes(t));card.hidden=!ok;if(ok){card.style.removeProperty('display');shown++}else card.style.setProperty('display','none','important')});
 const grid=root.querySelector('.product-grid');let empty=root.querySelector('.cashier-search-empty-v7815');if(q&&grid&&!shown){if(!empty){empty=document.createElement('div');empty.className='empty-state compact-empty cashier-search-empty-v7815';empty.innerHTML='<div class="empty-icon">⌕</div><h3>لا يوجد صنف مطابق</h3><p>ابحث بالاسم أو الباركود أو SKU.</p>';grid.insertAdjacentElement('afterend',empty)}}else empty?.remove();
 root.querySelectorAll(ids).forEach(el=>{if(el!==document.activeElement&&el.value!==raw)el.value=raw});return shown
}
function handle(e){const input=e.target;if(S.view!=='cashier'||!input?.matches?.(ids))return;const raw=input.value||'';S.cashierSearch=raw;if(raw.trim()&&S.cashierCategory&&S.cashierCategory!=='all'){
   S.cashierCategory='all';const inputId=input.id;A.renderCurrent('cashier');requestAnimationFrame(()=>{const n=document.getElementById(inputId)||document.querySelector(ids);if(n){n.value=raw;try{n.focus({preventScroll:true})}catch(_){n.focus()}}apply(raw,{showCatalog:true})});return
 }
 apply(raw,{showCatalog:true})
}
for(const ev of ['input','keyup','change','compositionend','search'])document.addEventListener(ev,handle,true);
document.addEventListener('paste',e=>{if(e.target?.matches?.(ids))setTimeout(()=>handle({target:e.target}),0)},true);
A.cashierApplySearch=apply;
const ws=document.getElementById('workspace');if(ws)new MutationObserver(()=>{if(S.view==='cashier')requestAnimationFrame(()=>{A.cashierApplySearch=apply;if(S.cashierSearch)apply(S.cashierSearch,{showCatalog:false})})}).observe(ws,{childList:true,subtree:true});
})();


/* v7.81.6 — customer autocomplete isolation/fallback.
   Keeps customer search independent from product search and from the currently selected cash customer. */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;const S=A.state,D=()=>A.db;
function cnorm(v){return String(v??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'').replace(/ـ/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim()}
function matches(c,q){if(!q)return true;const tokens=q.split(' ').filter(Boolean),hay=cnorm([c?.name,c?.phone,c?.address,c?.taxNumber,c?.code,c?.notes].filter(Boolean).join(' '));return hay.includes(q)||tokens.every(t=>hay.includes(t))}
function renderCustomerResults(input){if(S.view!=='cashier'||!input?.isConnected)return;const box=document.getElementById('cashierCustomerSuggestions');if(!box)return;const raw=input.value==='عميل نقدي'?'':input.value,q=cnorm(raw),customers=(D().customers||[]).filter(c=>!c.system&&c.active!==false&&matches(c,q)).slice(0,12),cashOk=!q||cnorm('عميل نقدي').includes(q),esc=A.esc,I=A.I;let html='';if(cashOk)html+=`<button type="button" class="customer-suggestion ${S.cashierCustomerId==='CUS-CASH'?'selected':''}" data-action="cashier-customer-pick" data-id="CUS-CASH"><span class="suggestion-icon">${I('customer',16)}</span><span><b>عميل نقدي</b></span></button>`;html+=customers.map(c=>`<button type="button" class="customer-suggestion ${S.cashierCustomerId===c.id?'selected':''}" data-action="cashier-customer-pick" data-id="${esc(c.id)}"><span class="suggestion-icon">${I('customer',16)}</span><span><b>${esc(c.name||'')}</b><small>${esc(c.phone||'')} · ${esc(A.priceGroupForCustomer?.(c)?.name||'السعر الأساسي')} · ${A.money(c.balance)}</small></span></button>`).join('');box.innerHTML=html||'<div class="customer-no-result">لا يوجد عميل مطابق</div>';box.hidden=false;A.injectIcons?.(box)}
function schedule(input){setTimeout(()=>renderCustomerResults(input),0)}
document.addEventListener('input',e=>{if(e.target?.id==='cashierCustomerSearch')schedule(e.target)},false);
document.addEventListener('compositionend',e=>{if(e.target?.id==='cashierCustomerSearch')schedule(e.target)},false);
document.addEventListener('focusin',e=>{if(e.target?.id==='cashierCustomerSearch')schedule(e.target)},false);
document.addEventListener('paste',e=>{if(e.target?.id==='cashierCustomerSearch')setTimeout(()=>renderCustomerResults(e.target),0)},false);
A.cashierCustomerSearchNormalize=cnorm;
A.cashierCustomerSearchMatches=matches;
})();

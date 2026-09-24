/* Al-Meezan Pro v7.84.9 — list search hotfixes */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;const S=A.state,D=()=>A.db,esc=A.esc,I=A.I;
function norm(v){return String(v??'').toLowerCase().trim()}
function contains(values,q){q=norm(q);if(!q)return true;return values.map(norm).join(' ').includes(q)}
function addSearch(root,key,placeholder){
  const panel=root.querySelector('.panel');if(!panel||root.querySelector(`[data-list-search="${key}"]`))return;
  const wrap=document.createElement('div');wrap.className='toolbar v7849-list-search';wrap.innerHTML=`<div class="search-box">${I('search')}<input type="search" autocomplete="off" data-list-search="${key}" placeholder="${esc(placeholder)}" value="${esc(S[key]||'')}"></div>`;
  panel.insertBefore(wrap,panel.firstChild);A.injectIcons?.(wrap);const input=wrap.querySelector('input');input.addEventListener('input',e=>{S[key]=e.target.value;clearTimeout(S[key+'Timer']);S[key+'Timer']=setTimeout(()=>{if(S.view)A.renderCurrent();requestAnimationFrame(()=>{const n=document.querySelector(`[data-list-search="${key}"]`);if(n){n.focus({preventScroll:true});const l=n.value.length;n.setSelectionRange?.(l,l)}})},90)});
}
function wrapView(view,key,placeholder,filterDb){const base=S.views[view];if(typeof base!=='function')return;A.registerView(view,root=>{const restore=filterDb(norm(S[key]||''));try{base(root)}finally{restore?.()}addSearch(root,key,placeholder)})}
wrapView('customers','customerListSearch','بحث بالاسم أو الهاتف أو العنوان أو الرصيد',q=>{if(!q)return()=>{};const all=D().customers;D().customers=all.filter(c=>c.system||contains([c.name,c.phone,c.address,c.taxNumber,c.balance],q));return()=>{D().customers=all}});
wrapView('vouchers','voucherListSearch','بحث برقم السند أو الطرف أو البيان أو المرجع أو المبلغ',q=>{if(!q)return()=>{};const all=D().vouchers;D().vouchers=all.filter(v=>contains([v.number,v.partyName,v.partyType,v.direction,v.reference,v.notes,v.amount,D().accounts.find(a=>a.id===v.accountId)?.name],q));return()=>{D().vouchers=all}});
wrapView('debts','debtListSearch','بحث باسم العميل أو المورد أو الهاتف أو الرصيد',q=>{if(!q)return()=>{};const customers=D().customers,suppliers=D().suppliers;D().customers=customers.filter(c=>c.system||contains([c.name,c.phone,c.address,c.balance],q));D().suppliers=suppliers.filter(s=>contains([s.name,s.phone,s.address,s.balance],q));return()=>{D().customers=customers;D().suppliers=suppliers}});
const style=document.createElement('style');style.textContent='.v7849-list-search{margin-bottom:12px}.v7849-list-search .search-box{width:min(100%,520px)}.v7849-list-search .search-box input{width:100%}';document.head.appendChild(style);
})();

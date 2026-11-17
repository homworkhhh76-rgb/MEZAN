/* AlMezan Pro 7.89 — safe UI, purchase documents, local cashier preferences */
(()=>{
 'use strict';
 const A=window.AlMezan;
 if(!A)return;
 const esc=v=>A.esc(v??'');
 const num=v=>A.num(v);
 const paperMoney=v=>Number(num(v)||0).toFixed(2)+' ₪';
 const profitKey='almezan_cashier_profit_visible_v789';
 const showProfit=()=>localStorage.getItem(profitKey)!=='0';
 A.registerAction('cashier-toggle-profit',()=>{
   localStorage.setItem(profitKey,showProfit()?'0':'1');
   document.querySelectorAll('.cashier-profit-margin').forEach(e=>e.hidden=!showProfit());
   document.querySelectorAll('.cashier-profit-toggle').forEach(e=>{
     e.setAttribute('aria-pressed',String(showProfit()));
     e.textContent=showProfit()?'إخفاء الربح':'إظهار الربح';
   });
 });
 function getPurchase(id){return A.db.purchases?.find(x=>String(x.id)===String(id))}
 function docHtml(x){
   const co=A.db.company||{},lines=x.lines||[];
   return `<section class="purchase-print-page" dir="rtl" lang="ar">
    <header><h1>${esc(co.name||'الميزان المحاسبي')}</h1>${co.phone?`<div>${esc(co.phone)}</div>`:''}${co.address?`<div>${esc(co.address)}</div>`:''}<h2>فاتورة مشتريات</h2></header>
    <div class="print-meta"><div><b>رقم الفاتورة:</b> ${esc(x.number||'')}</div><div><b>التاريخ:</b> ${esc(x.date||'')}</div><div><b>المورد:</b> ${esc(x.supplierName||'')}</div><div><b>المستودع:</b> ${esc(A.warehouseName(x.warehouseId)||'')}</div></div>
    <table><thead><tr><th>م</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead>
    <tbody>${lines.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.productName||'')}</td><td>${esc(l.unitName||'')}</td><td>${esc(l.qty)}</td><td>${paperMoney(l.unitCost)}</td><td>${paperMoney(l.total)}</td></tr>`).join('')}</tbody></table>
    <div class="print-totals"><div>المجموع: <b>${paperMoney(x.subtotal)}</b></div><div>الخصم: <b>${paperMoney(x.discount)}</b></div><div>الضريبة: <b>${paperMoney(x.tax)}</b></div><div class="strong">الإجمالي: <b>${paperMoney(x.total)}</b></div><div>المدفوع: <b>${paperMoney(x.paid)}</b></div><div>المتبقي: <b>${paperMoney(x.due)}</b></div></div>
    ${x.reference?`<div class="print-note"><b>المرجع:</b> ${esc(x.reference)}</div>`:''}
    ${x.notes?`<div class="print-note"><b>ملاحظات الفاتورة:</b> ${esc(x.notes)}</div>`:''}
    <footer>الميزان المحاسبي</footer></section>`;
 }
 const docCss=`
  @font-face{font-family:MezanCairo;src:url('./cairo.ttf') format('truetype');font-display:swap}
  .purchase-print-page{background:white;color:black;font:600 21px/1.55 MezanCairo,Tahoma,Arial,sans-serif;direction:rtl;width:770px;max-width:100%;padding:20px;box-sizing:border-box}
  .purchase-print-page *{box-sizing:border-box}.purchase-print-page header{text-align:center;border-bottom:3px solid #000;padding-bottom:12px}
  .purchase-print-page h1{font-size:35px;margin:0}.purchase-print-page h2{font-size:30px;margin:5px 0 0}
  .purchase-print-page .print-meta{display:grid;grid-template-columns:1fr 1fr;gap:5px 16px;margin:18px 0}
  .purchase-print-page table{width:100%;border-collapse:collapse;table-layout:auto}
  .purchase-print-page th,.purchase-print-page td{border:2px solid #111;padding:9px 6px;text-align:right;font-size:20px;overflow-wrap:anywhere}
  .purchase-print-page th:first-child,.purchase-print-page td:first-child{text-align:center}
  .purchase-print-page .print-totals{border-top:3px solid #000;margin-top:14px;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px}
  .purchase-print-page .print-totals b{font-weight:900}.purchase-print-page .print-totals .strong{font-size:27px;font-weight:900}
  .purchase-print-page .print-note{margin:14px 0 4px;border:2px dashed #555;padding:9px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:650;font-size:22px}
  .purchase-print-page footer{text-align:center;border-top:2px solid #555;margin-top:15px;padding-top:8px;font-size:17px}
  @media print{body{margin:0;background:#fff}.purchase-print-page{width:100%;padding:5mm}@page{size:A4;margin:6mm}}
 `;
 A.registerAction('print-purchase-document',b=>{
   const x=getPurchase(b.dataset.id);if(!x)return A.toast('فاتورة الشراء غير موجودة.','warning');
   const w=window.open('','_blank');if(!w)return A.toast('اسمح بفتح نافذة الطباعة.','warning');
   w.document.open();w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc('فاتورة مشتريات '+x.number)}</title><style>${docCss}</style></head><body>${docHtml(x)}<script>window.addEventListener('load',async()=>{try{await document.fonts.ready}catch(e){}setTimeout(()=>window.print(),250)})<\/script></body></html>`);w.document.close();
 });
 let html2canvasPromise=null;
 function getHtml2Canvas(){
   if(window.html2canvas)return Promise.resolve(window.html2canvas);
   if(html2canvasPromise)return html2canvasPromise;
   html2canvasPromise=new Promise((resolve,reject)=>{
     const script=document.createElement('script');script.src='./html2canvas.min.js?v=7891';script.onload=()=>window.html2canvas?resolve(window.html2canvas):reject(Error('مكتبة تصدير الصورة غير جاهزة'));script.onerror=()=>reject(Error('تعذر تحميل مكتبة الصورة محلياً'));document.head.appendChild(script);
   }).catch(e=>{html2canvasPromise=null;throw e});
   return html2canvasPromise;
 }
 A.registerAction('image-purchase-document',async b=>{
   const x=getPurchase(b.dataset.id);if(!x)return A.toast('فاتورة الشراء غير موجودة.','warning');
   const el=document.createElement('div');el.style.cssText='position:fixed;top:0;left:-10000px;width:770px;z-index:-9999;background:#fff';el.innerHTML=`<style>${docCss}</style>${docHtml(x)}`;document.body.appendChild(el);
   try{const renderer=await getHtml2Canvas();await document.fonts?.load?.('700 21px MezanCairo').catch(()=>{});const canvas=await renderer(el.querySelector('.purchase-print-page'),{scale:2,backgroundColor:'#ffffff',useCORS:false,logging:false});const blob=await new Promise((res,rej)=>canvas.toBlob(data=>data?res(data):rej(Error('تعذر إنشاء الصورة')),'image/png'));A.downloadBlob(`مشتريات-${x.number}.png`,blob,'image/png');A.toast('تم تجهيز صورة فاتورة المشتريات وبها الملاحظات.','success')}
   catch(e){console.error(e);A.toast(e.message||'تعذر إنشاء صورة الفاتورة.','error',5000)}finally{el.remove()}
 });
 // Keep image/source preference local; never synchronize printer permission or the profit switch.
 // Offer purchase actions even when one was not selected in the details modal.
 const root=document.querySelector('#workspace');
 if(root){const obs=new MutationObserver(()=>{
   if(A.state.view!=='purchases')return;
   root.querySelectorAll('[data-action="view-purchase"]').forEach(btn=>{
     const row=btn.closest('tr'),area=row?.querySelector('.table-actions');if(!area||area.querySelector('[data-action="print-purchase-document"]'))return;
     const id=btn.dataset.id;if(!id)return;
     const print=document.createElement('button');print.type='button';print.className='icon-button';print.dataset.action='print-purchase-document';print.dataset.id=id;print.title='طباعة فاتورة الشراء';print.textContent='طباعة';area.append(print);
     const image=document.createElement('button');image.type='button';image.className='icon-button';image.dataset.action='image-purchase-document';image.dataset.id=id;image.title='تنزيل فاتورة الشراء كصورة';image.textContent='صورة';area.append(image);
   });
 });obs.observe(root,{subtree:true,childList:true});}
})();

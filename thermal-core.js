'use strict';
/* Watheeq 4.7 thermal receipt: shared markup for browser and POS iframe. No CDN. */
window.W47Thermal=(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>Number(Number(x||0).toFixed(2)).toFixed(2);
 const digits=v=>String(v??'').replace(/[\u0660-\u0669]/g,c=>String(c.charCodeAt(0)-0x0660)).replace(/[\u06F0-\u06F9]/g,c=>String(c.charCodeAt(0)-0x06F0));
 const patterns=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
 function barcodeSVG(raw){
  const data=('INV-'+digits(raw||'0')).replace(/[^\x20-\x7e]/g,'-').slice(0,64);
  const codes=[104];let checksum=104;
  for(let i=0;i<data.length;i++){const c=data.charCodeAt(i)-32;codes.push(c);checksum+=c*(i+1)}
  codes.push(checksum%103,106);
  let x=10,paths='';for(const n of codes){const pat=patterns[n];for(let i=0;i<pat.length;i++){const w=Number(pat[i]);if(i%2===0)paths+=`<rect x="${x}" y="0" width="${w}" height="18"/>`;x+=w}}
  return `<svg class="w47-barcode" xmlns="http://www.w3.org/2000/svg" width="${x+10}" height="18" viewBox="0 0 ${x+10} 18" role="img" aria-label="باركود الفاتورة ${esc(raw)}"><g fill="#000">${paths}</g></svg>`;
 }
 function qrSVG(str){try{
  if(!window.W47QRCodeClass)return '';
  const qr=new W47QRCodeClass(0,W47QRCodeLevel.L);qr.addData(String(str).slice(0,240));qr.make();const size=qr.getModuleCount(),quiet=2;
  let paths='';for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(qr.isDark(y,x))paths+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
  return `<svg class="w47-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size+quiet*2} ${size+quiet*2}" role="img" aria-label="رمز الاستجابة السريعة للفاتورة"><rect width="100%" height="100%" fill="white"/><path d="${paths}" fill="black"/></svg>`;
 }catch(e){console.warn('QR print:',e);return ''}}
 const source=v=>{const s=String(v||'');return /^(data:image\/(png|jpeg|jpg|webp);base64,|https:\/\/|blob:)/i.test(s)?esc(s):''};
 function html(d={},size='58mm'){
  const compact=size==='58mm'||size==='57mm';const paper=compact?'paper-57mm':'paper-80mm';
  const lines=Array.isArray(d.lines)?d.lines:[];
  const curr=esc(d.currency||'');const subtotal=Number(d.subtotal||0),discount=Number(d.discount||0),grand=Number(d.grandTotal||0),paid=Number(d.paid||0),remaining=Number.isFinite(Number(d.remaining))?Number(d.remaining):Math.max(0,grand-paid);
  const date=esc(d.dateTime||d.date||new Date().toLocaleString('sv-SE').slice(0,16));
  const image=source(d.logo);
  let code='';const invoice=String(d.number||'');
  if(d.codeType!=='none')code=d.codeType==='qrcode'?qrSVG(`INV:${digits(invoice)}|TOTAL:${money(grand)}|TEL:${digits(d.footerPhone||'0597603119')}`):barcodeSVG(invoice);
  return `<article class="receipt w47-thermal-receipt receipt-paper ${paper}" dir="rtl" data-w47-paper="${compact?'58mm':'80mm'}" ${d.documentId?`data-document="${esc(d.documentId)}"`:''}>
  <div class="w47-head">
   <div class="w47-logo">${image?`<img src="${image}" alt="شعار المحل" />`:`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="black" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5L12 2zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`}</div>
   <h2 class="w47-store">${esc(d.company||'الوثيق')}</h2>
   ${d.address?`<div class="w47-head-sub">${esc(d.address)}</div>`:''}
   ${d.phone?`<div class="w47-head-sub">جوال: <span dir="ltr">${esc(d.phone)}</span></div>`:''}
   ${d.taxNumber?`<div class="w47-head-sub">الرقم الضريبي: ${esc(d.taxNumber)}</div>`:''}
   ${d.invoiceTitle?`<div class="w47-head-sub">${esc(d.invoiceTitle)}</div>`:''}
  </div>
  <div class="w47-meta"><div class="w47-line"><span>رقم الفاتورة: #${esc(invoice)}</span><span dir="ltr">${date}</span></div>
   <div class="w47-line"><span class="w47-customer">${d.isPurchase?'المورد':'العميل'}: ${esc(d.customer||'نقدي')}</span><span>الهاتف: <b dir="ltr">${esc(d.customerPhone||'-')}</b></span></div></div>
  <table class="w47-table receipt-table"><colgroup><col style="width:8%"><col style="width:44%"><col style="width:12%"><col style="width:16%"><col style="width:20%"></colgroup>
   <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
   <tbody>${lines.map((l,i)=>`<tr><td>${i+1}</td><td class="w47-item-name">${esc(l.name)}</td><td>${esc(l.unit||'')}</td><td>${esc(l.qty)}</td><td dir="ltr">${money(l.total)}</td></tr>`).join('')}</tbody></table>
  <div class="w47-summary"><div class="w47-summary-row"><div class="w47-summary-box"><span>الإجمالي:</span><strong>${money(subtotal)}</strong></div><div class="w47-summary-box"><span>الخصم:</span><strong>${money(discount)}</strong></div></div>
   <div class="w47-summary-row"><div class="w47-summary-box w47-grand"><span>النهائي:</span><strong>${money(grand)}</strong></div><div class="w47-summary-box"><span>المتبقي:</span><strong>${money(Math.max(0,remaining))}</strong></div></div></div>
  ${d.note?`<div class="w47-note">${esc(d.note)}</div>`:''}
  <div class="w47-footer"><div class="w47-credit">برنامج الوثيق المحاسبي 0597603119</div>${code?`<div class="w47-code">${code}</div>`:''}</div>
  </article>`;
 }
 return {html,barcodeSVG,qrSVG,esc,money};
})();

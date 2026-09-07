/* Al-Meezan Pro v7.59 — compact multi-unit transfer rows, print-safe invoice page, live shift shortage */
(()=>{
  'use strict';
  const A=window.AlMezan;if(!A)return;
  const D=()=>A.db,S=A.state,num=A.num,esc=A.esc,I=A.I;

  /* 1) Multi-unit transfer UX: one row per product, compact unit inputs horizontally, one delete button at physical left. */
  const style=document.createElement('style');
  style.id='almezan-v758-style';
  style.textContent=`
    .v757-transfer-line{
      direction:rtl!important;
      display:grid!important;
      grid-template-columns:132px minmax(0,1fr) 38px!important;
      gap:6px!important;
      align-items:end!important;
      padding:8px 0!important;
      border-bottom:1px solid var(--border,#dbe3ec)!important;
      min-width:0!important;
    }
    .v757-transfer-line>.v757-product-field{grid-column:1!important;min-width:0!important;margin:0!important}
    .v757-transfer-line>.v757-line-units{grid-column:2!important;min-width:0!important;overflow:hidden!important}
    .v757-transfer-line>.v757-remove-line{grid-column:3!important;justify-self:end!important;align-self:end!important;width:36px!important;height:36px!important;min-width:36px!important;box-shadow:none!important}
    .v757-product-field>span{font-size:10px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .v757-product-field select,.v757-product-field .custom-select,.v757-product-field .select-trigger{width:100%!important;min-width:0!important;max-width:132px!important}
    .v757-unit-grid{
      display:flex!important;
      flex-wrap:nowrap!important;
      align-items:flex-end!important;
      gap:5px!important;
      width:100%!important;
      max-width:100%!important;
      overflow-x:auto!important;
      overflow-y:hidden!important;
      overscroll-behavior-inline:contain!important;
      -webkit-overflow-scrolling:touch!important;
      scrollbar-width:thin!important;
      padding:0 0 3px!important;
      direction:rtl!important;
    }
    .v757-unit-field{
      flex:0 0 68px!important;
      width:68px!important;
      min-width:68px!important;
      max-width:68px!important;
      gap:3px!important;
      font-size:9.5px!important;
      color:var(--muted,#64748b)!important;
    }
    .v757-unit-field>span{display:block!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;text-align:right!important}
    .v757-unit-field input{
      width:68px!important;
      min-width:68px!important;
      max-width:68px!important;
      min-height:34px!important;
      height:34px!important;
      padding:5px 6px!important;
      border-radius:8px!important;
      font-size:12px!important;
      text-align:center!important;
    }
    @media(max-width:760px){
      .v757-transfer-line{grid-template-columns:124px minmax(0,1fr) 36px!important;gap:5px!important;padding:7px 0!important}
      .v757-product-field select,.v757-product-field .custom-select,.v757-product-field .select-trigger{max-width:124px!important}
      .v757-unit-field{flex-basis:64px!important;width:64px!important;min-width:64px!important;max-width:64px!important}
      .v757-unit-field input{width:64px!important;min-width:64px!important;max-width:64px!important;height:33px!important;min-height:33px!important;padding:4px!important}
      .v757-transfer-line>.v757-remove-line{width:34px!important;height:34px!important;min-width:34px!important}
    }
    @media(max-width:430px){
      .v757-transfer-line{grid-template-columns:108px minmax(0,1fr) 34px!important;gap:4px!important}
      .v757-product-field select,.v757-product-field .custom-select,.v757-product-field .select-trigger{max-width:108px!important}
      .v757-unit-field{flex-basis:60px!important;width:60px!important;min-width:60px!important;max-width:60px!important}
      .v757-unit-field input{width:60px!important;min-width:60px!important;max-width:60px!important}
    }
    .shift-shortage-live{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
    .shift-shortage-live>div{border:1px solid var(--border,#dbe3ec);border-radius:10px;padding:9px 10px;background:var(--surface-soft,#f8fafc);display:flex;flex-direction:column;gap:3px}
    .shift-shortage-live small{color:var(--muted,#64748b);font-size:10px}.shift-shortage-live strong{font-size:16px}
    .shift-shortage-live .shortage strong{color:#dc2626}.shift-shortage-live .surplus strong{color:#059669}
    @media(max-width:560px){.shift-shortage-live{grid-template-columns:1fr 1fr}.shift-shortage-live .net{grid-column:1/-1}}
  `;
  document.head.appendChild(style);


  const c39_758={'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn','K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn','U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'};
  function code39Svg758(input){let code=String(input||'').toUpperCase().replace(/[^0-9A-Z.\- ]/g,'');if(!code)return '';const chars=('*'+code+'*').split('');let x=8,rects=[];for(const ch of chars){const pat=c39_758[ch];if(!pat)continue;for(let i=0;i<9;i++){const w=pat[i]==='w'?5:2;if(i%2===0)rects.push(`<rect x="${x}" y="4" width="${w}" height="60" fill="#000"/>`);x+=w}x+=2}const width=x+8;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 82" width="${width}" height="82">${rects.join('')}<text x="${width/2}" y="78" text-anchor="middle" font-family="Arial" font-size="12" fill="#000">${esc(code)}</text></svg>`}

  /* 2) Printing that never boots the login screen: send a prepared receipt to a dedicated print-only HTML page. */
  let printWindow=null,printLock={id:'',at:0};
  function receiptHtml758(x){
    const st=D().settings||{},company=D().company||{},plain=v=>(Number(v)||0).toFixed(2),qtyTotal=(x.lines||[]).reduce((a,l)=>a+num(l.qty),0);
    const logo=st.showInvoiceLogo!==false?`<div class="receipt-logo receipt-logo-${esc(st.invoiceLogoSize||'small')}"><img src="brand-logo.png" alt=""></div>`:'';
    const employee=st.showInvoiceEmployee!==false?`<td class="r">الموظف : ${esc(x.userName||D().employees?.find(e=>e.id===x.userId)?.name||'—')}</td>`:'';
    const orderType=st.showInvoiceOrderType!==false?`<td class="l">نوع الطلب : ${esc(x.tableId?'محلي':(st.invoiceOrderTypeText||'سفري'))}</td>`:'';
    const customer=st.showInvoiceCustomer!==false?`<td class="r">العميل : ${esc(x.customerName||'عميل نقدي')}</td>`:'';
    const branch=st.showInvoiceBranch!==false?`<td class="l">الفرع : ${esc(A.branchName(x.branchId)||'—')}</td>`:'';
    const meta=[];if(employee||orderType)meta.push(`<tr>${employee||'<td></td>'}${orderType||'<td></td>'}</tr>`);if(customer||branch)meta.push(`<tr>${customer||'<td></td>'}${branch||'<td></td>'}</tr>`);
    const cols=[];if(st.showInvoiceItemNumber!==false)cols.push(['no','ت','10%']);cols.push(['name','اسم المادة','35%']);if(st.showInvoiceQtyColumn!==false)cols.push(['qty','الكمية','15%']);if(st.showInvoicePriceColumn!==false)cols.push(['price','السعر','20%']);if(st.showInvoiceLineTotal!==false)cols.push(['total','اجمالي','20%']);
    const rows=(x.lines||[]).map((l,i)=>`<tr>${cols.map(c=>`<td>${c[0]==='no'?i+1:c[0]==='name'?esc(l.productName):c[0]==='qty'?esc(l.qty):c[0]==='price'?plain(l.unitPrice):plain(l.total)}</td>`).join('')}</tr>`).join('');
    const summary=[];if(st.showInvoiceQuantityTotal!==false)summary.push(`الكمية : ${qtyTotal}`);if(st.showInvoiceSubtotal!==false)summary.push(`اجمالي المبلغ : ${plain(x.subtotal)} ₪`);if(st.showInvoiceTax!==false&&num(x.tax)!==0)summary.push(`الضريبة : ${plain(x.tax)} ₪`);if(st.showInvoiceDiscount!==false)summary.push(`الخصم : ${plain(x.discount)} ₪`);if(st.showInvoicePaid!==false)summary.push(`المدفوع : ${plain(x.paid)} ₪`);if(st.showInvoiceDue!==false)summary.push(`المتبقي : ${plain(x.due)} ₪`);
    const summaryRows=[];for(let i=0;i<summary.length;i+=2)summaryRows.push(`<tr><td class="r">${summary[i]||''}</td><td class="l">${summary[i+1]||''}</td></tr>`);
    const net=st.showInvoiceNetAmount!==false?`<table class="receipt-bordered receipt-net"><tr><td>المبلغ الصافي :</td><td>${plain(x.total)} ₪</td></tr></table>`:'';
    const barcode=st.showInvoiceBarcode===true?`<div class="receipt-barcode receipt-barcode-${esc(st.invoiceBarcodeSize||'medium')}">${code39Svg758(x.number)}</div>`:'';
    const message=st.showInvoiceMessage!==false&&company.invoiceNote?`<div class="receipt-footer-text">${esc(company.invoiceNote)}</div>`:'';
    const dt=new Date(x.createdAt||x.updatedAt||`${x.date||A.today()}T00:00:00`),dateTime=dt.toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    const footer=(st.showInvoiceFooterTime!==false||st.showInvoiceFooterNumber!==false)?`<table class="receipt-footer-info"><tr><td class="l">${st.showInvoiceFooterTime!==false?esc(dateTime):''}</td><td class="r">${st.showInvoiceFooterNumber!==false?esc(x.number):''}</td></tr></table>`:'';
    return `${logo}${meta.length?`<table class="receipt-header-table">${meta.join('')}</table>`:''}<table class="receipt-bordered receipt-items"><thead><tr>${cols.map(c=>`<th style="width:${c[2]}">${c[1]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${summaryRows.length?`<table class="receipt-totals">${summaryRows.join('')}</table>`:''}${net}${barcode}${message}${footer}`;
  }
  function safePrintInvoice758(id){
    id=String(id||'').trim();const sale=D().sales?.find(x=>String(x.id)===id);if(!sale)return A.toast('الفاتورة غير موجودة.','error');
    const at=Date.now();if(printLock.id===id&&at-printLock.at<1800){try{printWindow?.focus?.()}catch(_){}return true}printLock={id,at};
    const token=`${id}-${at.toString(36)}-${Math.random().toString(36).slice(2,8)}`,key=`almezan_print_job_v758_${token}`,size=D().settings?.printSize==='58'?'58':D().settings?.printSize==='a4'?'a4':'80',offsetMm=size==='58'?num(D().settings?.printOffset58??0):size==='80'?num(D().settings?.printOffset80??0):0;
    try{localStorage.setItem(key,JSON.stringify({html:receiptHtml758(sale),size,offsetMm,number:sale.number,createdAt:at}))}catch(e){return A.toast('تعذر تجهيز الفاتورة للطباعة.','error')}
    const url=`./print-invoice.html?v=770&token=${encodeURIComponent(token)}`;
    try{
      if(printWindow&&!printWindow.closed){printWindow.location.replace(url);printWindow.focus();return true}
      printWindow=window.open(url,'almezanInvoicePrint');if(printWindow){printWindow.focus();return true}
    }catch(_){ }
    A.toast('اسمح بالنوافذ المنبثقة للطباعة.','warning');return false;
  }
  A.openInvoicePrintOnce=safePrintInvoice758;
  A.registerAction('print-invoice',b=>{
    if(window.AlMezanBluetoothPrinter?.printInvoiceById)return window.AlMezanBluetoothPrinter.printInvoiceById(b.dataset.id);
    return safePrintInvoice758(b.dataset.id);
  });

  /* 3) Shift closing: calculate shortage/surplus live, post the exact shortage, and persist totals in the shift. */
  function parseShiftMoney758(value){
    let x=String(value??'').trim();if(!x)return NaN;const ar='٠١٢٣٤٥٦٧٨٩';x=x.replace(/[٠-٩]/g,d=>String(ar.indexOf(d))).replace(/٫/g,'.').replace(/[٬،,\s]/g,'');return Number(x)
  }
  function shiftInputValue758(value){const n=Number(value);if(!Number.isFinite(n))return '';return Number.isInteger(n)?String(n):String(Number(n.toFixed(2)))}
  function shiftCards758(accounts){
    return `<div class="shift-balance-grid">${accounts.map(a=>{const balance=Number(num(A.accountBalance(a.id)).toFixed(2));return `<article class="shift-balance-card"><div class="shift-balance-head"><div><b>${esc(a.name)}</b><small>${esc(a.code||'')}</small></div><span>رصيد البرنامج <strong>${A.money(balance)}</strong></span></div><label class="field"><span>الرصيد الفعلي</span><input class="shift-closing-actual-v758" data-account="${esc(a.id)}" data-expected="${balance}" type="text" required value="${esc(shiftInputValue758(balance))}" inputmode="decimal" autocomplete="off" placeholder="مثال: 10"></label></article>`}).join('')}</div>`;
  }
  function liveSummaryHtml(){return `<div class="shift-shortage-live"><div class="shortage"><small>العجز</small><strong id="shiftShortage758">${A.money(0)}</strong></div><div class="surplus"><small>الزيادة</small><strong id="shiftSurplus758">${A.money(0)}</strong></div><div class="net"><small>صافي الفرق</small><strong id="shiftNet758">${A.money(0)}</strong></div></div>`}
  function updateShiftLive758(form){
    let shortage=0,surplus=0;
    for(const inp of A.$$('.shift-closing-actual-v758',form)){const expected=num(inp.dataset.expected),actual=parseShiftMoney758(inp.value);if(!Number.isFinite(actual))continue;const diff=Number((actual-expected).toFixed(2));if(diff<0)shortage+=Math.abs(diff);else if(diff>0)surplus+=diff}
    shortage=Number(shortage.toFixed(2));surplus=Number(surplus.toFixed(2));const net=Number((surplus-shortage).toFixed(2));
    const s=A.$('#shiftShortage758',form),p=A.$('#shiftSurplus758',form),n=A.$('#shiftNet758',form);if(s)s.textContent=A.money(shortage);if(p)p.textContent=A.money(surplus);if(n)n.textContent=A.money(net);
    return {shortage,surplus,net};
  }
  function reconcile758(accounts,form,reference,stageLabel){
    const expected={},actual={},diffs=[];
    for(const inp of A.$$('.shift-closing-actual-v758',form)){
      const id=inp.dataset.account,account=accounts.find(a=>a.id===id);if(!account)continue;if(String(inp.value??'').trim()==='')throw Error(`أدخل رصيد ${account.name}.`);
      const value=parseShiftMoney758(inp.value);if(!Number.isFinite(value))throw Error(`رصيد ${account.name} غير صالح.`);
      const system=Number(num(A.accountBalance(id)).toFixed(2)),entered=Number(value.toFixed(2)),diff=Number((entered-system).toFixed(2));expected[id]=system;actual[id]=entered;
      if(Math.abs(diff)<.01)continue;
      let j;if(diff>0){j=A.postJournal(`${stageLabel} — زيادة ${account.name}`,reference,[{accountId:id,debit:diff,credit:0},{accountId:'ACC-4220',debit:0,credit:diff}],A.today(),true)}else{const amount=Math.abs(diff);j=A.postJournal(`${stageLabel} — عجز ${account.name}`,reference,[{accountId:'ACC-5220',debit:amount,credit:0},{accountId:id,debit:0,credit:amount}],A.today(),true)}
      if(j){j.kind='shift-balance-adjustment';j.shiftStage=stageLabel;j.paymentAccountId=id}diffs.push({accountId:id,expected:system,actual:entered,diff});
    }
    const shortageTotal=Number(diffs.filter(x=>x.diff<0).reduce((a,x)=>a+Math.abs(num(x.diff)),0).toFixed(2)),surplusTotal=Number(diffs.filter(x=>x.diff>0).reduce((a,x)=>a+num(x.diff),0).toFixed(2));
    return {expected,actual,diffs,shortageTotal,surplusTotal,netDifference:Number((surplusTotal-shortageTotal).toFixed(2))};
  }
  function closeShift758(id){
    const d=D(),sh=d.shifts?.find(x=>x.id===id);if(!sh||sh.status!=='open')return;
    const sales=d.sales.filter(s=>s.shiftId===sh.id&&s.status!=='returned'),returns=d.sales.filter(s=>s.shiftId===sh.id&&s.status==='returned'),accounts=A.paymentAccounts();if(!accounts.length)return A.toast('لا توجد حسابات دفع متاحة لإغلاق الوردية.','warning');
    A.openModal({title:`إغلاق الوردية ${sh.number}`,size:'modal-lg',body:`<div class="shift-balance-note closing">${I('cash',18)} <div><b>جرد حسابات الدفع قبل الإغلاق</b><small>الرصيد الفعلي معبأ تلقائياً. أي نقص يُحسب فوراً كعجز ويُرحل إلى حساب فروقات/عجز الصندوق عند الإغلاق.</small></div></div>${shiftCards758(accounts)}${liveSummaryHtml()}<label class="field"><span>ملاحظات التسليم</span><textarea name="notes" placeholder="اختياري"></textarea></label>`,submitText:'إغلاق الوردية واعتماد الجرد',submitIcon:'lock',afterOpen:form=>{const run=()=>updateShiftLive758(form);A.$$('.shift-closing-actual-v758',form).forEach(inp=>inp.addEventListener('input',run));run()},onSubmit:(fd,form)=>A.atomicMutation(()=>{
      const unposted=sales.filter(s=>s.accountingPosted===false);if(unposted.length){const groups=new Map();for(const sale of unposted){const dt=String(sale.date||A.today()).slice(0,10),g=groups.get(dt)||[];g.push(sale);groups.set(dt,g)}for(const [postingDate,group] of groups){const paidTotal=group.reduce((a,s)=>a+num(s.paid),0),ar=group.reduce((a,s)=>a+num(s.due),0),netSales=group.reduce((a,s)=>a+num(s.total)-num(s.tax),0),vat=group.reduce((a,s)=>a+num(s.tax),0),cost=group.reduce((a,s)=>a+num(s.costTotal),0);const saleLines=[...(paidTotal>.009?[{accountId:'ACC-2250',debit:Number(paidTotal.toFixed(2)),credit:0}]:[]),...(ar>.009?[{accountId:'ACC-1200',debit:Number(ar.toFixed(2)),credit:0}]:[]),...(netSales>.009?[{accountId:'ACC-4100',debit:0,credit:Number(netSales.toFixed(2))}]:[]),...(vat>.009?[{accountId:'ACC-2200',debit:0,credit:Number(vat.toFixed(2))}]:[])];const sj=A.postJournal(`ترحيل مجمع وردية ${sh.number}`,sh.number,saleLines,postingDate,true);sj.kind='shift-batch';let cj=null;if(cost>.009){cj=A.postJournal(`تكلفة مبيعات وردية ${sh.number}`,sh.number,[{accountId:'ACC-5100',debit:Number(cost.toFixed(2)),credit:0},{accountId:'ACC-1300',debit:0,credit:Number(cost.toFixed(2))}],postingDate,true);cj.kind='shift-cost-batch'}for(const sale of group){sale.accountingPosted=true;sale.shiftJournalId=sj.id;sale.shiftCostJournalId=cj?.id||''}}}
      const result=reconcile758(accounts,form,sh.number,`تسوية إغلاق وردية ${sh.number}`);
      Object.assign(sh,{status:'closed',closedAt:A.now(),actual:result.actual,expected:result.expected,differences:result.diffs,shortageTotal:result.shortageTotal,surplusTotal:result.surplusTotal,netDifference:result.netDifference,notesClose:fd.get('notes'),salesCount:sales.length,returnsCount:returns.length,grossSales:sales.reduce((a,s)=>a+num(s.total),0),returnsTotal:returns.reduce((a,s)=>a+num(s.total),0)});
      d.shiftBalanceLogs=d.shiftBalanceLogs||[];const balanceLog={id:A.uid('SHBAL'),shiftId:sh.id,shiftNumber:sh.number,userId:sh.userId||A.currentUser()?.id||'',userName:sh.userName||A.currentUser()?.name||'',closedAt:sh.closedAt,shortageTotal:result.shortageTotal,surplusTotal:result.surplusTotal,netDifference:result.netDifference,details:result.diffs.map(x=>({...x,accountName:accounts.find(a=>a.id===x.accountId)?.name||x.accountId})),notes:String(fd.get('notes')||'')};d.shiftBalanceLogs.unshift(balanceLog);sh.balanceLogId=balanceLog.id;
      const shortageDetails=balanceLog.details.filter(x=>num(x.diff)<0).map(x=>`${x.accountName}: متوقع ${x.expected} / فعلي ${x.actual} / عجز ${Math.abs(num(x.diff))}`).join(' | ');if(result.shortageTotal>0)A.audit('عجز وردية','الورديات',`${sh.number} — إجمالي العجز ${result.shortageTotal}${shortageDetails?' — '+shortageDetails:''}`);
      A.audit('إغلاق وردية','الكاشير',`${sh.number} — عجز ${result.shortageTotal} — زيادة ${result.surplusTotal}`);A.saveDB();A.toast(result.shortageTotal>0?`تم إغلاق الوردية وتسجيل عجز ${A.money(result.shortageTotal)}`:(result.surplusTotal>0?`تم إغلاق الوردية وتسجيل زيادة ${A.money(result.surplusTotal)}`:'تم إغلاق الوردية واعتماد الأرصدة'));A.renderCurrent();
    })});
  }
  A.registerAction('close-shift',b=>closeShift758(b.dataset.id));
  A.registerAction('shift-zreport',b=>{
    const d=D(),sh=d.shifts?.find(x=>x.id===b.dataset.id);if(!sh)return;const expected=sh.expected||{},actual=sh.actual||{},shortage=num(sh.shortageTotal)||Number((sh.differences||[]).filter(x=>num(x.diff)<0).reduce((a,x)=>a+Math.abs(num(x.diff)),0).toFixed(2)),surplus=num(sh.surplusTotal)||Number((sh.differences||[]).filter(x=>num(x.diff)>0).reduce((a,x)=>a+num(x.diff),0).toFixed(2));
    A.openModal({title:`Z-Report — ${sh.number}`,size:'modal-lg',hideSubmit:true,body:`<div class="z-report"><div class="z-head"><h3>${esc(d.company.name)}</h3><b>${esc(sh.number)}</b><span>${A.dateFmt(sh.openedAt,true)} — ${A.dateFmt(sh.closedAt,true)}</span></div><div class="stat-strip"><div><small>المبيعات</small><strong>${A.money(sh.grossSales)}</strong></div><div><small>المرتجعات</small><strong>${A.money(sh.returnsTotal)}</strong></div><div><small>العجز</small><strong>${A.money(shortage)}</strong></div><div><small>الزيادة</small><strong>${A.money(surplus)}</strong></div></div><table class="data-table"><thead><tr><th>الحساب</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th></tr></thead><tbody>${A.paymentAccounts().map(a=>`<tr><td>${esc(a.name)}</td><td>${A.money(expected[a.id]||0)}</td><td>${A.money(actual[a.id]||0)}</td><td>${A.money(num(actual[a.id])-num(expected[a.id]))}</td></tr>`).join('')}</tbody></table><div class="actions" style="margin-top:12px"><button class="btn btn-primary" type="button" onclick="window.print()">${I('print')} طباعة التقرير</button></div></div>`});
  });

  D().settings.enterpriseSchemaVersion=758;A.saveDB(true);
})();

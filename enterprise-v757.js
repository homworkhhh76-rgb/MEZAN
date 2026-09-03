/* Al-Meezan Pro v7.57 — returns/account balances, multi-unit+variant transfers, payment-balance guard, PDF header */
(()=>{
'use strict';
const A=window.AlMezan;if(!A)return;
const S=A.state,D=()=>A.db,$=A.$,$$=A.$$,esc=A.esc,num=A.num,I=A.I;
const round=n=>Number(num(n).toFixed(2));
const sync=()=>{try{window.AlMezanSync?.syncNow?.({manual:false,force:true})?.catch?.(()=>{})}catch(_){}};
const activeBranch=()=>A.currentUser()?.branchId||S.activeBranchId||D().branches?.[0]?.id||'';
const isBM=()=>A.getSession?.()?.type==='branch-manager'||A.currentUser()?.isBranchManager===true||A.currentUser()?.role==='مدير فرع';
const branchName=id=>D().branches?.find(b=>b.id===id)?.name||'—';
const whName=id=>D().warehouses?.find(w=>w.id===id)?.name||'—';
const branchOfWarehouse=id=>D().warehouses?.find(w=>w.id===id)?.branchId||'';
const whsForBranch=id=>(D().warehouses||[]).filter(w=>w.branchId===id&&w.active!==false);
const previousReturnSaleAction=S.actions?.['return-sale'];

/* ---------- 1) Never allow an outgoing movement to overdraw a selected cash/bank payment account ---------- */
const rawPostJournal=A.postJournal.bind(A);
function paymentMap(){return new Map((A.paymentAccounts?.()||[]).map(a=>[a.id,a]))}
function availableText(n){return round(n).toLocaleString('ar-EG-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2})}
A.ensurePaymentBalance=function(accountId,amount,label='العملية'){
  const a=paymentMap().get(accountId);if(!a||num(amount)<=0)return true;
  const bal=num(A.accountBalance(accountId));
  if(num(amount)>bal+0.009)throw Error(`${label}: الرصيد غير كافٍ في ${a.name||a.code}. المتاح ${availableText(bal)} والمطلوب ${availableText(amount)}.`);
  return true;
};
function guardedPostJournal(description,reference,lines,date,automatic){
  // Reversal entries must remain possible; the originating outgoing transaction is validated before it is posted.
  if(!/^عكس\s/.test(String(description||'').trim())){
    const pays=paymentMap(),outs=new Map();
    for(const l of lines||[]){if(!pays.has(l.accountId))continue;outs.set(l.accountId,round(num(outs.get(l.accountId))+num(l.credit)-num(l.debit)))}
    for(const [id,out] of outs)if(out>0)A.ensurePaymentBalance(id,out,String(description||'عملية صادرة'));
  }
  return rawPostJournal(description,reference,lines,date,automatic);
}
A.postJournal=guardedPostJournal;

/* ---------- 2) Cashier sales return: correct customer credit + selected refund account + exact unit/variant stock ---------- */
function saleCustomer(sale){return D().customers?.find(c=>c.id===sale?.customerId)}
function isCashCustomer(sale,c){return !!(c?.system||sale?.customerId==='CUS-CASH'||/نقدي/.test(String(c?.name||sale?.customerName||'')))}
function normalizeReturnPayments(sale){
  const paid=Math.max(0,round(sale?.paid));
  if(paid<=0)return [];
  let ps=(sale.payments||[]).filter(p=>p?.accountId&&num(p.amount)>0).map(p=>({accountId:p.accountId,amount:round(p.amount)}));
  if(!ps.length)ps=[{accountId:D().settings.defaultAccountId||A.paymentAccounts()?.[0]?.id||'ACC-1110',amount:paid}];
  let sum=round(ps.reduce((s,p)=>s+p.amount,0));
  if(Math.abs(sum-paid)>0.009){
    // Keep account allocation but make the normalized reversal exactly equal to recorded paid amount.
    let left=paid;ps=ps.map((p,i)=>{const amount=i===ps.length-1?round(left):round(Math.min(left,p.amount));left=round(left-amount);return {...p,amount}}).filter(p=>p.amount>0);
    if(left>0.009){if(ps.length)ps[ps.length-1].amount=round(ps[ps.length-1].amount+left);else ps=[{accountId:D().settings.defaultAccountId||'ACC-1110',amount:paid}]}
  }
  const grouped=new Map();for(const p of ps)grouped.set(p.accountId,round(num(grouped.get(p.accountId))+p.amount));
  return [...grouped].map(([accountId,amount])=>({accountId,amount}));
}
function normalizeReturnLines(sale){
  for(const l of sale.lines||[]){
    const p=D().products?.find(x=>x.id===l.productId),u=A.productUnit?.(p,l.unitId)||p?.units?.[0];
    const factor=num(l.factor)||num(u?.factor)||1;l.factor=factor;
    if(!(num(l.baseQty)>0)&&num(l.qty)>0)l.baseQty=round(num(l.qty)*factor);
    if(!l.unitId&&u)l.unitId=u.id;if(!l.unitName&&u)l.unitName=u.name;
    // productId intentionally stays the exact variant child id if this line was sold as a variant.
  }
}
function paymentOptions(selected=''){
  return (A.paymentAccounts?.()||[]).map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.code||'')} — ${esc(a.name)} — المتاح ${esc(availableText(A.accountBalance(a.id)))}</option>`).join('');
}
function openReturn757(preselect=''){
  const d=D(),sales=(d.sales||[]).filter(x=>x.status!=='returned'&&!A.isSaleLocked?.(x)).slice(0,100);
  if(!sales.length)return A.toast('لا توجد فواتير قابلة للإرجاع.','warning');
  const first=sales.find(s=>s.id===preselect)||sales[0],defaultAcc=d.settings.defaultAccountId||A.paymentAccounts()?.[0]?.id||'';
  A.openModal({title:'مرتجع مبيعات',size:'modal-lg',body:`<div class="form-grid">
    <label class="field full"><span>الفاتورة</span><select name="saleId" id="v757ReturnSale">${sales.map(s=>`<option value="${s.id}" ${s.id===first.id?'selected':''}>${esc(s.number)} — ${esc(s.customerName||'')} — ${A.money(s.total)}</option>`).join('')}</select></label>
    <label class="field" id="v757RefundModeWrap"><span>معالجة المبلغ المدفوع</span><select name="refundMode" id="v757RefundMode"><option value="cash">إرجاع المبلغ من حساب دفع</option><option value="credit">تسجيله رصيداً لصالح العميل</option></select></label>
    <label class="field" id="v757RefundAccountWrap"><span>حساب دفع مبلغ المرتجع</span><select name="refundAccountId">${paymentOptions(defaultAcc)}</select></label>
    <div class="first-login-note full" id="v757ReturnHint"></div>
    <label class="field full"><span>سبب الإرجاع</span><input name="reason" required></label>
  </div>`,submitText:'ترحيل المرتجع',submitIcon:'refresh',afterOpen:form=>{
    const saleSel=$('#v757ReturnSale',form),mode=$('#v757RefundMode',form),mw=$('#v757RefundModeWrap',form),aw=$('#v757RefundAccountWrap',form),hint=$('#v757ReturnHint',form);
    const refresh=()=>{const s=d.sales.find(x=>x.id===saleSel.value),c=saleCustomer(s),cash=isCashCustomer(s,c),paid=Math.max(0,num(s?.paid));
      if(cash){mode.value='cash';mw.hidden=true}else mw.hidden=paid<=0;
      aw.hidden=paid<=0||mode.value!=='cash';
      hint.textContent=paid<=0?'لا يوجد مبلغ مدفوع؛ سيتم فقط عكس الدين وإعادة البضاعة للمخزون.':cash?'العميل نقدي: سيتم إرجاع المبلغ من حساب الدفع المختار ولا يظهر خيار رصيد العميل.':'للعميل المسجل يمكنك إرجاع النقد من حساب دفع أو إبقاء المبلغ كرصيد لصالح العميل حتى لو كان رصيده الحالي صفراً.';
    };
    saleSel.addEventListener('change',refresh);mode.addEventListener('change',refresh);refresh();
  },onSubmit:fd=>{
    if(!A.has('sales_return')&&!A.has('sales'))throw Error('لا تملك صلاحية المرتجعات.');
    const sale=d.sales.find(x=>x.id===fd.get('saleId'));if(!sale||sale.status==='returned')throw Error('الفاتورة غير صالحة للإرجاع.');
    const c=saleCustomer(sale),cashCustomer=isCashCustomer(sale,c),paid=Math.max(0,round(sale.paid)),due=Math.max(0,round(sale.due)),mode=cashCustomer?'cash':String(fd.get('refundMode')||'cash'),refundAccount=String(fd.get('refundAccountId')||'');
    if(mode==='cash'&&paid>0){if(!refundAccount)throw Error('اختر حساب دفع مبلغ المرتجع.');A.ensurePaymentBalance(refundAccount,paid,'مرتجع المبيعات')}
    A.atomicMutation(()=>{
      normalizeReturnLines(sale);const before=c&&!c.system?round(c.balance):0,normalizedPays=normalizeReturnPayments(sale);sale.payments=normalizedPays;
      // Existing reversal is retained because it correctly reverses sales, COGS, representative commission and exact base stock.
      A.reverseSaleEffect(sale,{markReturned:true});
      if(paid>0){
        if(mode==='credit'&&c&&!c.system){
          // Cancel the cash-credit legs created by the generic reversal and move the paid part into customer credit (A/R credit).
          const lines=normalizedPays.map(p=>({accountId:p.accountId,debit:p.amount,credit:0}));lines.push({accountId:'ACC-1200',debit:0,credit:paid});rawPostJournal(`رصيد عميل من مرتجع ${sale.number}`,sale.number,lines,A.today(),true);
          c.balance=round(before-due-paid);
        }else{
          // Redirect the actual refund to the account explicitly selected by the user.
          const same=normalizedPays.length===1&&normalizedPays[0].accountId===refundAccount&&Math.abs(normalizedPays[0].amount-paid)<0.01;
          if(!same){const lines=normalizedPays.map(p=>({accountId:p.accountId,debit:p.amount,credit:0}));lines.push({accountId:refundAccount,debit:0,credit:paid});rawPostJournal(`دفع مرتجع ${sale.number}`,sale.number,lines,A.today(),true)}
          if(c&&!c.system)c.balance=round(before-due);
        }
      }else if(c&&!c.system)c.balance=round(before-due);
      Object.assign(sale,{returnReason:String(fd.get('reason')||''),refundMode:mode,refundAccountId:mode==='cash'?refundAccount:'',returnedAt:A.now(),returnedBy:A.currentUser()?.id||''});
      A.audit('مرتجع مبيعات','الكاشير',`${sale.number} — ${sale.returnReason}`);A.saveDB();sync();A.toast('تم ترحيل المرتجع وإعادة البضاعة حسب الوحدة والمتغير وعكس الحسابات');A.renderCurrent();
    });
  }});
}
A.registerAction('cashier-return',()=>openReturn757());
A.registerAction('return-sale',b=>{const id=b.dataset.id||'',sale=D().sales?.find(x=>x.id===id),contract=sale&&D().installmentContracts?.find(c=>c.saleId===sale.id&&c.status!=='cancelled');if(contract&&previousReturnSaleAction)return previousReturnSaleAction(b);if(sale&&(sale.status==='returned'||A.isSaleLocked?.(sale)))return A.toast(sale.status==='returned'?'الفاتورة مرتجعة بالفعل.':'الفاتورة ضمن وردية مغلقة. استخدم مرتجعاً مستقلاً.','warning');openReturn757(id)});

/* ---------- 3) Multi-unit + variant stock transfer editor ---------- */
function productLabel(p){
  if(!p)return '';
  if(p.isVariant){const parent=D().products?.find(x=>x.id===p.parentId),attrs=Object.values(p.variantAttributes||{}).filter(Boolean).join(' / ');return `${parent?.name||p.name}${attrs?' — '+attrs:''}`}
  return p.name||p.id;
}
function transferProducts(){return (D().products||[]).filter(p=>p.active!==false&&(p.isVariant||(!p.isVariant&&!p.hasVariants))).sort((a,b)=>productLabel(a).localeCompare(productLabel(b),'ar'))}
function productOptions757(selected=''){return transferProducts().map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(productLabel(p))}</option>`).join('')}
function lineUnits(line,p){
  if(Array.isArray(line?.unitQuantities)&&line.unitQuantities.length)return Object.fromEntries(line.unitQuantities.map(u=>[u.unitId,num(u.qty)]));
  const m={};if(line&&num(line.qty)>0){const u=(p?.units||[]).find(x=>x.id===line.unitId)||p?.units?.[0];if(u)m[u.id]=num(line.qty)}return m;
}
function unitInputs757(p,line={}){
  if(!p)return '<span class="muted">اختر صنفاً</span>';
  const values=lineUnits(line,p),units=(p.units||[]).slice().sort((a,b)=>num(b.factor)-num(a.factor));
  return `<div class="v757-unit-grid">${units.map(u=>`<label class="v757-unit-field"><span>${esc(u.name||'وحدة')}</span><input type="number" min="0" step="any" inputmode="decimal" data-unit-id="${esc(u.id)}" data-factor="${num(u.factor)||1}" value="${values[u.id]||''}" placeholder="0"></label>`).join('')}</div>`;
}
function transferLine757(line={}){const p=transferProducts().find(x=>x.id===line.productId)||transferProducts()[0];return `<div class="v757-transfer-line"><label class="field v757-product-field"><span>الصنف / المتغير</span><select class="v757-product-select searchable-select mobile-full-select">${productOptions757(p?.id||'')}</select></label><div class="v757-line-units">${unitInputs757(p,line)}</div><button type="button" class="icon-button v757-remove-line" title="حذف">${I('trash',16)}</button></div>`}
function bindTransferEditor(form,boxId,addId,initial=[{}]){
  const box=$('#'+boxId,form);box.innerHTML=initial.map(transferLine757).join('');A.enhanceSelects(box);A.injectIcons(box);
  const refreshRow=row=>{const p=D().products.find(x=>x.id===$('.v757-product-select',row)?.value);$('.v757-line-units',row).innerHTML=unitInputs757(p,{})};
  box.addEventListener('change',e=>{if(e.target.matches('.v757-product-select'))refreshRow(e.target.closest('.v757-transfer-line'))});
  box.addEventListener('click',e=>{const b=e.target.closest('.v757-remove-line');if(!b)return;if($$('.v757-transfer-line',box).length<=1)return A.toast('يجب أن يبقى صنف واحد على الأقل.','warning');b.closest('.v757-transfer-line').remove()});
  $('#'+addId,form)?.addEventListener('click',()=>{box.insertAdjacentHTML('beforeend',transferLine757({}));const row=box.lastElementChild;A.enhanceSelects(row);A.injectIcons(row)});
}
function collectTransfer757(form,boxId){
  const merged=new Map();
  const box=$('#'+boxId,form);
  for(const row of $$('.v757-transfer-line',box)){
    const pid=$('.v757-product-select',row)?.value,p=D().products.find(x=>x.id===pid);if(!p)continue;
    const unitQuantities=[];let baseQty=0;
    for(const inp of $$('[data-unit-id]',row)){const qty=Math.max(0,num(inp.value));if(qty<=0)continue;const u=(p.units||[]).find(x=>x.id===inp.dataset.unitId),factor=num(u?.factor)||num(inp.dataset.factor)||1,bq=round(qty*factor);baseQty=round(baseQty+bq);unitQuantities.push({unitId:u?.id||inp.dataset.unitId,unitName:u?.name||'وحدة',factor,qty,baseQty:bq})}
    if(baseQty<=0)continue;
    let target=merged.get(pid);if(!target){target={productId:pid,productName:productLabel(p),variantId:p.isVariant?p.id:'',variantAttributes:p.variantAttributes||{},unitQuantities:[],baseQty:0,unitCost:num(p.cost)};merged.set(pid,target)}
    target.baseQty=round(target.baseQty+baseQty);
    for(const uq of unitQuantities){let x=target.unitQuantities.find(z=>z.unitId===uq.unitId);if(!x){x={...uq,qty:0,baseQty:0};target.unitQuantities.push(x)}x.qty=round(x.qty+uq.qty);x.baseQty=round(x.baseQty+uq.baseQty)}
  }
  return [...merged.values()].map(l=>{l.quantityText=l.unitQuantities.map(u=>`${u.qty} ${u.unitName}`).join(' + ');const first=l.unitQuantities[0];l.unitId=first?.unitId||'';l.unitName=l.unitQuantities.length===1?(first?.unitName||''):'متعدد الوحدات';l.factor=first?.factor||1;l.qty=l.unitQuantities.length===1?first.qty:l.baseQty;return l});
}
function warehouseUnitCost757(productId,warehouseId){const d=D(),row=(d.warehouseCosts||[]).find(x=>x.productId===productId&&x.warehouseId===warehouseId),p=d.products.find(x=>x.id===productId);return num(row?.averageCost??p?.cost)}
function updateWarehouseAverageCost757(productId,warehouseId,incomingQty,incomingUnitCost){const d=D(),q=Math.max(0,num(incomingQty));if(q<=0)return;d.warehouseCosts=Array.isArray(d.warehouseCosts)?d.warehouseCosts:[];const oldQty=Math.max(0,num(A.stockQty(productId,warehouseId))),oldCost=warehouseUnitCost757(productId,warehouseId),newCost=round((oldQty*oldCost+q*num(incomingUnitCost))/(oldQty+q));let row=d.warehouseCosts.find(x=>x.productId===productId&&x.warehouseId===warehouseId);if(!row){row={id:`WC-${productId}-${warehouseId}`,productId,warehouseId,createdAt:A.now()};d.warehouseCosts.push(row)}row.averageCost=newCost;row.updatedAt=A.now()}
function normalizeTransferLine757(l){const p=D().products.find(x=>x.id===l.productId);if(!p)return l;if(Array.isArray(l.unitQuantities)&&l.unitQuantities.length){l.baseQty=round(l.unitQuantities.reduce((s,u)=>s+num(u.baseQty||num(u.qty)*(num(u.factor)||1)),0));l.quantityText=l.unitQuantities.map(u=>`${num(u.qty)} ${u.unitName||''}`).join(' + ');return l}const u=(p.units||[]).find(x=>x.id===l.unitId)||p.units?.[0],factor=num(l.factor)||num(u?.factor)||1,qty=num(l.qty)||num(l.baseQty)/factor;l.unitQuantities=[{unitId:u?.id||'',unitName:u?.name||'',factor,qty:round(qty),baseQty:round(qty*factor)}];l.baseQty=round(qty*factor);l.quantityText=`${round(qty)} ${u?.name||''}`;return l}
function branchChooser(name,id,selected,bmFixed=false){const branches=(D().branches||[]).filter(b=>b.active!==false);return bmFixed?`<input value="${esc(branchName(selected))}" readonly><input type="hidden" name="${name}" value="${esc(selected)}">`:`<select name="${name}" id="${id}">${A.options(branches,'id','name',selected)}</select>`}

function openInternalTransfer757(){
 const d=D(),bid=isBM()?activeBranch():(S.activeBranchId||d.branches?.[0]?.id||'');
 A.openModal({title:'نقل مخزني داخل الفرع — متعدد الوحدات والمتغيرات',size:'modal-xl',body:`<div class="form-grid cols-4"><label class="field"><span>الفرع</span>${branchChooser('branchId','v757InternalBranch',bid,isBM())}</label><label class="field"><span>من مستودع</span><select name="fromId" id="v757InternalFrom"></select></label><label class="field"><span>إلى مستودع</span><select name="toId" id="v757InternalTo"></select></label><label class="field"><span>التاريخ</span><input name="date" type="date" value="${A.today()}" required></label><label class="field full"><span>ملاحظات</span><input name="notes"></label></div><section class="form-section"><div class="form-section-title"><h4>الأصناف والوحدات</h4><button type="button" class="btn btn-secondary btn-sm" id="v757AddInternal">${I('plus',16)} إضافة صنف</button></div><div id="v757InternalLines"></div></section><div class="first-login-note">يمكن نقل أكثر من صنف ومتغير، وإدخال كمية كل وحدة للصنف في نفس السند.</div>`,submitText:'تنفيذ النقل',onSubmit:(fd,form)=>A.atomicMutation(()=>{
   const branchId=String(fd.get('branchId')||bid),from=String(fd.get('fromId')||''),to=String(fd.get('toId')||''),wf=d.warehouses.find(w=>w.id===from),wt=d.warehouses.find(w=>w.id===to),lines=collectTransfer757(form,'v757InternalLines');
   if(!wf||!wt||wf.branchId!==branchId||wt.branchId!==branchId)throw Error('اختر مستودعين تابعين لنفس الفرع.');if(from===to)throw Error('مستودع المصدر والوجهة يجب أن يكونا مختلفين.');if(!lines.length)throw Error('أدخل كمية وحدة واحدة على الأقل.');
   for(const l of lines)if(A.stockQty(l.productId,from)+1e-8<num(l.baseQty)&&!d.settings.allowNegative)throw Error(`الرصيد غير كافٍ للصنف: ${l.productName}`);
   let total=0;for(const l of lines){l.unitCost=warehouseUnitCost757(l.productId,from);l.outValue=round(l.baseQty*l.unitCost);total=round(total+l.outValue);A.adjustStock(l.productId,from,-l.baseQty);A.adjustStock(l.productId,to,l.baseQty)}
   const x={id:A.uid('TRF'),number:A.nextNo('transfer','TRF-'),date:String(fd.get('date')||A.today()),scope:'internal',fromBranchId:branchId,toBranchId:branchId,fromId:from,toId:to,lines,status:'received',locked:true,totalValue:total,notes:String(fd.get('notes')||''),createdAt:A.now(),receivedAt:A.now(),userId:A.currentUser()?.id||''};d.transfers.unshift(x);A.audit('نقل داخلي متعدد الوحدات','المخزون',`${x.number}: ${whName(from)} → ${whName(to)}`);A.saveDB();sync();A.toast('تم نقل الأصناف والوحدات داخل الفرع');A.renderCurrent();
 }),afterOpen:form=>{
   const br=$('#v757InternalBranch',form),from=$('#v757InternalFrom',form),to=$('#v757InternalTo',form);const fill=()=>{const wh=whsForBranch(br?.value||bid);from.innerHTML=A.options(wh,'id','name',wh[0]?.id||'');to.innerHTML=A.options(wh,'id','name',wh[1]?.id||wh[0]?.id||'');A.enhanceSelects(form)};br?.addEventListener('change',fill);fill();bindTransferEditor(form,'v757InternalLines','v757AddInternal',[{}]);
 }});
}
A.registerAction('internal-transfer-v752',openInternalTransfer757);A.registerAction('internal-transfer-v753',openInternalTransfer757);

function openTransferRequest757(){
 const d=D(),toBid=isBM()?activeBranch():(S.activeBranchId||d.branches?.[0]?.id||''),other=d.branches?.find(b=>b.active!==false&&b.id!==toBid)?.id||'';
 A.openModal({title:'طلب تحويل بين الفروع — متعدد الوحدات والمتغيرات',size:'modal-xl',body:`<div class="form-grid"><label class="field"><span>التاريخ</span><input name="date" type="date" value="${A.today()}" required></label><label class="field"><span>الفرع المستلم</span>${branchChooser('toBranchId','v757ReqTo',toBid,isBM())}</label><label class="field"><span>الفرع المطلوب منه الإرسال</span><select name="fromBranchId">${A.options((d.branches||[]).filter(b=>b.active!==false&&b.id!==toBid),'id','name',other)}</select></label><label class="field full"><span>ملاحظات</span><input name="notes"></label></div><section class="form-section"><div class="form-section-title"><h4>الأصناف والوحدات المطلوبة</h4><button type="button" class="btn btn-secondary btn-sm" id="v757AddReq">${I('plus',16)} إضافة صنف</button></div><div id="v757ReqLines"></div></section>`,onSubmit:(fd,form)=>{const lines=collectTransfer757(form,'v757ReqLines'),from=String(fd.get('fromBranchId')||''),to=String(fd.get('toBranchId')||'');if(!lines.length)throw Error('أدخل كمية وحدة واحدة على الأقل.');if(from===to)throw Error('الفرع المرسل والمستلم يجب أن يكونا مختلفين.');const x={id:A.uid('TRQ'),number:A.nextNo('transferRequest','REQ-'),date:String(fd.get('date')||A.today()),fromBranchId:from,toBranchId:to,lines,status:'requested',notes:String(fd.get('notes')||''),requestedBy:A.currentUser()?.id||'',createdAt:A.now()};d.transferRequests.unshift(x);A.audit('طلب تحويل','الفروع',`${x.number} ${branchName(from)} → ${branchName(to)}`);A.saveDB();sync();A.toast('تم إرسال طلب التحويل');A.renderCurrent()},afterOpen:form=>bindTransferEditor(form,'v757ReqLines','v757AddReq',[{}])});
}
A.registerAction('transfer-request-v750',openTransferRequest757);

function openTransferOut757(req=null){
 const d=D(),fromBid=isBM()?activeBranch():(req?.fromBranchId||S.activeBranchId||d.branches?.[0]?.id||''),toBid=req?.toBranchId||d.branches?.find(b=>b.active!==false&&b.id!==fromBid)?.id||'',initial=(req?.lines?.length?req.lines.map(l=>normalizeTransferLine757({...l})):[{}]);
 A.openModal({title:'سند تحويل خارجي — متعدد الوحدات والمتغيرات',size:'modal-xl',body:`<div class="form-grid"><label class="field"><span>التاريخ</span><input name="date" type="date" value="${A.today()}" required></label><label class="field"><span>الفرع المرسل</span>${branchChooser('fromBranchId','v757OutFromBranch',fromBid,isBM())}</label><label class="field"><span>مستودع الإرسال</span><select name="fromWarehouseId" id="v757OutWh">${A.options(whsForBranch(fromBid))}</select></label><label class="field"><span>الفرع المستلم</span><select name="toBranchId">${A.options((d.branches||[]).filter(b=>b.active!==false&&b.id!==fromBid),'id','name',toBid)}</select></label><label class="field full"><span>مرجع / ملاحظات</span><input name="notes" value="${esc(req?.notes||'')}"></label></div><section class="form-section"><div class="form-section-title"><h4>الأصناف والوحدات المشحونة</h4>${req?'':`<button type="button" class="btn btn-secondary btn-sm" id="v757AddOut">${I('plus',16)} إضافة صنف</button>`}</div><div id="v757OutLines"></div></section>`,onSubmit:(fd,form)=>A.atomicMutation(()=>{
   const lines=collectTransfer757(form,'v757OutLines'),fromW=String(fd.get('fromWarehouseId')||''),fromB=String(fd.get('fromBranchId')||''),toB=String(fd.get('toBranchId')||'');if(!lines.length)throw Error('أدخل كمية وحدة واحدة على الأقل.');if(branchOfWarehouse(fromW)!==fromB)throw Error('المستودع لا يتبع الفرع المرسل.');if(fromB===toB)throw Error('اختر فرعين مختلفين.');
   for(const l of lines)if(A.stockQty(l.productId,fromW)+1e-8<l.baseQty)throw Error(`الرصيد غير كافٍ للصنف: ${l.productName}`);
   let total=0;for(const l of lines){l.unitCost=warehouseUnitCost757(l.productId,fromW);l.outValue=round(l.baseQty*l.unitCost);total=round(total+l.outValue);A.adjustStock(l.productId,fromW,-l.baseQty)}
   const x={id:A.uid('TRF'),number:A.nextNo('transfer','TRF-'),requestId:req?.id||'',date:String(fd.get('date')||A.today()),fromBranchId:fromB,toBranchId:toB,fromId:fromW,toId:'',lines,status:'in_transit',lockedOut:true,totalValue:total,notes:String(fd.get('notes')||''),userId:A.currentUser()?.id||'',createdAt:A.now()};d.transfers.unshift(x);if(total>0)A.postJournal(`تحويل مخزني خارجي ${x.number}`,x.number,[{accountId:'ACC-1350',debit:total,credit:0,branchId:fromB},{accountId:'ACC-1300',debit:0,credit:total,branchId:fromB}],x.date,true);if(req){req.status='in_transit';req.transferId=x.id;req.updatedAt=A.now()}A.audit('سند تحويل خارجي','النقل بين الفروع',`${x.number} ${branchName(fromB)} → ${branchName(toB)}`);A.saveDB();sync();A.toast('تم تحويل الكميات إلى بضاعة في الطريق');A.renderCurrent();
 }),afterOpen:form=>{const br=$('#v757OutFromBranch',form),wh=$('#v757OutWh',form);br?.addEventListener('change',()=>{wh.innerHTML=A.options(whsForBranch(br.value));A.enhanceSelects(form)});bindTransferEditor(form,'v757OutLines','v757AddOut',initial);if(req)$('#v757AddOut',form)?.remove()}});
}
A.registerAction('transfer-out-v750',()=>openTransferOut757());A.registerAction('transfer-out-from-request-v750',b=>openTransferOut757(D().transferRequests?.find(x=>x.id===b.dataset.id)||null));

function receivedEditor757(x){return (x.lines||[]).map((l,i)=>{normalizeTransferLine757(l);const p=D().products.find(p=>p.id===l.productId),vals=l.unitQuantities||[];return `<div class="v757-receive-line" data-index="${i}"><div><b>${esc(l.productName||productLabel(p))}</b><small class="muted">المشحون: ${esc(l.quantityText||l.baseQty)}</small></div><div class="v757-unit-grid">${(p?.units||[]).slice().sort((a,b)=>num(b.factor)-num(a.factor)).map(u=>{const shipped=vals.find(z=>z.unitId===u.id)?.qty||0;return `<label class="v757-unit-field"><span>${esc(u.name)} <small>(شحن ${shipped})</small></span><input type="number" min="0" step="any" data-recv-unit="${esc(u.id)}" data-factor="${num(u.factor)||1}" value="${shipped||''}" placeholder="0"></label>`}).join('')}</div></div>`}).join('')}
function openTransferIn757(id){
 const d=D(),x=d.transfers?.find(t=>t.id===id);if(!x||x.status!=='in_transit')return;if(isBM()&&x.toBranchId!==activeBranch())return A.toast('هذا السند ليس لفرعك.','error');
 A.openModal({title:`استلام داخلي — ${x.number}`,size:'modal-xl',body:`<div class="form-grid cols-4"><label class="field"><span>مستودع الاستلام</span><select name="toWarehouseId">${A.options(whsForBranch(x.toBranchId))}</select></label><label class="field"><span>مصاريف الشحن</span><input name="landingCost" type="number" min="0" step="0.01" value="0"></label><label class="field"><span>حساب دفع الشحن</span><select name="landingAccountId">${paymentOptions('')}</select></label><label class="field"><span>ملاحظات الفحص</span><input name="receiveNotes"></label></div><section class="form-section"><h4>الاستلام الفعلي حسب الوحدات</h4><div class="v757-receive-list">${receivedEditor757(x)}</div></section><div class="first-login-note">أدخل الكمية المستلمة لكل وحدة. يتم تحويلها للوحدة الأساسية تلقائياً، ويُسجل أي عجز على حساب خسائر وتوالف النقل.</div>`,submitText:'تأكيد الاستلام وإقفال السند',onSubmit:(fd,form)=>A.atomicMutation(()=>{
   const toWh=String(fd.get('toWarehouseId')||'');if(branchOfWarehouse(toWh)!==x.toBranchId)throw Error('مستودع الاستلام لا يتبع الفرع المستلم.');const landing=Math.max(0,round(fd.get('landingCost'))),landAcc=String(fd.get('landingAccountId')||'');if(landing>0){if(!landAcc)throw Error('اختر حساب دفع الشحن.');A.ensurePaymentBalance(landAcc,landing,'مصاريف شحن النقل المخزني')}
   const received=[];let receivedValue=0,shortValue=0;
   for(const row of $$('.v757-receive-line',form)){const i=Number(row.dataset.index),l=x.lines[i],p=d.products.find(p=>p.id===l.productId);normalizeTransferLine757(l);let actual=0;const actualUnits=[];for(const inp of $$('[data-recv-unit]',row)){const qty=Math.max(0,num(inp.value)),u=(p?.units||[]).find(u=>u.id===inp.dataset.recvUnit),factor=num(u?.factor)||num(inp.dataset.factor)||1;if(qty>0){const bq=round(qty*factor);actual=round(actual+bq);actualUnits.push({unitId:u?.id||'',unitName:u?.name||'',factor,qty,baseQty:bq})}}if(actual>num(l.baseQty)+1e-8)throw Error(`الكمية المستلمة للصنف ${l.productName} أكبر من المشحون.`);const rv=round(actual*num(l.unitCost)),sv=round((num(l.baseQty)-actual)*num(l.unitCost));received.push({l,p,actual,actualUnits,rv,sv});receivedValue=round(receivedValue+rv);shortValue=round(shortValue+sv)}
   const basis=received.reduce((n,z)=>n+z.rv,0)||received.reduce((n,z)=>n+z.actual,0)||1;for(const z of received){const share=round(landing*(z.rv||z.actual)/basis),incoming=z.actual>0?num(z.l.unitCost)+share/z.actual:num(z.l.unitCost);if(z.actual>0){updateWarehouseAverageCost757(z.l.productId,toWh,z.actual,incoming);A.updateWeightedAverageCost?.(z.l.productId,z.actual,incoming,1);A.adjustStock(z.l.productId,toWh,z.actual)}Object.assign(z.l,{receivedBaseQty:round(z.actual),receivedUnitQuantities:z.actualUnits,shortageBaseQty:round(num(z.l.baseQty)-z.actual),landingCost:share})}
   const lines=[];if(receivedValue+landing>0)lines.push({accountId:'ACC-1300',debit:round(receivedValue+landing),credit:0,branchId:x.toBranchId});if(shortValue>0)lines.push({accountId:'ACC-5240',debit:shortValue,credit:0,costCenterId:d.settings.defaultCostCenterId||'',branchId:x.toBranchId});if(num(x.totalValue)>0)lines.push({accountId:'ACC-1350',debit:0,credit:num(x.totalValue),branchId:x.toBranchId});if(landing>0)lines.push({accountId:landAcc,debit:0,credit:landing,branchId:x.toBranchId});if(lines.length)A.postJournal(`استلام تحويل مخزني ${x.number}`,x.number,lines,A.today(),true);
   Object.assign(x,{toId:toWh,status:'received',locked:true,receivedAt:A.now(),receivedBy:A.currentUser()?.id||'',landingCost:landing,shortageValue:shortValue,receiveNotes:String(fd.get('receiveNotes')||'')});const req=d.transferRequests?.find(r=>r.id===x.requestId);if(req){req.status='received';req.updatedAt=A.now()}A.audit('استلام تحويل','النقل بين الفروع',`${x.number} — عجز ${shortValue}`);A.saveDB();sync();A.toast('تم الاستلام وإقفال السند وتحديث المخزون والتكلفة');A.renderCurrent();
 })});
}
A.registerAction('transfer-in-v750',b=>openTransferIn757(b.dataset.id));

/* Transfer exports/prints now show the multi-unit breakdown and variant name accurately. */
function transferDoc(kind,id){return kind==='request'?D().transferRequests?.find(x=>x.id===id):D().transfers?.find(x=>x.id===id)}
function transferTitle(kind,x){return kind==='request'?'طلب تحويل مخزني':x.scope==='internal'?'سند نقل مخزني داخلي':'سند نقل مخزني بين الفروع'}
function transferFrom(kind,x){return kind==='request'?branchName(x.fromBranchId):x.scope==='internal'?`${branchName(x.fromBranchId)} / ${whName(x.fromId)}`:`${branchName(x.fromBranchId)} / ${whName(x.fromId)}`}
function transferTo(kind,x){return kind==='request'?branchName(x.toBranchId):x.scope==='internal'?`${branchName(x.toBranchId)} / ${whName(x.toId)}`:branchName(x.toBranchId)}
function transferRows757(x){return (x.lines||[]).map((l,i)=>{normalizeTransferLine757(l);return [i+1,l.productName||productLabel(D().products.find(p=>p.id===l.productId)),l.quantityText||l.baseQty,round(l.unitCost||0),round(l.outValue||num(l.baseQty)*num(l.unitCost||0))]})}
A.registerAction('transfer-excel-v753',b=>{const x=transferDoc(b.dataset.kind,b.dataset.id);if(x)A.exportExcel(`${transferTitle(b.dataset.kind,x)}-${x.number}`,['#','الصنف / المتغير','الكميات حسب الوحدة','تكلفة الوحدة الأساسية','الإجمالي'],transferRows757(x))});
function printTransfer757(kind,id,forceA4=false){
 const x=transferDoc(kind,id);if(!x)return;const d=D(),st=d.settings||{},size=forceA4?'a4':(st.printSize||'80'),thermal=size!=='a4',paper=size==='58'?'54mm':size==='80'?'76mm':'auto',title=transferTitle(kind,x),rows=transferRows757(x),logo=st.showInvoiceLogo!==false?new URL('brand-logo.png',location.href).href:'';
 const w=window.open('','almezan-transfer-print','width=850,height=900');if(!w)return A.toast('اسمح بالنوافذ المنبثقة للطباعة.','warning');const css=thermal?`@page{size:${size==='58'?'58mm':'80mm'} auto;margin:0}body{width:${paper};margin:0 auto;padding:4mm 2mm;font-size:11px}`:`@page{size:A4 portrait;margin:12mm}body{max-width:190mm;margin:0 auto;padding:0;font-size:12px}`;
 w.document.open();w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>*{box-sizing:border-box}body{font-family:"Cairo",Tahoma,Arial,sans-serif;color:#000}${css}.head{text-align:center;border-bottom:2px solid #000;padding-bottom:7px}.head img{width:${thermal?'36mm':'28mm'};max-height:22mm;object-fit:contain}.head h1{margin:2px;font-size:${thermal?'16px':'22px'}}.meta,.items{width:100%;border-collapse:collapse;margin-top:7px}.meta td{padding:2px}.items th,.items td{border:1px solid #000;padding:${thermal?'3px 2px':'6px'};text-align:center;word-break:break-word}.items th{font-weight:700}.notes{margin-top:7px;border-top:1px dashed #000;padding-top:5px}.foot{text-align:center;margin-top:8px;font-size:9px}</style></head><body><header class="head">${logo?`<img src="${logo}">`:''}<h1>${esc(d.company.name||'الميزان برو')}</h1><div>${esc(d.company.phone||'')} ${d.company.address?' — '+esc(d.company.address):''}</div></header><h2 style="text-align:center">${esc(title)}</h2><table class="meta"><tr><td><b>الرقم:</b> ${esc(x.number)}</td><td><b>التاريخ:</b> ${esc(x.date||'')}</td></tr><tr><td><b>من:</b> ${esc(transferFrom(kind,x))}</td><td><b>إلى:</b> ${esc(transferTo(kind,x))}</td></tr></table><table class="items"><thead><tr><th>#</th><th>الصنف / المتغير</th><th>الكميات حسب الوحدة</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${x.notes?`<div class="notes"><b>ملاحظات:</b> ${esc(x.notes)}</div>`:''}${x.receiveNotes?`<div class="notes"><b>ملاحظات الفحص:</b> ${esc(x.receiveNotes)}</div>`:''}<div class="foot">${esc(d.company.name||'الميزان برو')} — ${new Date().toLocaleString('ar-EG-u-nu-latn')}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
}
A.registerAction('transfer-pdf-v753',b=>printTransfer757(b.dataset.kind,b.dataset.id,true));A.registerAction('transfer-print-v753',b=>printTransfer757(b.dataset.kind,b.dataset.id,false));

/* ---------- 4) Restore rich PDF report header + summary cards in one horizontal grid ---------- */
function summaryValue(label,value){if(typeof value!=='number')return esc(value);if(/كمية|عدد|أيام|ساعات|نسبة|%/i.test(label))return esc(Number(value.toFixed(3)).toLocaleString('ar-EG-u-nu-latn'));return A.money(value)}
function summaryCards(summary){const items=[['عدد السجلات',summary?.count||0],...(summary?.totals||[])];return `<section class="pdf-summary-grid">${items.map(([k,v])=>`<div class="pdf-summary-card"><small>${esc(k)}</small><strong>${summaryValue(String(k),v)}</strong></div>`).join('')}</section>`}
A.exportTablePDF=async function(btn,opts={}){
 try{
  const r=A.tableExportData(btn);if(opts.title)r.title=opts.title;const d=D(),logo=new URL('brand-logo.png',location.href).href,w=window.open('','_blank');if(!w)throw Error('اسمح بفتح النوافذ لتجهيز PDF.');
  const rows=r.rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  w.document.open();w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(r.title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font-family:"Cairo",Tahoma,Arial,sans-serif;color:#172033;margin:0;font-size:9px}.pdf-head{display:grid;grid-template-columns:74px 1fr auto;gap:12px;align-items:center;border-bottom:2px solid #1f4b7a;padding-bottom:8px;margin-bottom:9px}.pdf-head img{width:68px;height:58px;object-fit:contain}.pdf-brand h1{margin:0 0 2px;font-size:17px}.pdf-brand p{margin:1px 0;color:#64748b;font-size:8.5px}.pdf-title{text-align:left}.pdf-title h2{font-size:14px;margin:0 0 2px}.pdf-title span{color:#64748b;font-size:8px}.pdf-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0 0 10px}.pdf-summary-card{border:1px solid #cbd5e1;border-radius:7px;padding:6px 8px;background:#f8fafc;min-height:45px;display:flex;flex-direction:column;justify-content:center}.pdf-summary-card small{color:#64748b;font-size:8px}.pdf-summary-card strong{font-size:12px;margin-top:2px;white-space:nowrap}table{border-collapse:collapse;width:100%;table-layout:auto}th,td{border:1px solid #cbd5e1;padding:4px;text-align:right;vertical-align:top;word-break:break-word}th{background:#eef3f8;font-weight:700}tbody tr:nth-child(even){background:#f8fafc}.pdf-foot{margin-top:7px;text-align:center;color:#64748b;font-size:7.5px}@media(max-width:700px){.pdf-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style></head><body><header class="pdf-head"><img src="${logo}" alt=""><div class="pdf-brand"><h1>${esc(d.company.name||'الميزان برو')}</h1>${d.company.legalName?`<p>${esc(d.company.legalName)}</p>`:''}<p>${esc(d.company.phone||'')}${d.company.address?' — '+esc(d.company.address):''}</p></div><div class="pdf-title"><h2>${esc(r.title)}</h2><span>${new Date().toLocaleString('ar-EG-u-nu-latn')}</span></div></header>${summaryCards(r.summary)}<table><thead><tr>${r.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><div class="pdf-foot">${esc(d.company.name||'الميزان برو')} — نظام الميزان برو</div><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);w.document.close();
 }catch(e){A.toast(e.message||'تعذر تجهيز PDF','error')}
};
A.registerAction('export-table-pdf',b=>A.exportTablePDF(b));
A.registerAction('report-pdf',()=>{const tableBtn=$('#workspace .data-table-block .table-export-pdf');if(!tableBtn)return A.toast('لا توجد بيانات للتقرير.','warning');const title=$('#workspace .panel-head h3')?.textContent?.trim()||'التقرير المالي';A.exportTablePDF(tableBtn,{title})});

/* Small responsive styles for the multi-unit transfer editor. */
const style=document.createElement('style');style.textContent=`
.v757-transfer-line{display:grid;grid-template-columns:minmax(210px,1.2fr) minmax(320px,2fr) 42px;gap:10px;align-items:end;padding:10px 0;border-bottom:1px solid var(--border,#dbe3ec);min-width:0}.v757-transfer-line>*{min-width:0}.v757-product-field,.v757-product-field .custom-select,.v757-line-units{width:100%;min-width:0}
.v757-unit-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px;min-width:0}.v757-unit-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted,#64748b);min-width:0}.v757-unit-field input{width:100%;min-width:0;min-height:40px;border:1px solid var(--border,#cbd5e1);border-radius:9px;padding:7px 9px;background:var(--surface,#fff);color:inherit}.v757-receive-line{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(320px,2fr);gap:12px;align-items:center;padding:10px;border-bottom:1px solid var(--border,#dbe3ec);min-width:0}.v757-receive-line>*{min-width:0}.v757-receive-line small{display:block;margin-top:3px}@media(max-width:760px){.v757-transfer-line,.v757-receive-line{grid-template-columns:minmax(0,1fr)!important;gap:8px}.v757-transfer-line>.icon-button{justify-self:start}.v757-unit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v757-product-field .custom-select-trigger{width:100%}}@media(max-width:380px){.v757-unit-grid{grid-template-columns:minmax(0,1fr)}}
`;document.head.appendChild(style);

D().settings.enterpriseSchemaVersion=757;A.saveDB(true);
})();

(function(){
  'use strict';
  const A=window.AlMezan,S=A.state,$=A.$,num=A.num,esc=A.esc,I=A.I,D=()=>A.db;

  function ensureDB(){
    const d=D();
    d.productBatches=d.productBatches||[];
    d.wastageDocs=d.wastageDocs||[];
    d.recipes=d.recipes||[];
    d.productionOrders=d.productionOrders||[];
    d.restaurantTables=d.restaurantTables||[];
    d.sequences=d.sequences||{};
    if(!d.sequences.batch)d.sequences.batch=0;
    if(!d.sequences.wastage)d.sequences.wastage=0;
    if(!d.sequences.production)d.sequences.production=0;
    if(!d.sequences.table)d.sequences.table=0;
    if(!d.accounts.find(a=>a.id==='ACC-5230'))d.accounts.push({id:'ACC-5230',code:'5230',name:'خسائر وتسويات المخزون',type:'expense',parentId:'ACC-5000',level:1,balance:0});
    if(!d.accounts.find(a=>a.id==='ACC-4230'))d.accounts.push({id:'ACC-4230',code:'4230',name:'أرباح تسوية المخزون',type:'revenue',parentId:'ACC-4000',level:1,balance:0});
    if(!d.accounts.find(a=>a.id==='ACC-3200'))d.accounts.push({id:'ACC-3200',code:'3200',name:'الأرصدة الافتتاحية',type:'equity',parentId:'ACC-3000',level:1,balance:0});
    if(!d.accounts.find(a=>a.id==='ACC-1400'))d.accounts.push({id:'ACC-1400',code:'1400',name:'ضريبة القيمة المضافة المدخلة',type:'asset',parentId:'ACC-1000',level:1,balance:0});
    if(!d.restaurantTables.length)d.restaurantTables.push({id:A.uid('TBL'),name:'طاولة 1',status:'available',capacity:4,notes:'',active:true});
  }
  ensureDB();

  function insertNav(groupTitle,item){
    const g=A.NAV.find(x=>x.title===groupTitle);
    if(g&&!g.items.some(i=>i[0]===item[0]))g.items.push(item);
  }
  insertNav('المخزون',['batches','barcode','التشغيلات والصلاحية','inventory']);
  insertNav('المخزون',['wastage','trash','التالف والهالك','inventory']);
  insertNav('المخزون',['recipes','products','الوصفات والتصنيع','inventory']);
  insertNav('المخزون',['production','warehouse','أوامر التصنيع','inventory']);
  insertNav('المبيعات والمشتريات',['restaurant-tables','branch','طاولات المطعم','cashier']);
  insertNav('المحاسبة',['stock-insights','reports','تحليل المخزون','reports']);
  A.PAGE_META.batches=['التشغيلات والصلاحية','تتبع صلاحية المخزون وفق FEFO'];
  A.PAGE_META.wastage=['التالف والهالك','سندات إتلاف وربطها المحاسبي'];
  A.PAGE_META.recipes=['الوصفات والتصنيع','شجرة المواد للمطاعم والتصنيع'];
  A.PAGE_META.production=['أوامر التصنيع','إنتاج صنف نهائي من المواد الأولية'];
  A.PAGE_META['restaurant-tables']=['طاولات المطعم','إدارة الطاولات وحالاتها'];
  A.PAGE_META['stock-insights']=['تحليل المخزون','انتهاء الصلاحية والحركة والأصناف الراكدة'];

  function table(headers,rows,empty){return A.table(headers,(rows||[]).map(r=>Array.isArray(r)?`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`:r),empty)}
  function findProduct(id){return D().products.find(p=>p.id===id)}
  function whName(id){return D().warehouses.find(w=>w.id===id)?.name||'—'}
  function today(){return A.today()}
  function expiryStatus(date){
    if(!date)return {label:'بدون تاريخ',tone:'primary'};
    if(date<today())return {label:'منتهي',tone:'red'};
    const days=Math.ceil((new Date(date)-new Date(today()))/86400000);
    if(days<=30)return {label:`قرب الانتهاء (${days} يوم)`,tone:'amber'};
    return {label:'ساري',tone:'green'};
  }
  function lotSort(a,b){
    const ax=a.expiryDate||'9999-12-31',bx=b.expiryDate||'9999-12-31';
    if(ax!==bx)return ax.localeCompare(bx);
    return (a.createdAt||'').localeCompare(b.createdAt||'');
  }
  function recipeRows(productId){return D().recipes.filter(r=>r.productId===productId&&r.active!==false)}
  function productRecipe(productId){return recipeRows(productId)}

  function sellableQty(productId,warehouseId){
    const p=findProduct(productId); if(!p)return 0;
    const lots=(D().productBatches||[]).filter(b=>b.productId===productId&&b.warehouseId===warehouseId&&num(b.qtyBase)>0);
    if(!p.trackExpiry||!lots.length)return A.stockQty(productId,warehouseId);
    return lots.filter(b=>!b.expiryDate||b.expiryDate>=today()).reduce((a,b)=>a+num(b.qtyBase),0);
  }

  function consumeLots(productId,warehouseId,qtyBase,{allowExpired=false}={}){
    const p=findProduct(productId); if(!p)return {ok:false,error:'الصنف غير موجود.'};
    qtyBase=num(qtyBase); if(qtyBase<=0)return {ok:true,items:[],costTotal:0};
    const lots=(D().productBatches||[])
      .filter(b=>b.productId===productId&&b.warehouseId===warehouseId&&num(b.qtyBase)>0)
      .filter(b=>allowExpired||!b.expiryDate||b.expiryDate>=today())
      .sort(lotSort);
    const items=[]; let remaining=qtyBase;
    if(p.trackExpiry&&lots.length){
      for(const lot of lots){
        if(remaining<=0)break;
        const take=Math.min(remaining,num(lot.qtyBase));
        if(take<=0)continue;
        lot.qtyBase=Number((num(lot.qtyBase)-take).toFixed(6));
        const unitCost=num(lot.cost||p.cost||0);
        items.push({productId,warehouseId,batchId:lot.id,batchNo:lot.batchNo||'',expiryDate:lot.expiryDate||'',qtyBase:take,unitCost,totalCost:Number((take*unitCost).toFixed(2))});
        remaining=Number((remaining-take).toFixed(6));
      }
      if(remaining>1e-8)return {ok:false,error:`لا توجد كمية صالحة كافية للصنف ${p.name}.`};
      A.adjustStock(productId,warehouseId,-qtyBase);
      return {ok:true,items,costTotal:Number(items.reduce((a,x)=>a+num(x.totalCost),0).toFixed(2))};
    }
    if(A.stockQty(productId,warehouseId)+1e-8<qtyBase)return {ok:false,error:`المخزون غير كافٍ للصنف ${p.name}.`};
    A.adjustStock(productId,warehouseId,-qtyBase);
    const unitCost=num(p.cost||0);
    return {ok:true,items:[{productId,warehouseId,batchId:'',batchNo:'',expiryDate:'',qtyBase,unitCost,totalCost:Number((qtyBase*unitCost).toFixed(2)),direct:true}],costTotal:Number((qtyBase*unitCost).toFixed(2))};
  }

  function restoreConsumptions(items,warehouseId){
    for(const it of items||[]){
      const wh=it.warehouseId||warehouseId;
      if(it.batchId){
        let lot=D().productBatches.find(b=>b.id===it.batchId);
        if(!lot){
          lot={id:it.batchId,productId:it.productId,warehouseId:wh,batchNo:it.batchNo||'',expiryDate:it.expiryDate||'',qtyBase:0,cost:it.unitCost||0,createdAt:A.now()};
          D().productBatches.push(lot);
        }
        lot.qtyBase=Number((num(lot.qtyBase)+num(it.qtyBase)).toFixed(6));
      }
      A.adjustStock(it.productId,wh,num(it.qtyBase));
    }
  }

  A.cashierSellableQty=sellableQty;
  A.cashierPrepareLines=function(lines,warehouseId){
    ensureDB();
    const prepared=lines.map(l=>({...l,stockConsumptions:[],consumedMaterials:[],recipeComponents:[]}));
    const needMap={};
    for(const line of prepared){
      const p=findProduct(line.productId);
      if(!p)continue;
      if(line.useRecipe){
        const rec=productRecipe(line.productId);
        if(!rec.length){prepared.error=`الصنف ${p.name} معرف كوصفة لكن بدون مكونات.`;return prepared;}
        let estCost=0;
        for(const r of rec){
          const cp=findProduct(r.componentProductId); if(!cp)continue;
          const need=num(r.qtyBase)*num(line.baseQty);
          line.recipeComponents.push({productId:cp.id,productName:cp.name,qtyBase:need,trackExpiry:cp.trackExpiry===true,cost:num(cp.cost||0)});
          needMap[cp.id]=(needMap[cp.id]||0)+need;
          estCost+=need*num(cp.cost||0);
        }
        line.unitCost=num(line.baseQty)?Number((estCost/num(line.baseQty)).toFixed(4)):0;
        line.costTotal=Number(estCost.toFixed(2));
        line.trackStock=false;
      }else if(line.trackStock){
        needMap[line.productId]=(needMap[line.productId]||0)+num(line.baseQty);
      }
    }
    for(const [pid,need] of Object.entries(needMap)){
      const p=findProduct(pid); if(!p)continue;
      const available=p.trackExpiry?sellableQty(pid,warehouseId):A.stockQty(pid,warehouseId);
      if(available+1e-8<need){prepared.error=`الكمية غير كافية للصنف ${p.name}. المتاح ${A.unitBreakdown(p,available)}.`;return prepared;}
    }
    return prepared;
  };
  A.cashierCommitStock=function(lines,warehouseId){
    ensureDB();
    for(const line of lines||[]){
      const p=findProduct(line.productId); if(!p)continue;
      if(line.useRecipe){
        let totalCost=0; line.consumedMaterials=[];
        for(const comp of line.recipeComponents||[]){
          const res=consumeLots(comp.productId,warehouseId,comp.qtyBase);
          if(!res.ok)throw Error(res.error);
          totalCost+=num(res.costTotal);
          line.consumedMaterials.push(...res.items);
        }
        line.costTotal=Number(totalCost.toFixed(2));
        line.unitCost=num(line.baseQty)?Number((totalCost/num(line.baseQty)).toFixed(4)):0;
      }else if(line.trackStock){
        const res=consumeLots(line.productId,warehouseId,line.baseQty);
        if(!res.ok)throw Error(res.error);
        line.stockConsumptions=res.items;
        line.costTotal=Number(res.costTotal.toFixed(2));
        line.unitCost=num(line.baseQty)?Number((num(res.costTotal)/num(line.baseQty)).toFixed(4)):0;
      }
    }
  };
  A.cashierRestoreStock=function(lines,warehouseId){
    for(const line of lines||[]){
      if(line.stockConsumptions?.length)restoreConsumptions(line.stockConsumptions,warehouseId);
      else if(line.trackStock)A.adjustStock(line.productId,warehouseId,num(line.baseQty));
      if(line.consumedMaterials?.length)restoreConsumptions(line.consumedMaterials,warehouseId);
    }
  };

  function addBatchModal(){
    const d=D();
    A.openModal({title:'إضافة تشغيلة',body:`<div class="form-grid"><label class="field"><span>التاريخ</span><input type="date" name="date" value="${today()}" required></label><label class="field"><span>الصنف</span><select name="productId" required>${A.options(d.products.filter(p=>p.active!==false),'id','name')}</select></label><label class="field"><span>المستودع</span><select name="warehouseId" required>${A.options(d.warehouses.filter(w=>w.active),'id','name',S.activeWarehouseId||d.warehouses[0]?.id)}</select></label><label class="field"><span>رقم التشغيلة</span><input name="batchNo" required></label><label class="field"><span>تاريخ الانتهاء</span><input type="date" name="expiryDate"></label><label class="field"><span>الكمية الأساسية</span><input type="number" step="any" min="0.00000001" name="qtyBase" required></label><label class="field"><span>تكلفة الوحدة</span><input type="number" step="0.01" min="0" name="cost"></label><label class="field"><span>نوع الإدخال المحاسبي</span><select name="sourceMode"><option value="opening">رصيد افتتاحي</option><option value="adjustment">تسوية زيادة مخزون</option></select></label><label class="field full"><span>ملاحظات</span><textarea name="notes"></textarea></label></div>`,onSubmit:fd=>{const p=findProduct(fd.get('productId'));if(!p)return;const date=fd.get('date')||today(),qty=num(fd.get('qtyBase')),cost=num(fd.get('cost')||p.cost||0);A.validateOpenFinancialDate?.(date);const lot={id:A.uid('BAT'),productId:p.id,warehouseId:fd.get('warehouseId'),batchNo:fd.get('batchNo').trim(),expiryDate:fd.get('expiryDate'),qtyBase:qty,cost,notes:fd.get('notes').trim(),date,sourceMode:fd.get('sourceMode')||'opening',createdAt:A.now()};D().productBatches.unshift(lot);if(qty>0){A.updateWeightedAverageCost?.(lot.productId,qty,cost,1);A.adjustStock(lot.productId,lot.warehouseId,qty)}const value=Number((qty*cost).toFixed(2));if(value>.009){const counterpart=lot.sourceMode==='opening'?'ACC-3200':'ACC-4230',j=A.postJournal(`${lot.sourceMode==='opening'?'رصيد افتتاحي':'تسوية زيادة'} تشغيلة ${p.name}`,lot.batchNo||lot.id,[{accountId:'ACC-1300',debit:value,credit:0},{accountId:counterpart,debit:0,credit:value}],date,true);j.kind=lot.sourceMode==='opening'?'opening-batch':'stock-adjustment';j.sourceId=lot.id}A.saveDB();A.audit('إضافة تشغيلة','المخزون',`${p.name} - ${lot.batchNo}`);A.renderCurrent();A.toast('تمت إضافة التشغيلة وترحيل أثرها المحاسبي');}})
  }
  function renderBatches(root){
    ensureDB();
    const rows=(D().productBatches||[]).slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    root.innerHTML=`${A.pageHead('التشغيلات والصلاحية','تتبع الكميات حسب التشغيلة وتاريخ الانتهاء',`<button class="btn btn-primary" data-action="add-batch">${I('plus')} إضافة تشغيلة</button>`)}<div class="card">${rows.length?table(['الصنف','المستودع','التشغيلة','الانتهاء','الكمية','الحالة'],rows.map(r=>{const p=findProduct(r.productId),st=expiryStatus(r.expiryDate);return[`<div><strong>${esc(p?.name||'—')}</strong><div class="muted">${esc(p?.sku||'')}</div></div>`,esc(whName(r.warehouseId)),esc(r.batchNo||'—'),r.expiryDate?A.dateFmt(r.expiryDate):'—',esc(A.unitBreakdown(p,num(r.qtyBase))),A.badge(st.label,st.tone)]})):A.emptyState('barcode','لا توجد تشغيلات','ابدأ بإدخال التشغيلات للأصناف المنتهية الصلاحية.')}</div>`;
  }

  function renderWastage(root){
    ensureDB();
    const docs=(D().wastageDocs||[]);
    root.innerHTML=`${A.pageHead('التالف والهالك','سندات إتلاف مع ترحيل تكلفة الهالك',`<button class="btn btn-primary" data-action="add-wastage">${I('trash')} سند إتلاف</button>`)}<div class="card">${docs.length?table(['الرقم','التاريخ','المستودع','الأصناف','السبب','القيمة'],docs.map(x=>[esc(x.number),A.dateFmt(x.date),esc(whName(x.warehouseId)),esc((x.lines||[]).map(l=>l.productName).join('، ')),`<span class="wastage-reason-chip">${I('alert',14)} ${esc(x.reason||'—')}</span>`,A.money(x.totalCost)])):A.emptyState('trash','لا توجد سندات إتلاف','سجّل الأصناف التالفة أو المفقودة هنا.')}</div>`;
  }

  function addWastageModal(){
    const d=D();
    A.openModal({title:'سند إتلاف مخزني',body:`<div class="form-grid"><label class="field"><span>التاريخ</span><input type="date" name="date" value="${today()}" required></label><label class="field"><span>المستودع</span><select name="warehouseId" required>${A.options(d.warehouses.filter(w=>w.active),'id','name')}</select></label><label class="field"><span>الصنف</span><select name="productId" required>${A.options(d.products.filter(p=>p.active!==false),'id','name')}</select></label><label class="field"><span>الكمية الأساسية</span><input type="number" name="qtyBase" step="any" min="0.00000001" required></label><label class="field"><span>سبب الإتلاف</span><select name="reason"><option>تالف</option><option>هالك</option><option>منتهي الصلاحية</option><option>فاقد جرد</option></select></label><label class="field full"><span>ملاحظات</span><textarea name="notes"></textarea></label></div>`,onSubmit:fd=>{const p=findProduct(fd.get('productId'));if(!p)throw Error('الصنف غير موجود.');const res=consumeLots(p.id,fd.get('warehouseId'),fd.get('qtyBase'),{allowExpired:true});if(!res.ok)throw Error(res.error);const number=`WST-${String(++D().sequences.wastage).padStart(6,'0')}`;const totalCost=Number(num(res.costTotal).toFixed(2));const doc={id:A.uid('WST'),number,date:fd.get('date')||today(),warehouseId:fd.get('warehouseId'),reason:fd.get('reason'),notes:fd.get('notes').trim(),lines:[{productId:p.id,productName:p.name,qtyBase:num(fd.get('qtyBase')),consumptions:res.items,costTotal:totalCost}],totalCost,createdAt:A.now()};D().wastageDocs.unshift(doc);A.postJournal(`سند إتلاف ${number}`,number,[{accountId:'ACC-5230',debit:totalCost,credit:0},{accountId:'ACC-1300',debit:0,credit:totalCost}],doc.date,true);A.audit('سند إتلاف','المخزون',`${number} - ${p.name}`);A.saveDB();A.renderCurrent();A.toast('تم حفظ سند الإتلاف');}})
  }

  function recipeEditor(productId){
    const d=D(),product=findProduct(productId);if(!product)return;
    const current=recipeRows(productId),candidates=d.products.filter(p=>p.active!==false&&p.id!==productId);
    const rowHtml=r=>{const cp=findProduct(r.componentProductId)||candidates[0],units=cp?.units||[],unit=A.productUnit(cp,r.unitId)||units[0],factor=num(unit?.factor||1),unitQty=r.unitQty!=null?num(r.unitQty):(factor?num(r.qtyBase)/factor:num(r.qtyBase));return `<div class="recipe-row recipe-unit-row"><label class="field"><span>المكوّن</span><select class="recipe-product searchable-select">${A.options(candidates,'id','name',cp?.id||'')}</select></label><label class="field"><span>الوحدة</span><select class="recipe-unit">${A.options(units,'id','name',unit?.id||'')}</select></label><label class="field"><span>الكمية</span><input class="recipe-qty" type="number" step="any" min="0.00000001" value="${unitQty||1}"></label><button type="button" class="btn btn-danger btn-icon recipe-remove" title="حذف">${I('trash',14)}</button></div>`};
    A.openModal({title:`وصفة ${product.name}`,size:'modal-lg',body:`<div class="form-grid"><label class="field full"><span>الصنف النهائي</span><input value="${esc(product.name)}" disabled></label></div><div class="form-section-title"><div><h4>المكونات والوحدات</h4><small class="muted">يمكن استخدام كسور مثل 0.125 كجم أو 12.5 جرام.</small></div><button type="button" class="btn btn-secondary btn-sm" id="addRecipeRow">${I('plus')} مكوّن</button></div><div id="recipeRows" class="recipe-units-editor">${(current.length?current:[{componentProductId:candidates[0]?.id||'',qtyBase:1}]).map(rowHtml).join('')}</div>`,onSubmit:(fd,form)=>{const rows=A.$$('.recipe-row',form).map(r=>{const componentProductId=A.$('.recipe-product',r).value,cp=findProduct(componentProductId),unitId=A.$('.recipe-unit',r).value,unit=A.productUnit(cp,unitId)||cp?.units?.[0],unitQty=num(A.$('.recipe-qty',r).value),factor=num(unit?.factor||1);return {componentProductId,unitId:unit?.id||'',unitName:unit?.name||'وحدة',factor,unitQty,qtyBase:Number((unitQty*factor).toFixed(8))}}).filter(r=>r.componentProductId&&r.qtyBase>0);if(!rows.length)throw Error('أضف مكوناً واحداً على الأقل.');D().recipes=D().recipes.filter(r=>r.productId!==productId);rows.forEach(r=>D().recipes.push({id:A.uid('RCP'),productId,...r,active:true,createdAt:A.now()}));product.useRecipe=true;if(!product.usageType||product.usageType==='stock')product.usageType='recipe';A.saveDB();A.renderCurrent();A.toast('تم حفظ الوصفة والوحدات')},afterOpen:form=>{const box=$('#recipeRows',form);const bind=()=>{A.$$('.recipe-remove',form).forEach(b=>b.onclick=()=>b.closest('.recipe-row')?.remove());A.$$('.recipe-product',form).forEach(ps=>ps.onchange=()=>{const row=ps.closest('.recipe-row'),cp=findProduct(ps.value),us=A.$('.recipe-unit',row);us.innerHTML=A.options(cp?.units||[]);A.enhanceSelects(row)})};$('#addRecipeRow',form).onclick=()=>{box.insertAdjacentHTML('beforeend',rowHtml({componentProductId:candidates[0]?.id||'',qtyBase:1}));A.enhanceSelects(box.lastElementChild);A.injectIcons(box.lastElementChild);bind()};bind()}})
  }

  function renderRecipes(root){
    ensureDB();
    const recipeProducts=D().products.filter(p=>recipeRows(p.id).length||p.useRecipe);
    root.innerHTML=`${A.pageHead('الوصفات والتصنيع','تعريف شجرة المواد للأصناف المباعة أو المصنعة','')}<div class="card">${table(['الصنف','الحالة','المكونات','إجراء'],recipeProducts.map(p=>{const comps=recipeRows(p.id);return[esc(p.name),A.badge(p.showInCashier!==false?'يباع بالكاشير':'مخفي عن الكاشير',p.showInCashier!==false?'primary':'red'),`<div class="recipe-components-mini">${comps.length?comps.map(c=>{const cp=findProduct(c.componentProductId),u=A.productUnit(cp,c.unitId)||cp?.units?.[0],factor=num(u?.factor||c.factor||1),q=c.unitQty!=null?num(c.unitQty):(factor?num(c.qtyBase)/factor:num(c.qtyBase));return `<span>${esc(cp?.name||'—')} × ${q} ${esc(u?.name||c.unitName||'وحدة')}</span>`}).join(''):'<span>لا توجد مكونات</span>'}</div>`,`<button class="btn btn-secondary btn-sm" data-action="edit-recipe" data-id="${p.id}">${I('edit',14)} تحرير</button>`]}))}</div><div class="card" style="margin-top:12px"><div class="card-head"><div><h3>أصناف قابلة للتحويل إلى وصفة</h3><small class="muted">فعّل خيار الوصفة من شاشة المنتجات ثم حرر المكونات هنا.</small></div></div>${table(['الصنف','الكاشير','الإجراء'],D().products.filter(p=>p.active!==false&&!recipeRows(p.id).length).map(p=>[esc(p.name),p.showInCashier!==false?'نعم':'لا',`<button class="btn btn-secondary btn-sm" data-action="edit-recipe" data-id="${p.id}">إعداد الوصفة</button>`]))}</div>`;
  }

  function addProductionModal(){
    const d=D(),available=d.products.filter(p=>p.active!==false&&(p.useRecipe||recipeRows(p.id).length)),first=available[0],firstUnit=first?.units?.[0];
    A.openModal({title:'أمر تصنيع',body:`<div class="form-grid"><label class="field"><span>التاريخ</span><input type="date" name="date" value="${today()}" required></label><label class="field"><span>المستودع</span><select name="warehouseId" required>${A.options(d.warehouses.filter(w=>w.active),'id','name',d.settings.restaurantMode&&d.settings.restaurantKitchenWarehouseId?d.settings.restaurantKitchenWarehouseId:'')}</select></label><label class="field"><span>الصنف المراد تصنيعه</span><select name="productId" id="prodProduct" class="searchable-select" required>${A.options(available,'id','name')}</select></label><label class="field"><span>وحدة الإنتاج</span><select name="unitId" id="prodUnit">${A.options(first?.units||[],'id','name',firstUnit?.id)}</select></label><label class="field"><span>الكمية</span><input type="number" step="any" min="0.00000001" name="qty" value="1" required></label><label class="field full"><span>ملاحظات</span><textarea name="notes"></textarea></label></div>`,onSubmit:fd=>{const product=findProduct(fd.get('productId'));if(!product)throw Error('الصنف غير موجود');const outputUnit=A.productUnit(product,fd.get('unitId'))||product.units?.[0];if(!outputUnit)throw Error('حدد وحدة إنتاج.');const wh=fd.get('warehouseId'),unitQty=num(fd.get('qty')),factor=num(outputUnit.factor||1),baseQty=Number((unitQty*factor).toFixed(8));const rec=recipeRows(product.id);if(!rec.length)throw Error('لا توجد وصفة لهذا الصنف.');let totalCost=0;const materials=[];for(const r of rec){const need=Number((num(r.qtyBase)*baseQty).toFixed(8)),res=consumeLots(r.componentProductId,wh,need);if(!res.ok)throw Error(res.error);materials.push(...res.items);totalCost+=num(res.costTotal)}if(product.trackStock!==false){const outputBaseCost=baseQty>0?num(totalCost)/baseQty:0;A.updateWeightedAverageCost?.(product.id,baseQty,outputBaseCost,1);A.adjustStock(product.id,wh,baseQty)}const number=`PRO-${String(++D().sequences.production).padStart(6,'0')}`;D().productionOrders.unshift({id:A.uid('PROD'),number,date:fd.get('date')||today(),warehouseId:wh,productId:product.id,productName:product.name,unitId:outputUnit.id,unitName:outputUnit.name,factor,unitQty,baseQty,qty:baseQty,totalCost:Number(totalCost.toFixed(2)),materials,notes:fd.get('notes').trim(),createdAt:A.now()});A.audit('أمر تصنيع','المخزون',`${number} - ${product.name} ${unitQty} ${outputUnit.name}`);A.saveDB();A.renderCurrent();A.toast('تم حفظ أمر التصنيع')},afterOpen:form=>{const ps=$('#prodProduct',form),us=$('#prodUnit',form);ps.onchange=()=>{const product=findProduct(ps.value);us.innerHTML=A.options(product?.units||[]);A.enhanceSelects(form)}}})
  }

  function renderProduction(root){
    const docs=D().productionOrders||[];
    root.innerHTML=`${A.pageHead('أوامر التصنيع','تصنيع صنف نهائي مع خصم مواده الأولية',`<button class="btn btn-primary" data-action="add-production">${I('plus')} أمر تصنيع</button>`)}<div class="card">${docs.length?table(['الرقم','التاريخ','الصنف','المستودع','الكمية','التكلفة'],docs.map(x=>[esc(x.number),A.dateFmt(x.date),esc(x.productName),esc(whName(x.warehouseId)),`${num(x.unitQty??x.qty)} ${esc(x.unitName||findProduct(x.productId)?.units?.[0]?.name||'وحدة')}`,A.money(x.totalCost)])):A.emptyState('warehouse','لا توجد أوامر تصنيع','ابدأ بإنشاء وصفة ثم أنشئ أمر تصنيع.')}</div>`;
  }

  function renderTables(root){
    const items=D().restaurantTables||[];
    root.innerHTML=`${A.pageHead('طاولات المطعم','إدارة الطاولات وربطها بطلبات الكاشير',`<button class="btn btn-primary" data-action="add-table">${I('plus')} إضافة طاولة</button>`)}<div class="table-grid">${items.map(t=>`<div class="table-card"><h3>${esc(t.name)}</h3><p>السعة: ${num(t.capacity)||0}</p><div class="table-status"><span>${A.badge(t.status==='occupied'?'مشغولة':'متاحة',t.status==='occupied'?'amber':'green')}</span><b>${t.active!==false?'نشطة':'موقوفة'}</b></div><div style="margin-top:10px"><button class="btn btn-secondary btn-sm" data-action="edit-table" data-id="${t.id}">${I('edit',14)} تعديل</button></div></div>`).join('')}</div>`;
  }

  function tableModal(item){
    A.openModal({title:item?'تعديل طاولة':'إضافة طاولة',body:`<div class="form-grid"><label class="field"><span>الاسم</span><input name="name" value="${esc(item?.name||'')}" required></label><label class="field"><span>السعة</span><input type="number" name="capacity" value="${num(item?.capacity)||4}"></label><label class="field"><span>الحالة</span><select name="status"><option value="available" ${(item?.status||'available')==='available'?'selected':''}>متاحة</option><option value="occupied" ${(item?.status||'')==='occupied'?'selected':''}>مشغولة</option></select></label><label class="field"><span>النشاط</span><select name="active"><option value="1" ${item?.active!==false?'selected':''}>نشطة</option><option value="0" ${item?.active===false?'selected':''}>موقوفة</option></select></label><label class="field full"><span>ملاحظات</span><textarea name="notes">${esc(item?.notes||'')}</textarea></label></div>`,onSubmit:fd=>{const obj=item||{id:A.uid('TBL'),createdAt:A.now()};Object.assign(obj,{name:fd.get('name').trim(),capacity:num(fd.get('capacity')||0),status:fd.get('status'),active:fd.get('active')==='1',notes:fd.get('notes').trim(),updatedAt:A.now()});if(!item)D().restaurantTables.push(obj);A.saveDB();A.renderCurrent();A.toast(item?'تم تعديل الطاولة':'تمت إضافة الطاولة');}})
  }

  function productLastSale(productId){
    const dates=(D().sales||[]).filter(s=>(s.lines||[]).some(l=>l.productId===productId)).map(s=>s.date).filter(Boolean).sort();
    return dates[dates.length-1]||'';
  }
  function bestSellers(){
    const map={};
    (D().sales||[]).forEach(s=>(s.lines||[]).forEach(l=>{const m=map[l.productId]||(map[l.productId]={productId:l.productId,qty:0,revenue:0,profit:0});m.qty+=num(l.baseQty||l.qty);m.revenue+=num(l.total);m.profit+=num(l.total)-num(l.tax)-num(l.costTotal)}));
    return Object.values(map).sort((a,b)=>b.qty-a.qty).slice(0,10);
  }
  function expiringSoon(){return (D().productBatches||[]).filter(b=>b.expiryDate&&b.expiryDate>=today()&&Math.ceil((new Date(b.expiryDate)-new Date(today()))/86400000)<=30 && num(b.qtyBase)>0).sort(lotSort)}
  function stagnantProducts(days=90){
    const cutoff=new Date(Date.now()-days*86400000);
    return D().products.filter(p=>p.active!==false).map(p=>({p,last:productLastSale(p.id)})).filter(x=>!x.last||new Date(x.last)<cutoff);
  }
  function movementRows(productId){
    const p=findProduct(productId); if(!p)return [];
    const rows=[];
    (D().purchases||[]).forEach(x=>(x.lines||[]).filter(l=>l.productId===productId).forEach(l=>rows.push({date:x.date,kind:'شراء',ref:x.number,in:num(l.baseQty),out:0})));
    (D().sales||[]).forEach(x=>(x.lines||[]).filter(l=>l.productId===productId).forEach(l=>rows.push({date:x.date,kind:'بيع',ref:x.number,in:0,out:num(l.baseQty)})));
    (D().wastageDocs||[]).forEach(x=>(x.lines||[]).filter(l=>l.productId===productId).forEach(l=>rows.push({date:x.date,kind:'هالك',ref:x.number,in:0,out:num(l.qtyBase)})));
    (D().productionOrders||[]).forEach(x=>{if(x.productId===productId)rows.push({date:x.date,kind:'تصنيع+',ref:x.number,in:num(x.baseQty??x.qty),out:0});(x.materials||[]).filter(m=>m.productId===productId).forEach(m=>rows.push({date:x.date,kind:'تصنيع-',ref:x.number,in:0,out:num(m.qtyBase)}))});
    return rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }

  function renderStockInsights(root){
    ensureDB();
    const productId=S.stockInsightProductId||D().products[0]?.id||'';
    const mv=movementRows(productId);
    let bal=0;
    const mvTable=mv.map(r=>{bal+=num(r.in)-num(r.out);return[A.dateFmt(r.date),esc(r.kind),esc(r.ref||'—'),num(r.in),num(r.out),esc(A.unitBreakdown(findProduct(productId),bal))]});
    root.innerHTML=`${A.pageHead('تحليل المخزون','التنبيهات والحركة والأصناف الأكثر مبيعاً',`<label class="field" style="min-width:260px"><span>حركة صنف</span><select id="stockInsightProduct">${A.options(D().products.filter(p=>p.active!==false),'id','name',productId)}</select></label>`)}<div class="stats-grid"><div class="stat-card"><small>تشغيلات قرب الانتهاء</small><strong>${expiringSoon().length}</strong><div class="stat-note">آخر 30 يوم قبل الانتهاء</div></div><div class="stat-card"><small>الأصناف الراكدة</small><strong>${stagnantProducts(90).length}</strong><div class="stat-note">بلا بيع خلال 90 يوماً</div></div><div class="stat-card"><small>وصفات فعالة</small><strong>${new Set((D().recipes||[]).map(r=>r.productId)).size}</strong><div class="stat-note">أصناف تستخدم BOM</div></div></div><div class="card" style="margin-top:12px"><div class="card-head"><div><h3>تشغيلات قريبة الانتهاء</h3></div></div>${expiringSoon().length?table(['الصنف','المستودع','التشغيلة','الانتهاء','الكمية'],expiringSoon().slice(0,10).map(b=>[esc(findProduct(b.productId)?.name||'—'),esc(whName(b.warehouseId)),esc(b.batchNo||'—'),A.dateFmt(b.expiryDate),esc(A.unitBreakdown(findProduct(b.productId),num(b.qtyBase)))])):A.emptyState('alert','لا توجد تشغيلات قريبة الانتهاء','')}</div><div class="card" style="margin-top:12px"><div class="card-head"><div><h3>الأصناف الأكثر مبيعاً</h3></div></div>${bestSellers().length?table(['الصنف','الكمية','الإيراد','الربح'],bestSellers().map(x=>[esc(findProduct(x.productId)?.name||'—'),num(x.qty),A.money(x.revenue),A.money(x.profit)])):A.emptyState('reports','لا توجد مبيعات بعد','')}</div><div class="card" style="margin-top:12px"><div class="card-head"><div><h3>الأصناف الراكدة</h3></div></div>${stagnantProducts(90).length?table(['الصنف','آخر بيع'],stagnantProducts(90).slice(0,20).map(x=>[esc(x.p.name),x.last?A.dateFmt(x.last):'لم يُبع'])):A.emptyState('products','لا توجد أصناف راكدة','')}</div><div class="card" style="margin-top:12px"><div class="card-head"><div><h3>حركة الصنف</h3></div></div>${mvTable.length?table(['التاريخ','الحركة','المرجع','داخل','خارج','الرصيد'],mvTable):A.emptyState('warehouse','لا توجد حركة لهذا الصنف','')}</div>`;
    $('#stockInsightProduct',root)?.addEventListener('change',e=>{S.stockInsightProductId=e.target.value;renderStockInsights(root)});
  }

  A.registerView('batches',renderBatches);
  A.registerView('wastage',renderWastage);
  A.registerView('recipes',renderRecipes);
  A.registerView('production',renderProduction);
  A.registerView('restaurant-tables',renderTables);
  A.registerView('stock-insights',renderStockInsights);
  A.registerAction('add-batch',addBatchModal);
  A.registerAction('add-wastage',addWastageModal);
  A.registerAction('edit-recipe',b=>recipeEditor(b.dataset.id));
  A.registerAction('add-production',addProductionModal);
  A.registerAction('add-table',()=>tableModal());
  A.registerAction('edit-table',b=>tableModal(D().restaurantTables.find(x=>x.id===b.dataset.id)));
})();

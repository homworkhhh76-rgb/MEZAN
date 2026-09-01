(function(){
  'use strict';
  const A=window.AlMezan;
  if(!A)return;
  const COMMON_SERVICES=[
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
  ];
  const state={device:null,server:null,characteristic:null,connecting:null,printing:false,printingSaleId:''};
  const PRINT_GUARD_KEY='almezan_print_guard_v2',PRINT_GUARD_MS=10000;
  const D=()=>A.db;
  const support=()=>!!(navigator.bluetooth&&window.isSecureContext);
  function uuid(v){
    v=String(v||'').trim().toLowerCase().replace(/^0x/,'');
    if(!v)return '';
    if(/^[0-9a-f]{4}$/.test(v))return `0000${v}-0000-1000-8000-00805f9b34fb`;
    if(/^[0-9a-f]{8}$/.test(v))return `${v}-0000-1000-8000-00805f9b34fb`;
    return v;
  }
  function settings(){
    const s=D()?.settings||{};
    if(!s.bluetoothServiceUuid)s.bluetoothServiceUuid='18f0';
    if(!s.bluetoothPrintMode)s.bluetoothPrintMode='raster';
    if(s.bluetoothAutoReconnect===undefined)s.bluetoothAutoReconnect=true;
    return s;
  }
  function emit(){window.dispatchEvent(new CustomEvent('almezan:printer-status',{detail:status()}))}
  function status(){
    const s=settings();
    return {supported:support(),connected:!!state.characteristic&&!!state.device?.gatt?.connected,deviceId:state.device?.id||s.bluetoothPrinterId||'',name:state.device?.name||s.bluetoothPrinterName||'',printing:state.printing};
  }
  function saveDevice(device){const s=settings();s.bluetoothPrinterId=device?.id||'';s.bluetoothPrinterName=device?.name||'طابعة بلوتوث';A.saveDB?.();emit()}
  function clearConnection(){state.server=null;state.characteristic=null;emit()}
  function onDisconnected(){clearConnection();if(settings().bluetoothAutoReconnect) setTimeout(()=>connectSaved().catch(()=>{}),1200)}
  async function writableCharacteristic(server,preferredService='',preferredCharacteristic=''){
    const preferredS=uuid(preferredService),preferredC=uuid(preferredCharacteristic);
    if(preferredS){
      try{
        const service=await server.getPrimaryService(preferredS);
        if(preferredC){const ch=await service.getCharacteristic(preferredC);if(ch.properties.write||ch.properties.writeWithoutResponse)return ch}
        const chars=await service.getCharacteristics();
        const ch=chars.find(x=>x.properties.writeWithoutResponse||x.properties.write);if(ch)return ch;
      }catch(_){ }
    }
    const services=await server.getPrimaryServices();
    for(const service of services){
      try{
        const chars=await service.getCharacteristics();
        const ch=chars.find(x=>x.properties.writeWithoutResponse||x.properties.write);if(ch)return ch;
      }catch(_){ }
    }
    throw new Error('تم الاتصال بالطابعة لكن لم يتم العثور على قناة طباعة قابلة للكتابة. جرّب UUID مختلفاً من إعدادات الطابعة.');
  }
  async function connectDevice(device){
    if(!device)throw new Error('لم يتم اختيار طابعة.');
    if(device.gatt?.connected&&state.characteristic)return device;
    state.device=device;device.removeEventListener?.('gattserverdisconnected',onDisconnected);device.addEventListener?.('gattserverdisconnected',onDisconnected);
    const server=await device.gatt.connect();state.server=server;
    const s=settings();state.characteristic=await writableCharacteristic(server,s.bluetoothServiceUuid,s.bluetoothCharacteristicUuid);
    saveDevice(device);emit();return device;
  }
  async function requestPrinter(opts={}){
    if(!support())throw new Error('Bluetooth Web غير مدعوم في هذا المتصفح. استخدم Chrome/Edge على جهاز يدعم Web Bluetooth ومن خلال HTTPS.');
    const s=settings(),configured=uuid(opts.serviceUuid||s.bluetoothServiceUuid),optional=[configured,...COMMON_SERVICES].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
    const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:optional});
    return connectDevice(device);
  }
  async function connectSaved(){
    if(!support())throw new Error('Bluetooth Web غير مدعوم.');
    if(state.device?.gatt?.connected&&state.characteristic)return state.device;
    if(state.connecting)return state.connecting;
    state.connecting=(async()=>{
      const s=settings();
      if(!s.bluetoothPrinterId||typeof navigator.bluetooth.getDevices!=='function')throw new Error('لا توجد طابعة محفوظة يمكن إعادة الاتصال بها تلقائياً.');
      const devices=await navigator.bluetooth.getDevices(),device=devices.find(d=>d.id===s.bluetoothPrinterId)||devices.find(d=>d.name&&d.name===s.bluetoothPrinterName);
      if(!device)throw new Error('الطابعة المحفوظة غير متاحة حالياً.');
      return connectDevice(device);
    })();
    try{return await state.connecting}finally{state.connecting=null}
  }
  async function connect(opts={}){
    if(state.device?.gatt?.connected&&state.characteristic)return state.device;
    if(opts.prompt===false)return connectSaved();
    return requestPrinter(opts);
  }
  function disconnect(){try{state.device?.gatt?.disconnect()}catch(_){}clearConnection()}
  function forget(){disconnect();const s=settings();s.bluetoothPrinterId='';s.bluetoothPrinterName='';A.saveDB?.();emit()}
  const money=v=>`${(Number(v)||0).toFixed(2)} ₪`;
  function wrap(ctx,text,maxWidth){
    const words=String(text||'').split(/\s+/).filter(Boolean),out=[];let line='';
    for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width<=maxWidth||!line)line=next;else{out.push(line);line=word}}
    if(line)out.push(line);return out.length?out:[''];
  }
  async function loadLogo(){
    try{const img=new Image();img.src='brand-logo.png';if(img.decode)await img.decode();else await new Promise((res,rej)=>{img.onload=res;img.onerror=rej});return img}catch(_){return null}
  }
  async function receiptCanvas(sale){
    const st=settings(),width=st.printSize==='58'?384:576,pad=st.printSize==='58'?12:16,inner=width-pad*2,scale=st.printSize==='58'?.78:1;
    const font=(size,weight=600)=>`${weight} ${Math.max(10,Math.round(size*scale))}px Arial, Tahoma, sans-serif`;
    const probe=document.createElement('canvas').getContext('2d');probe.font=font(18,700);
    const nameWidth=inner*(st.showInvoiceItemNumber!==false?.35:.40);let rowsHeight=0;for(const l of sale.lines||[]){rowsHeight+=Math.max(1,wrap(probe,l.productName,nameWidth).length)*Math.round(25*scale)+Math.round(12*scale)}
    const visibleMeta=(st.showInvoiceEmployee!==false||st.showInvoiceOrderType!==false||st.showInvoiceCustomer!==false||st.showInvoiceBranch!==false),visibleSummary=[st.showInvoiceQuantityTotal!==false,st.showInvoiceSubtotal!==false,st.showInvoiceDiscount!==false,st.showInvoiceTax!==false&&Number(sale.tax||0)!==0,st.showInvoicePaid!==false,st.showInvoiceDue!==false].filter(Boolean).length;
    const estimate=180+rowsHeight+visibleSummary*Math.round(27*scale)+(st.showInvoiceNetAmount!==false?62:0)+(st.showInvoiceMessage!==false&&D().company.invoiceNote?52:0)+(st.showInvoiceFooterTime!==false||st.showInvoiceFooterNumber!==false?38:0)+(st.showInvoiceLogo!==false?110:0)+(st.showInvoiceBarcode===true?90:0);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(420,estimate);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#000';ctx.strokeStyle='#000';ctx.direction='rtl';ctx.textBaseline='middle';let y=Math.round(10*scale);
    const txt=(text,x,cy,size=16,weight=600,align='right')=>{ctx.font=font(size,weight);ctx.textAlign=align;ctx.fillText(String(text??''),x,cy)};
    const hline=(yy,x1=pad,x2=width-pad,lw=1.5)=>{ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x1,yy);ctx.lineTo(x2,yy);ctx.stroke()};
    const rect=(x,yy,w,h,lw=1.5)=>{ctx.lineWidth=lw;ctx.strokeRect(x,yy,w,h)};
    const logo=st.showInvoiceLogo!==false?await loadLogo():null;if(logo){const sizes={small:[110,72],medium:[150,92],large:[195,116]},sz=sizes[st.invoiceLogoSize]||sizes.small,ratio=Math.min(sz[0]/logo.width,sz[1]/logo.height,1),w=logo.width*ratio,h=logo.height*ratio;ctx.drawImage(logo,(width-w)/2,y,w,h);y+=h+Math.round(8*scale)}
    const employee=st.showInvoiceEmployee!==false?`الموظف : ${sale.userName||'—'}`:'',orderType=st.showInvoiceOrderType!==false?`نوع الطلب : ${sale.tableId?'محلي':(st.invoiceOrderTypeText||'سفري')}`:'',customer=st.showInvoiceCustomer!==false?`العميل : ${sale.customerName||'عميل نقدي'}`:'',branch=st.showInvoiceBranch!==false?`الفرع : ${A.branchName(sale.branchId)||'—'}`:'';
    const metaRows=[[employee,orderType],[customer,branch]].filter(r=>r.some(Boolean));for(const r of metaRows){const rh=Math.round(31*scale);if(r[0])txt(r[0],width-pad,y+rh/2,15,700,'right');if(r[1])txt(r[1],pad,y+rh/2,15,700,'left');y+=rh}
    const cols=[];if(st.showInvoiceItemNumber!==false)cols.push({key:'no',label:'ت',ratio:.10});cols.push({key:'name',label:'اسم المادة',ratio:.35});if(st.showInvoiceQtyColumn!==false)cols.push({key:'qty',label:'الكمية',ratio:.15});if(st.showInvoicePriceColumn!==false)cols.push({key:'price',label:'السعر',ratio:.20});if(st.showInvoiceLineTotal!==false)cols.push({key:'total',label:'اجمالي',ratio:.20});const totalRatio=cols.reduce((a,c)=>a+c.ratio,0);cols.forEach(c=>c.w=inner*c.ratio/totalRatio);
    const headerH=Math.round(36*scale);rect(pad,y,inner,headerH);let x=width-pad;for(const c of cols){const next=x-c.w;txt(c.label,(x+next)/2,y+headerH/2,14,700,'center');if(next>pad+.5){ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(next,y);ctx.lineTo(next,y+headerH);ctx.stroke()}x=next}y+=headerH;
    const moneyPlain=v=>(Number(v)||0).toFixed(2);
    for(let i=0;i<(sale.lines||[]).length;i++){const l=sale.lines[i];ctx.font=font(14,700);const nameCol=cols.find(c=>c.key==='name'),nameLines=wrap(ctx,l.productName,Math.max(45,nameCol.w-8));const rowH=Math.max(Math.round(36*scale),nameLines.length*Math.round(22*scale)+Math.round(10*scale));rect(pad,y,inner,rowH);let xx=width-pad;for(const c of cols){const next=xx-c.w;if(next>pad+.5){ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(next,y);ctx.lineTo(next,y+rowH);ctx.stroke()}if(c.key==='name'){const lh=Math.round(22*scale),startY=y+rowH/2-(nameLines.length-1)*lh/2;nameLines.forEach((line,j)=>txt(line,(xx+next)/2,startY+j*lh,14,700,'center'))}else{const val=c.key==='no'?i+1:c.key==='qty'?l.qty:c.key==='price'?moneyPlain(l.unitPrice):moneyPlain(l.total);txt(val,(xx+next)/2,y+rowH/2,14,700,'center')}xx=next}y+=rowH}
    const qtyTotal=(sale.lines||[]).reduce((a,l)=>a+Number(l.qty||0),0),summary=[];if(st.showInvoiceQuantityTotal!==false)summary.push(`الكمية : ${qtyTotal}`);if(st.showInvoiceSubtotal!==false)summary.push(`اجمالي المبلغ : ${moneyPlain(sale.subtotal)} ₪`);if(st.showInvoiceTax!==false&&Number(sale.tax||0)!==0)summary.push(`الضريبة : ${moneyPlain(sale.tax)} ₪`);if(st.showInvoiceDiscount!==false)summary.push(`الخصم : ${moneyPlain(sale.discount)} ₪`);if(st.showInvoicePaid!==false)summary.push(`المدفوع : ${moneyPlain(sale.paid)} ₪`);if(st.showInvoiceDue!==false)summary.push(`المتبقي : ${moneyPlain(sale.due)} ₪`);for(let i=0;i<summary.length;i+=2){const rh=Math.round(29*scale);txt(summary[i],width-pad,y+rh/2,14,700,'right');if(summary[i+1])txt(summary[i+1],pad,y+rh/2,14,700,'left');y+=rh}
    if(st.showInvoiceNetAmount!==false){const rh=Math.round(58*scale),half=inner/2;rect(pad,y,inner,rh,2);ctx.beginPath();ctx.moveTo(pad+half,y);ctx.lineTo(pad+half,y+rh);ctx.lineWidth=2;ctx.stroke();txt('المبلغ الصافي :',width-pad-half/2,y+rh/2,21,700,'center');txt(`${moneyPlain(sale.total)} ₪`,pad+half/2,y+rh/2,23,800,'center');y+=rh+Math.round(8*scale)}
    if(st.showInvoiceMessage!==false&&D().company.invoiceNote){ctx.font=font(17,700);const lines=wrap(ctx,D().company.invoiceNote,inner-8),lh=Math.round(24*scale);lines.forEach(line=>{txt(line,width/2,y+lh/2,17,700,'center');y+=lh});y+=Math.round(5*scale)}
    // Optional Code39 remains available from settings, but hidden by default in the new receipt style.
    if(st.showInvoiceBarcode===true){txt(`* ${sale.number} *`,width/2,y+Math.round(14*scale),12,500,'center');y+=Math.round(28*scale)}
    if(st.showInvoiceFooterTime!==false||st.showInvoiceFooterNumber!==false){const dt=new Date(sale.createdAt||sale.updatedAt||Date.now()),dateTime=dt.toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}),rh=Math.round(30*scale);if(st.showInvoiceFooterTime!==false)txt(dateTime,pad,y+rh/2,12,500,'left');if(st.showInvoiceFooterNumber!==false)txt(sale.number,width-pad,y+rh/2,12,700,'right');y+=rh}
    const finalH=Math.min(canvas.height,Math.ceil(y+Math.round(10*scale))),out=document.createElement('canvas');out.width=width;out.height=finalH;out.getContext('2d').drawImage(canvas,0,0,width,finalH,0,0,width,finalH);return out;
  }
  function rasterBytes(canvas){
    const ctx=canvas.getContext('2d'),img=ctx.getImageData(0,0,canvas.width,canvas.height),widthBytes=Math.ceil(canvas.width/8),data=new Uint8Array(widthBytes*canvas.height);
    for(let y=0;y<canvas.height;y++)for(let xb=0;xb<widthBytes;xb++){let b=0;for(let bit=0;bit<8;bit++){const x=xb*8+bit;if(x>=canvas.width)continue;const i=(y*canvas.width+x)*4,r=img.data[i],g=img.data[i+1],bl=img.data[i+2],a=img.data[i+3],lum=(.299*r+.587*g+.114*bl)*(a/255)+255*(1-a/255);if(lum<165)b|=(0x80>>bit)}data[y*widthBytes+xb]=b}
    const header=new Uint8Array([0x1b,0x40,0x1b,0x61,0x01,0x1d,0x76,0x30,0x00,widthBytes&255,(widthBytes>>8)&255,canvas.height&255,(canvas.height>>8)&255]);
    const tail=new Uint8Array([0x0a,0x0a,0x0a,0x1d,0x56,0x00]);const out=new Uint8Array(header.length+data.length+tail.length);out.set(header,0);out.set(data,header.length);out.set(tail,header.length+data.length);return out;
  }
  async function writePiece(ch,bytes){
    const view=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    if(ch.properties.writeWithoutResponse&&typeof ch.writeValueWithoutResponse==='function')return ch.writeValueWithoutResponse(view);
    if(typeof ch.writeValueWithResponse==='function')return ch.writeValueWithResponse(view);
    return ch.writeValue(view);
  }
  async function writeBytes(bytes){
    const ch=state.characteristic;if(!ch)throw new Error('الطابعة غير متصلة.');let pos=0,chunk=180;
    while(pos<bytes.length){const end=Math.min(bytes.length,pos+chunk),part=bytes.subarray(pos,end);try{await writePiece(ch,part);pos=end}catch(e){if(chunk>20){chunk=20;continue}throw e}if(pos%3600<chunk)await new Promise(r=>setTimeout(r,2))}
  }
  function readPrintGuard(){try{return JSON.parse(localStorage.getItem(PRINT_GUARD_KEY)||'null')||null}catch(_){return null}}
  function writePrintGuard(saleId){try{localStorage.setItem(PRINT_GUARD_KEY,JSON.stringify({saleId:String(saleId||''),at:Date.now()}))}catch(_){}}
  function recentlyPrinting(saleId){const g=readPrintGuard();return !!(state.printing||state.printingSaleId===String(saleId||'')||(g&&g.saleId===String(saleId||'')&&Date.now()-Number(g.at||0)<PRINT_GUARD_MS))}
  async function printInvoice(sale){
    if(!sale)throw new Error('الفاتورة غير موجودة.');const s=settings();
    if(recentlyPrinting(sale.id))return false;
    // الطباعة الحرارية الصامتة المباشرة تتم فقط عبر Bluetooth المحفوظ. لا نفتح صفحة معاينة كبديل.
    if(s.printSize==='a4'){window.open(`./index.html?v=742#print-invoice/${sale.id}`,'_blank');return false}
    if(s.printerConnection!=='bluetooth'||!support())return false;
    state.printing=true;state.printingSaleId=String(sale.id||'');writePrintGuard(sale.id);emit();
    try{
      if(!state.characteristic||!state.device?.gatt?.connected)await connectSaved();
      const canvas=await receiptCanvas(sale),bytes=rasterBytes(canvas);await writeBytes(bytes);
      A.toast?.(`تمت طباعة ${sale.number} على ${state.device?.name||'طابعة البلوتوث'}`,'success');return true
    }catch(e){
      console.error(e);const msg=String(e?.message||e||'');
      // لا Toast عند عدم وجود/توفر طابعة محفوظة، ولا نفتح معاينة طباعة حتى لا تتكرر الفاتورة.
      if(!/لا توجد طابعة محفوظة|الطابعة المحفوظة غير متاحة|Bluetooth Web غير مدعوم/.test(msg))A.toast?.('تعذر إرسال الفاتورة للطابعة: '+msg,'error',5200);
      return false
    }finally{state.printing=false;state.printingSaleId='';emit()}
  }
  function printInvoiceById(id){const sale=D()?.sales?.find(x=>x.id===id);return printInvoice(sale)}
  async function printTest(){
    const sale=D()?.sales?.[0];if(sale)return printInvoice(sale);
    if(!state.characteristic||!state.device?.gatt?.connected)await connectSaved();const fake={id:'TEST',number:'TEST-PRINT',date:A.today(),customerName:'طباعة تجريبية',userName:A.currentUser?.()?.name||'المستخدم',branchId:A.state.activeBranchId,lines:[{productName:'اختبار الطابعة الحرارية',unitName:'حبة',qty:1,unitPrice:1,total:1}],subtotal:1,discount:0,tax:0,total:1,paid:1,due:0};const canvas=await receiptCanvas(fake);await writeBytes(rasterBytes(canvas));A.toast?.('تم إرسال ورقة الاختبار للطابعة.','success')
  }
  window.AlMezanBluetoothPrinter={support,status,connect,connectSaved,disconnect,forget,printInvoice,printInvoiceById,printTest};
  window.addEventListener('online',()=>{if(settings().printerConnection==='bluetooth'&&settings().bluetoothAutoReconnect)connectSaved().catch(()=>{})});
  setTimeout(()=>{if(settings().printerConnection==='bluetooth'&&settings().bluetoothAutoReconnect)connectSaved().catch(()=>{})},900);
})();

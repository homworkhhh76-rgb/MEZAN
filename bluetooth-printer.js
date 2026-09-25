(function(){
  'use strict';
  const A=window.AlMezan;
  if(!A)return;
  const D=()=>A.db;
  const META_KEY='almezan_bt_printer_v7850';
  const PRINT_GUARD_KEY='almezan_print_guard_v7850',PRINT_GUARD_MS=9000;
  const COMMON_SERVICES=[
    '000018f0-0000-1000-8000-00805f9b34fb','0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb','0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb','0000ae3a-0000-1000-8000-00805f9b34fb',
    '0000af30-0000-1000-8000-00805f9b34fb','49535343-fe7d-4ae5-8fa9-9fafd205e455',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2','6e400001-b5a3-f393-e0a9-e50e24dcca9e'
  ];
  const PREFERRED_CHARS=[
    '0000ae01-0000-1000-8000-00805f9b34fb','0000ae03-0000-1000-8000-00805f9b34fb',
    '0000ffe1-0000-1000-8000-00805f9b34fb','0000ff02-0000-1000-8000-00805f9b34fb',
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e','49535343-1e4d-4bd9-ba61-23c647249616'
  ];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const state={device:null,server:null,characteristic:null,connecting:null,writeTail:Promise.resolve(),printing:false,printingSaleId:'',reconnectTimer:null,reconnectAttempts:0,keepAliveTimer:null,manualDisconnect:false,lastActivity:0,lastError:''};
  const support=()=>!!(navigator.bluetooth&&window.isSecureContext);
  function uuid(v){v=String(v||'').trim().toLowerCase().replace(/^0x/,'');if(!v)return'';if(/^[0-9a-f]{4}$/.test(v))return`0000${v}-0000-1000-8000-00805f9b34fb`;if(/^[0-9a-f]{8}$/.test(v))return`${v}-0000-1000-8000-00805f9b34fb`;return v}
  function readMeta(){try{return JSON.parse(localStorage.getItem(META_KEY)||'{}')||{}}catch(_){return{}}}
  function writeMeta(patch={}){const m={...readMeta(),...patch,updatedAt:Date.now()};try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch(_){}return m}
  function settings(){const s=D()?.settings||{};if(s.bluetoothServiceUuid==='18f0')s.bluetoothServiceUuid='';if(!s.bluetoothPrintMode)s.bluetoothPrintMode='raster';if(s.bluetoothAutoReconnect===undefined)s.bluetoothAutoReconnect=true;return s}
  function emit(){try{window.dispatchEvent(new CustomEvent('almezan:printer-status',{detail:status()}))}catch(_){}}
  function status(){const s=settings(),m=readMeta(),connected=!!state.device?.gatt?.connected&&!!state.characteristic;return{supported:support(),connected,deviceId:state.device?.id||m.deviceId||s.bluetoothPrinterId||'',name:state.device?.name||m.deviceName||s.bluetoothPrinterName||'',serviceUuid:String(state.characteristic?.service?.uuid||m.serviceUuid||s.bluetoothServiceUuid||''),characteristicUuid:String(state.characteristic?.uuid||m.characteristicUuid||s.bluetoothCharacteristicUuid||''),printing:state.printing,lastError:state.lastError||''}}
  function remember(device,ch){const s=settings(),serviceUuid=String(ch?.service?.uuid||readMeta().serviceUuid||''),characteristicUuid=String(ch?.uuid||readMeta().characteristicUuid||'');s.bluetoothPrinterId=device?.id||s.bluetoothPrinterId||'';s.bluetoothPrinterName=device?.name||s.bluetoothPrinterName||'طابعة بلوتوث';if(serviceUuid)s.bluetoothServiceUuid=serviceUuid;if(characteristicUuid)s.bluetoothCharacteristicUuid=characteristicUuid;writeMeta({deviceId:s.bluetoothPrinterId,deviceName:s.bluetoothPrinterName,serviceUuid,characteristicUuid});A.saveDB?.(true,{fromSync:true});emit()}
  function clearLive(){state.server=null;state.characteristic=null;emit()}
  function isBtWanted(){const s=settings();return s.bluetoothAutoReconnect!==false&&(s.printerConnection==='bluetooth'||!!readMeta().deviceId)}
  function cancelReconnect(){if(state.reconnectTimer){clearTimeout(state.reconnectTimer);state.reconnectTimer=null}}
  function scheduleReconnect(){if(state.manualDisconnect||!isBtWanted()||state.reconnectTimer)return;const delay=[350,700,1200,2200,4000,6500][Math.min(state.reconnectAttempts,5)];state.reconnectAttempts++;state.reconnectTimer=setTimeout(async()=>{state.reconnectTimer=null;try{await connectSaved();state.reconnectAttempts=0}catch(_){if(state.reconnectAttempts<20)scheduleReconnect()}},delay)}
  function onDisconnected(){clearLive();if(!state.manualDisconnect)scheduleReconnect()}
  function bindDevice(device){if(!device)return;try{device.removeEventListener?.('gattserverdisconnected',onDisconnected)}catch(_){}device.addEventListener?.('gattserverdisconnected',onDisconnected)}
  function connectionHints(opts={}){const s=settings(),m=readMeta();return{deviceId:opts.deviceId||m.deviceId||s.bluetoothPrinterId||'',deviceName:opts.deviceName||m.deviceName||s.bluetoothPrinterName||'',serviceUuid:uuid(opts.serviceUuid||m.serviceUuid||s.bluetoothServiceUuid||''),characteristicUuid:uuid(opts.characteristicUuid||m.characteristicUuid||s.bluetoothCharacteristicUuid||'')}}
  async function characteristicFromService(service,wanted=''){let chars=[];try{chars=await service.getCharacteristics()}catch(_){return null}if(wanted){const exact=chars.find(c=>String(c.uuid).toLowerCase()===wanted&&(c.properties.writeWithoutResponse||c.properties.write));if(exact)return exact}for(const id of PREFERRED_CHARS){const c=chars.find(x=>String(x.uuid).toLowerCase()===id&&(x.properties.writeWithoutResponse||x.properties.write));if(c)return c}return chars.find(c=>c.properties.writeWithoutResponse||c.properties.write)||null}
  async function findWritable(server,opts={}){const h=connectionHints(opts),seen=new Set(),services=[];for(const sid of [h.serviceUuid,...COMMON_SERVICES].filter(Boolean)){try{const service=await server.getPrimaryService(sid);if(service&&!seen.has(service.uuid)){seen.add(service.uuid);services.push(service)}}catch(_){}}try{for(const service of await server.getPrimaryServices())if(!seen.has(service.uuid)){seen.add(service.uuid);services.push(service)}}catch(_){}for(const service of services){const ch=await characteristicFromService(service,h.characteristicUuid);if(ch)return ch}throw Error('تم الاتصال بالطابعة لكن لم يتم العثور على قناة BLE للكتابة. أطفئ الطابعة وشغّلها مرة واحدة ثم أعد اختيارها.')}
  async function connectDevice(device,opts={}){if(!device?.gatt)throw Error('الجهاز المختار لا يدعم اتصال GATT للطباعة.');state.manualDisconnect=false;state.device=device;bindDevice(device);if(device.gatt.connected&&state.characteristic){remember(device,state.characteristic);return device}clearLive();let server;let last;for(let attempt=0;attempt<3;attempt++){try{server=device.gatt.connected?device.gatt:await device.gatt.connect();if(server)break}catch(e){last=e;try{device.gatt.disconnect()}catch(_){}await wait(160+attempt*220)}}if(!server)throw last||Error('تعذر فتح اتصال GATT بالطابعة.');state.server=server;state.characteristic=await findWritable(server,opts);state.reconnectAttempts=0;state.lastError='';remember(device,state.characteristic);return device}
  async function recoverSavedDevice(opts={}){const h=connectionHints(opts);if(state.device&&(state.device.id===h.deviceId||!h.deviceId))return state.device;if(typeof navigator.bluetooth.getDevices!=='function')return state.device||null;let devices=[];try{devices=await navigator.bluetooth.getDevices()}catch(_){}return devices.find(d=>h.deviceId&&d.id===h.deviceId)||devices.find(d=>h.deviceName&&d.name===h.deviceName)||devices[0]||null}
  async function connectSaved(opts={}){if(!support())throw Error('Bluetooth Web غير مدعوم في هذا المتصفح أو الصفحة ليست HTTPS.');if(state.device?.gatt?.connected&&state.characteristic)return state.device;if(state.connecting)return state.connecting;state.connecting=(async()=>{const device=await recoverSavedDevice(opts);if(!device)throw Error('لا توجد طابعة محفوظة بإذن Bluetooth. اضغط اتصال مرة واحدة فقط لاختيار الطابعة.');return connectDevice(device,opts)})();try{return await state.connecting}finally{state.connecting=null}}
  async function requestPrinter(opts={}){if(!support())throw Error('Bluetooth Web غير مدعوم في هذا المتصفح أو الصفحة ليست HTTPS.');const h=connectionHints(opts),optional=[h.serviceUuid,...COMMON_SERVICES].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:optional});return connectDevice(device,opts)}
  async function connect(opts={}){if(state.device?.gatt?.connected&&state.characteristic)return state.device;if(opts.prompt===false)return connectSaved(opts);return requestPrinter(opts)}
  function disconnect(){state.manualDisconnect=true;cancelReconnect();try{state.device?.gatt?.disconnect()}catch(_){}clearLive()}
  function forget(){disconnect();state.device=null;const s=settings();s.bluetoothPrinterId='';s.bluetoothPrinterName='';s.bluetoothServiceUuid='';s.bluetoothCharacteristicUuid='';try{localStorage.removeItem(META_KEY)}catch(_){}A.saveDB?.(true,{fromSync:true});emit()}
  const money=v=>`${(Number(v)||0).toFixed(2)} ₪`;
  function wrap(ctx,text,maxWidth){
    const words=String(text||'').split(/\s+/).filter(Boolean),out=[];let line='';
    for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width<=maxWidth||!line)line=next;else{out.push(line);line=word}}
    if(line)out.push(line);return out.length?out:[''];
  }
  async function loadLogo(){
    const preferred=String(A.systemLogoSrc?.()||'brand-logo.png'),sources=[preferred];if(preferred!=='brand-logo.png')sources.push('brand-logo.png');
    for(const src of sources)try{const img=new Image();if(/^https?:/i.test(src))img.crossOrigin='anonymous';img.src=src;if(img.decode)await img.decode();else await new Promise((res,rej)=>{img.onload=res;img.onerror=rej});return img}catch(_){}
    return null
  }
  async function receiptCanvas(sale){
    const st=settings(),width=st.printSize==='58'?384:576,pad=st.printSize==='58'?12:16,inner=width-pad*2,scale=st.printSize==='58'?.95:1.16;
    const font=(size,weight=700)=>`${weight} ${Math.max(10,Math.round(size*scale))}px Arial, Tahoma, sans-serif`;
    const probe=document.createElement('canvas').getContext('2d');probe.font=font(18,700);
    const nameWidth=inner*(st.showInvoiceUnitColumn!==false?.30:(st.showInvoiceItemNumber!==false?.35:.40));let rowsHeight=0;for(const l of sale.lines||[]){rowsHeight+=Math.max(1,wrap(probe,l.productName,nameWidth).length)*Math.round(25*scale)+Math.round(12*scale)}
    const visibleMeta=(st.showInvoiceEmployee!==false||st.showInvoiceOrderType!==false||st.showInvoiceCustomer!==false||st.showInvoiceBranch!==false),visibleSummary=[st.showInvoiceQuantityTotal!==false,st.showInvoiceSubtotal!==false,st.showInvoiceDiscount!==false,st.showInvoiceTax!==false&&Number(sale.tax||0)!==0,st.showInvoicePaid!==false,st.showInvoiceDue!==false].filter(Boolean).length;
    const estimate=180+rowsHeight+visibleSummary*Math.round(27*scale)+(st.showInvoiceNetAmount!==false?62:0)+(st.showInvoiceMessage!==false&&D().company.invoiceNote?52:0)+(st.showInvoiceFooterTime!==false||st.showInvoiceFooterNumber!==false?38:0)+(st.showInvoiceLogo!==false?110:0)+(st.showInvoiceStoreName!==false&&D().company.name?45:0)+(st.showInvoiceBarcode===true?90:0);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(420,estimate);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#000';ctx.strokeStyle='#000';ctx.direction='rtl';ctx.textBaseline='middle';let y=Math.round(10*scale);
    const txt=(text,x,cy,size=16,weight=600,align='right')=>{ctx.font=font(size,weight);ctx.textAlign=align;ctx.fillText(String(text??''),x,cy)};
    const hline=(yy,x1=pad,x2=width-pad,lw=1.5)=>{ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x1,yy);ctx.lineTo(x2,yy);ctx.stroke()};
    const rect=(x,yy,w,h,lw=1.5)=>{ctx.lineWidth=lw;ctx.strokeRect(x,yy,w,h)};
    const logo=st.showInvoiceLogo!==false?await loadLogo():null;if(logo){const sizes={small:[110,72],medium:[150,92],large:[195,116]},sz=sizes[st.invoiceLogoSize]||sizes.small,ratio=Math.min(sz[0]/logo.width,sz[1]/logo.height,1),w=logo.width*ratio,h=logo.height*ratio;ctx.drawImage(logo,(width-w)/2,y,w,h);y+=h+Math.round(8*scale)}
    if(st.showInvoiceStoreName!==false&&D().company.name){const rh=Math.round(34*scale);txt(D().company.name,width/2,y+rh/2,19,800,'center');y+=rh+Math.round(4*scale)}
    const employee=st.showInvoiceEmployee!==false?`الموظف : ${sale.userName||'—'}`:'',orderType=st.showInvoiceOrderType!==false?`نوع الطلب : ${sale.tableId?'محلي':(st.invoiceOrderTypeText||'سفري')}`:'',customer=st.showInvoiceCustomer!==false?`العميل : ${sale.customerName||'عميل نقدي'}`:'',branch=st.showInvoiceBranch!==false?`الفرع : ${A.branchName(sale.branchId)||'—'}`:'';
    const metaRows=[[employee,orderType],[customer,branch]].filter(r=>r.some(Boolean));for(const r of metaRows){const rh=Math.round(31*scale);if(r[0])txt(r[0],width-pad,y+rh/2,15,700,'right');if(r[1])txt(r[1],pad,y+rh/2,15,700,'left');y+=rh}
    const cols=[];if(st.showInvoiceItemNumber!==false)cols.push({key:'no',label:'ت',ratio:.10});cols.push({key:'name',label:'اسم المادة',ratio:.34});if(st.showInvoiceUnitColumn!==false)cols.push({key:'unit',label:'الوحدة',ratio:.14});if(st.showInvoiceQtyColumn!==false)cols.push({key:'qty',label:'الكمية',ratio:.14});if(st.showInvoicePriceColumn!==false)cols.push({key:'price',label:'السعر',ratio:.20});if(st.showInvoiceLineTotal!==false)cols.push({key:'total',label:'اجمالي',ratio:.22});const totalRatio=cols.reduce((a,c)=>a+c.ratio,0);cols.forEach(c=>c.w=inner*c.ratio/totalRatio);
    const headerH=Math.round(36*scale);rect(pad,y,inner,headerH);let x=width-pad;for(const c of cols){const next=x-c.w;txt(c.label,(x+next)/2,y+headerH/2,14,700,'center');if(next>pad+.5){ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(next,y);ctx.lineTo(next,y+headerH);ctx.stroke()}x=next}y+=headerH;
    const moneyPlain=v=>(Number(v)||0).toFixed(2);
    for(let i=0;i<(sale.lines||[]).length;i++){const l=sale.lines[i];ctx.font=font(14,700);const nameCol=cols.find(c=>c.key==='name'),nameLines=wrap(ctx,l.productName,Math.max(45,nameCol.w-8));const rowH=Math.max(Math.round(36*scale),nameLines.length*Math.round(22*scale)+Math.round(10*scale));rect(pad,y,inner,rowH);let xx=width-pad;for(const c of cols){const next=xx-c.w;if(next>pad+.5){ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(next,y);ctx.lineTo(next,y+rowH);ctx.stroke()}if(c.key==='name'){const lh=Math.round(22*scale),startY=y+rowH/2-(nameLines.length-1)*lh/2;nameLines.forEach((line,j)=>txt(line,(xx+next)/2,startY+j*lh,14,700,'center'))}else{const val=c.key==='no'?i+1:c.key==='unit'?(l.unitName||'—'):c.key==='qty'?l.qty:c.key==='price'?moneyPlain(l.unitPrice):moneyPlain(l.total);txt(val,(xx+next)/2,y+rowH/2,14,700,'center')}xx=next}y+=rowH}
    const qtyTotal=(sale.lines||[]).reduce((a,l)=>a+Number(l.qty||0),0),summary=[];if(st.showInvoiceQuantityTotal!==false)summary.push(`الكمية : ${qtyTotal}`);if(st.showInvoiceSubtotal!==false)summary.push(`اجمالي المبلغ : ${moneyPlain(sale.subtotal)} ₪`);if(st.showInvoiceTax!==false&&Number(sale.tax||0)!==0)summary.push(`الضريبة : ${moneyPlain(sale.tax)} ₪`);if(st.showInvoiceDiscount!==false)summary.push(`الخصم : ${moneyPlain(sale.discount)} ₪`);if(st.showInvoicePaid!==false)summary.push(`المدفوع : ${moneyPlain(sale.paid)} ₪`);if(st.showInvoiceDue!==false)summary.push(`المتبقي : ${moneyPlain(sale.due)} ₪`);for(let i=0;i<summary.length;i+=2){const rh=Math.round(29*scale);txt(summary[i],width-pad,y+rh/2,14,700,'right');if(summary[i+1])txt(summary[i+1],pad,y+rh/2,14,700,'left');y+=rh}
    if(st.showInvoiceNetAmount!==false){const rh=Math.round(58*scale),half=inner/2;rect(pad,y,inner,rh,2);ctx.beginPath();ctx.moveTo(pad+half,y);ctx.lineTo(pad+half,y+rh);ctx.lineWidth=2;ctx.stroke();txt('المبلغ الصافي :',width-pad-half/2,y+rh/2,21,700,'center');txt(`${moneyPlain(sale.total)} ₪`,pad+half/2,y+rh/2,23,800,'center');y+=rh+Math.round(8*scale)}
    if(st.showInvoiceMessage!==false&&D().company.invoiceNote){ctx.font=font(17,700);const lines=wrap(ctx,D().company.invoiceNote,inner-8),lh=Math.round(24*scale);lines.forEach(line=>{txt(line,width/2,y+lh/2,17,700,'center');y+=lh});y+=Math.round(5*scale)}
    // Optional Code39 remains available from settings, but hidden by default in the new receipt style.
    if(st.showInvoiceBarcode===true){txt(`* ${sale.number} *`,width/2,y+Math.round(14*scale),12,700,'center');y+=Math.round(28*scale)}
    if(st.showInvoiceFooterTime!==false||st.showInvoiceFooterNumber!==false){const dt=new Date(sale.createdAt||sale.updatedAt||Date.now()),dateTime=dt.toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}),rh=Math.round(30*scale);if(st.showInvoiceFooterTime!==false)txt(dateTime,pad,y+rh/2,12,700,'left');if(st.showInvoiceFooterNumber!==false)txt(sale.number,width-pad,y+rh/2,12,700,'right');y+=rh}
    const finalH=Math.min(canvas.height,Math.ceil(y+Math.round(10*scale))),out=document.createElement('canvas');out.width=width;out.height=finalH;out.getContext('2d').drawImage(canvas,0,0,width,finalH,0,0,width,finalH);return out;
  }
  function rasterBytes(canvas){
    const ctx=canvas.getContext('2d'),img=ctx.getImageData(0,0,canvas.width,canvas.height),widthBytes=Math.ceil(canvas.width/8),parts=[new Uint8Array([0x1b,0x40,0x1b,0x61,0x01])],bandRows=192;
    for(let y0=0;y0<canvas.height;y0+=bandRows){const h=Math.min(bandRows,canvas.height-y0),data=new Uint8Array(widthBytes*h);for(let y=0;y<h;y++)for(let xb=0;xb<widthBytes;xb++){let b=0;for(let bit=0;bit<8;bit++){const x=xb*8+bit;if(x>=canvas.width)continue;const i=((y0+y)*canvas.width+x)*4,r=img.data[i],g=img.data[i+1],bl=img.data[i+2],a=img.data[i+3],lum=(.299*r+.587*g+.114*bl)*(a/255)+255*(1-a/255);if(lum<165)b|=(0x80>>bit)}data[y*widthBytes+xb]=b}parts.push(new Uint8Array([0x1d,0x76,0x30,0x00,widthBytes&255,(widthBytes>>8)&255,h&255,(h>>8)&255]),data)}
    parts.push(new Uint8Array([0x0a,0x0a,0x0a,0x1d,0x56,0x00]));const len=parts.reduce((n,x)=>n+x.length,0),out=new Uint8Array(len);let at=0;for(const x of parts){out.set(x,at);at+=x.length}return out;
  }
  async function writePiece(ch,bytes){
    const view=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    if(ch.properties.writeWithoutResponse&&typeof ch.writeValueWithoutResponse==='function')return ch.writeValueWithoutResponse(view);
    if(typeof ch.writeValueWithResponse==='function')return ch.writeValueWithResponse(view);
    return ch.writeValue(view);
  }
  function transientWriteError(e){return /gatt|disconnect|network|not connected|operation|in progress|invalid state|connection|characteristic|device is no longer/i.test(String(e?.message||e||''))}
  async function writeRawNow(input,opts={}){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input||[]);if(!bytes.length)return true;
    let ch=state.characteristic;if(!ch||!state.device?.gatt?.connected){await connectSaved(opts);ch=state.characteristic}if(!ch)throw Error('الطابعة غير متصلة فعلياً.');
    const android=/Android/i.test(navigator.userAgent||'');let pos=0,chunk=Number(readMeta().chunkSize||0)||(android?60:120),reconnects=0,busyRetries=0;chunk=Math.max(20,Math.min(180,chunk));
    while(pos<bytes.length){const part=bytes.subarray(pos,Math.min(bytes.length,pos+chunk));try{await writePiece(ch,part);pos+=part.length;reconnects=0;busyRetries=0;state.lastActivity=Date.now();if(chunk<80&&pos>600)chunk=Math.min(80,chunk+10)}catch(e){const msg=String(e?.message||e||'');if(/operation.*progress|busy/i.test(msg)&&busyRetries<5){busyRetries++;await wait(70*busyRetries);continue}if(chunk>20){chunk=Math.max(20,Math.floor(chunk/2));writeMeta({chunkSize:chunk});await wait(80);continue}if(transientWriteError(e)&&reconnects<4){reconnects++;clearLive();try{state.device?.gatt?.disconnect()}catch(_){}await wait(220*reconnects);await connectSaved(opts);ch=state.characteristic;continue}state.lastError=msg;emit();throw e}await wait(android?12:4);if(pos>0&&pos%1536<chunk)await wait(android?28:10)}
    writeMeta({chunkSize:chunk});await wait(android?180:80);state.lastError='';emit();return true
  }
  function writeRaw(bytes,opts={}){const job=state.writeTail.catch(()=>{}).then(()=>writeRawNow(bytes,opts));state.writeTail=job;return job}
  function readPrintGuard(){try{return JSON.parse(localStorage.getItem(PRINT_GUARD_KEY)||'null')||null}catch(_){return null}}
  function writePrintGuard(saleId){try{localStorage.setItem(PRINT_GUARD_KEY,JSON.stringify({saleId:String(saleId||''),at:Date.now()}))}catch(_){}}
  function recentlyPrinting(saleId){const g=readPrintGuard(),id=String(saleId||'');return !!(state.printing||state.printingSaleId===id||(g&&g.saleId===id&&Date.now()-Number(g.at||0)<PRINT_GUARD_MS))}
  async function printInvoice(sale,opts={}){
    if(!sale)throw Error('الفاتورة غير موجودة.');const s=settings(),force=opts.forceBluetooth===true;
    if(!force&&(s.printerConnection!=='bluetooth'||s.printSize==='a4'||!support())){A.openInvoicePrintOnce?.(sale.id);return true}
    if(recentlyPrinting(sale.id)&&!opts.ignoreGuard)return false;
    state.printing=true;state.printingSaleId=String(sale.id||'');writePrintGuard(sale.id);emit();
    try{await connectSaved(opts);const canvas=await receiptCanvas(sale),bytes=rasterBytes(canvas);await writeRaw(bytes,opts);A.toast?.(`تمت طباعة ${sale.number} على ${state.device?.name||'طابعة البلوتوث'}`,'success');return true}
    catch(e){const msg=String(e?.message||e||'');state.lastError=msg;console.error('Bluetooth print failed',e);A.toast?.('تعذر إرسال الفاتورة للطابعة: '+msg,'error',6000);emit();return false}
    finally{state.printing=false;state.printingSaleId='';emit()}
  }
  function printInvoiceById(id,opts={}){const sale=D()?.sales?.find(x=>x.id===id);return printInvoice(sale,opts)}
  async function printTest(opts={}){await connectSaved(opts);const fake={id:'TEST-'+Date.now(),number:'TEST-PRINT',date:A.today(),customerName:'طباعة تجريبية',userName:A.currentUser?.()?.name||'المستخدم',branchId:A.state.activeBranchId,lines:[{productName:'اختبار الطابعة الحرارية',unitName:'حبة',qty:1,unitPrice:1,total:1}],subtotal:1,discount:0,tax:0,total:1,paid:1,due:0};const canvas=await receiptCanvas(fake);await writeRaw(rasterBytes(canvas),opts);A.toast?.('تم إرسال ورقة الاختبار والطابعة بقيت متصلة.','success');return true}
  function ensureKeepAlive(){if(state.keepAliveTimer)return;state.keepAliveTimer=setInterval(()=>{if(document.hidden||!isBtWanted()||state.manualDisconnect)return;if(!state.device?.gatt?.connected||!state.characteristic)connectSaved().catch(()=>scheduleReconnect())},7000)}
  window.AlMezanBluetoothPrinter={support,status,connect,connectSaved,disconnect,forget,writeRaw,printInvoice,printInvoiceById,printTest,receiptCanvas,rasterBytes};
  for(const ev of ['online','focus'])window.addEventListener(ev,()=>{if(isBtWanted()&&!state.manualDisconnect)connectSaved().catch(()=>scheduleReconnect())});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isBtWanted()&&!state.manualDisconnect)connectSaved().catch(()=>scheduleReconnect())});
  ensureKeepAlive();setTimeout(()=>{if(isBtWanted())connectSaved().catch(()=>scheduleReconnect())},650);
})();

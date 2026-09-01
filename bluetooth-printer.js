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
  const state={device:null,server:null,characteristic:null,connecting:null,printing:false};
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
    const s=settings(),width=s.printSize==='58'?384:576,pad=s.printSize==='58'?18:24,inner=width-pad*2;
    const tmp=document.createElement('canvas'),tctx=tmp.getContext('2d');tctx.font=`600 ${s.printSize==='58'?19:22}px Cairo, Tahoma, Arial`;
    let extra=0;for(const l of sale.lines||[])extra+=Math.max(1,wrap(tctx,l.productName,inner).length)*30+34;
    const height=Math.max(680,500+extra+(D().company.invoiceNote?70:30));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.direction='rtl';let y=18;
    const line=(dash=false)=>{ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.setLineDash(dash?[5,5]:[]);ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();ctx.setLineDash([]);y+=12};
    const center=(text,size=20,weight=600,gap=7)=>{ctx.font=`${weight} ${size}px Cairo, Tahoma, Arial`;ctx.textAlign='center';ctx.fillText(String(text||''),width/2,y+size);y+=size+gap};
    const row=(right,left,size=18,weight=500)=>{ctx.font=`${weight} ${size}px Cairo, Tahoma, Arial`;ctx.textAlign='right';ctx.fillText(String(right||''),width-pad,y+size);ctx.textAlign='left';ctx.fillText(String(left||''),pad,y+size);y+=size+7};
    const logo=await loadLogo();if(settings().showInvoiceLogo!==false&&logo){const maxW=s.printSize==='58'?105:135,maxH=s.printSize==='58'?72:86,ratio=Math.min(maxW/logo.width,maxH/logo.height,1),w=logo.width*ratio,h=logo.height*ratio;ctx.drawImage(logo,(width-w)/2,y,w,h);y+=h+8}
    center(D().company.name,s.printSize==='58'?22:25,700,4);if(D().company.legalName)center(D().company.legalName,14,500,3);if(D().company.phone||D().company.address)center([D().company.phone,D().company.address].filter(Boolean).join(' • '),13,400,3);if(D().company.taxNumber)center(`الرقم الضريبي: ${D().company.taxNumber}`,12,400,5);line(true);
    center('فاتورة مبيعات',18,700,3);center(sale.number,15,600,6);line(true);
    row(`التاريخ: ${A.dateFmt(sale.date)}`,`الكاشير: ${sale.userName||'—'}`,14,500);row(`العميل: ${sale.customerName||'عميل نقدي'}`,`الفرع: ${A.branchName(sale.branchId)}`,14,500);line();
    row('الصنف / الكمية والسعر','الإجمالي',14,700);line(true);
    let idx=0;for(const l of sale.lines||[]){idx++;ctx.font=`600 ${s.printSize==='58'?16:18}px Cairo, Tahoma, Arial`;ctx.textAlign='right';const names=wrap(ctx,`${idx}. ${l.productName}`,inner);for(const name of names){ctx.fillText(name,width-pad,y+18);y+=25}row(`${l.qty} ${l.unitName||''} × ${money(l.unitPrice)}`,money(l.total),14,500);y+=2}
    line();row('المجموع',money(sale.subtotal),15,500);if(Number(sale.discount))row('الخصم',money(sale.discount),15,500);if(Number(sale.tax))row('الضريبة',money(sale.tax),15,500);line();row('الإجمالي',money(sale.total),21,700);row('المدفوع',money(sale.paid),16,600);row('المتبقي',money(sale.due),16,600);line(true);
    if(D().company.invoiceNote)center(D().company.invoiceNote,14,500,5);center('الميزان برو للمحاسبة ونقاط البيع',11,400,4);center(new Date().toLocaleString('ar-EG'),10,400,6);
    const finalH=Math.min(canvas.height,Math.ceil(y+25)),out=document.createElement('canvas');out.width=width;out.height=finalH;out.getContext('2d').drawImage(canvas,0,0,width,finalH,0,0,width,finalH);return out;
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
  async function printInvoice(sale){
    if(!sale)throw new Error('الفاتورة غير موجودة.');const s=settings();if(s.printSize==='a4'||s.printerConnection!=='bluetooth'){window.open(`./index.html?v=739#print-invoice/${sale.id}`,'_blank');return false}
    if(!support()){A.toast?.('الطباعة بالبلوتوث غير مدعومة في هذا المتصفح؛ سيتم فتح الطباعة العادية.','warning',5000);window.open(`./index.html?v=739#print-invoice/${sale.id}`,'_blank');return false}
    state.printing=true;emit();try{if(!state.characteristic||!state.device?.gatt?.connected)await connectSaved();const canvas=await receiptCanvas(sale),bytes=rasterBytes(canvas);await writeBytes(bytes);A.toast?.(`تمت طباعة ${sale.number} على ${state.device?.name||'طابعة البلوتوث'}`,'success');return true}catch(e){console.error(e);A.toast?.(`${e.message||e} — تم فتح الطباعة العادية كبديل.`,'warning',6000);window.open(`./index.html?v=739#print-invoice/${sale.id}`,'_blank');return false}finally{state.printing=false;emit()}
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

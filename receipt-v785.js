(()=>{const A=window.AlMezan;
window.MezanLogoSource=(c=A.db.company||{})=>{const source=window.AlMezanBrandImages?.src?.('logo',c)||c.logoTelegramUrl||c.logoDataUrl||c.logoUrl||c.logo||'';try{const url=new URL(source,location.href);return /^(https?:|data:|blob:)$/.test(url.protocol)?url.href:''}catch{return ''}};
window.MezanLoadLogo=async(c=A.db.company||{})=>{await window.AlMezanBrandImages?.hydrate?.();const src=window.MezanLogoSource(c);if(!src)return null;return new Promise(resolve=>{const im=new Image();const timer=setTimeout(()=>resolve(null),5000);im.crossOrigin='anonymous';im.onload=()=>{clearTimeout(timer);resolve(im)};im.onerror=()=>{clearTimeout(timer);resolve(null)};im.src=src})};
function documentData(s){const c=A.db.company||{},p=A.db.customers.find(x=>x.id===s.customerId)||{};return {company:c.name||'الميزان',logo:window.MezanLogoSource(c),address:c.address,phone:c.phone,taxNumber:c.taxNumber,number:s.number,dateTime:A.dateFmt(s.date,true),customer:s.customerName||p.name||'عميل نقدي',customerPhone:p.phone,currency:A.db.settings.currency,lines:(s.lines||[]).map(l=>({name:l.productName,unit:l.unitName,qty:l.qty,total:l.total})),subtotal:A.num(s.total)+A.num(s.discount),discount:A.num(s.discount),grandTotal:A.num(s.total),remaining:A.num(s.due),note:s.notes||'',invoiceTitle:s.status==='returned'?'فاتورة مرتجع':''}}
 window.MezanReceiptData=documentData;window.MezanReceiptCanvas=async function(d,width=576,paper='80'){
  
  const data=documentData(d),narrow=String(paper)==='58'||(width<=384),paperWidth=width;
  if(document.fonts?.ready)await Promise.all([document.fonts.load('900 20px Cairo'),document.fonts.load('700 20px Cairo')]);
  const pixelScale=width/(narrow?384:576),base=narrow?384:576,ops=[],probe=document.createElement('canvas').getContext('2d');
  let y=10;
  const textFont=(size,bold=true)=>`${bold?'900':'700'} ${size}px W47Cairo, Cairo, sans-serif`;
  function wrap(value,max,size,bold=true){probe.font=textFont(size,bold);const result=[],words=String(value??'').split(/\s+/).filter(Boolean);let row='';
   for(const word of words){const next=row?row+' '+word:word;if(row&&probe.measureText(next).width>max){result.push(row);row=word}else row=next}
   if(row)result.push(row);
   return result.length?result:[''];}
  function txt(value,x,size=20,align='center',bold=true,rowHeight=size+5,max=base-28){const lines=wrap(value,max,size,bold);for(const line of lines){ops.push({t:'text',value:line,x,y,size,align,bold});y+=rowHeight}}
  function ruler(heavy=false){ops.push({t:'rule',y,heavy});y+=heavy?8:7}
  const logo=await window.MezanLoadLogo();
  if(logo){const ratio=logo.naturalWidth/logo.naturalHeight,h=Math.min(90,130/ratio),w=h*ratio;ops.push({t:'image',image:logo,x:(base-w)/2,y,w,h});y+=h+8}
  txt(data.company,base/2,narrow?27:33,'center',true,35);
  if(data.address)txt(data.address,base/2,narrow?17:20,'center',true,24);
  if(data.phone)txt('جوال: '+data.phone,base/2,narrow?17:20,'center',true,24);
  if(data.taxNumber)txt('الرقم الضريبي: '+data.taxNumber,base/2,16,'center',true,22);
  if(data.invoiceTitle)txt(data.invoiceTitle,base/2,20,'center',true,25);
  y+=5;
  function double(right,left,size=16){ops.push({t:'text',value:String(right),x:base-10,y,size,align:'right',bold:true});ops.push({t:'text',value:String(left),x:10,y,size,align:'left',bold:true});y+=size+9}
  double('رقم الفاتورة: #'+data.number,data.dateTime,narrow?16:19);
  txt((data.isPurchase?'المورد: ':'العميل: ')+data.customer,base-12,narrow?18:20,'right',true,25,base-26);
  if(data.customerPhone)txt('الهاتف: '+data.customerPhone,base-12,16,'right',true,21);
  y+=3;ruler(true);
  // Percentage columns exactly as the supplied HTML: 8 / 44 / 12 / 16 / 20.
  const col=[.08,.44,.12,.16,.20],cum=[];let s=0;for(const w of col){cum.push(s+w/2);s+=w}
  const xc=cum.map(r=>(1-r)*base),headers=['#','الصنف','الوحدة','الكمية','الإجمالي'];
  for(let i=0;i<headers.length;i++)ops.push({t:'text',value:headers[i],x:xc[i],y,size:narrow?14:18,align:'center',bold:true});
  y+=(narrow?25:29);ruler(true);
  const font=narrow?15:18,lh=narrow?22:26;
  for(let i=0;i<data.lines.length;i++){
   const l=data.lines[i],names=wrap(l.name,base*.41,font,true),units=wrap(l.unit,base*.11,font,true),tall=Math.max(names.length,units.length,1);
   ops.push({t:'text',value:String(i+1),x:xc[0],y,size:font,align:'center',bold:true});
   names.forEach((v,j)=>ops.push({t:'text',value:v,x:base*(1-.08)-2,y:y+j*lh,size:font,align:'right',bold:true}));
   units.forEach((v,j)=>ops.push({t:'text',value:v,x:xc[2],y:y+j*lh,size:font,align:'center',bold:true}));
   ops.push({t:'text',value:String(l.qty),x:xc[3],y,size:font,align:'center',bold:true});
   ops.push({t:'text',value:W47Thermal.money(l.total),x:8,y,size:font,align:'left',bold:true});
   y+=tall*lh+5;ops.push({t:'rule',y,heavy:false});y+=6;
  }
  y+=3;
  const gap=4,half=(base-20-gap)/2,start=10,boxH=narrow?31:37;
  function twoBoxes(a,b,blackFirst=false){ops.push({t:'box',x:start+half+gap,y,w:half,h:boxH,label:a[0],val:W47Thermal.money(a[1]),black:blackFirst});ops.push({t:'box',x:start,y,w:half,h:boxH,label:b[0],val:W47Thermal.money(b[1]),black:false});y+=boxH+4}
  twoBoxes(['الإجمالي:',data.subtotal],['الخصم:',data.discount]);
  twoBoxes(['النهائي:',data.grandTotal],['المتبقي:',data.remaining],true);
  if(data.note)txt(data.note,base/2,narrow?15:18,'center',true,21);
  y+=3;ruler();txt('برنامج الميزان المحاسبي',base/2,narrow?18:22,'center',true,narrow?25:28);
  const codeType=A.db.settings.thermalCode||'barcode';
  if(codeType!=='none'){const svg=codeType==='qrcode'?W47Thermal.qrSVG(`INV:${data.number}|TOTAL:${data.grandTotal.toFixed(2)}|TEL:0597603119`):W47Thermal.barcodeSVG(data.number);
   if(svg){try{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();const cw=codeType==='qrcode'?(narrow?65:85):Math.min(base-22,Math.max(90,img.naturalWidth*1.5)),ch=codeType==='qrcode'?cw:35;ops.push({t:'code',image:img,x:(base-cw)/2,y,w:cw,h:ch});y+=ch+5}catch(e){console.warn('Code image',e)}}}
  y+=7;
  const canvas=document.createElement('canvas');canvas.width=paperWidth;canvas.height=Math.ceil(y*pixelScale);const ctx=canvas.getContext('2d',{alpha:false});ctx.setTransform(pixelScale,0,0,pixelScale,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,base,y);ctx.textBaseline='top';ctx.direction='rtl';
  for(const o of ops){ctx.fillStyle='#000';ctx.strokeStyle='#000';
   if(o.t==='text'){ctx.font=textFont(o.size,o.bold);ctx.textAlign=o.align;ctx.fillText(o.value,o.x,o.y)}
   else if(o.t==='rule'){ctx.lineWidth=o.heavy?2.4:1;ctx.setLineDash(o.heavy?[]:[3,3]);ctx.beginPath();ctx.moveTo(8,o.y);ctx.lineTo(base-8,o.y);ctx.stroke();ctx.setLineDash([])}
   else if(o.t==='image'||o.t==='code'){try{ctx.drawImage(o.image,o.x,o.y,o.w,o.h)}catch{}}
   else if(o.t==='box'){ctx.fillStyle=o.black?'#000':'#fff';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.strokeStyle='#000';ctx.lineWidth=o.black?2.4:1.4;ctx.strokeRect(o.x,o.y,o.w,o.h);
    const size=narrow?16:20;ctx.font=textFont(size,true);ctx.textAlign='right';ctx.fillStyle=o.black?'#fff':'#000';ctx.fillText(o.label,o.x+o.w-5,o.y+(o.h-size)/2);ctx.textAlign='left';ctx.fillText(o.val,o.x+5,o.y+(o.h-size)/2)}
  }
  return canvas;
 };
})();
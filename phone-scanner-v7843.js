/* Al-Meezan Phone Barcode Scanner v7.84.3 — fixed 6-digit link */
(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const CODE_KEY='almezan_phone_scanner_6digit_v7843';
const PEER_OPTIONS={
  host:'0.peerjs.com',
  port:443,
  path:'/',
  secure:true,
  debug:0,
  config:{
    iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun1.l.google.com:19302'},
      {urls:'stun:stun2.l.google.com:19302'}
    ],
    sdpSemantics:'unified-plan'
  }
};
let peer=null,conn=null,connected=false,connecting=false,reconnectTimer=0,manualStop=false,generation=0;
let stream=null,detector=null,scanTimer=0,lastCode='',lastAt=0,busy=false,torch=false,imageBusy=false;
const codeInput=$('#pairCode'),connectBtn=$('#connectBtn'),disconnectBtn=$('#disconnectBtn');
const linkStatus=$('#linkStatus'),linkStatusText=$('#linkStatusText');
const video=$('#scannerVideo'),startBtn=$('#startScannerBtn'),stopBtn=$('#stopScannerBtn'),torchBtn=$('#torchBtn');
const imageBtn=$('#imageBarcodeBtn'),imageInput=$('#barcodeImageInput'),resultBox=$('#scanResult'),sound=$('#barcodeSound');

function normalizeCode(v){return String(v||'').replace(/\D/g,'').slice(0,6)}
function readCode(){try{return normalizeCode(localStorage.getItem(CODE_KEY)||'')}catch(_){return''}}
function saveCode(v){try{localStorage.setItem(CODE_KEY,normalizeCode(v))}catch(_){}}
function setStatus(kind,text){
  if(linkStatus)linkStatus.className='scanner-link-status'+(kind?' '+kind:'');
  if(linkStatusText)linkStatusText.textContent=text||'';
  if(connectBtn)connectBtn.disabled=connecting;
  if(disconnectBtn)disconnectBtn.hidden=!(connected||connecting||conn||peer);
}
function showResult(ok,title,sub=''){
  if(!resultBox)return;
  resultBox.className='scan-result '+(ok?'ok':'bad');
  resultBox.innerHTML=`<b>${escapeHtml(title||'')}</b>${sub?`<small>${escapeHtml(sub)}</small>`:''}`;
  resultBox.hidden=false;
  clearTimeout(showResult._t);
  showResult._t=setTimeout(()=>{resultBox.hidden=true},2600);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function playScanSound(){
  try{sound.currentTime=0;const p=sound.play();if(p?.catch)p.catch(()=>{})}catch(_){}
  try{navigator.vibrate?.(35)}catch(_){}
}
function errorTone(){try{navigator.vibrate?.([40,45,40])}catch(_){}}
function newMsgId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,9)}
function loadPeerJs(){
  if(window.Peer)return Promise.resolve(window.Peer);
  if(window.__almezanScannerPeerLoading)return window.__almezanScannerPeerLoading;
  window.__almezanScannerPeerLoading=(async()=>{
    let last;
    for(const src of ['https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js','https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js']){
      try{
        await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
        if(window.Peer)return window.Peer;
      }catch(e){last=e}
    }
    throw last||Error('تعذر تحميل محرك الربط');
  })().finally(()=>window.__almezanScannerPeerLoading=null);
  return window.__almezanScannerPeerLoading;
}
function cleanupConnection(keepManual=true){
  clearTimeout(reconnectTimer);
  try{conn?.close?.()}catch(_){}
  try{peer?.destroy?.()}catch(_){}
  conn=null;peer=null;connected=false;connecting=false;
  if(!keepManual)manualStop=false;
}
function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  if(manualStop)return;
  const code=normalizeCode(codeInput?.value||readCode());
  if(!/^\d{6}$/.test(code))return;
  reconnectTimer=setTimeout(()=>connect(code,true).catch(()=>{}),2200);
}
function onRemoteData(msg){
  if(msg?.type==='paired'){
    connected=true;connecting=false;manualStop=false;
    setStatus('connected','تم الاتصال بالكاشير');
    showResult(true,'تم الربط بنجاح');
    playScanSound();
    startProductScanner().catch(()=>{});
    return;
  }
  if(msg?.type==='auth-error'){
    connected=false;connecting=false;
    setStatus('error',msg.message||'كود الربط غير صحيح');
    showResult(false,'فشل الربط',msg.message||'كود الربط غير صحيح');
    errorTone();return;
  }
  if(msg?.type==='scan-result'){
    busy=false;
    if(msg.ok)showResult(true,msg.productName||'تمت إضافة الصنف',msg.unitName?`${msg.code} — ${msg.unitName}`:msg.code);
    else{showResult(false,msg.message||'تعذر إضافة الباركود',msg.code||'');errorTone()}
  }
}
async function connect(raw,auto=false){
  const code=normalizeCode(raw);
  if(codeInput)codeInput.value=code;
  if(!/^\d{6}$/.test(code)){
    setStatus('error','اكتب 6 أرقام بالضبط');
    if(!auto)showResult(false,'الكود غير صحيح','اكتب 6 أرقام بالضبط');
    return false;
  }
  saveCode(code);manualStop=false;const myGen=++generation;cleanupConnection(true);connecting=true;
  setStatus('connecting','جاري الاتصال...');
  const Peer=await loadPeerJs();
  peer=new Peer(undefined,PEER_OPTIONS);
  peer.on('error',err=>{
    if(myGen!==generation)return;
    const type=String(err?.type||'');
    connected=false;connecting=false;
    const msg=type==='peer-unavailable'?'لم يتم العثور على الكاشير بهذا الكود':String(err?.message||type||'تعذر الاتصال');
    setStatus('error',msg);
    if(!auto)showResult(false,'تعذر الربط',msg);
    scheduleReconnect();
  });
  peer.on('disconnected',()=>{if(myGen!==generation)return;connected=false;connecting=false;setStatus('connecting','انقطع الاتصال — إعادة محاولة...');scheduleReconnect()});
  await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(Error('انتهت مهلة الاتصال')),10000);
    peer.once('open',()=>{clearTimeout(t);resolve()});
    peer.once('error',e=>{if(e?.type!=='peer-unavailable'){clearTimeout(t);reject(e)}});
  });
  const target='sixlink-'+code;
  conn=peer.connect(target,{reliable:true,serialization:'json',metadata:{room:code,v:2,kind:'almezan-phone-scanner'}});
  conn.on('open',()=>{
    if(myGen!==generation)return;
    connecting=false;setStatus('connecting','تم العثور على الكاشير — جاري التحقق...');
    try{conn.send({type:'hello',code,room:code,device:navigator.userAgent.slice(0,120),at:Date.now()})}catch(_){}
  });
  conn.on('data',msg=>{if(myGen===generation)onRemoteData(msg)});
  conn.on('close',()=>{
    if(myGen!==generation)return;
    connected=false;connecting=false;
    setStatus('connecting','انقطع الاتصال — إعادة محاولة...');
    scheduleReconnect();
  });
  conn.on('error',err=>{
    if(myGen!==generation)return;
    connected=false;connecting=false;
    setStatus('error',String(err?.message||'خطأ اتصال'));
    scheduleReconnect();
  });
  return true;
}
function disconnect(){
  manualStop=true;++generation;cleanupConnection(true);setStatus('','غير متصل');stopCamera();
}
async function sendBarcode(raw,source){
  raw=String(raw||'').trim();
  if(!raw)return false;
  if(!connected||!conn?.open){showResult(false,'القارئ غير متصل بالكاشير');errorTone();return false}
  if(busy)return false;
  busy=true;
  try{conn.send({type:'barcode',id:newMsgId(),code:raw,source,at:Date.now()});return true}
  catch(e){busy=false;showResult(false,'تعذر إرسال الباركود');errorTone();return false}
  finally{setTimeout(()=>{busy=false},1800)}
}
async function supportedFormats(){if(!('BarcodeDetector'in window))return[];try{return await BarcodeDetector.getSupportedFormats()}catch(_){return[]}}
async function makeDetector(){
  if(!('BarcodeDetector'in window))throw Error('قراءة الباركود غير مدعومة في هذا المتصفح');
  const formats=await supportedFormats(),wanted=['ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','data_matrix','qr_code'];
  const use=wanted.filter(x=>!formats.length||formats.includes(x));
  try{return use.length?new BarcodeDetector({formats:use}):new BarcodeDetector()}catch(_){return new BarcodeDetector()}
}
async function openCamera(){
  if(!connected)throw Error('اربط القارئ بالكاشير أولاً');
  if(!window.isSecureContext&&location.hostname!=='localhost')throw Error('الكاميرا تحتاج HTTPS');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('الكاميرا غير مدعومة');
  await stopCamera();detector=await makeDetector();
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  video.srcObject=stream;await video.play();document.body.classList.add('camera-active');
  startBtn.hidden=true;stopBtn.hidden=false;
  const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()||{};
  torchBtn.hidden=!caps.torch;scanLoop();
}
async function stopCamera(){
  clearTimeout(scanTimer);scanTimer=0;
  try{stream?.getTracks?.().forEach(t=>t.stop())}catch(_){}
  stream=null;if(video)video.srcObject=null;document.body.classList.remove('camera-active');
  if(startBtn)startBtn.hidden=false;if(stopBtn)stopBtn.hidden=true;if(torchBtn)torchBtn.hidden=true;torch=false;
}
async function handleDetected(raw,force=false){
  raw=String(raw||'').trim();if(!raw)return false;
  const now=Date.now();if(!force&&raw===lastCode&&now-lastAt<900)return false;
  lastCode=raw;lastAt=now;playScanSound();
  return sendBarcode(raw,force?'image':'camera');
}
async function scanLoop(){
  if(!stream||!detector)return;
  try{const codes=await detector.detect(video);if(codes?.length)await handleDetected(codes[0].rawValue,false)}catch(_){}
  finally{if(stream)scanTimer=setTimeout(scanLoop,120)}
}
function imageToCanvas(file,maxSide=2400){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      try{
        const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height)),
        w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)),h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale)),
        c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);resolve(c);
      }catch(e){URL.revokeObjectURL(url);reject(e)}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('تعذر فتح الصورة'))};img.src=url;
  });
}
function rotatedCanvas(src,deg){
  const swap=deg%180!==0,c=document.createElement('canvas');c.width=swap?src.height:src.width;c.height=swap?src.width:src.height;
  const x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate(deg*Math.PI/180);x.drawImage(src,-src.width/2,-src.height/2);return c;
}
async function decodeImage(file){
  const d=await makeDetector(),base=await imageToCanvas(file),tries=[base,rotatedCanvas(base,90),rotatedCanvas(base,180),rotatedCanvas(base,270)];
  for(const source of tries){try{const found=await d.detect(source);if(found?.length)return String(found[0].rawValue||'').trim()}catch(_){}}
  return'';
}
async function scanImageFile(file){
  if(!file||imageBusy)return;if(!connected){showResult(false,'اربط القارئ بالكاشير أولاً');return}
  imageBusy=true;if(imageBtn)imageBtn.disabled=true;
  try{
    await stopCamera();showResult(true,'جاري قراءة الصورة...');
    const raw=await decodeImage(file);
    if(!raw){showResult(false,'لم يتم العثور على باركود واضح');errorTone();return}
    await handleDetected(raw,true);
  }catch(e){showResult(false,'تعذر قراءة الصورة',e?.message||'');errorTone()}
  finally{imageBusy=false;if(imageBtn)imageBtn.disabled=false;if(imageInput)imageInput.value=''}
}
async function startProductScanner(){return openCamera()}

codeInput?.addEventListener('input',()=>{codeInput.value=normalizeCode(codeInput.value)});
codeInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();connect(codeInput.value).catch(err=>showResult(false,'تعذر الربط',err?.message||''))}});
connectBtn?.addEventListener('click',()=>connect(codeInput.value).catch(err=>{setStatus('error','تعذر الاتصال');showResult(false,'تعذر الربط',err?.message||'');errorTone()}));
disconnectBtn?.addEventListener('click',disconnect);
startBtn?.addEventListener('click',()=>startProductScanner().catch(e=>showResult(false,'تعذر تشغيل الماسح',e.message)));
stopBtn?.addEventListener('click',stopCamera);
torchBtn?.addEventListener('click',async()=>{
  try{const track=stream?.getVideoTracks?.()[0];if(!track)return;torch=!torch;await track.applyConstraints({advanced:[{torch}]});torchBtn.classList.toggle('active',torch)}
  catch(_){showResult(false,'الفلاش غير مدعوم')}
});
imageBtn?.addEventListener('click',()=>imageInput?.click());
imageInput?.addEventListener('change',()=>scanImageFile(imageInput.files?.[0]));
window.addEventListener('online',()=>{if(!manualStop){const c=normalizeCode(codeInput?.value||readCode());if(/^\d{6}$/.test(c))connect(c,true).catch(()=>{})}});
window.addEventListener('beforeunload',()=>{manualStop=true;++generation;cleanupConnection(true);stopCamera()});

const saved=readCode();if(codeInput)codeInput.value=saved;
if(saved){setStatus('','جاهز للاتصال');setTimeout(()=>connect(saved,true).catch(()=>{}),500)}else setStatus('','اكتب كود الكاشير');
})();

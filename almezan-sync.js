/* Al-Meezan Offline Sync v1
 * Local-first UI, durable browser storage, record-level Turso synchronization,
 * tombstones for deletes, last-write-wins per record, and a compact pending queue.
 */
(() => {
  'use strict';
  const META_PREFIX='almezan_sync_meta_v1::';
  const PENDING_PREFIX='almezan_sync_pending_v1::';
  const DEVICE_KEY='almezan_device_id_v1';
  const IDB_NAME='almezan_offline_v1',IDB_STORE='tenants';
  let initializedTenant='', snapshot=null, busy=false, suppress=false, timer=null;
  const safe=v=>String(v??'').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const runtime=()=>window.AlMezanActivation?.readRuntime?.()||null;
  const tenant=()=>safe(runtime()?.companyId||runtime()?.tenantId);
  const dbCfg=()=>window.AlMezanActivation?.readDatabaseAccess?.(tenant())||runtime()?.database||null;
  const basePath=()=>`almezan/companies/${encodeURIComponent(tenant())}/d`;
  function deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=(crypto.randomUUID?crypto.randomUUID():`DEV-${Date.now()}-${Math.random().toString(36).slice(2)}`);localStorage.setItem(DEVICE_KEY,id)}return id}
  function hashText(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  const stableJson=v=>JSON.stringify(v);
  function recordKey(dataset,row,index=0){
    if(row&&typeof row==='object'){
      if(row.id!=null&&String(row.id)!=='')return String(row.id);
      if(dataset==='stock'&&row.productId&&row.warehouseId)return `${row.productId}::${row.warehouseId}`;
      if(dataset==='itemPrices')return `${row.productId||''}::${row.unitId||''}::${row.priceGroupId||''}`;
      if(dataset==='exchangeRates')return `${row.currencyId||''}::${row.date||''}`;
      if(row.code!=null&&String(row.code)!=='')return `code:${row.code}`;
      if(row.number!=null&&String(row.number)!=='')return `number:${row.number}`;
    }
    return `_h_${hashText(stableJson(row))}_${index}`;
  }
  function snapshotDb(db){
    const out={};
    for(const [dataset,value] of Object.entries(db||{})){
      if(Array.isArray(value)){
        const map={};value.forEach((row,i)=>{const key=recordKey(dataset,row,i);map[key]=hashText(stableJson(row))});out[dataset]={kind:'array',map};
      }else out[dataset]={kind:'value',map:{__value__:hashText(stableJson(value))}};
    }
    return out;
  }
  function metaKey(t=tenant()){return META_PREFIX+encodeURIComponent(t||'none')}
  function pendingKey(t=tenant()){return PENDING_PREFIX+encodeURIComponent(t||'none')}
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}}
  function readMeta(){return readJson(metaKey(),{records:{},lastPullAt:0,lastPushAt:0,lastSuccessAt:0})}
  function writeMeta(m){try{localStorage.setItem(metaKey(),JSON.stringify(m))}catch(_){}}
  function readPending(){return readJson(pendingKey(),{})}
  function writePending(p){try{localStorage.setItem(pendingKey(),JSON.stringify(p))}catch(_){}emitStatus()}
  function pkey(dataset,key){return dataset+'\u0001'+key}
  function revNow(){return Date.now()*1000+Math.floor(Math.random()*900)}
  function enqueue(dataset,key,deleted=false,rev=revNow()){
    if(!tenant())return;const p=readPending(),pk=pkey(dataset,key),cur=p[pk];if(!cur||Number(cur.rev||0)<=rev)p[pk]={dataset,key,deleted:!!deleted,rev,deviceId:deviceId()};writePending(p);
    const m=readMeta();m.records[pk]={...(m.records[pk]||{}),rev,deleted:!!deleted};writeMeta(m);
  }
  function pendingCount(){return Object.keys(readPending()).length}
  function emitStatus(extra={}){window.dispatchEvent(new CustomEvent('almezan:sync-status',{detail:{pending:pendingCount(),online:navigator.onLine!==false,busy,...extra}}))}

  function getRecord(db,dataset,key){const value=db?.[dataset];if(Array.isArray(value)){for(let i=0;i<value.length;i++)if(recordKey(dataset,value[i],i)===key)return value[i];return undefined}return key==='__value__'?value:undefined}
  function applyRecord(db,dataset,key,value,deleted){
    if(key==='__value__'){if(deleted)delete db[dataset];else db[dataset]=clone(value);return}
    if(!Array.isArray(db[dataset]))db[dataset]=[];const arr=db[dataset],idx=arr.findIndex((row,i)=>recordKey(dataset,row,i)===key);
    if(deleted){if(idx>=0)arr.splice(idx,1)}else if(idx>=0)arr[idx]=clone(value);else arr.push(clone(value));
  }

  function capture(db){
    if(suppress||!tenant())return;
    const next=snapshotDb(db);
    if(!snapshot){snapshot=next;mirrorDb(db).catch(()=>{});return}
    const datasets=new Set([...Object.keys(snapshot),...Object.keys(next)]);
    for(const dataset of datasets){
      const oldEntry=snapshot[dataset]||{kind:'value',map:{}},newEntry=next[dataset]||{kind:oldEntry.kind,map:{}},keys=new Set([...Object.keys(oldEntry.map||{}),...Object.keys(newEntry.map||{})]);
      for(const key of keys){const a=oldEntry.map?.[key],b=newEntry.map?.[key];if(a===b)continue;enqueue(dataset,key,b===undefined)}
    }
    snapshot=next;mirrorDb(db).catch(()=>{});schedule(550);
  }

  function seedAll(db){
    const next=snapshotDb(db);snapshot=next;
    for(const [dataset,entry] of Object.entries(next))for(const key of Object.keys(entry.map||{}))enqueue(dataset,key,false);
    mirrorDb(db).catch(()=>{});schedule(50);
  }

  function openIdb(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return resolve(null);const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE,{keyPath:'tenantId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function mirrorDb(db){const t=tenant();if(!t)return;const idb=await openIdb();if(!idb)return;await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put({tenantId:t,db:clone(db),savedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});idb.close()}
  async function readMirror(t=tenant()){if(!t)return null;const idb=await openIdb();if(!idb)return null;const result=await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly'),req=tx.objectStore(IDB_STORE).get(t);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});idb.close();return result}

  function cloudPath(dataset,key){return `${basePath()}/${encodeURIComponent(dataset)}/${encodeURIComponent(key)}`}
  function parseCloudPath(path){const prefix=basePath()+'/';if(!String(path).startsWith(prefix))return null;const rel=String(path).slice(prefix.length),parts=rel.split('/');if(parts.length<2)return null;try{return{dataset:decodeURIComponent(parts[0]),key:decodeURIComponent(parts.slice(1).join('/'))}}catch(_){return null}}
  function tursoRows(result){const names=(result?.cols||[]).map(c=>c.name);return(result?.rows||[]).map(row=>Object.fromEntries(row.map((c,i)=>{let v=c?.value;if(c?.type==='integer'||c?.type==='float')v=Number(v);if(c?.type==='null')v=null;return[names[i],v]})))}

  async function pushPending(){
    const cfg=dbCfg(),direct=window.AlMezanActivation?.tursoDirect;if(!cfg?.databaseURL||!cfg?.authToken||!direct)throw new Error('بيانات المزامنة غير متاحة.');await direct.ensure(cfg);
    const pending=readPending(),entries=Object.entries(pending);if(!entries.length)return{uploaded:0,remaining:0};const appDb=window.AlMezan?.db||{},table=direct.table(cfg);let uploaded=0;
    for(let offset=0;offset<entries.length;offset+=45){const batch=entries.slice(offset,offset+45),statements=[];
      for(const[,op]of batch){const current=getRecord(appDb,op.dataset,op.key),deleted=op.deleted||current===undefined,envelope={v:deleted?null:current,deleted,rev:op.rev,deviceId:op.deviceId||deviceId()};statements.push({sql:`INSERT INTO ${table}(path,payload,deleted,updated_at) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at WHERE excluded.updated_at >= ${table}.updated_at`,args:[cloudPath(op.dataset,op.key),JSON.stringify(envelope),deleted?1:0,Number(op.rev)]})}
      await direct.pipeline(cfg,statements,Math.max(30000,batch.length*1600));
      const latest=readPending();for(const[pk,op]of batch){if(Number(latest[pk]?.rev||0)===Number(op.rev)){delete latest[pk];uploaded++}}writePending(latest);
    }
    const m=readMeta();m.lastPushAt=Date.now();writeMeta(m);return{uploaded,remaining:pendingCount()};
  }

  async function pullAll(){
    const cfg=dbCfg(),direct=window.AlMezanActivation?.tursoDirect;if(!cfg?.databaseURL||!cfg?.authToken||!direct)throw new Error('بيانات المزامنة غير متاحة.');await direct.ensure(cfg);
    const rows=await direct.listPrefix(cfg,basePath()),pending=readPending(),meta=readMeta(),current=clone(window.AlMezan?.db||{});let applied=0,remoteRows=0;
    for(const row of rows){const parsed=parseCloudPath(row.path);if(!parsed)continue;remoteRows++;const pk=pkey(parsed.dataset,parsed.key),remoteRev=Number(row.updated_at||row.payload?.rev||0),localRev=Number(meta.records?.[pk]?.rev||0),localPending=Number(pending[pk]?.rev||0);
      if(localPending>remoteRev||localRev>remoteRev)continue;let envelope=row.payload;if(typeof envelope==='string'){try{envelope=JSON.parse(envelope)}catch(_){envelope=null}}const deleted=Number(row.deleted)===1||envelope?.deleted===true;const value=envelope&&Object.prototype.hasOwnProperty.call(envelope,'v')?envelope.v:envelope;
      applyRecord(current,parsed.dataset,parsed.key,value,deleted);meta.records[pk]={rev:remoteRev,deleted,hash:deleted?'':hashText(stableJson(value))};if(pending[pk]&&localPending<=remoteRev)delete pending[pk];applied++;
    }
    meta.lastPullAt=Date.now();meta.lastSuccessAt=Date.now();writeMeta(meta);writePending(pending);
    if(applied&&window.AlMezan?.replaceDBFromSync){suppress=true;try{window.AlMezan.replaceDBFromSync(current)}finally{suppress=false}snapshot=snapshotDb(window.AlMezan.db);await mirrorDb(window.AlMezan.db).catch(()=>{})}
    return{applied,remoteRows};
  }

  async function syncNow({manual=false,force=false}={}){
    if(busy)return{busy:true,remaining:pendingCount()};if(!tenant())return{unavailable:true,remaining:pendingCount()};if(navigator.onLine===false){emitStatus({state:'offline'});if(manual)window.AlMezan?.toast?.('أنت الآن دون إنترنت. التغييرات محفوظة محلياً وستتم مزامنتها عند عودة الاتصال.','warning');return{offline:true,remaining:pendingCount()}};
    busy=true;emitStatus({state:'syncing'});try{const pushed=await pushPending(),pulled=await pullAll(),result={...pushed,...pulled,remaining:pendingCount(),success:true};emitStatus({state:'success',lastSuccessAt:Date.now()});if(manual)window.AlMezan?.toast?.(result.remaining?`تمت المزامنة وبقي ${result.remaining} تغيير معلق.`:'اكتملت المزامنة بنجاح.','success');return result}catch(error){console.error('AlMeezan sync:',error);emitStatus({state:'error',message:String(error?.message||error)});if(manual)window.AlMezan?.toast?.('تعذر إكمال المزامنة: '+String(error?.message||error),'error');return{error:true,message:String(error?.message||error),remaining:pendingCount()}}finally{busy=false;emitStatus()}
  }
  function schedule(delay=900){clearTimeout(timer);timer=setTimeout(()=>syncNow({manual:false}).catch(()=>{}),delay)}

  async function initialize(db,{seed=false}={}){
    const t=tenant();if(!t)return{tenant:''};initializedTenant=t;
    const mirror=await readMirror(t).catch(()=>null);if(mirror?.db&&window.AlMezan?.hasTenantLocalData?.()===false){suppress=true;try{window.AlMezan.replaceDBFromSync(mirror.db)}finally{suppress=false}db=window.AlMezan.db}
    snapshot=snapshotDb(db||window.AlMezan?.db||{});if(seed)seedAll(db||window.AlMezan.db);emitStatus();return{tenant:t,pending:pendingCount(),mirror:!!mirror}
  }
  function resetForTenant(db){initializedTenant=tenant();snapshot=snapshotDb(db||{});emitStatus()}
  function isRemoteEmptyResult(result){return Number(result?.remoteRows||0)===0}
  function needsBootstrap(){const m=readMeta();return !Number(m.lastPullAt||0)&&Object.keys(m.records||{}).length===0&&pendingCount()===0}

  window.addEventListener('online',()=>schedule(80));window.addEventListener('offline',()=>emitStatus({state:'offline'}));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule(250)});
  setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false&&tenant())syncNow({manual:false}).catch(()=>{})},30000);

  window.AlMezanSync={version:1,capture,seedAll,initialize,resetForTenant,syncNow,pushPending,pullAll,pendingCount,mirrorDb,readMirror,isRemoteEmptyResult,needsBootstrap,get busy(){return busy},get suppress(){return suppress}};
})();

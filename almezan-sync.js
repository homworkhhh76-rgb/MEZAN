/* Al-Meezan Instant Offline Sync v5.0
 * Live delta sync: cloud commits are ordered by a server-side batch inside one
 * transaction, remote deltas are applied immediately to the in-memory DB, and
 * the UI receives the exact changed datasets/records without reloading pages.
 */
(() => {
  'use strict';
  const META_PREFIX='almezan_sync_meta_v5::'; // keep v5 cursor and queue for migration; v6 is backwards compatible
  const LEGACY_META_PREFIX='almezan_sync_meta_v4::';
  const LEGACY_PENDING_PREFIXES=['almezan_sync_pending_v4::','almezan_sync_pending_v3::','almezan_sync_pending_v1::'];
  const LEGACY_FAILED_PREFIX='almezan_sync_failed_v4::';
  const DEVICE_KEY='almezan_device_id_v1';
  const IDB_NAME='almezan_offline_v2',IDB_STORE='tenants',IDB_QUEUE='sync_queue',IDB_FAILED='sync_failed',DB_SAVED_PREFIX='almezan_db_saved_at_v752::';
  const REMOTE_ACTIVE_MS=800,REMOTE_IDLE_MS=2600,CASHIER_ACTIVE_MS=350,CASHIER_IDLE_MS=1200,PUSH_BATCH_SIZE=36,IMPORT_PUSH_BATCH_SIZE=60;
  let snapshot=null,busy=false,suppress=false,initialized=false,timer=null,retryTimer=null,retryAttempt=0,lastProbeAt=0,lastActivityAt=Date.now(),schemaTenant='',rerunRequested=false;
  let pendingMem={},failedMem={},queueTenant='',queueHydrated=false,idbPromise=null,channel=null,mirrorTimer=null,mirrorQueuedDb=null;
  let queueWriteTail=Promise.resolve(),queueStorageError=null,mirrorWriteTail=Promise.resolve();
  let localSaveBarrier=Promise.resolve();
  const safe=v=>String(v??'').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const runtime=()=>window.AlMezanActivation?.readRuntime?.()||null;
  const tenant=()=>safe(runtime()?.companyId||runtime()?.tenantId);
  const dbCfg=()=>window.AlMezanActivation?.readDatabaseAccess?.(tenant())||runtime()?.database||null;
  const basePath=()=>`almezan/companies/${encodeURIComponent(tenant())}/d`;
  function deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=(crypto.randomUUID?crypto.randomUUID():`DEV-${Date.now()}-${Math.random().toString(36).slice(2)}`);localStorage.setItem(DEVICE_KEY,id)}return id}
  function hashText(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  const stableJson=v=>JSON.stringify(v);
  function recordKey(dataset,row,index=0){if(row&&typeof row==='object'){if(row.id!=null&&String(row.id)!=='')return String(row.id);if(dataset==='stock'&&row.productId&&row.warehouseId)return `${row.productId}::${row.warehouseId}`;if(dataset==='itemPrices')return `${row.productId||''}::${row.unitId||''}::${row.priceGroupId||''}`;if(dataset==='exchangeRates')return `${row.currencyId||''}::${row.date||''}`;if(row.code!=null&&String(row.code)!=='')return `code:${row.code}`;if(row.number!=null&&String(row.number)!=='')return `number:${row.number}`}return `_h_${hashText(stableJson(row))}_${index}`}
  function snapshotDb(db){const out={};for(const [dataset,value] of Object.entries(db||{})){if(Array.isArray(value)){const map={};value.forEach((row,i)=>{const key=recordKey(dataset,row,i),h=hashText(stableJson(row));map[key]=(dataset==='stock'||dataset==='repStock')?{h,qty:Number(row?.qtyBase||0)}:(dataset==='customers'||dataset==='suppliers'||dataset==='representatives')?{h,balance:Number(row?.balance||0)}:h});out[dataset]={kind:'array',map}}else out[dataset]={kind:'value',map:{__value__:hashText(stableJson(value))}}}return out}
  const snapHash=v=>v&&typeof v==='object'?v.h:v;
  const snapQty=v=>v&&typeof v==='object'?Number(v.qty||0):0;
  const snapBalance=v=>v&&typeof v==='object'?Number(v.balance||0):0;
  function metaKey(t=tenant()){return META_PREFIX+encodeURIComponent(t||'none')}
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}}
  function readMeta(){const m=readJson(metaKey(),null)||readJson(LEGACY_META_PREFIX+encodeURIComponent(tenant()||'none'),null)||{};return{protocol:5,remoteBatch:Number(m.remoteBatch||0),batchInitialized:!!m.batchInitialized,lastPullAt:Number(m.lastPullAt||0),lastPushAt:Number(m.lastPushAt||0),lastSuccessAt:Number(m.lastSuccessAt||0),reconciledV6:!!m.reconciledV6}}
  function writeMeta(m){try{localStorage.setItem(metaKey(),JSON.stringify({protocol:5,remoteBatch:Number(m?.remoteBatch||0),batchInitialized:!!m?.batchInitialized,lastPullAt:Number(m?.lastPullAt||0),lastPushAt:Number(m?.lastPushAt||0),lastSuccessAt:Number(m?.lastSuccessAt||0),reconciledV6:!!m?.reconciledV6}))}catch(_){} }
  function pkey(dataset,key){return dataset+'\u0001'+key}
  let lastRevision=0;
  function revNow(){lastRevision=Math.max(Date.now()*1000,lastRevision+1);return lastRevision}
  function readPending(){return {...pendingMem}}
  function readFailed(){return {...failedMem}}
  function pendingCount(){return Object.keys(pendingMem).length}
  function failedCount(){return Object.keys(failedMem).length}
  function cloneSafe(v){if(v===undefined)return undefined;try{return clone(v)}catch(_){return v}}
  function sanitizeRecord(dataset,value){
    if(value==null||typeof value!=='object')return cloneSafe(value);
    const out=cloneSafe(value);
    if(dataset==='products'&&out){
      // صور الأصناف المحلية لا تُرسل داخل JSON إلى Turso؛ تُرفع إلى بوت الصور ثم نزامن المعرف والرابط فقط.
      if(typeof out.imageData==='string'&&/^data:image\//i.test(out.imageData))out.imageData='';
      if(out.imagePendingUpload){out.imagePendingUpload=false;out.imagePendingName='';}
    }
    return out
  }
  async function idbTenantRows(storeName,t){const idb=await openIdb();if(!idb)return[];return new Promise((resolve,reject)=>{const tx=idb.transaction(storeName,'readonly'),store=tx.objectStore(storeName),idx=store.index('tenantId'),req=idx.getAll(t);req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
  // Serialize every IndexedDB queue update. A later save must never finish before
  // an earlier one and resurrect acknowledged operations after reload.
  function persistMapDiff(storeName,t,oldMap,newMap){
    if(!t)return Promise.resolve();
    const previous=cloneSafe(oldMap||{}),next=cloneSafe(newMap||{});
    const run=async()=>{
      const idb=await openIdb();
      if(!idb)throw Error('التخزين الآمن IndexedDB غير متاح. لم تُرسل البيانات للسحابة حفاظاً عليها.');
      await new Promise((resolve,reject)=>{
        const tx=idb.transaction(storeName,'readwrite'),store=tx.objectStore(storeName);
        const keys=new Set([...Object.keys(previous),...Object.keys(next)]);
        for(const pk of keys){const had=Object.prototype.hasOwnProperty.call(previous,pk),has=Object.prototype.hasOwnProperty.call(next,pk);
          if(had&&has&&JSON.stringify(previous[pk])===JSON.stringify(next[pk]))continue;
          const id=t+'\u0001'+pk;
          if(!has)store.delete(id);else store.put({id,tenantId:t,pk,op:next[pk]});
        }
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('IndexedDB queue write failed'));
        tx.onabort=()=>reject(tx.error||Error('IndexedDB queue write aborted'));
      });
      queueStorageError=null;
    };
    queueWriteTail=queueWriteTail.then(run,run).catch(e=>{queueStorageError=e;console.error('[AlMeezan sync] persistent queue failed',e);emitStatus({state:'storage-error',message:String(e?.message||e)})});
    return queueWriteTail;
  }
  async function ensureQueueDurable(){await queueWriteTail;if(queueStorageError)throw queueStorageError}
  function writePending(p){const next=p&&typeof p==='object'?p:{},old=pendingMem;pendingMem=next;persistMapDiff(IDB_QUEUE,tenant(),old,next);emitStatus()}
  function writeFailed(p){const next=p&&typeof p==='object'?p:{},old=failedMem;failedMem=next;persistMapDiff(IDB_FAILED,tenant(),old,next);emitStatus()}
  async function hydrateQueue(t=tenant()){
    if(!t)return; if(queueHydrated&&queueTenant===t)return;
    const pending={},failed={};
    try{for(const row of await idbTenantRows(IDB_QUEUE,t))if(row?.pk&&row.op)pending[row.pk]=row.op}catch(_){}
    try{for(const row of await idbTenantRows(IDB_FAILED,t))if(row?.pk&&row.op)failed[row.pk]=row.op}catch(_){}
    // ترحيل الطوابير القديمة من localStorage مرة واحدة ثم حذفها حتى لا تكبر الذاكرة المحلية.
    const enc=encodeURIComponent(t);
    for(const prefix of LEGACY_PENDING_PREFIXES){const key=prefix+enc,legacy=readJson(key,{});for(const[pk,op]of Object.entries(legacy||{}))if(!pending[pk])pending[pk]=op;}
    const legacyFailed=readJson(LEGACY_FAILED_PREFIX+enc,{});for(const[pk,op]of Object.entries(legacyFailed||{}))if(!failed[pk])failed[pk]=op;
    const oldPending=pendingMem,oldFailed=failedMem;for(const [pk,op] of Object.entries(oldPending)){if(!pending[pk]||Number(op.rev)>Number(pending[pk].rev))pending[pk]=op}pendingMem=pending;failedMem=failed;lastRevision=Object.values(pending).reduce((highest,op)=>Math.max(highest,Number(op?.rev||0)),lastRevision);queueTenant=t;queueHydrated=true;
    await persistMapDiff(IDB_QUEUE,t,oldPending,pending);await persistMapDiff(IDB_FAILED,t,oldFailed,failed);
    await ensureQueueDurable(); // Never delete legacy storage until IndexedDB has committed the migration.
    for(const prefix of LEGACY_PENDING_PREFIXES)try{localStorage.removeItem(prefix+enc)}catch(_){}
    try{localStorage.removeItem(LEGACY_FAILED_PREFIX+enc)}catch(_){}
    emitStatus()
  }
  function enqueue(dataset,key,deleted=false,rev=revNow(),extra={}){
    if(!tenant())return false;const p={...readPending()},basePk=pkey(dataset,key),isStockDelta=extra.mode==='stockDelta'||extra.mode==='balanceDelta',pk=isStockDelta?`${basePk}\u0001${rev}`:basePk,cur=p[pk];if(cur&&Number(cur.rev||0)>rev)return false;
    const current=deleted?undefined:getRecord(window.AlMezan?.db||{},dataset,key),value=Object.prototype.hasOwnProperty.call(extra,'value')?extra.value:sanitizeRecord(dataset,current);
    if(!deleted&&value===undefined){console.error('[AlMeezan sync] refusing undefined upsert',dataset,key);return false}
    const cleanExtra={...extra};delete cleanExtra.value;
    p[pk]={dataset,key,deleted:!!deleted,rev,deviceId:deviceId(),value:deleted?null:value,...cleanExtra};writePending(p);
    try{channel?.postMessage?.({type:'local-change',tenant:tenant(),at:Date.now()})}catch(_){}
    return true
  }
  function pendingRevForRecord(pending,dataset,key){let rev=0;for(const op of Object.values(pending||{}))if(op?.dataset===dataset&&String(op?.key)===String(key))rev=Math.max(rev,Number(op.rev||0));return rev}
  function pendingQtyDelta(pending,dataset,key){let delta=0;for(const op of Object.values(pending||{}))if(op?.dataset===dataset&&String(op?.key)===String(key)&&op?.mode==='stockDelta')delta+=Number(op.delta||0);return Number(delta.toFixed(8))}
  function emitStatus(extra={}){try{window.dispatchEvent(new CustomEvent('almezan:sync-status',{detail:{pending:pendingCount(),failed:failedCount(),online:navigator.onLine!==false,busy,...extra}}))}catch(_){} }
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function retryRead(fn,attempts=2){let last;for(let i=0;i<attempts;i++){try{return await fn()}catch(e){last=e;if(navigator.onLine===false||i===attempts-1)break;await sleep(350*(i+1))}}throw last}
  function clearRetry(){clearTimeout(retryTimer);retryTimer=null;retryAttempt=0}
  function scheduleRetry(){if(!pendingCount()||navigator.onLine===false)return;clearTimeout(retryTimer);retryAttempt=Math.min(retryAttempt+1,6);const delay=Math.min(15000,1200*Math.pow(2,retryAttempt-1));emitStatus({state:'retrying',retryIn:delay});retryTimer=setTimeout(()=>{retryTimer=null;syncNow({manual:false,force:true,checkRemote:true}).catch(()=>{})},delay)}
  function getRecord(db,dataset,key){const value=db?.[dataset];if(Array.isArray(value)){for(let i=0;i<value.length;i++)if(recordKey(dataset,value[i],i)===key)return value[i];return undefined}return key==='__value__'?value:undefined}
  function applyRecord(db,dataset,key,value,deleted){if(key==='__value__'){if(deleted)delete db[dataset];else db[dataset]=clone(value);return}if(!Array.isArray(db[dataset]))db[dataset]=[];const arr=db[dataset],idx=arr.findIndex((row,i)=>recordKey(dataset,row,i)===key);if(deleted){if(idx>=0)arr.splice(idx,1)}else if(idx>=0)arr[idx]=clone(value);else arr.push(clone(value))}
  function capture(db){if(suppress||!tenant())return 0;const next=snapshotDb(db);if(!initialized&&!snapshot){snapshot=next;return 0}if(!snapshot){snapshot=next;scheduleMirror(db,120);return 0}let changed=0;const datasets=new Set([...Object.keys(snapshot),...Object.keys(next)]);for(const dataset of datasets){const a=snapshot[dataset]?.map||{},b=next[dataset]?.map||{},keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const key of keys){if(snapHash(a[key])===snapHash(b[key]))continue;if(dataset==='stock'||dataset==='repStock'){if(b[key]===undefined){if(enqueue(dataset,key,true))changed++;continue}const delta=Number((snapQty(b[key])-snapQty(a[key])).toFixed(8));if(Math.abs(delta)>1e-10&&enqueue(dataset,key,false,revNow(),{mode:'stockDelta',delta}))changed++;else if(a[key]===undefined&&enqueue(dataset,key,false))changed++;continue}if((dataset==='customers'||dataset==='suppliers'||dataset==='representatives')&&a[key]!==undefined&&b[key]!==undefined&&snapBalance(a[key])!==snapBalance(b[key])){
          // A balance is a cumulative financial delta, never a last-writer-wins value.
          // Keep every delta separately, just like stock movements, so simultaneous
          // invoices on two devices add together rather than replacing one another.
          const delta=Number((snapBalance(b[key])-snapBalance(a[key])).toFixed(8));
          if(enqueue(dataset,key,false,revNow(),{mode:'balanceDelta',delta}))changed++;
          continue;
        }
        if(enqueue(dataset,key,b[key]===undefined))changed++}}snapshot=next;scheduleMirror(db,140);if(changed)schedule(20);return changed}
  async function commitSettings(datasets=['company','settings']){
    const t=tenant();if(!t)return {unavailable:true};
    for(const dataset of datasets)if(window.AlMezan?.db?.[dataset]!==undefined)enqueue(dataset,'__value__');
    await hydrateQueue(t);await persistMapDiff(IDB_QUEUE,t,{},readPending());
    scheduleMirror(window.AlMezan.db,40);schedule(15);return {queued:true,remaining:pendingCount()};
  }
  function seedAll(db){const next=snapshotDb(db);snapshot=next;let n=0;for(const [dataset,entry] of Object.entries(next))for(const key of Object.keys(entry.map||{})){enqueue(dataset,key,false);n++}scheduleMirror(db,60);if(n)schedule(20);return n}
  function openIdb(){
    if(idbPromise)return idbPromise;
    idbPromise=new Promise((resolve,reject)=>{if(!('indexedDB'in window))return resolve(null);const req=indexedDB.open(IDB_NAME,2);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE,{keyPath:'tenantId'});for(const name of[IDB_QUEUE,IDB_FAILED]){let st;if(!db.objectStoreNames.contains(name))st=db.createObjectStore(name,{keyPath:'id'});else st=req.transaction.objectStore(name);if(!st.indexNames.contains('tenantId'))st.createIndex('tenantId','tenantId',{unique:false})}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{idbPromise=null;reject(req.error)}});return idbPromise
  }
  async function storagePressureLevel(){try{const e=await navigator.storage?.estimate?.(),ratio=e?.quota?Number(e.usage||0)/Number(e.quota):0;if(ratio>=.88)return 3;if(ratio>=.75)return 2;if(ratio>=.60)return 1;return 0}catch(_){return 1}}
  // Never truncate sales, purchases, journals or historical documents in an offline
  // mirror: a partial mirror could otherwise be mistaken for the complete tenant DB.
  async function putMirrorRecord(idb,record){return new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||Error('IndexedDB write aborted'))})}
  async function mirrorDb(db,opts={}){
    const t=tenant();if(!t)return;
    const savedAt=Number(opts.savedAt)||Date.now();
    // Capture the full state immediately; serialize committed mirrors in save order.
    const record={tenantId:t,db:clone(db||{}),savedAt,compacted:false,pressureLevel:0};
    const persist=async()=>{const idb=await openIdb();if(!idb)throw Error('IndexedDB غير متاح لحفظ النسخة المحلية الكاملة.');await putMirrorRecord(idb,record)};
    const promise=mirrorWriteTail.then(persist,persist);
    mirrorWriteTail=promise.catch(e=>{console.warn('[AlMeezan sync] full local mirror failed',e);emitStatus({state:'storage-error',message:'تعذّر حفظ النسخة الاحتياطية المحلية الكاملة.'})});
    return promise;
  }
  function scheduleMirror(db,delay=180){
    mirrorQueuedDb=db||window.AlMezan?.db||{};clearTimeout(mirrorTimer);mirrorTimer=setTimeout(()=>{const source=mirrorQueuedDb;mirrorQueuedDb=null;mirrorTimer=null;mirrorDb(source).catch(()=>{})},Math.max(40,Number(delay)||180))
  }
  async function readLegacyMirror(t){
    if(!t||!('indexedDB'in window))return null;
    return new Promise(resolve=>{
      let req;try{req=indexedDB.open('almezan_offline_v1',1)}catch(_){return resolve(null)}
      req.onupgradeneeded=()=>{};
      req.onerror=()=>resolve(null);
      req.onsuccess=()=>{const db=req.result;if(!db.objectStoreNames.contains('tenants')){try{db.close()}catch(_){}return resolve(null)}try{const tx=db.transaction('tenants','readonly'),get=tx.objectStore('tenants').get(t);get.onsuccess=()=>{const out=get.result||null;try{db.close()}catch(_){}resolve(out)};get.onerror=()=>{try{db.close()}catch(_){}resolve(null)}}catch(_){try{db.close()}catch(__){}resolve(null)}}
    })
  }
  async function readMirror(t=tenant()){
    if(!t)return null;const idb=await openIdb();if(!idb)return null;
    const current=await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly'),req=tx.objectStore(IDB_STORE).get(t);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});
    if(current)return current;
    const legacy=await readLegacyMirror(t);
    if(legacy?.db){try{await putMirrorRecord(idb,{tenantId:t,db:legacy.db,savedAt:Number(legacy.savedAt)||Date.now(),migratedFrom:'almezan_offline_v1'})}catch(_){}return legacy}
    return null
  }
  function representativeScopeId(){
    const rt=runtime();if(rt?.type!=='representative')return '';
    const direct=safe(rt?.account?.representativeId);if(direct)return direct;
    const uid=safe(rt?.account?.id),d=window.AlMezan?.db;
    return safe(d?.employees?.find?.(e=>String(e.id)===uid)?.representativeId||d?.representatives?.find?.(r=>String(r.employeeId)===uid)?.id);
  }
  function allowRemoteRecordForRole(dataset,key,value){
    const repId=representativeScopeId();if(!repId)return true;
    // المندوب لا يحتاج أرصدة مستودعات الشركة. مخزونه الوحيد هو repStock الخاص به.
    if(dataset==='stock')return false;
    if(dataset==='repStock'){
      const row=value&&typeof value==='object'?value:null;
      if(row?.repId)return String(row.repId)===String(repId);
      return String(key||'').split('::')[0]===String(repId);
    }
    if(dataset==='repStockMoves'){
      const row=value&&typeof value==='object'?value:null;
      return !row?.repId||String(row.repId)===String(repId);
    }
    return true;
  }
  function cloudPath(dataset,key){return `${basePath()}/${encodeURIComponent(dataset)}/${encodeURIComponent(key)}`}
  function parseCloudPath(path){const prefix=basePath()+'/';if(!String(path).startsWith(prefix))return null;const rel=String(path).slice(prefix.length),parts=rel.split('/');if(parts.length<2)return null;try{return{dataset:decodeURIComponent(parts[0]),key:decodeURIComponent(parts.slice(1).join('/'))}}catch(_){return null}}
  function rowsOf(direct,r){try{return direct.rows(r)||[]}catch(_){return[]}}
  async function ensureSyncSchema(){const t=tenant(),cfg=dbCfg(),direct=window.AlMezanActivation?.tursoDirect;if(!t||!cfg?.databaseURL||!cfg?.authToken||!direct)throw Error('بيانات المزامنة غير متاحة.');if(schemaTenant===t)return{cfg,direct,table:direct.table(cfg),metaTable:direct.table(cfg)+'_syncmeta',seqTable:direct.table(cfg)+'_sequences',historyTable:direct.table(cfg)+'_history'};await direct.ensure(cfg);const table=direct.table(cfg),metaTable=table+'_syncmeta',seqTable=table+'_sequences',historyTable=table+'_history';const[info]=await direct.pipeline(cfg,[{sql:`PRAGMA table_info(${table})`,args:[]}]);const cols=rowsOf(direct,info).map(x=>String(x.name));if(!cols.includes('sync_batch')){try{await direct.pipeline(cfg,[{sql:`ALTER TABLE ${table} ADD COLUMN sync_batch INTEGER NOT NULL DEFAULT 0`,args:[]}])}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}await direct.pipeline(cfg,[{sql:`CREATE TABLE IF NOT EXISTS ${metaTable} (id INTEGER PRIMARY KEY CHECK(id=1), batch INTEGER NOT NULL DEFAULT 0)`,args:[]},{sql:`CREATE TABLE IF NOT EXISTS ${seqTable} (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,args:[]},{sql:`CREATE TABLE IF NOT EXISTS ${historyTable} (id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT NOT NULL,payload TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,original_rev INTEGER NOT NULL DEFAULT 0,archived_at INTEGER NOT NULL)`,args:[]}]);schemaTenant=t;return{cfg,direct,table,metaTable,seqTable,historyTable}}
  async function reserveBatch(schema){const[r]=await schema.direct.pipeline(schema.cfg,[{sql:`INSERT INTO ${schema.metaTable}(id,batch) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET batch=batch+1 RETURNING batch`,args:[]}]);return Number(rowsOf(schema.direct,r)[0]?.batch||1)}
  async function readRemoteBatch(schema){const[r]=await retryRead(()=>schema.direct.pipeline(schema.cfg,[{sql:`SELECT batch FROM ${schema.metaTable} WHERE id=1 LIMIT 1`,args:[]}]),2);return Number(rowsOf(schema.direct,r)[0]?.batch||0)}
  function documentSequence(value){const m=String(value||'').trim().match(/(\d+)\s*$/);return m?Math.max(0,Number(m[1])||0):0}
  function formatDocumentNumber(prefix,value){prefix=safe(prefix)||'INV';return `${prefix}-${String(Math.max(1,Number(value)||1)).padStart(6,'0')}`}
  async function peekDocumentNumber(kind,prefix,localFloor=0){
    prefix=safe(prefix)||'INV';localFloor=Math.max(0,Number(localFloor)||0);
    if(navigator.onLine===false||!tenant())return formatDocumentNumber(prefix,localFloor+1);
    const s=await ensureSyncSchema();
    const[r]=await s.direct.pipeline(s.cfg,[{sql:`SELECT value FROM ${s.seqTable} WHERE name=? LIMIT 1`,args:[String(kind||'sale')]}]);
    const remote=Number(rowsOf(s.direct,r)[0]?.value||0),next=Math.max(localFloor,remote)+1;
    return formatDocumentNumber(prefix,next)
  }
  async function reserveDocumentNumber(kind,prefix,minNext=1){
    prefix=safe(prefix)||'INV';minNext=Math.max(1,Number(minNext)||1);
    if(navigator.onLine===false||!tenant())return formatDocumentNumber(prefix,minNext);
    const s=await ensureSyncSchema();
    const[r]=await s.direct.pipeline(s.cfg,[{sql:`INSERT INTO ${s.seqTable}(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN value+1>excluded.value THEN value+1 ELSE excluded.value END RETURNING value`,args:[String(kind||'sale'),minNext]}]);
    const value=Number(rowsOf(s.direct,r)[0]?.value||minNext);
    return formatDocumentNumber(prefix,value)
  }
  async function claimDocumentNumber(kind,prefix,requested,localFloor=0){
    prefix=safe(prefix)||'INV';localFloor=Math.max(0,Number(localFloor)||0);
    const requestedSeq=documentSequence(requested),target=Math.max(localFloor+1,requestedSeq||0,1);
    if(navigator.onLine===false||!tenant())return formatDocumentNumber(prefix,target);
    const s=await ensureSyncSchema();
    const[r]=await s.direct.pipeline(s.cfg,[{sql:`INSERT INTO ${s.seqTable}(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN excluded.value>value THEN excluded.value ELSE value+1 END RETURNING value`,args:[String(kind||'sale'),target]}]);
    const value=Number(rowsOf(s.direct,r)[0]?.value||target);
    return formatDocumentNumber(prefix,value)
  }
  function buildPushStatements(s,batch,appDb){
    const statements=[{sql:'BEGIN IMMEDIATE',args:[]},{sql:`INSERT INTO ${s.metaTable}(id,batch) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET batch=batch+1`,args:[]}];let maxSaleSeq=0,maxPurchaseSeq=0;
    for(const[,op]of batch){
      const current=Object.prototype.hasOwnProperty.call(op,'value')?op.value:getRecord(appDb,op.dataset,op.key),deleted=op.deleted||current===undefined,envelope={v:deleted?null:sanitizeRecord(op.dataset,current),deleted,rev:op.rev,deviceId:op.deviceId||deviceId()};
      if(op.dataset==='sales'&&!deleted)maxSaleSeq=Math.max(maxSaleSeq,documentSequence(current?.number));
      if(op.dataset==='purchases'&&!deleted)maxPurchaseSeq=Math.max(maxPurchaseSeq,documentSequence(current?.number));
      if((op.dataset==='stock'||op.dataset==='repStock')&&op.mode==='stockDelta'){
        const parts=String(op.key).split('::'),fallback=op.dataset==='repStock'?{repId:parts[0]||'',productId:parts[1]||'',qtyBase:Number(op.delta||0)}:{productId:parts[0]||'',warehouseId:parts[1]||'',qtyBase:Number(op.delta||0)},base=current&&typeof current==='object'?{...current,qtyBase:Number(current.qtyBase||0)}:fallback,dev=op.deviceId||deviceId(),devKey='d'+hashText(dev),clockPath=`$.stockClock.${devKey}`,rev=Number(op.rev),insertEnvelope={v:base,deleted:false,rev,deviceId:dev,stockClock:{[devKey]:rev}};
        statements.push({sql:`INSERT INTO ${s.historyTable}(path,payload,deleted,original_rev,archived_at) SELECT path,payload,deleted,COALESCE(CAST(json_extract(payload,'$.rev') AS INTEGER),0),? FROM ${s.table} WHERE path=? AND COALESCE(CAST(json_extract(payload,'${clockPath}') AS INTEGER),0)<?`,args:[Date.now(),cloudPath(op.dataset,op.key),rev]});
        statements.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=json_set(CASE WHEN json_type(${s.table}.payload,'$.v')='object' THEN ${s.table}.payload ELSE excluded.payload END,'$.v.qtyBase',COALESCE(CAST(json_extract(${s.table}.payload,'$.v.qtyBase') AS REAL),0)+?,'$.rev',?,'$.deviceId',?,'${clockPath}',?),deleted=0,updated_at=?,sync_batch=(SELECT batch FROM ${s.metaTable} WHERE id=1) WHERE COALESCE(CAST(json_extract(${s.table}.payload,'${clockPath}') AS INTEGER),0)<?`,args:[cloudPath(op.dataset,op.key),JSON.stringify(insertEnvelope),0,rev,Number(op.delta||0),rev,dev,rev,rev,rev]});
        continue
      }
      // Atomic history: the old cloud record is never discarded silently when an edit wins.
      if(op.mode==='balanceDelta'){
        const dev=op.deviceId||deviceId(),devKey='d'+hashText(dev),clockPath=`$.balanceClock.${devKey}`,rev=Number(op.rev),local=op.value&&typeof op.value==='object'?clone(op.value):{},delta=Number(op.delta||0);
        // Other customer fields may change together with balance. JSON patch
        // merges their metadata while leaving the cloud's financial balance alone.
        delete local.balance;
        const patch=JSON.stringify({v:local});
        const initial=JSON.stringify({v:op.value||{},deleted:false,rev,deviceId:dev,balanceClock:{[devKey]:rev}});
        statements.push({sql:`INSERT INTO ${s.historyTable}(path,payload,deleted,original_rev,archived_at) SELECT path,payload,deleted,COALESCE(CAST(json_extract(payload,'$.rev') AS INTEGER),0),? FROM ${s.table} WHERE path=? AND COALESCE(CAST(json_extract(payload,'${clockPath}') AS INTEGER),0)<?`,args:[Date.now(),cloudPath(op.dataset,op.key),rev]});
        statements.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=json_set(json_patch(CASE WHEN json_type(${s.table}.payload,'$.v')='object' THEN ${s.table}.payload ELSE excluded.payload END,?),'$.v.balance',COALESCE(CAST(json_extract(${s.table}.payload,'$.v.balance') AS REAL),0)+?,'$.rev',?,'$.deviceId',?,'${clockPath}',?),deleted=0,updated_at=?,sync_batch=(SELECT batch FROM ${s.metaTable} WHERE id=1) WHERE COALESCE(CAST(json_extract(${s.table}.payload,'${clockPath}') AS INTEGER),0)<?`,args:[cloudPath(op.dataset,op.key),initial,0,rev,patch,delta,rev,dev,rev,rev,rev]});
        continue;
      }
      statements.push({sql:`INSERT INTO ${s.historyTable}(path,payload,deleted,original_rev,archived_at) SELECT path,payload,deleted,COALESCE(CAST(json_extract(payload,'$.rev') AS INTEGER),0),? FROM ${s.table} WHERE path=? AND payload<>? AND COALESCE(CAST(json_extract(payload,'$.rev') AS INTEGER),0)<=?`,args:[Date.now(),cloudPath(op.dataset,op.key),JSON.stringify(envelope),Number(op.rev)]});
      statements.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at,sync_batch=excluded.sync_batch WHERE COALESCE(CAST(json_extract(excluded.payload,'$.rev') AS INTEGER),0)>=COALESCE(CAST(json_extract(${s.table}.payload,'$.rev') AS INTEGER),0)`,args:[cloudPath(op.dataset,op.key),JSON.stringify(envelope),deleted?1:0,Number(op.rev)]})
    }
    if(maxSaleSeq>0)statements.push({sql:`INSERT INTO ${s.seqTable}(name,value) VALUES('sale',?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN excluded.value>value THEN excluded.value ELSE value END`,args:[maxSaleSeq]});
    if(maxPurchaseSeq>0)statements.push({sql:`INSERT INTO ${s.seqTable}(name,value) VALUES('purchase',?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN excluded.value>value THEN excluded.value ELSE value END`,args:[maxPurchaseSeq]});
    statements.push({sql:'COMMIT',args:[]});return statements
  }
  function removePendingIfSame(pk,op){const latest=readPending();if(Number(latest[pk]?.rev||0)===Number(op.rev)){delete latest[pk];writePending(latest);const failed=readFailed();if(failed[pk]){delete failed[pk];writeFailed(failed)}return true}return false}
  function quarantinePending(pk,op,error){
    // لا نحذف أي حركة فاشلة من طابور المزامنة. تبقى محفوظة وتُعاد المحاولة
    // تلقائياً حتى بعد إغلاق التطبيق، مع حفظ آخر خطأ للتشخيص فقط.
    const latest=readPending();if(Number(latest[pk]?.rev||0)!==Number(op.rev))return false;
    const prevOp=latest[pk]||op,attempts=Number(prevOp.attempts||0)+1;
    latest[pk]={...prevOp,attempts,lastError:String(error?.message||error||'فشل غير معروف'),lastAttemptAt:Date.now()};writePending(latest);
    const failed=readFailed(),prev=failed[pk]||{};failed[pk]={...op,error:String(error?.message||error||'فشل غير معروف'),failedAt:Date.now(),attempts:Math.max(attempts,Number(prev.attempts||0)+1)};writeFailed(failed);return true
  }
  async function verifyCloudBatch(s,batch){
    const pairs=batch.map(([pk,op])=>({pk,op,path:cloudPath(op.dataset,op.key)}));
    const out=new Set();
    if(!pairs.length)return out;
    const placeholders=pairs.map(()=>'?').join(',');
    const [response]=await s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload FROM ${s.table} WHERE path IN (${placeholders})`,args:pairs.map(x=>x.path)}]);
    const remote=new Map(rowsOf(s.direct,response).map(x=>[String(x.path),x.payload]));
    for(const item of pairs){let env=remote.get(item.path);if(typeof env==='string'){try{env=JSON.parse(env)}catch(_){env=null}}
      if(!env)continue;
      if(item.op.mode==='stockDelta'||item.op.mode==='balanceDelta'){
        const clock=item.op.mode==='balanceDelta'?env.balanceClock||{}:env.stockClock||{};if(Number(clock['d'+hashText(item.op.deviceId||deviceId())]||0)>=Number(item.op.rev))out.add(item.pk);
      }else if(Number(env.rev||0)===Number(item.op.rev)&&String(env.deviceId||'')===String(item.op.deviceId||deviceId()))out.add(item.pk);
    }
    return out;
  }
  // If another device committed a higher revision of the SAME record, the old
  // implementation retried forever, leaving two devices showing different data.
  // Rebase the locally saved operation above the remote clock. The remote version
  // is archived by buildPushStatements before it is replaced. No queue entry is
  // acknowledged until the server confirms our own revision and deviceId.
  async function rebaseConflicts(s,entries){
    const others=entries.filter(([,op])=>op?.mode!=='stockDelta'&&op?.mode!=='balanceDelta');
    if(!others.length)return 0;
    const paths=others.map(([,op])=>cloudPath(op.dataset,op.key));
    const placeholders=paths.map(()=>'?').join(',');
    const [r]=await s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload FROM ${s.table} WHERE path IN (${placeholders})`,args:paths}]);
    const remote=new Map(rowsOf(s.direct,r).map(x=>[String(x.path),x.payload]));
    let rebased=0;
    const latest=readPending();
    for(const [pk,op] of others){
      if(!latest[pk]||Number(latest[pk].rev)!==Number(op.rev))continue;
      let value=remote.get(cloudPath(op.dataset,op.key));
      if(typeof value==='string')try{value=JSON.parse(value)}catch(_){continue}
      const serverRevision=Number(value?.rev||0);
      if(serverRevision>=Number(op.rev||0)&&String(value?.deviceId||'')!==String(op.deviceId||'')){
        // Older remote value stays in the server's immutable revision history.
        const nextRev=Math.max(serverRevision+1,revNow());
        latest[pk]={...latest[pk],rev:nextRev,rebasedAt:Date.now(),conflictRevision:serverRevision};
        lastRevision=Math.max(lastRevision,nextRev);rebased++;
      }
    }
    if(rebased){writePending(latest);await ensureQueueDurable();emitStatus({state:'conflict-rebased',rebased});window.AlMezan?.toast?.('تم حل تعارض بين جهازين. احتُفظ بالنسخة السابقة في سجل الاستعادة بالإعدادات.','warning',4800)}
    return rebased;
  }
  async function pushPending(){
    await ensureQueueDurable();const s=await ensureSyncSchema(),appDb=window.AlMezan?.db||{};
    // Preflight every batch: prevent permanent conflict loops on different clocks.
    await rebaseConflicts(s,Object.entries(readPending()));
    const entries=Object.entries(readPending());if(!entries.length)return{uploaded:0,remaining:0};
    let uploaded=0,skipped=0;
    const batchSize=entries.some(([,op])=>op?.imported===true)?IMPORT_PUSH_BATCH_SIZE:PUSH_BATCH_SIZE;
    for(let offset=0;offset<entries.length;offset+=batchSize){
      const batch=entries.slice(offset,offset+batchSize);
      try{
        await s.direct.pipeline(s.cfg,buildPushStatements(s,batch,appDb),Math.max(30000,batch.length*1300));
        const acknowledged=await verifyCloudBatch(s,batch);
        for(const[pk,op]of batch){if(acknowledged.has(pk)){if(removePendingIfSame(pk,op))uploaded++}else if(quarantinePending(pk,op,'تعارض مع نسخة أحدث بالسحابة؛ لم يتم حذف البيانات المحلية.'))skipped++}
      }catch(batchError){
        console.warn('[AlMeezan sync] batch failed; retrying records individually without dropping any local change.',batchError);
        for(const pair of batch){const[pk,op]=pair;try{await s.direct.pipeline(s.cfg,buildPushStatements(s,[pair],appDb),30000);const acknowledged=await verifyCloudBatch(s,[pair]);if(acknowledged.has(pk)){if(removePendingIfSame(pk,op))uploaded++}else if(quarantinePending(pk,op,'تعارض مع تعديل أحدث بالسحابة.'))skipped++}catch(error){if(quarantinePending(pk,op,error))skipped++;console.warn('[AlMeezan sync] retained failed queue item for automatic retry',op?.dataset,op?.key,error)}}
      }
    }
    await ensureQueueDurable();const m=readMeta();m.lastPushAt=Date.now();writeMeta(m);if(uploaded)try{channel?.postMessage?.({type:'cloud-change',tenant:tenant(),at:Date.now()})}catch(_){}return{uploaded,skipped,failed:failedCount(),remaining:pendingCount()}
  }
  async function applyRows(rows,remoteBatch){
    window.AlMezan?.flushPendingLocalSave?.();await ensureQueueDurable();
    const pending=readPending(),meta=readMeta(),current=clone(window.AlMezan?.db||{}),changedDatasets=new Set(),changedRecords={};let applied=0,deferredRemoteRows=0;
    for(const row of rows){
      const parsed=parseCloudPath(row.path);if(!parsed)continue;
      const pk=pkey(parsed.dataset,parsed.key),rowBatch=Number(row.sync_batch||0),localPending=pendingRevForRecord(pending,parsed.dataset,parsed.key);
      let envelope=row.payload;if(typeof envelope==='string'){try{envelope=JSON.parse(envelope)}catch(_){envelope=null}}
      const deleted=Number(row.deleted)===1||envelope?.deleted===true;let value=envelope&&Object.prototype.hasOwnProperty.call(envelope,'v')?envelope.v:envelope;
      if(!allowRemoteRecordForRole(parsed.dataset,parsed.key,value))continue;
      const qtyDataset=parsed.dataset==='stock'||parsed.dataset==='repStock';
      if(!qtyDataset&&localPending>0){deferredRemoteRows++;continue;}
      if(qtyDataset&&!deleted&&value&&localPending>0){value=clone(value);value.qtyBase=Number((Number(value.qtyBase||0)+pendingQtyDelta(pending,parsed.dataset,parsed.key)).toFixed(8))}
      const before=getRecord(current,parsed.dataset,parsed.key),beforeHash=before===undefined?'__missing__':hashText(stableJson(before)),afterHash=deleted?'__deleted__':hashText(stableJson(value));
      applyRecord(current,parsed.dataset,parsed.key,value,deleted);
      if(!qtyDataset&&pending[pk]&&localPending<=Number(row.updated_at||0))delete pending[pk];
      changedDatasets.add(parsed.dataset);(changedRecords[parsed.dataset]||(changedRecords[parsed.dataset]=[])).push(parsed.key);applied++
    }
    meta.protocol=5;
    // Never advance past an un-applied remote record while its local edit is pending.
    // Otherwise another device's change would never be fetched after a conflict clears.
    if(!deferredRemoteRows)meta.remoteBatch=Math.max(Number(meta.remoteBatch||0),Number(remoteBatch||0));
    meta.batchInitialized=true;meta.lastPullAt=Date.now();meta.lastSuccessAt=Date.now();writePending(pending);
    const detail={at:Date.now(),datasets:[...changedDatasets],records:changedRecords,remoteBatch:Number(remoteBatch||0),applied};
    if(applied&&window.AlMezan?.replaceDBFromSync){suppress=true;try{window.AlMezan.replaceDBFromSync(current,detail)}finally{suppress=false}snapshot=snapshotDb(window.AlMezan.db);await mirrorDb(window.AlMezan.db).catch(e=>console.warn('Full offline mirror unavailable',e))}
    await ensureQueueDurable();writeMeta(meta);
    return{applied,detail}
  }
  async function pullChanges({force=false,full=false}={}){
    const s=await ensureSyncSchema(),meta=readMeta(),remoteBatch=await readRemoteBatch(s),last=Number(meta.remoteBatch||0);if(meta.batchInitialized&&!force&&!full&&remoteBatch<=last)return{applied:0,remoteRows:0,remoteBatch,changedDatasets:[]};
    const lo=basePath(),hi=lo+'\uffff';let rows=[];
    if(full||!meta.batchInitialized){const[r]=await retryRead(()=>s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? ORDER BY path`,args:[lo,hi]}],60000),3);rows=rowsOf(s.direct,r).map(x=>({...x,payload:(()=>{try{return typeof x.payload==='string'?JSON.parse(x.payload):x.payload}catch(_){return x.payload}})()}))}
    else if(remoteBatch>last){const[r]=await retryRead(()=>s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? AND sync_batch>? ORDER BY sync_batch ASC,path ASC`,args:[lo,hi,last]}],60000),3);rows=rowsOf(s.direct,r).map(x=>({...x,payload:(()=>{try{return typeof x.payload==='string'?JSON.parse(x.payload):x.payload}catch(_){return x.payload}})()}))}
    const out=await applyRows(rows,remoteBatch);if(full){const m=readMeta();m.reconciledV6=true;writeMeta(m)}return{applied:out.applied,remoteRows:rows.length,remoteBatch,changedDatasets:out.detail?.datasets||[],changedRecords:out.detail?.records||{},bootstrap:!meta.batchInitialized}
  }
  const BUSINESS_DATASETS=new Set(['sales','purchases','products','customers','suppliers','stock','repStock','journals','vouchers','cheques','installmentContracts','installmentSchedule','transfers','transferRequests','itemPrices','finance','expenses','revenues','wastageDocs','productBatches']);
  function businessRecordCount(db){const keys=['sales','purchases','products','suppliers','stock','journals','vouchers','cheques','installmentContracts','transfers','transferRequests'];return keys.reduce((n,k)=>n+(Array.isArray(db?.[k])?db[k].length:0),0)+(db?.customers||[]).filter(c=>c&&!c.system).length}
  function pendingBusinessCount(){return Object.values(readPending()).filter(op=>BUSINESS_DATASETS.has(String(op?.dataset||''))).length}
  async function pullFull({reason='manual'}={}){
    if(!tenant())return{unavailable:true,reason};
    if(navigator.onLine===false)return{offline:true,reason};
    if(pendingBusinessCount()>0)return{blocked:true,reason,message:'توجد تغييرات محلية تجارية معلقة؛ قم بمزامنتها أولاً.'}; // Keep pending settings and company records; applyRows protects them.
    const s=await ensureSyncSchema(),remoteBatch=await readRemoteBatch(s),lo=basePath(),hi=lo+'\uffff';
    const[r]=await retryRead(()=>s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? ORDER BY path`,args:[lo,hi]}],60000),3);
    const rows=rowsOf(s.direct,r).map(x=>({...x,payload:(()=>{try{return typeof x.payload==='string'?JSON.parse(x.payload):x.payload}catch(_){return x.payload}})()}));
    if(!rows.length)return{applied:0,remoteRows:0,remoteBatch,empty:true,reason};
    const old=readMeta(),repair={...old,protocol:5,remoteBatch:0,batchInitialized:false};writeMeta(repair);
    try{const out=await applyRows(rows,remoteBatch);emitStatus({state:'success',recovered:true});return{applied:out.applied,remoteRows:rows.length,remoteBatch,changedDatasets:out.detail?.datasets||[],changedRecords:out.detail?.records||{},recovered:true,reason}}
    catch(error){writeMeta(old);throw error}
  }
  async function recoverIfEmpty({silent=true}={}){
    if(!tenant()||navigator.onLine===false)return{skipped:true};
    const localCount=businessRecordCount(window.AlMezan?.db||{});if(localCount>0)return{skipped:true,localCount};
    // لا نعتبر حركات الإقلاع غير التجارية سبباً لمنع استعادة بيانات الشركة القديمة.
    // pullFull يمنع الاستعادة فقط عندما توجد حركات تجارية محلية حقيقية حتى لا نخسرها.
    try{const r=await pullFull({reason:'empty-local-recovery'});if(r?.remoteRows>0&&!silent)window.AlMezan?.toast?.(`تمت استعادة البيانات القديمة من قاعدة الشركة (${r.applied||0} سجل).`,'success',5200);return r}
    catch(error){console.warn('[AlMeezan sync] empty-local recovery failed',error);return{error:true,message:String(error?.message||error)}}
  }
  function probeInterval(){const active=Date.now()-lastActivityAt<30000;if(window.AlMezan?.state?.view==='cashier')return active?CASHIER_ACTIVE_MS:CASHIER_IDLE_MS;return active?REMOTE_ACTIVE_MS:REMOTE_IDLE_MS}
  async function checkRemote({force=false}={}){if(busy||!tenant()||navigator.onLine===false||document.visibilityState==='hidden')return{skipped:true};const now=Date.now(),interval=pendingCount()?Math.min(3000,probeInterval()):probeInterval();if(!force&&now-lastProbeAt<Math.max(250,interval-120))return{throttled:true};lastProbeAt=now;try{if(pendingCount()||!readMeta().reconciledV6)return syncNow({manual:false,force:true,checkRemote:true});const s=await ensureSyncSchema(),remote=await readRemoteBatch(s),local=Number(readMeta().remoteBatch||0);if(!readMeta().batchInitialized||remote>local)return syncNow({manual:false,checkRemote:true});return{changed:false,remoteBatch:remote}}catch(error){if(pendingCount())scheduleRetry();return{error:true,message:String(error?.message||error)}}}
  async function syncNow({manual=false,force=false,checkRemote:wantRemote=false}={}){if(busy){rerunRequested=true;if(manual)window.AlMezan?.toast?.('المزامنة جارية الآن، انتظر لحظة.','warning');return{busy:true,remaining:pendingCount()}}if(!tenant())return{unavailable:true,remaining:pendingCount()};if(navigator.onLine===false){emitStatus({state:'offline'});if(manual)window.AlMezan?.toast?.('أنت الآن دون إنترنت. التغييرات محفوظة محلياً وستتم مزامنتها عند عودة الاتصال.','warning');return{offline:true,remaining:pendingCount()}};const hasPending=pendingCount()>0;if(!manual&&!force&&!wantRemote&&!hasPending)return{idle:true,remaining:0};busy=true;emitStatus({state:'syncing'});try{const pushed=hasPending?await pushPending():{uploaded:0,remaining:0},pulled=(manual||wantRemote||hasPending)?await pullChanges({force:manual||force,full:!readMeta().reconciledV6}):{applied:0,remoteRows:0,changedDatasets:[]},result={...pushed,...pulled,remaining:pendingCount(),success:true};clearRetry();emitStatus({state:'success',lastSuccessAt:Date.now()});try{window.dispatchEvent(new CustomEvent('almezan:sync-complete',{detail:result}))}catch(_){}if(manual){const skipped=Number(result.skipped||0);window.AlMezan?.toast?.(skipped?`تمت مزامنة ما أمكن، و${skipped} حركة ما زالت محفوظة وستتم إعادة محاولتها تلقائياً.`:result.remaining?`تمت المزامنة وبقي ${result.remaining} تغيير معلق وسيعاد إرساله تلقائياً.`:result.applied?`اكتملت المزامنة وتحدثت الشاشة (${result.applied} تغيير).`:'اكتملت المزامنة — البيانات محدثة.',skipped?'warning':'success',skipped?5200:undefined)};if(result.remaining)scheduleRetry();return result}catch(error){console.error('AlMeezan sync:',error);emitStatus({state:'error',message:String(error?.message||error)});if(pendingCount())scheduleRetry();if(manual)window.AlMezan?.toast?.('تعذر الاتصال الآن. بياناتك محفوظة وسيعيد النظام المزامنة تلقائياً.','warning',5200);return{error:true,message:String(error?.message||error),remaining:pendingCount()}}finally{busy=false;emitStatus();if(rerunRequested){rerunRequested=false;schedule(20)}else if(pendingCount()&&!retryTimer)scheduleRetry()}}
  function schedule(delay=25){if(!pendingCount())return;clearTimeout(timer);timer=setTimeout(()=>syncNow({manual:false,force:true,checkRemote:true}).catch(()=>{}),Math.max(15,Number(delay)||25))}
  async function initialize(db,{seed=false}={}){const t=tenant();if(!t)return{tenant:''};try{await navigator.storage?.persist?.()}catch(_){}await hydrateQueue(t);try{await backupBeforeUpgradeV6(db||window.AlMezan?.db||{})}catch(e){console.warn('[AlMeezan sync] pre-upgrade backup unavailable',e);emitStatus({state:'storage-error',message:'تعذر حفظ نسخة الاستعادة الخاصة بالتحديث.'})}try{if(typeof BroadcastChannel!=='undefined'&&!channel){channel=new BroadcastChannel('almezan-instant-sync-v5');channel.onmessage=e=>{if(e?.data?.tenant===tenant()&&e?.data?.type==='cloud-change')setTimeout(()=>checkRemote({force:true}).catch(()=>{}),40)}}}catch(_){}const mirror=await readMirror(t).catch(()=>null),fastSavedAt=Number(localStorage.getItem(DB_SAVED_PREFIX+encodeURIComponent(t))||0),current=db||window.AlMezan?.db||{},currentBusiness=businessRecordCount(current),mirrorBusiness=businessRecordCount(mirror?.db||{}),preferBusinessMirror=currentBusiness===0&&mirrorBusiness>0;if(mirror?.db&&(preferBusinessMirror||(!mirror.compacted&&(window.AlMezan?.hasTenantLocalData?.()===false||Number(mirror.savedAt||0)>fastSavedAt)))){suppress=true;try{(()=>{const restored=clone(mirror.db);for(const op of Object.values(readPending()))if(op.dataset==='company'||op.dataset==='settings')applyRecord(restored,op.dataset,op.key,op.value,op.deleted);window.AlMezan.replaceDBFromSync(restored)})()}finally{suppress=false}db=window.AlMezan.db}snapshot=snapshotDb(db||window.AlMezan?.db||{});initialized=true;if(seed)seedAll(db||window.AlMezan.db);emitStatus();setTimeout(async()=>{const localBusiness=businessRecordCount(window.AlMezan?.db||{});if(localBusiness===0){const recovered=await recoverIfEmpty({silent:true});if(recovered?.recovered)return}if(pendingCount())schedule(20);else checkRemote({force:true}).catch(()=>{})},220);return{tenant:t,pending:pendingCount(),mirror:!!mirror,restoredMirror:preferBusinessMirror}}
  async function backupBeforeUpgradeV6(db){
    const t=tenant();if(!t)return;
    const idb=await openIdb();if(!idb)return;
    const key='__before_sync_v6__'+t;
    const old=await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly'),r=tx.objectStore(IDB_STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    if(!old)await putMirrorRecord(idb,{tenantId:key,originalTenantId:t,db:clone(db||{}),savedAt:Date.now(),recoveryCopy:true,compacted:false});
  }
  async function getPreUpgradeCopy(){const idb=await openIdb(),t=tenant();if(!idb||!t)return null;return new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly'),r=tx.objectStore(IDB_STORE).get('__before_sync_v6__'+t);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
  function resetForTenant(db){schemaTenant='';initialized=false;clearRetry();clearTimeout(mirrorTimer);mirrorTimer=null;mirrorQueuedDb=null;snapshot=snapshotDb(db||{});pendingMem={};failedMem={};queueTenant='';queueHydrated=false;emitStatus()}
  function isRemoteEmptyResult(result){return Number(result?.remoteRows||0)===0}
  function needsBootstrap(){const m=readMeta();return !m.batchInitialized&&pendingCount()===0}
  function requestSync(delay=20){if(pendingCount())schedule(delay)}
  function queueBackupSnapshot(db,{clearExisting=true,includeKnownDeletes=true}={}){
    const t=tenant();if(!t)return{queued:0,deletions:0,datasets:0,unavailable:true};
    if(clearExisting&&pendingCount()>0){console.warn('Backup import: preserving unsynced queue instead of deleting it.')}
    if(clearExisting&&pendingCount()===0){clearTimeout(timer);timer=null;clearRetry()}
    const source=db||window.AlMezan?.db||{},next=snapshotDb(source),pending={...readPending()},dev=deviceId();let rev=Date.now()*1000+Math.floor(Math.random()*500),queued=0;
    for(const [dataset,entry] of Object.entries(next))for(const key of Object.keys(entry.map||{})){const pk=pkey(dataset,key),opRev=rev++,value=sanitizeRecord(dataset,getRecord(source,dataset,key));pending[pk]={dataset,key,deleted:false,rev:opRev,deviceId:dev,value,mode:'snapshotReplace',imported:true};queued++}
    writePending(pending);snapshot=next;mirrorDb(source).catch(()=>{});emitStatus({state:'backup-import-queued',importQueued:queued,importDeletions:0});if(queued)schedule(20);return{queued,deletions:0,datasets:Object.keys(next).length,remaining:pendingCount(),failed:failedCount()}
  }
  async function exportRevisionHistory(){
    const s=await ensureSyncSchema(),lo=basePath(),hi=lo+'\uffff';
    const [r]=await s.direct.pipeline(s.cfg,[{sql:`SELECT id,path,payload,deleted,original_rev,archived_at FROM ${s.historyTable} WHERE path>=? AND path<? ORDER BY id DESC`,args:[lo,hi]}],60000);
    const records=rowsOf(s.direct,r);
    const pending=readPending(),failed=readFailed(),preUpgrade=await getPreUpgradeCopy().catch(()=>null);
    const contents=JSON.stringify({version:6,companyId:tenant(),exportedAt:new Date().toISOString(),cloudHistory:records,preUpgradeSnapshot:preUpgrade?.db||null,unsyncedOperations:pending,failedOperations:failed},null,2);
    window.AlMezan?.downloadBlob?.(`almezan-sync-recovery-${new Date().toISOString().slice(0,10)}.json`,contents,'application/json;charset=utf-8');
    return{versions:records.length,pending:Object.keys(pending).length};
  }
  function clearQueue({includeFailed=true}={}){
    const pending=pendingCount(),failed=failedCount();writePending({});if(includeFailed)writeFailed({});clearTimeout(timer);timer=null;clearRetry();snapshot=snapshotDb(window.AlMezan?.db||{});emitStatus({state:'queue-cleared'});return{clearedPending:pending,clearedFailed:includeFailed?failed:0,remaining:0,failed:includeFailed?0:failedCount()}
  }
  ['pointerdown','keydown','input','touchstart'].forEach(type=>document.addEventListener(type,()=>{lastActivityAt=Date.now()},{capture:true,passive:true}));window.addEventListener('online',()=>{retryAttempt=0;lastActivityAt=Date.now();if(pendingCount())schedule(20);else checkRemote({force:true}).catch(()=>{})});window.addEventListener('offline',()=>emitStatus({state:'offline'}));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastActivityAt=Date.now();setTimeout(()=>checkRemote({force:true}).catch(()=>{}),350)}});window.addEventListener('focus',()=>{lastActivityAt=Date.now();checkRemote({force:true}).catch(()=>{})});setInterval(()=>checkRemote().catch(()=>{}),500);
  window.AlMezanSync={version:6.0,exportRevisionHistory,commitSettings,capture,seedAll,queueBackupSnapshot,initialize,resetForTenant,syncNow,pushPending,pullAll:pullFull,pullFull,recoverIfEmpty,pullChanges,checkRemote,pendingCount,failedCount,clearQueue,mirrorDb,readMirror,isRemoteEmptyResult,needsBootstrap,requestSync,peekDocumentNumber,reserveDocumentNumber,claimDocumentNumber,get busy(){return busy},get suppress(){return suppress}};
})();

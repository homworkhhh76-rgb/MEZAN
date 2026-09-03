/* Al-Meezan Offline Sync v4.0
 * Live delta sync: cloud commits are ordered by a server-side batch inside one
 * transaction, remote deltas are applied immediately to the in-memory DB, and
 * the UI receives the exact changed datasets/records without reloading pages.
 */
(() => {
  'use strict';
  const META_PREFIX='almezan_sync_meta_v4::';
  const PENDING_PREFIX='almezan_sync_pending_v4::';
  const LEGACY_META_PREFIX='almezan_sync_meta_v3::';
  const LEGACY_PENDING_PREFIX='almezan_sync_pending_v3::';
  const VERY_LEGACY_PENDING_PREFIX='almezan_sync_pending_v1::';
  const DEVICE_KEY='almezan_device_id_v1';
  const IDB_NAME='almezan_offline_v1',IDB_STORE='tenants',DB_SAVED_PREFIX='almezan_db_saved_at_v752::';
  const REMOTE_ACTIVE_MS=5000,REMOTE_IDLE_MS=8000,CASHIER_ACTIVE_MS=1800,CASHIER_IDLE_MS=5000,PUSH_BATCH_SIZE=24;
  let snapshot=null,busy=false,suppress=false,timer=null,retryTimer=null,retryAttempt=0,lastProbeAt=0,lastActivityAt=Date.now(),schemaTenant='';
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
  function snapshotDb(db){const out={};for(const [dataset,value] of Object.entries(db||{})){if(Array.isArray(value)){const map={};value.forEach((row,i)=>{const key=recordKey(dataset,row,i),h=hashText(stableJson(row));map[key]=(dataset==='stock'||dataset==='repStock')?{h,qty:Number(row?.qtyBase||0)}:h});out[dataset]={kind:'array',map}}else out[dataset]={kind:'value',map:{__value__:hashText(stableJson(value))}}}return out}
  const snapHash=v=>v&&typeof v==='object'?v.h:v;
  const snapQty=v=>v&&typeof v==='object'?Number(v.qty||0):0;
  function metaKey(t=tenant()){return META_PREFIX+encodeURIComponent(t||'none')}
  function pendingKey(t=tenant()){return PENDING_PREFIX+encodeURIComponent(t||'none')}
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}}
  function readMeta(){return readJson(metaKey(),{protocol:4,records:{},remoteBatch:0,batchInitialized:false,lastPullAt:0,lastPushAt:0,lastSuccessAt:0})}
  function writeMeta(m){try{localStorage.setItem(metaKey(),JSON.stringify(m))}catch(_){}}
  function migrateLegacyQueue(){const t=tenant();if(!t)return;const pk=pendingKey(t);if(localStorage.getItem(pk))return;let old=readJson(LEGACY_PENDING_PREFIX+encodeURIComponent(t),{});if(!old||!Object.keys(old).length)old=readJson(VERY_LEGACY_PENDING_PREFIX+encodeURIComponent(t),{});if(old&&Object.keys(old).length)try{localStorage.setItem(pk,JSON.stringify(old))}catch(_){} }
  function readPending(){migrateLegacyQueue();return readJson(pendingKey(),{})}
  function writePending(p){try{localStorage.setItem(pendingKey(),JSON.stringify(p))}catch(_){}emitStatus()}
  function pkey(dataset,key){return dataset+'\u0001'+key}
  function revNow(){return Date.now()*1000+Math.floor(Math.random()*900)}
  function enqueue(dataset,key,deleted=false,rev=revNow(),extra={}){if(!tenant())return false;const p=readPending(),basePk=pkey(dataset,key),isStockDelta=extra.mode==='stockDelta',pk=isStockDelta?`${basePk}\u0001${rev}`:basePk,cur=p[pk];if(cur&&Number(cur.rev||0)>rev)return false;p[pk]={dataset,key,deleted:!!deleted,rev,deviceId:deviceId(),...extra};writePending(p);const m=readMeta();m.records[basePk]={...(m.records[basePk]||{}),rev,deleted:!!deleted};writeMeta(m);return true}
  function pendingRevForRecord(pending,dataset,key){let rev=0;for(const op of Object.values(pending||{}))if(op?.dataset===dataset&&String(op?.key)===String(key))rev=Math.max(rev,Number(op.rev||0));return rev}
  function pendingQtyDelta(pending,dataset,key){let delta=0;for(const op of Object.values(pending||{}))if(op?.dataset===dataset&&String(op?.key)===String(key)&&op?.mode==='stockDelta')delta+=Number(op.delta||0);return Number(delta.toFixed(8))}
  function pendingCount(){return Object.keys(readPending()).length}
  function emitStatus(extra={}){window.dispatchEvent(new CustomEvent('almezan:sync-status',{detail:{pending:pendingCount(),online:navigator.onLine!==false,busy,...extra}}))}
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function retryRead(fn,attempts=2){let last;for(let i=0;i<attempts;i++){try{return await fn()}catch(e){last=e;if(navigator.onLine===false||i===attempts-1)break;await sleep(350*(i+1))}}throw last}
  function clearRetry(){clearTimeout(retryTimer);retryTimer=null;retryAttempt=0}
  function scheduleRetry(){if(!pendingCount()||navigator.onLine===false)return;clearTimeout(retryTimer);retryAttempt=Math.min(retryAttempt+1,6);const delay=Math.min(15000,1200*Math.pow(2,retryAttempt-1));emitStatus({state:'retrying',retryIn:delay});retryTimer=setTimeout(()=>{retryTimer=null;syncNow({manual:false,force:true,checkRemote:true}).catch(()=>{})},delay)}
  function getRecord(db,dataset,key){const value=db?.[dataset];if(Array.isArray(value)){for(let i=0;i<value.length;i++)if(recordKey(dataset,value[i],i)===key)return value[i];return undefined}return key==='__value__'?value:undefined}
  function applyRecord(db,dataset,key,value,deleted){if(key==='__value__'){if(deleted)delete db[dataset];else db[dataset]=clone(value);return}if(!Array.isArray(db[dataset]))db[dataset]=[];const arr=db[dataset],idx=arr.findIndex((row,i)=>recordKey(dataset,row,i)===key);if(deleted){if(idx>=0)arr.splice(idx,1)}else if(idx>=0)arr[idx]=clone(value);else arr.push(clone(value))}
  function capture(db){if(suppress||!tenant())return 0;const next=snapshotDb(db);if(!snapshot){snapshot=next;mirrorDb(db).catch(()=>{});return 0}let changed=0;const datasets=new Set([...Object.keys(snapshot),...Object.keys(next)]);for(const dataset of datasets){const a=snapshot[dataset]?.map||{},b=next[dataset]?.map||{},keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const key of keys){if(snapHash(a[key])===snapHash(b[key]))continue;if(dataset==='stock'||dataset==='repStock'){if(b[key]===undefined){if(enqueue(dataset,key,true))changed++;continue}const delta=Number((snapQty(b[key])-snapQty(a[key])).toFixed(8));if(Math.abs(delta)>1e-10&&enqueue(dataset,key,false,revNow(),{mode:'stockDelta',delta}))changed++;continue}if(enqueue(dataset,key,b[key]===undefined))changed++}}snapshot=next;mirrorDb(db).catch(()=>{});if(changed)schedule(180);return changed}
  function seedAll(db){const next=snapshotDb(db);snapshot=next;let n=0;for(const [dataset,entry] of Object.entries(next))for(const key of Object.keys(entry.map||{})){enqueue(dataset,key,false);n++}mirrorDb(db).catch(()=>{});if(n)schedule(150);return n}
  function openIdb(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return resolve(null);const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE,{keyPath:'tenantId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  function compactMirrorDb(source,level=1){const x=clone(source||{}),limits=level>1?{audit:120,notifications:80,chatMessages:120,heldOrders:40}:{audit:500,notifications:200,chatMessages:300,heldOrders:100};for(const[k,max]of Object.entries(limits))if(Array.isArray(x[k])&&x[k].length>max)x[k]=x[k].slice(0,max);return x}
  async function putMirrorRecord(idb,record){return new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}
  async function mirrorDb(db,opts={}){const t=tenant();if(!t)return;const idb=await openIdb();if(!idb)return;const savedAt=Number(opts.savedAt)||Date.now();try{await putMirrorRecord(idb,{tenantId:t,db:clone(db),savedAt})}catch(_){try{await putMirrorRecord(idb,{tenantId:t,db:compactMirrorDb(db,1),savedAt,compacted:true})}catch(__){await putMirrorRecord(idb,{tenantId:t,db:compactMirrorDb(db,2),savedAt,compacted:true})}}finally{idb.close()}}
  async function readMirror(t=tenant()){if(!t)return null;const idb=await openIdb();if(!idb)return null;const result=await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly'),req=tx.objectStore(IDB_STORE).get(t);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});idb.close();return result}
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
  async function ensureSyncSchema(){const t=tenant(),cfg=dbCfg(),direct=window.AlMezanActivation?.tursoDirect;if(!t||!cfg?.databaseURL||!cfg?.authToken||!direct)throw Error('بيانات المزامنة غير متاحة.');if(schemaTenant===t)return{cfg,direct,table:direct.table(cfg),metaTable:direct.table(cfg)+'_syncmeta',seqTable:direct.table(cfg)+'_sequences'};await direct.ensure(cfg);const table=direct.table(cfg),metaTable=table+'_syncmeta',seqTable=table+'_sequences';const[info]=await direct.pipeline(cfg,[{sql:`PRAGMA table_info(${table})`,args:[]}]);const cols=rowsOf(direct,info).map(x=>String(x.name));if(!cols.includes('sync_batch')){try{await direct.pipeline(cfg,[{sql:`ALTER TABLE ${table} ADD COLUMN sync_batch INTEGER NOT NULL DEFAULT 0`,args:[]}])}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}await direct.pipeline(cfg,[{sql:`CREATE TABLE IF NOT EXISTS ${metaTable} (id INTEGER PRIMARY KEY CHECK(id=1), batch INTEGER NOT NULL DEFAULT 0)`,args:[]},{sql:`CREATE TABLE IF NOT EXISTS ${seqTable} (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,args:[]}]);schemaTenant=t;return{cfg,direct,table,metaTable,seqTable}}
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
  async function pushPending(){
    const pending=readPending(),entries=Object.entries(pending);if(!entries.length)return{uploaded:0,remaining:0};
    const s=await ensureSyncSchema(),appDb=window.AlMezan?.db||{};let uploaded=0;
    for(let offset=0;offset<entries.length;offset+=PUSH_BATCH_SIZE){
      const batch=entries.slice(offset,offset+PUSH_BATCH_SIZE),statements=[{sql:'BEGIN IMMEDIATE',args:[]},{sql:`INSERT INTO ${s.metaTable}(id,batch) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET batch=batch+1`,args:[]}];let maxSaleSeq=0;
      for(const[,op]of batch){
        const current=getRecord(appDb,op.dataset,op.key),deleted=op.deleted||current===undefined,envelope={v:deleted?null:current,deleted,rev:op.rev,deviceId:op.deviceId||deviceId()};
        if(op.dataset==='sales'&&!deleted)maxSaleSeq=Math.max(maxSaleSeq,documentSequence(current?.number));
        if((op.dataset==='stock'||op.dataset==='repStock')&&op.mode==='stockDelta'){
          const parts=String(op.key).split('::'),fallback=op.dataset==='repStock'?{repId:parts[0]||'',productId:parts[1]||'',qtyBase:Number(op.delta||0)}:{productId:parts[0]||'',warehouseId:parts[1]||'',qtyBase:Number(op.delta||0)},base=current&&typeof current==='object'?{...current,qtyBase:Number(current.qtyBase||0)}:fallback,dev=op.deviceId||deviceId(),devKey='d'+hashText(dev),clockPath=`$.stockClock.${devKey}`,rev=Number(op.rev),insertEnvelope={v:base,deleted:false,rev,deviceId:dev,stockClock:{[devKey]:rev}};
          statements.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=json_set(CASE WHEN json_type(${s.table}.payload,'$.v')='object' THEN ${s.table}.payload ELSE excluded.payload END,'$.v.qtyBase',COALESCE(CAST(json_extract(${s.table}.payload,'$.v.qtyBase') AS REAL),0)+?,'$.rev',?,'$.deviceId',?,'${clockPath}',?),deleted=0,updated_at=?,sync_batch=(SELECT batch FROM ${s.metaTable} WHERE id=1) WHERE COALESCE(CAST(json_extract(${s.table}.payload,'${clockPath}') AS INTEGER),0)<?`,args:[cloudPath(op.dataset,op.key),JSON.stringify(insertEnvelope),0,rev,Number(op.delta||0),rev,dev,rev,rev,rev]});
          continue
        }
        statements.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at,sync_batch=excluded.sync_batch WHERE excluded.sync_batch>=${s.table}.sync_batch`,args:[cloudPath(op.dataset,op.key),JSON.stringify(envelope),deleted?1:0,Number(op.rev)]})
      }
      if(maxSaleSeq>0)statements.push({sql:`INSERT INTO ${s.seqTable}(name,value) VALUES('sale',?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN excluded.value>value THEN excluded.value ELSE value END`,args:[maxSaleSeq]});
      statements.push({sql:'COMMIT',args:[]});
      await s.direct.pipeline(s.cfg,statements,Math.max(30000,batch.length*1300));
      const latest=readPending();for(const[pk,op]of batch){if(Number(latest[pk]?.rev||0)===Number(op.rev)){delete latest[pk];uploaded++}}writePending(latest)
    }
    const m=readMeta();m.lastPushAt=Date.now();writeMeta(m);return{uploaded,remaining:pendingCount()}
  }
  async function applyRows(rows,remoteBatch){
    const pending=readPending(),meta=readMeta(),current=clone(window.AlMezan?.db||{}),changedDatasets=new Set(),changedRecords={};let applied=0;
    for(const row of rows){
      const parsed=parseCloudPath(row.path);if(!parsed)continue;
      const pk=pkey(parsed.dataset,parsed.key),rowBatch=Number(row.sync_batch||0),localBatch=Number(meta.records?.[pk]?.batch||0),localPending=pendingRevForRecord(pending,parsed.dataset,parsed.key);
      let envelope=row.payload;if(typeof envelope==='string'){try{envelope=JSON.parse(envelope)}catch(_){envelope=null}}
      const deleted=Number(row.deleted)===1||envelope?.deleted===true;let value=envelope&&Object.prototype.hasOwnProperty.call(envelope,'v')?envelope.v:envelope;
      if(!allowRemoteRecordForRole(parsed.dataset,parsed.key,value))continue;
      const qtyDataset=parsed.dataset==='stock'||parsed.dataset==='repStock';
      if(!qtyDataset&&localPending>0)continue;
      if(!qtyDataset&&rowBatch>0&&localBatch>=rowBatch)continue;
      if(qtyDataset&&!deleted&&value&&localPending>0){value=clone(value);value.qtyBase=Number((Number(value.qtyBase||0)+pendingQtyDelta(pending,parsed.dataset,parsed.key)).toFixed(8))}
      const before=getRecord(current,parsed.dataset,parsed.key),beforeHash=before===undefined?'__missing__':hashText(stableJson(before)),afterHash=deleted?'__deleted__':hashText(stableJson(value));
      if(qtyDataset&&rowBatch>0&&localBatch>=rowBatch&&beforeHash===afterHash)continue;
      applyRecord(current,parsed.dataset,parsed.key,value,deleted);
      meta.records[pk]={rev:Number(row.updated_at||envelope?.rev||0),batch:rowBatch,deleted,hash:deleted?'':hashText(stableJson(value))};
      if(!qtyDataset&&pending[pk]&&localPending<=Number(row.updated_at||0))delete pending[pk];
      changedDatasets.add(parsed.dataset);(changedRecords[parsed.dataset]||(changedRecords[parsed.dataset]=[])).push(parsed.key);applied++
    }
    meta.protocol=4;meta.remoteBatch=Math.max(Number(meta.remoteBatch||0),Number(remoteBatch||0));meta.batchInitialized=true;meta.lastPullAt=Date.now();meta.lastSuccessAt=Date.now();writeMeta(meta);writePending(pending);
    const detail={at:Date.now(),datasets:[...changedDatasets],records:changedRecords,remoteBatch:Number(remoteBatch||0),applied};
    if(applied&&window.AlMezan?.replaceDBFromSync){suppress=true;try{window.AlMezan.replaceDBFromSync(current,detail)}finally{suppress=false}snapshot=snapshotDb(window.AlMezan.db);await mirrorDb(window.AlMezan.db).catch(()=>{})}
    return{applied,detail}
  }
  async function pullChanges({force=false}={}){
    const s=await ensureSyncSchema(),meta=readMeta(),remoteBatch=await readRemoteBatch(s),last=Number(meta.remoteBatch||0);if(meta.batchInitialized&&!force&&remoteBatch<=last)return{applied:0,remoteRows:0,remoteBatch,changedDatasets:[]};
    const lo=basePath(),hi=lo+'\uffff';let rows=[];
    if(!meta.batchInitialized){const[r]=await retryRead(()=>s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? ORDER BY path`,args:[lo,hi]}],60000),3);rows=rowsOf(s.direct,r).map(x=>({...x,payload:(()=>{try{return typeof x.payload==='string'?JSON.parse(x.payload):x.payload}catch(_){return x.payload}})()}))}
    else if(remoteBatch>last){const[r]=await retryRead(()=>s.direct.pipeline(s.cfg,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? AND sync_batch>? ORDER BY sync_batch ASC,path ASC`,args:[lo,hi,last]}],60000),3);rows=rowsOf(s.direct,r).map(x=>({...x,payload:(()=>{try{return typeof x.payload==='string'?JSON.parse(x.payload):x.payload}catch(_){return x.payload}})()}))}
    const out=await applyRows(rows,remoteBatch);return{applied:out.applied,remoteRows:rows.length,remoteBatch,changedDatasets:out.detail?.datasets||[],changedRecords:out.detail?.records||{},bootstrap:!meta.batchInitialized}
  }
  function probeInterval(){const active=Date.now()-lastActivityAt<30000;if(window.AlMezan?.state?.view==='cashier')return active?CASHIER_ACTIVE_MS:CASHIER_IDLE_MS;return active?REMOTE_ACTIVE_MS:REMOTE_IDLE_MS}
  async function checkRemote({force=false}={}){if(busy||!tenant()||navigator.onLine===false||document.visibilityState==='hidden')return{skipped:true};const now=Date.now(),interval=pendingCount()?Math.min(3000,probeInterval()):probeInterval();if(!force&&now-lastProbeAt<Math.max(1000,interval-350))return{throttled:true};lastProbeAt=now;try{if(pendingCount())return syncNow({manual:false,force:true,checkRemote:true});const s=await ensureSyncSchema(),remote=await readRemoteBatch(s),local=Number(readMeta().remoteBatch||0);if(!readMeta().batchInitialized||remote>local)return syncNow({manual:false,checkRemote:true});return{changed:false,remoteBatch:remote}}catch(error){if(pendingCount())scheduleRetry();return{error:true,message:String(error?.message||error)}}}
  async function syncNow({manual=false,force=false,checkRemote:wantRemote=false}={}){if(busy){if(manual)window.AlMezan?.toast?.('المزامنة جارية الآن، انتظر لحظة.','warning');return{busy:true,remaining:pendingCount()}}if(!tenant())return{unavailable:true,remaining:pendingCount()};if(navigator.onLine===false){emitStatus({state:'offline'});if(manual)window.AlMezan?.toast?.('أنت الآن دون إنترنت. التغييرات محفوظة محلياً وستتم مزامنتها عند عودة الاتصال.','warning');return{offline:true,remaining:pendingCount()}};const hasPending=pendingCount()>0;if(!manual&&!force&&!wantRemote&&!hasPending)return{idle:true,remaining:0};busy=true;emitStatus({state:'syncing'});try{const pushed=hasPending?await pushPending():{uploaded:0,remaining:0},pulled=(manual||wantRemote||hasPending)?await pullChanges({force:manual||force}):{applied:0,remoteRows:0,changedDatasets:[]},result={...pushed,...pulled,remaining:pendingCount(),success:true};clearRetry();emitStatus({state:'success',lastSuccessAt:Date.now()});try{window.dispatchEvent(new CustomEvent('almezan:sync-complete',{detail:result}))}catch(_){}if(manual)window.AlMezan?.toast?.(result.remaining?`تمت المزامنة وبقي ${result.remaining} تغيير معلق وسيعاد إرساله تلقائياً.`:result.applied?`اكتملت المزامنة وتحدثت الشاشة (${result.applied} تغيير).`:'اكتملت المزامنة — البيانات محدثة.','success');if(result.remaining)scheduleRetry();return result}catch(error){console.error('AlMeezan sync:',error);emitStatus({state:'error',message:String(error?.message||error)});if(pendingCount())scheduleRetry();if(manual)window.AlMezan?.toast?.('تعذر الاتصال الآن. بياناتك محفوظة وسيعيد النظام المزامنة تلقائياً.','warning',5200);return{error:true,message:String(error?.message||error),remaining:pendingCount()}}finally{busy=false;emitStatus()}}
  function schedule(delay=800){if(!pendingCount())return;clearTimeout(timer);timer=setTimeout(()=>syncNow({manual:false}).catch(()=>{}),Math.max(100,Number(delay)||800))}
  async function initialize(db,{seed=false}={}){const t=tenant();if(!t)return{tenant:''};try{await navigator.storage?.persist?.()}catch(_){}const mirror=await readMirror(t).catch(()=>null),fastSavedAt=Number(localStorage.getItem(DB_SAVED_PREFIX+encodeURIComponent(t))||0);if(mirror?.db&&(window.AlMezan?.hasTenantLocalData?.()===false||Number(mirror.savedAt||0)>fastSavedAt)){suppress=true;try{window.AlMezan.replaceDBFromSync(mirror.db)}finally{suppress=false}db=window.AlMezan.db}snapshot=snapshotDb(db||window.AlMezan?.db||{});if(seed)seedAll(db||window.AlMezan.db);emitStatus();setTimeout(()=>{if(pendingCount())schedule(250);else checkRemote({force:true}).catch(()=>{})},500);return{tenant:t,pending:pendingCount(),mirror:!!mirror}}
  function resetForTenant(db){schemaTenant='';clearRetry();snapshot=snapshotDb(db||{});emitStatus()}
  function isRemoteEmptyResult(result){return Number(result?.remoteRows||0)===0}
  function needsBootstrap(){const m=readMeta();return !m.batchInitialized&&pendingCount()===0}
  function requestSync(delay=250){if(pendingCount())schedule(delay)}
  ['pointerdown','keydown','input','touchstart'].forEach(type=>document.addEventListener(type,()=>{lastActivityAt=Date.now()},{capture:true,passive:true}));window.addEventListener('online',()=>{retryAttempt=0;lastActivityAt=Date.now();if(pendingCount())schedule(200);else checkRemote({force:true}).catch(()=>{})});window.addEventListener('offline',()=>emitStatus({state:'offline'}));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastActivityAt=Date.now();setTimeout(()=>checkRemote({force:true}).catch(()=>{}),350)}});window.addEventListener('focus',()=>{lastActivityAt=Date.now();checkRemote({force:true}).catch(()=>{})});setInterval(()=>checkRemote().catch(()=>{}),900);
  window.AlMezanSync={version:4.0,capture,seedAll,initialize,resetForTenant,syncNow,pushPending,pullAll:pullChanges,pullChanges,checkRemote,pendingCount,mirrorDb,readMirror,isRemoteEmptyResult,needsBootstrap,requestSync,peekDocumentNumber,reserveDocumentNumber,claimDocumentNumber,get busy(){return busy},get suppress(){return suppress}};
})();

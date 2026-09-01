/* Al-Meezan Activation Runtime v1
 * Offline-first portable encrypted activation files + Turso direct helpers.
 * Browser-side encryption protects credentials from casual inspection only;
 * real security still depends on Turso token permissions and device security.
 */
(() => {
  'use strict';
  const APP_TAG='ALMEEZAN_ACTIVATION_V1';
  const RUNTIME_KEY='almezan_activation_runtime_v1';
  const MASTER_KEY='almezan_master_runtime_v1';
  const LOCAL_DB_ACCESS_KEY='almezan_local_db_access_v1';
  const VERIFIED_KEY='almezan_verified_files_v1';
  const enc=new TextEncoder(), dec=new TextDecoder();
  const safe=v=>String(v??'').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const b64=u8=>btoa(String.fromCharCode(...u8));
  const unb64=s=>Uint8Array.from(atob(String(s||'')),c=>c.charCodeAt(0));
  const K=['AM','_8Q','2x','!m','7Z','b4','_r','9P','@k','5N'].join('');
  const mask=s=>enc.encode(String(s));
  function xor(bytes,key){const out=new Uint8Array(bytes.length),m=mask(key);for(let i=0;i<bytes.length;i++)out[i]=bytes[i]^m[i%m.length];return out}
  const wrapText=s=>b64(xor(enc.encode(String(s||'')),K));
  const unwrapText=s=>dec.decode(xor(unb64(s),K));

  async function derive(password,salt,iterations=220000){
    const material=await crypto.subtle.importKey('raw',enc.encode(String(password)),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function aesEncrypt(text,password,saltBytes=null){
    const salt=saltBytes||crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(password,salt);
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(String(text))));
    return {salt,iv,cipher};
  }
  async function aesDecrypt(cipher,password,salt,iv){
    const key=await derive(password,salt);return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher));
  }

  async function sealObject(value,secret){
    const pass=safe(secret);if(!pass)throw new Error('مفتاح الحماية غير متوفر.');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(pass,salt,240000);
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value))));
    const out=new Uint8Array(28+cipher.length);out.set(salt,0);out.set(iv,16);out.set(cipher,28);return 'AMV1.'+b64(out);
  }
  async function openObject(value,secret){
    const text=safe(value);if(!text.startsWith('AMV1.'))throw new Error('بيانات الخزنة غير صالحة.');
    const raw=unb64(text.slice(5));if(raw.length<45)throw new Error('بيانات الخزنة تالفة.');
    const key=await derive(safe(secret),raw.slice(0,16),240000);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(16,28)},key,raw.slice(28));return JSON.parse(dec.decode(plain));
  }

  function tursoTable(db){return safe(db?.table||'almezan_rtdb').replace(/[^a-zA-Z0-9_]/g,'')||'almezan_rtdb'}
  function tursoPipelineUrl(db){const url=safe(db?.databaseURL);if(!url)throw new Error('رابط قاعدة البيانات غير موجود.');if(!/^(?:libsql|https?):\/\//i.test(url))throw new Error('رابط قاعدة البيانات غير صالح.');return url.replace(/^libsql:\/\//i,'https://').replace(/\/+$/,'')+'/v2/pipeline'}
  function arg(value){if(value==null)return{type:'null'};if(typeof value==='number'&&Number.isInteger(value))return{type:'integer',value:String(value)};if(typeof value==='number')return{type:'float',value:String(value)};return{type:'text',value:String(value)}}
  function cell(c){if(!c||c.type==='null')return null;if(c.type==='integer'||c.type==='float'){const n=Number(c.value);return Number.isFinite(n)?n:c.value}return c.value}
  function rows(result){const names=(result?.cols||[]).map(c=>c.name);return(result?.rows||[]).map(r=>Object.fromEntries(r.map((c,i)=>[names[i],cell(c)])))}
  async function pipeline(db,statements,timeout=26000){
    const token=safe(db?.authToken);if(!token)throw new Error('توكن قاعدة البيانات غير موجود.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(tursoPipelineUrl(db),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({requests:[...statements.map(st=>({type:'execute',stmt:{sql:st.sql,args:(st.args||[]).map(arg)}})),{type:'close'}]}),signal:controller.signal,cache:'no-store'});
      const text=await response.text();if(!response.ok)throw new Error(`Turso HTTP ${response.status}: ${text.slice(0,220)}`);
      let data;try{data=JSON.parse(text)}catch(_){throw new Error('استجابة قاعدة البيانات غير صالحة.');}
      return statements.map((_,i)=>{const item=data?.results?.[i];if(!item||item.type!=='ok')throw new Error(`Turso SQL: ${item?.error?.message||item?.error||'UNKNOWN'}`);return item.response?.result||{cols:[],rows:[],affected_row_count:0}});
    }catch(error){if(error?.name==='AbortError')throw new Error('انتهت مهلة الاتصال بقاعدة البيانات.');throw error}finally{clearTimeout(timer)}
  }
  async function ensure(db){const table=tursoTable(db);await pipeline(db,[{sql:`CREATE TABLE IF NOT EXISTS ${table} (path TEXT PRIMARY KEY,payload TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)`,args:[]}]);return true}
  function normalizePath(path){return safe(path).replace(/\.json(?:\?.*)?$/i,'').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/')}
  function parsePayload(v){if(v==null)return null;if(typeof v!=='string')return v;try{return JSON.parse(v)}catch(_){return v}}
  async function readExact(db,path,{ensureSchema=false}={}){if(ensureSchema)await ensure(db);const table=tursoTable(db),p=normalizePath(path);const[r]=await pipeline(db,[{sql:`SELECT payload,deleted,updated_at FROM ${table} WHERE path=? LIMIT 1`,args:[p]}]);const row=rows(r)[0];if(!row)return undefined;return Number(row.deleted)===1?null:parsePayload(row.payload)}
  async function readExactRow(db,path,{ensureSchema=false}={}){if(ensureSchema)await ensure(db);const table=tursoTable(db),p=normalizePath(path);const[r]=await pipeline(db,[{sql:`SELECT path,payload,deleted,updated_at FROM ${table} WHERE path=? LIMIT 1`,args:[p]}]);const row=rows(r)[0];return row?{...row,payload:parsePayload(row.payload)}:undefined}
  async function listPrefix(db,path,{ensureSchema=false}={}){if(ensureSchema)await ensure(db);const table=tursoTable(db),p=normalizePath(path),hi=p+'\uffff';const[r]=await pipeline(db,[{sql:`SELECT path,payload,deleted,updated_at FROM ${table} WHERE path>=? AND path<? ORDER BY path`,args:[p,hi]}],60000);return rows(r).map(x=>({...x,payload:parsePayload(x.payload)}))}
  async function writeExact(db,path,value,updatedAt=Date.now(),deleted=false){await ensure(db);const table=tursoTable(db),p=normalizePath(path);await pipeline(db,[{sql:`INSERT INTO ${table}(path,payload,deleted,updated_at) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at`,args:[p,JSON.stringify(value),deleted?1:0,Number(updatedAt)||Date.now()]}]);return true}
  async function deletePrefix(db,path){await ensure(db);const table=tursoTable(db),p=normalizePath(path),like=p+'/%';await pipeline(db,[{sql:`DELETE FROM ${table} WHERE path=? OR path LIKE ?`,args:[p,like]}],60000);return true}
  const tursoDirect=Object.freeze({table:tursoTable,pipeline,rows,ensure,readExact,readExactRow,listPrefix,writeExact,deletePrefix,normalizePath});

  async function packOpaque(payload){
    const activationKey=safe(payload.activationKey);if(!activationKey)throw new Error('ملف التفعيل يحتاج مفتاح شركة.');
    const keySalt=crypto.getRandomValues(new Uint8Array(16)),wrapped=await aesEncrypt(activationKey,K,keySalt),keyBlob=new Uint8Array(12+wrapped.cipher.length);keyBlob.set(wrapped.iv,0);keyBlob.set(wrapped.cipher,12);
    const payloadSalt=crypto.getRandomValues(new Uint8Array(16)),payloadIv=crypto.getRandomValues(new Uint8Array(12)),payloadKey=await derive(activationKey,payloadSalt);
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:payloadIv},payloadKey,enc.encode(JSON.stringify({...payload,app:APP_TAG}))));
    const out=new Uint8Array(1+16+2+keyBlob.length+16+12+cipher.length);let o=0;out[o++]=0x6d;out.set(keySalt,o);o+=16;out[o++]=(keyBlob.length>>8)&255;out[o++]=keyBlob.length&255;out.set(keyBlob,o);o+=keyBlob.length;out.set(payloadSalt,o);o+=16;out.set(payloadIv,o);o+=12;out.set(cipher,o);return b64(out);
  }
  async function unpackOpaque(text){
    let raw;try{raw=unb64(String(text||'').replace(/\s+/g,''))}catch(_){throw new Error('ملف التفعيل غير صالح.');}
    if(raw.length<90||raw[0]!==0x6d)throw new Error('ملف التفعيل غير صالح.');let o=1;const keySalt=raw.slice(o,o+16);o+=16;const len=(raw[o++]<<8)|raw[o++];if(len<29||o+len+44>raw.length)throw new Error('ملف التفعيل تالف.');const keyBlob=raw.slice(o,o+len);o+=len;
    let activationKey='';try{activationKey=await aesDecrypt(keyBlob.slice(12),K,keySalt,keyBlob.slice(0,12))}catch(_){throw new Error('تعذر التحقق من ملف التفعيل.');}
    const payloadSalt=raw.slice(o,o+16);o+=16;const payloadIv=raw.slice(o,o+12);o+=12;const cipher=raw.slice(o);try{const key=await derive(activationKey,payloadSalt),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:payloadIv},key,cipher),payload=JSON.parse(dec.decode(plain));if(payload?.app!==APP_TAG||safe(payload.activationKey)!==safe(activationKey))throw new Error();return payload}catch(_){throw new Error('فشل فك ملف التفعيل أو تم العبث به.');}
  }
  async function makeFile(payload){const value={...clone(payload),fileId:payload.fileId||(crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random()}`),app:APP_TAG};return{value,opaque:await packOpaque(value)}}
  async function downloadActivationFile(payload,fileName){const made=await makeFile(payload),name=(fileName||`${payload.companyName||'AlMeezan'}-login.mzauth`).replace(/[\\/:*?"<>|]+/g,'_').replace(/\.(?:mzauth|ctauth)$/i,'')+'.mzauth',blob=new Blob([made.opaque],{type:'application/octet-stream'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1200);return made}
  async function parseActivationFile(file){if(!file)throw new Error('اختر ملف التفعيل أولاً.');if(!/\.mzauth$/i.test(file.name||''))throw new Error('امتداد الملف غير معتمد. استخدم ملف .mzauth');const text=(await file.text()).trim();if(!text)throw new Error('ملف التفعيل فارغ.');const p=await unpackOpaque(text);if(p.expiresAt&&Date.now()>=new Date(p.expiresAt).getTime())throw new Error('انتهت صلاحية ملف التفعيل.');return p}

  const scopedDbKey=id=>`${LOCAL_DB_ACCESS_KEY}::${encodeURIComponent(safe(id)||'current')}`;
  function saveDatabaseAccess(db,meta={}){const identity=safe(meta.companyId||meta.tenantId||readRuntime()?.companyId),cfg={databaseURL:safe(db?.databaseURL),authToken:safe(db?.authToken),table:safe(db?.table||'almezan_rtdb'),companyId:identity,tenantId:identity,savedAt:Date.now()};if(!cfg.databaseURL||!cfg.authToken)throw new Error('بيانات قاعدة الشركة غير مكتملة.');const wrapped=wrapText(JSON.stringify(cfg));localStorage.setItem(LOCAL_DB_ACCESS_KEY,wrapped);if(identity)localStorage.setItem(scopedDbKey(identity),wrapped);return cfg}
  function readDatabaseAccess(identity=''){const wanted=safe(identity||readRuntime()?.companyId);for(const key of [wanted?scopedDbKey(wanted):'',LOCAL_DB_ACCESS_KEY].filter(Boolean)){try{const raw=localStorage.getItem(key),cfg=raw?JSON.parse(unwrapText(raw)):null;if(cfg?.databaseURL&&cfg?.authToken&&(!wanted||!cfg.companyId||cfg.companyId===wanted))return cfg}catch(_){}}return null}
  function activatePayload(payload){if(!payload||payload.app!==APP_TAG)throw new Error('ملف التفعيل غير صالح.');const cfg=payload.database||{},runtime={activationKey:payload.activationKey,fileId:payload.fileId,type:payload.type,companyId:payload.companyId||payload.tenantId,tenantId:payload.tenantId||payload.companyId,companyKey:payload.companyKey||payload.activationKey,companyName:payload.companyName,account:payload.account||null,permissions:payload.permissions||payload.account?.permissions||[],status:payload.status||'active',plan:payload.plan||'lifetime',expiresAt:payload.expiresAt||'',database:{databaseURL:safe(cfg.databaseURL),authToken:safe(cfg.authToken),table:safe(cfg.table||'almezan_rtdb')},rootPath:payload.rootPath||'almezan/companies',activatedAt:Date.now()};localStorage.setItem(RUNTIME_KEY,wrapText(JSON.stringify(runtime)));if(runtime.database.databaseURL&&runtime.database.authToken)saveDatabaseAccess(runtime.database,{companyId:runtime.companyId});window.dispatchEvent(new CustomEvent('almezan:activation-loaded',{detail:{...runtime,database:{...runtime.database,authToken:''}}}));return runtime}
  function readRuntime(){try{const raw=localStorage.getItem(RUNTIME_KEY);return raw?JSON.parse(unwrapText(raw)):null}catch(_){return null}}
  function clearRuntime(){localStorage.removeItem(RUNTIME_KEY)}
  function saveMasterConfig(cfg){const master={database:{databaseURL:safe(cfg.databaseURL),authToken:safe(cfg.authToken),table:safe(cfg.table||'almezan_rtdb')},adminRootPath:cfg.adminRootPath||'almezan/admin',rootPath:cfg.rootPath||'almezan/companies',savedAt:Date.now()};if(!master.database.databaseURL||!master.database.authToken)throw new Error('بيانات قاعدة الأم غير مكتملة.');localStorage.setItem(MASTER_KEY,wrapText(JSON.stringify(master)));return master}
  function readMasterConfig(){try{const raw=localStorage.getItem(MASTER_KEY);return raw?JSON.parse(unwrapText(raw)):null}catch(_){return null}}
  function clearMasterConfig(){localStorage.removeItem(MASTER_KEY)}

  function verificationMap(){try{return JSON.parse(localStorage.getItem(VERIFIED_KEY)||'{}')}catch(_){return{}}}
  function markVerified(payload,access){const all=verificationMap();all[payload.fileId]={fileId:payload.fileId,companyId:payload.companyId||payload.tenantId,companyKey:payload.companyKey||payload.activationKey,accountId:payload.account?.id||'',authVersion:payload.account?.authVersion||'',status:access?.status||'active',expiresAt:access?.endAt||payload.expiresAt||'',verifiedAt:Date.now()};localStorage.setItem(VERIFIED_KEY,JSON.stringify(all));return all[payload.fileId]}
  function cachedVerification(payload){const v=verificationMap()[payload?.fileId];if(!v)return null;if(v.companyId!==String(payload.companyId||payload.tenantId||''))return null;if(v.companyKey!==String(payload.companyKey||payload.activationKey||''))return null;if(v.accountId!==String(payload.account?.id||''))return null;if(String(v.authVersion||'')!==String(payload.account?.authVersion||''))return null;if(v.status!=='active')return null;if(v.expiresAt&&Date.now()>=new Date(v.expiresAt).getTime())return null;return v}

  function accountPath(payload){const companyId=encodeURIComponent(String(payload.companyId||payload.tenantId||''));const base=`almezan/companies/${companyId}`;if(payload.type==='company-manager')return `${base}/access/company`;return `${base}/d/employees/${encodeURIComponent(String(payload.account?.id||''))}`}
  function unwrapRecord(value){if(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'v'))return value.deleted?null:value.v;return value}
  async function verifyCompanyAccessRemote(payload){
    const db=payload?.database||readDatabaseAccess(payload?.companyId)||{},companyId=String(payload?.companyId||payload?.tenantId||'');
    if(!companyId||!db.databaseURL||!db.authToken)throw new Error('بيانات قاعدة الشركة غير متاحة.');
    const base=`almezan/companies/${encodeURIComponent(companyId)}`,access=unwrapRecord(await readExact(db,`${base}/access/company`,{ensureSchema:true}));
    if(!access)throw new Error('مفتاح الشركة غير مسجل في قاعدة الشركة.');
    if(String(access.companyKey||'').toUpperCase()!==String(payload.companyKey||payload.activationKey||'').toUpperCase())throw new Error('ملف التفعيل لا يطابق مفتاح الشركة.');
    if(access.status!=='active')throw new Error('تم إيقاف مفتاح الشركة من الإدارة العامة.');
    if(access.endAt&&Date.now()>=new Date(access.endAt).getTime())throw new Error('انتهت مدة تفعيل الشركة.');
    try{markVerified(payload,access)}catch(_){}
    return {access,online:true};
  }
  async function verifyPayloadRemote(payload){
    const db=payload.database||readDatabaseAccess(payload.companyId)||{},companyId=String(payload.companyId||payload.tenantId||'');if(!companyId||!db.databaseURL||!db.authToken)throw new Error('ملف التفعيل لا يحتوي على قاعدة شركة صالحة.');
    const base=`almezan/companies/${encodeURIComponent(companyId)}`,access=unwrapRecord(await readExact(db,`${base}/access/company`,{ensureSchema:true}));
    if(!access)throw new Error('مفتاح الشركة غير مسجل في قاعدة الشركة.');if(String(access.companyKey||'').toUpperCase()!==String(payload.companyKey||payload.activationKey||'').toUpperCase())throw new Error('ملف التفعيل لا يطابق مفتاح الشركة.');if(access.status!=='active')throw new Error('تم إيقاف مفتاح الشركة من الإدارة العامة.');if(access.endAt&&Date.now()>=new Date(access.endAt).getTime())throw new Error('انتهت مدة تفعيل الشركة.');
    const account=payload.account||{};
    if(payload.type==='company-manager'){
      const row=access.manager;if(!row||row.active===false)throw new Error('حساب مدير الشركة غير متاح.');if(String(row.id||'')!==String(account.id||''))throw new Error('ملف المدير لا يطابق الحساب المسجل.');if(String(row.authVersion||'')!==String(account.authVersion||''))throw new Error('تم إصدار ملف مدير أحدث. استخدم الملف الجديد.');
    }else{
      const row=unwrapRecord(await readExact(db,accountPath(payload)));if(!row)throw new Error('الحساب غير موجود في قاعدة الشركة أو لم تتم مزامنته بعد.');if(row.active===false)throw new Error('تم إيقاف هذا الحساب.');if(String(row.authVersion||'')!==String(account.authVersion||''))throw new Error('تم إصدار ملف دخول أحدث لهذا الحساب.');if(payload.type==='representative'&&String(row.role||'')!=='مندوب')throw new Error('الحساب لم يعد مندوباً.');
    }
    markVerified(payload,access);return {access,online:true};
  }
  function isLogicalVerificationError(error){
    const msg=String(error?.message||error||'');
    return /مفتاح الشركة غير مسجل|لا يطابق|تم إيقاف|انتهت مدة|غير متاح|تم إصدار ملف|الحساب غير موجود|تم إيقاف هذا الحساب|لم يعد مندوباً/.test(msg);
  }
  async function verifyPayload(payload,{allowOffline=true}={}){
    if(navigator.onLine!==false){
      try{return await verifyPayloadRemote(payload)}
      catch(error){
        if(isLogicalVerificationError(error))throw error;
        const cached=allowOffline?cachedVerification(payload):null;
        if(cached)return{access:cached,online:false,deferred:true,error:String(error?.message||error)};
        throw error;
      }
    }
    const cached=allowOffline?cachedVerification(payload):null;if(cached)return{access:cached,online:false,deferred:true};throw new Error('يلزم الإنترنت في أول استخدام لهذا الملف على هذا الجهاز. بعد التحقق الأول يعمل الدخول دون إنترنت.')
  }
  function buildRolePayload(type,account,extra={}){const rt=readRuntime()||{};return{type,activationKey:rt.companyKey||rt.activationKey,fileId:`${type}_${account?.id||Date.now()}_${account?.authVersion||''}`,companyId:rt.companyId,tenantId:rt.companyId,companyKey:rt.companyKey||rt.activationKey,companyName:rt.companyName||'الشركة',status:rt.status||'active',plan:rt.plan||'lifetime',expiresAt:rt.expiresAt||'',rootPath:rt.rootPath||'almezan/companies',database:readDatabaseAccess(rt.companyId)||rt.database||{},permissions:account?.permissions||[],account:clone(account),...extra}}
  async function prepareVerifiedRoleFile(type,account,fileName){const payload=buildRolePayload(type,account);if(window.AlMezanSync){const result=await window.AlMezanSync.syncNow({manual:false,force:true});if(result?.remaining>0||result?.error)throw new Error('الحساب محفوظ محلياً لكن لم يصل إلى قاعدة الشركة بعد. شغّل المزامنة ثم أعد المحاولة.')}await verifyPayloadRemote(payload);return downloadActivationFile(payload,fileName)}

  window.AlMezanActivation={version:1,makeFile,downloadActivationFile,parseActivationFile,activatePayload,readRuntime,clearRuntime,saveDatabaseAccess,readDatabaseAccess,saveMasterConfig,readMasterConfig,clearMasterConfig,sealObject,openObject,tursoDirect,verifyPayload,verifyPayloadRemote,verifyCompanyAccessRemote,cachedVerification,markVerified,buildRolePayload,prepareVerifiedRoleFile,constants:{APP_TAG,RUNTIME_KEY,MASTER_KEY,LOCAL_DB_ACCESS_KEY,VERIFIED_KEY}};
})();

/* AlMezan v7.90 - backup download for conflict and pre-upgrade recovery.
   No destructive reset action is provided. */
(()=>{
  'use strict';
  const A=window.AlMezan;
  if(!A)return;
  A.registerAction('sync-export-recovery',async b=>{
    b.disabled=true;
    try{
      const result=await window.AlMezanSync?.exportRevisionHistory?.();
      if(!result)throw Error('محرك المزامنة غير متاح.');
      A.toast(`تم تنزيل ملف الاستعادة. نسخ السجلات السابقة: ${result.versions}، تغييرات تنتظر المزامنة: ${result.pending}.`,'success',5200);
    }catch(e){A.toast(`تعذر تنزيل نسخة الاستعادة: ${e.message||e}`,'error',5500)}finally{b.disabled=false}
  });
  // Programmatic focus inside newly opened dialogs must not raise the Android
  // soft keyboard. Browser-native focus caused by actually tapping a field stays
  // fully functional; Tab navigation remains accessible on physical keyboards.
  let directFieldIntent=0;
  const isField=el=>!!el?.matches?.('input:not([type=hidden]),textarea,select,[contenteditable="true"]');
  document.addEventListener('pointerdown',e=>{if(isField(e.target))directFieldIntent=Date.now()+1200},true);
  document.addEventListener('keydown',e=>{if(e.key==='Tab')directFieldIntent=Date.now()+1200},true);
  const nativeFocus=HTMLElement.prototype.focus;
  HTMLElement.prototype.focus=function(...args){
    const inDialog=!!this.closest?.('#modalRoot .modal');
    const inMobileCashier=!!this.closest?.('.cashier-page')&&window.matchMedia?.('(max-width: 900px)')?.matches;
    if(isField(this)&&(inDialog||inMobileCashier)&&Date.now()>directFieldIntent&&document.activeElement!==this)return;
    return nativeFocus.apply(this,args);
  };
  let currentPending=0;
  window.addEventListener('almezan:sync-status',e=>{
    currentPending=Number(e.detail?.pending||0);
    const count=document.getElementById('v790PendingCount');
    if(count)count.textContent=currentPending?`تغييرات تنتظر المزامنة: ${currentPending}`:'جميع التغييرات المحلية المعلّقة تم إرسالها';
  });
  function mount(){
    if(A.state?.view!=='settings')return;
    const workspace=document.getElementById('workspace'),target=workspace?.querySelector('#printerManagerSection')||workspace?.querySelector('#settingsForm');
    if(!target||document.getElementById('v790RecoveryActions'))return;
    const holder=document.createElement('section');
    holder.id='v790RecoveryActions';holder.className='setting-group';
    holder.style.cssText='margin-top:15px;padding:14px;border:1px solid #cad4e0;border-radius:9px;background:#f9fbfd';
    holder.innerHTML=`<h3 style="font-size:15px;margin:0 0 7px">حماية البيانات والمزامنة</h3>
      <div id="v790PendingCount" style="margin-bottom:10px;color:#344256;font-size:13px">تغييرات تنتظر المزامنة: ${currentPending}</div>
      <button type="button" class="btn btn-secondary" data-action="sync-export-recovery">${A.I('file',17)} تنزيل نسخة الاستعادة وسجل التعديلات</button>
      <p style="margin:8px 0 0;color:#5b6778;font-size:12px">يحفظ النظام نسخة البيانات السابقة للتحديث والسجلات السحابية قبل الاستبدال، للمراجعة عند حدوث تعارض. لا يحذف هذا الزر أي بيانات.</p>`;
    target.insertAdjacentElement('afterend',holder);
  }
  const workspace=document.getElementById('workspace');
  if(workspace){const obs=new MutationObserver(()=>{if(A.state?.view==='settings')requestAnimationFrame(mount)});obs.observe(workspace,{subtree:false,childList:true});}
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-view="settings"]'))setTimeout(mount,100)},true);
  window.addEventListener('almezan:data-synced',mount);
  mount();
})();

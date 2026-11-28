"use client";
import {publishChildScopeChange} from "@/lib/ledger-invalidation";
import {createPortal} from "react-dom";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {ChildPasswordDialog} from "./child-password-dialog";
type Status={children:{id:string;configured:boolean}[];unlocked_child_id:string|null;expires_at:string|null;server_now:string;enrollment_child_id:string|null};
type AccessContext = {childId:string; parentToken:string; parentMode:boolean};
type DisplayStatus = Status & {observation?:{context:AccessContext; deadline:number|null}};

// SQL emits zoned timestamps and may include microseconds. Round inward at each end.
function statusTime(value:unknown, roundUp:boolean) {
 const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d{1,6}))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
 if (!match) return NaN;
 const day = new Date(match[1] + 'T00:00:00Z');
 if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return NaN;
 return Date.parse(value) + (roundUp && /[1-9]/.test(match[2]?.slice(3) ?? '') ? 1 : 0);
}

function statusDeadline(s:Status, childId:string, sent:number, received:number) {
 if (!childId || s.unlocked_child_id !== childId || !s.children.some(c => c.id === childId && c.configured)) return null;
 const remaining = statusTime(s.expires_at, false) - statusTime(s.server_now, true);
 if (!Number.isFinite(remaining) || remaining > 10 * 60_000 || !Number.isFinite(sent) || sent < 0 || !Number.isFinite(received) || received < sent) return null;
 const end = sent + remaining;
 return end > received ? end : 0;
}
type Child={id:string;nickname:string};
export function ChildAccessControls({children,childId,parentToken,parentMode,parentTarget,onParentNeeded,onEnroll}:{children:Child[];childId:string;parentToken:string;parentMode:boolean;parentTarget?:HTMLElement|null;onParentNeeded:()=>void;onEnroll:(id:string)=>void}){
 const [snapshot,setStatus]=useState<DisplayStatus|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[modal,setModal]=useState<{id:string;mode:"setup"|"unlock"|"change"|"parent-set"}|null>(null),[view,setView]=useState<{id:string;password:string}|null>(null),[revealed,setRevealed]=useState(false),[firstHelp,setFirstHelp]=useState(false);
 const context=useMemo(()=>({childId,parentToken,parentMode}),[childId,parentToken,parentMode]);
 const currentContext=useRef(context);currentContext.current=context;
 const status=snapshot?.observation && snapshot.observation.context !== context ? null : snapshot;
 const reads=useRef({issued:0,settled:0});
 const generation=useRef(0),previous=useRef(childId),skipSelection=useRef(""),gate=useRef(false),deadline=useRef(0);const [,tick]=useState(0);
 const request=useCallback(async(action:string,extra:Record<string,unknown>={})=>{const res=await fetch('/api/child-access',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const v=await res.json().catch(()=>({}));if(!res.ok||v?.error)throw Error(v?.error||'child_access_failed');if(action!=='status'){window.dispatchEvent(new Event('island-child-access-changed'));publishChildScopeChange();}return v.data},[]);
 const apply=useCallback((s:Status)=>{setStatus(s);deadline.current=s.expires_at?performance.now()+Math.max(0,Date.parse(s.expires_at)-Date.parse(s.server_now)):0},[]);
 const refresh=useCallback(async()=>{
  const scope=currentContext.current, g=generation.current, id=++reads.current.issued;
  const current=()=>scope===currentContext.current && g===generation.current && id>reads.current.settled;
  const sent=performance.now();
  try {
   const s:Status=await request('status');
   if (!current()) return;
   reads.current.settled=id;
   if (!Array.isArray(s?.children) || !s.children.every(c=>c && typeof c.id==='string' && typeof c.configured==='boolean')) {
    setStatus(null);
    return;
   }
   const end=statusDeadline(s,scope.childId,sent,performance.now());
   setStatus(previous=>{
    const prior=previous?.observation;
    const sameExpiry=prior?.context===scope && previous?.expires_at===s.expires_at && previous.unlocked_child_id===s.unlocked_child_id;
    const bound=sameExpiry && prior.deadline!==null && end!==null ? Math.min(prior.deadline,end) : end;
    return {...s,observation:{context:scope,deadline:bound}};
   });
  } catch {
   if (current()) { reads.current.settled=id; setStatus(null); }
  }
 },[request]);
 const observedEnd=status?.observation ? (status.observation.deadline ?? 0) : undefined;
 useEffect(()=>{
  if (!observedEnd) return;
  const timer=setTimeout(()=>tick(x=>x+1),Math.max(0,Math.ceil(observedEnd-performance.now())));
  return ()=>clearTimeout(timer);
 },[observedEnd]);
 useEffect(()=>{void refresh();const t=setInterval(()=>{tick(x=>x+1);if(document.visibilityState!=='hidden')void refresh()},5000);const visible=()=>{if(!document.hidden)void refresh()};window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(t);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}},[refresh]);
 useEffect(()=>{if(previous.current===childId)return;previous.current=childId;generation.current++;setModal(null);setView(null);setFirstHelp(false);setStatus(null);if(skipSelection.current===childId){skipSelection.current='';setModal({id:childId,mode:'setup'});void refresh();return}void request('lock').then(apply).catch(()=>setError('锁定还未确认，请稍后重试。'))},[childId,request,apply,refresh]);
 useEffect(()=>{setView(null);setRevealed(false);setModal(m=>m?.mode==="change"||m?.mode==="parent-set"?null:m);generation.current++;setStatus(null);void refresh()},[parentToken,parentMode,refresh]);
 useEffect(()=>{if(!view)return;const t=setTimeout(()=>{setView(null);setRevealed(false)},60000);return()=>clearTimeout(t)},[view]);
 useEffect(()=>{if(parentMode&&!parentTarget){setView(null);setRevealed(false);setModal(m=>m?.mode==="change"||m?.mode==="parent-set"?null:m);generation.current++;}},[parentMode,parentTarget]);
 const child=children.find(c=>c.id===childId);const configured=!!status?.children.find(c=>c.id===childId)?.configured;const unlocked=status?.unlocked_child_id===childId&&(observedEnd??deadline.current)>performance.now();
 const open=useCallback(()=>{if(!childId)return;if(status?.enrollment_child_id===childId){setModal({id:childId,mode:'setup'});return}if(status?.children.find(c=>c.id===childId)?.configured)setModal({id:childId,mode:'unlock'});else setFirstHelp(true)},[childId,status]);
 useEffect(()=>{const f=()=>{void refresh();open()};window.addEventListener('island-child-unlock-required',f);return()=>window.removeEventListener('island-child-unlock-required',f)},[open,refresh]);
 async function manage(action:'enroll'|'view'|'change'|'parent-set',id:string){if(gate.current)return;const context=currentContext.current;const g=++generation.current;gate.current=true;setBusy(true);setError('');try{if(action==='change'||action==='parent-set'){setModal({id,mode:action});return}const v=await request(action,{child_id:id,parent_token:parentToken});if(g!==generation.current||context.parentToken!==currentContext.current.parentToken||context.parentMode!==currentContext.current.parentMode||context.childId!==currentContext.current.childId)return;generation.current++;if(action==='view'){setRevealed(false);setView({id,password:v.password})}else{skipSelection.current=previous.current===id?'':id;apply(v);setFirstHelp(false);onEnroll(id);setModal({id,mode:'setup'})}}catch{setError('还未确认，请重新解锁家长空间后再试。')}finally{gate.current=false;setBusy(false)}}
 return <>
 {parentMode?(parentTarget&&createPortal(<section className="child-password-settings"><h3>孩子密码</h3>{children.map(c=><div className="admin-row child-password-row" key={c.id}><strong>{c.nickname}</strong><span>{!status?'读取中':status.children.find(x=>x.id===c.id)?.configured?'已设置':'未设置'}</span><div className="button-row child-password-actions">{status?.children.find(x=>x.id===c.id)?.configured?<><button type="button" className="secondary" disabled={busy||!status||!parentToken} onClick={()=>void manage('view',c.id)}>查看</button><button type="button" className="secondary" disabled={busy||!status||!parentToken} onClick={()=>void manage('change',c.id)}>修改</button></>:<><button type="button" className="secondary" disabled={busy||!status||!parentToken} onClick={()=>void manage('parent-set',c.id)}>设置密码</button><button type="button" className="secondary" disabled={busy||!status||!parentToken} onClick={()=>void manage('enroll',c.id)}>让孩子设置</button></>}</div></div>)}</section>,parentTarget)):child&&unlocked&&<div className="child-access-bar"><button type="button" className="text-button" disabled={busy} onClick={()=>{const g=++generation.current;setBusy(true);setStatus(null);void request('lock').then(v=>{if(g===generation.current){generation.current++;apply(v)}}).catch(()=>setError('锁定还未确认，请重试。')).finally(()=>setBusy(false))}}>已解锁 · 锁住</button></div>}
 {error&&<p role="status" className="small">{error}</p>}
 {firstHelp&&<ChildAccessNotice title="设置我的密码" onClose={()=>setFirstHelp(false)}><p>请家长先确认你的名字，再由你自己设置密码。</p><button type="button" className="primary" onClick={()=>{setFirstHelp(false);onParentNeeded()}}>请家长确认</button></ChildAccessNotice>}
 {modal&&<ChildPasswordDialog key={modal.id+modal.mode} childName={children.find(c=>c.id===modal.id)?.nickname||'孩子'} mode={modal.mode} onClose={()=>setModal(null)} onSubmit={async password=>{const g=++generation.current;const v=await request(modal.mode==='setup'?'setup':(modal.mode==='change'||modal.mode==='parent-set')?'change':'unlock',{child_id:modal.id,password,...((modal.mode==='change'||modal.mode==='parent-set')?{parent_token:parentToken,pin_format:true}:{})});if(g===generation.current){generation.current++;apply(v);setError('')}}}/>}
 {view&&parentToken&&parentMode&&parentTarget&&<ChildAccessNotice title="查看孩子密码" onClose={()=>{setView(null);setRevealed(false)}}><input aria-label="孩子密码" type={revealed?'text':'password'} value={view.password} readOnly autoComplete="off"/><button type="button" className="secondary" onClick={()=>setRevealed(x=>!x)}>{revealed?'隐藏':'显示'}</button></ChildAccessNotice>}
 </>;
}
function ChildAccessNotice({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const el=ref.current;if(el&&!el.open)el.showModal();},[]);return <dialog ref={ref} className="child-password-dialog" onCancel={e=>{e.preventDefault();onClose()}}><h2>{title}</h2>{children}<button type="button" className="secondary" onClick={onClose}>关闭</button></dialog>}

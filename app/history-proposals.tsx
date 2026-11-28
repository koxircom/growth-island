"use client";
import {useEffect,useId,useRef,useState} from 'react';import {habitsAt,type Dashboard} from '@/lib/model';
type Snapshot={id:string;revision:number};
type Props={data:Dashboard;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<unknown>};
export function ChildHistoryProposal({data,childId,day,busy,mutate}:Props&{childId:string;day:string}){
 const [open,setOpen]=useState(false),[habitId,setHabit]=useState(''),[count,setCount]=useState(1),[reason,setReason]=useState(''),[error,setError]=useState('');
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const emptyDescription=useId();
 useEffect(()=>{const el=dialog.current;if(open&&el&&!el.open)el.showModal();},[open]);
 const close=()=>dialog.current?.close();
 const habits=habitsAt(data,day).filter(h=>h.child_id===childId),pending=(data.history_proposals||[]).filter(p=>p.child_id===childId&&p.day===day&&p.status==='pending');const proposal=pending.find(p=>p.habit_id===habitId);const stale=Boolean(snapshot?(!proposal||proposal.id!==snapshot.id||proposal.revision!==snapshot.revision):proposal);const chosen=habits.find(h=>h.id===habitId);
 const choose=(id:string)=>{setHabit(id);const old=pending.find(p=>p.habit_id===id);setSnapshot(old?{id:old.id,revision:old.revision}:null);setCount(old?.desired_count??data.checkins.filter(c=>c.habit_id===id&&c.day===day&&c.status==='approved').length);setReason(old?.reason||'');setError('');};
 return <div className="history-proposal">
  <button ref={trigger} className="secondary" onClick={()=>{choose(habits[0]?.id||'');setOpen(true);}}>补录或修改这一天</button>
  {pending.length>0&&<span> · {pending.length} 项等家长确认</span>}
  {open&&<dialog ref={dialog} aria-label="修改历史记录" className="habit-rule-dialog"
   aria-describedby={habits.length ? undefined : emptyDescription}
   onClose={()=>{setOpen(false);trigger.current?.focus();}}>
   {habits.length===0 ? <div className="empty">
    <p id={emptyDescription}>这一天没有生效的习惯，无法补录。可以选择其他日期。</p>
    <button type="button" className="secondary" onClick={close}>取消</button>
   </div> : <form onSubmit={async e=>{
    e.preventDefault();
    if(stale){setError('记录已变化，请重新选择习惯后核对。');return;}
    const ok=await mutate('history_submit',{child_id:childId,habit_id:habitId,day,desired_count:count,reason,...(snapshot||{})});
    if(ok)close();else setError('暂未提交，请刷新核对后重试。');
   }}>
    <label className="field">习惯<select aria-label="习惯" value={habitId} onChange={e=>choose(e.target.value)}>
     {habits.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
    </select></label>
    <label className="field">实际完成次数<input type="number" min={0} max={chosen?.target_count||20} required value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
    <label className="field">想告诉家长的话（可选）<input maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <p className="small">提交后等家长确认，星星暂不变。</p>
    {stale&&<p role="alert">记录已变化，请重新选择习惯后核对。<button type="button" onClick={()=>choose(habitId)}>重新读取</button></p>}
    {error&&<p role="alert">{error}</p>}
    <div className="button-row">
     <button type="button" className="secondary" disabled={busy} onClick={close}>取消</button>
     {snapshot&&<button type="button" className="secondary" disabled={busy} onClick={async()=>{
      if(stale){setError('记录已变化，请重新选择习惯后核对。');return;}
      if(await mutate('history_withdraw',{...snapshot}))close();
     }}>撤回申请</button>}
     <button className="primary" disabled={busy||!habitId}>提交确认</button>
    </div>
   </form>}
  </dialog>}
 </div>;
}
export function HistoryProposalReview({data,busy,mutate}:Props){const [selected,setSelected]=useState<Snapshot[]>([]),[error,setError]=useState('');const rows=(data.history_proposals||[]).filter(p=>p.status==='pending');const stale=selected.some(s=>!rows.some(p=>p.id===s.id&&p.revision===s.revision));if(!rows.length&&!selected.length)return null;
 const review=async(approve:boolean)=>{setError('');if(stale){setError('记录已变化，请清除选择后重新核对。');return;}if(await mutate('history_review',{approve,targets:selected.map(s=>({...s}))}))setSelected([]);else setError('未保存：记录可能已变化，或星星不足以撤销。请刷新核对。');};
 return <section aria-label="历史记录审核"><h3>历史补录与修改</h3><label className="checkbox"><input type="checkbox" checked={rows.length>0&&selected.length===rows.length&&!stale} onChange={e=>setSelected(e.target.checked?rows.map(p=>({id:p.id,revision:p.revision})):[])}/>全选</label>{rows.map(p=><label className="review-row checkbox" key={p.id}><input type="checkbox" checked={selected.some(s=>s.id===p.id)} onChange={e=>setSelected(v=>e.target.checked?[...v.filter(s=>s.id!==p.id),{id:p.id,revision:p.revision}]:v.filter(s=>s.id!==p.id))}/><span className="task-text"><strong>{data.children.find(c=>c.id===p.child_id)?.nickname} · {p.day} · {data.habits.find(h=>h.id===p.habit_id)?.name}</strong><br/>{p.base.filter(x=>x[1]==='approved').length} → {p.desired_count} 次{p.reason&&<> · {p.reason}</>}</span></label>)}{stale&&<p role="alert">记录已变化，请清除选择后重新核对。<button type="button" onClick={()=>{setSelected([]);setError('');}}>清除选择</button></p>}{error&&<p role="alert">{error}</p>}<div className="button-row"><button className="secondary" disabled={busy||!selected.length} onClick={()=>void review(false)}>退回所选</button><button className="primary" disabled={busy||!selected.length} onClick={()=>void review(true)}>通过所选</button></div></section>;
}



"use client";
import {useEffect,useState} from "react";
import {type Dashboard} from "@/lib/model";
import {serverClock} from "@/lib/server-clock";
import {redemptionUndoSecondsLeft} from "@/lib/redemption-undo-window";
export function RedemptionUndoNotice({data,childId,busy,mutate}:{data:Dashboard;childId:string;busy:boolean;mutate:(action:string,payload:Record<string,unknown>)=>Promise<unknown>}) {
 const [,tick]=useState(0);
 useEffect(()=>{const t=setInterval(()=>tick(v=>v+1),200);return()=>clearInterval(t)},[]);
 const r=data.redemptions.filter(r=>r.child_id===childId&&r.request_id&&(r.status==="approved"||r.status==="pending")&&!r.cancelled_at).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 const left=r?redemptionUndoSecondsLeft(r.created_at,serverClock.now()):0;
 if(!r||left===0)return null;
 const undo=()=>{
  if(redemptionUndoSecondsLeft(r.created_at,serverClock.now())===0)return;
  void mutate("redeem_undo",{id:r.id,child_id:r.child_id});
 };
 const name=data.children.find(c=>c.id===childId)?.nickname||"你";
 return <div className="toast redemption-undo-toast" role="status" aria-live="polite" aria-atomic="false">
  <span>{name}的{r.reward_name||"奖励"}{r.status==="pending"?"已提交":r.kind==="device_time"?"时间已到账":"已确认"}</span>
  <button className="undo-toast-button" disabled={busy} onClick={undo} aria-label="撤销刚才的奖励兑换">撤销<span aria-hidden="true">（{left}秒）</span></button>
 </div>;
}

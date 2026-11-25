"use client";
import {ChildQuickSwitch} from "./child-quick-switch";
import {growthLedgerRows} from "@/lib/growth-ledger-view";
import {ledgerDescription} from "@/lib/star-ledger";
import {speakChildFeedback} from "@/lib/child-voice";
import {useState} from "react";
import {BookOpen,ChevronLeft} from "lucide-react";
import {balance,checkinHabitName,formatDuration,localDay,newestFirst,redemptionName,type Dashboard,type Child} from "@/lib/model";

const status:Record<string,string>={approved:"已确认",pending:"待家长确认",undone:"已撤销",rejected:"未通过",completed:"已完成",stopped:"已结束",cancelled:"已结束"};
type Row={seq?:number|null;id:string;day:string;at:string;title:string;detail:string;status:string};
export function ChildHistory({data,child,onChild,onBack}:{data:Dashboard;child:Child;onChild:(id:string)=>void;onBack:()=>void}){
 const [kind,setKind]=useState("habits"),[date,setDate]=useState(""),[page,setPage]=useState(0);
 const day=(v:string)=>localDay(data.family.timezone,new Date(v));
 const records:Row[]=kind==="habits"?data.checkins.filter(c=>c.child_id===child.id&&c.status!=="undone").map(c=>({
   id:c.id,day:c.day,at:c.created_at||c.day,title:checkinHabitName(data,c),
   detail:c.status==="approved"?"+"+c.stars+" 星星":c.status==="pending"?"等待确认，星星尚未到账":"保留历史记录，不计入当前完成次数",status:status[c.status]||"已记录"
 })):kind==="practice"?data.timers.filter(t=>t.child_id===child.id&&t.ended_at).map(t=>({
   id:t.id,day:day(t.started_at),at:t.started_at,title:t.kind==="focus"?"专注训练":"游戏约定",
   detail:formatDuration(t.actual_seconds||0),status:t.kind==="game"?(t.status==="completed"?"按时结束":"这次没做到，下次再试"):(t.status==="completed"?"完成目标":"已记录努力")
 })):kind==="rewards"?data.redemptions.filter(r=>r.child_id===child.id).map(r=>({
   id:r.id,day:day(r.created_at),at:r.created_at,title:redemptionName(r,data.rewards),
   detail:r.cost+" 星星"+(r.status==="pending"?" · 已预留":r.status==="rejected"?" · 已退回":""),status:status[r.status]||"已记录"
 })): growthLedgerRows(data.star_ledger||[]).filter(g=>g.child_id===child.id).map(g=>({
   seq:g.posting_seq,id:g.id,day:day(g.created_at),at:g.created_at,
   title:ledgerDescription(data,g),
   detail:(g.amount>0?"+":"")+g.amount+" 星星 · "+(g.balance_after==null?"历史余额未记录":"余额 "+g.balance_after+" 星星"),
   status:"已入账"
 }));
 const rows=kind==="stars"?records.filter(r=>!date||r.day===date).sort((a,b)=>a.seq!=null&&b.seq!=null?b.seq-a.seq:a.seq!=null?-1:b.seq!=null?1:b.at.localeCompare(a.at)):newestFirst(records.filter(r=>!date||r.day===date),r=>r.at);
 const last=Math.max(0,Math.ceil(rows.length/20)-1),current=Math.min(page,last);
 return <>
  <div className="heading"><div><span className="eyebrow">每一步努力都值得被看见</span><h1>{child.nickname}的成长记录</h1><p>查看和筛选不需要家长密码，也不会修改数据。</p></div><div className="star-badge">{balance(data,child.id)}<small>可用星星</small></div></div>
  <div className="button-row child-history-nav"><button className="secondary" onClick={onBack}><ChevronLeft size={18}/>回到个人小岛</button></div>
  <section className="panel child-read-history" aria-label="成长记录">
   <div className="panel-heading"><h2><BookOpen size={20}/>我的记录</h2></div>
   <div className="account-filters">
    <ChildQuickSwitch children={data.children} value={child.id} onChange={onChild} label="记录所属孩子"/>
    <label className="field"><span>记录类型</span><select aria-label="记录类型" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="habits">习惯打卡</option><option value="practice">专注与游戏练习</option><option value="rewards">奖励兑换</option><option value="stars">星星收支</option></select></label>
    <label className="field"><span>筛选日期</span><input type="date" value={date} onChange={e=>{setDate(e.target.value);setPage(0);}}/></label>
    <div className="field"><span>日期范围</span><button className="secondary" aria-disabled={!date} data-explainable={!date} onClick={()=>{if(!date){speakChildFeedback("现在已经显示全部日期啦。");return;}setDate("");setPage(0);}}>全部日期</button></div>
   </div>
   <p className="small">共 {rows.length} 条记录，每页最多 20 条。</p>
   {!rows.length?<p className="history-empty">这段时间还没有这类记录。</p>:rows.slice(current*20,current*20+20).map(r=><article className="ledger-entry" key={r.id}><div className="ledger-entry-top"><strong>{r.title}</strong><span className="status-pill">{r.status}</span></div><p>{r.detail}</p><p className="small">{r.day}</p></article>)}
   <div className="button-row"><button className="secondary" aria-disabled={current===0} data-explainable={current===0} onClick={()=>{if(current===0){speakChildFeedback("已经是第一页啦。");return;}setPage(current-1);}}>上一页</button><span>第 {current+1} 页</span><button className="secondary" aria-disabled={current>=last} data-explainable={current>=last} onClick={()=>{if(current>=last){speakChildFeedback("这段记录已经看完啦，新的小进步会慢慢留下来。");return;}setPage(current+1);}}>下一页</button></div>
  </section>
 </>;
}


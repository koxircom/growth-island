"use client";
import {useRef,useState} from 'react';
import {checkinHabitName,type Dashboard} from '@/lib/model';
import {reviewDay,requestTime} from '@/lib/review-display';
export function CheckinReviewList({data,busy,mutate}:{data:Dashboard;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<unknown>}){
 const rows=data.checkins.filter(c=>c.status==='pending');
 const [selected,setSelected]=useState<string[]>([]),[running,setRunning]=useState(false),[message,setMessage]=useState('');
 const gate=useRef(false),latest=useRef(data);latest.current=data;
 if (rows.length === 0 && selected.length > 0) {
   setSelected([]);
 }
 const stale=selected.some(id=>!rows.some(c=>c.id===id)),disabled=busy||running;
 async function approve(){if(gate.current||disabled||stale||!selected.length)return;gate.current=true;setRunning(true);setMessage('');let saved=0;const ids=[...selected];
 try{for(const id of ids){if(!latest.current.checkins.some(c=>c.id===id&&c.status==='pending')){setMessage(`已确认 ${saved} 项；其他记录已变化，请刷新核对。`);return;}
 const result=await mutate('checkin_review',{id,approve:true}) as Dashboard|undefined;
 if(!result){setMessage(`已确认 ${saved} 项；本项结果未确认，已停止后续操作。请刷新核对后再试。`);return;}
 latest.current=result;saved++;setSelected(v=>v.filter(x=>x!==id));}
 setMessage(`已确认 ${saved} 项。`);
 }catch{setMessage(`已确认 ${saved} 项；操作中断，请刷新核对后再试。`);}finally{gate.current=false;setRunning(false);}}
 return <div className="checkin-review-list">{rows.length>0&&<div className="review-batch-toolbar"><label className="review-select"><input type="checkbox" disabled={disabled} checked={rows.length>0&&selected.length===rows.length&&!stale} onChange={e=>setSelected(e.target.checked?rows.map(c=>c.id):[])}/>全选打卡</label><span>已选 {selected.length} 项</span><div className="review-batch-actions"><button className="secondary" disabled={disabled||!selected.length} onClick={()=>setSelected([])}>清除选择</button><button className="primary" disabled={disabled||stale||!selected.length} onClick={()=>void approve()}>{running?'正在确认…':'确认所选'}</button></div></div>}
 {stale&&<p role="alert">所选记录已变化，请清除选择后重新核对。</p>}{message&&<p role="status">{message}</p>}
 {rows.map(c=><div className="review-row checkin-review-row" key={c.id}><label className="review-select"><input type="checkbox" aria-label={`选择 ${checkinHabitName(data,c)} ${c.day}`} disabled={disabled} checked={selected.includes(c.id)} onChange={e=>setSelected(v=>e.target.checked?[...v.filter(id=>id!==c.id),c.id]:v.filter(id=>id!==c.id))}/></label><div className="review-details"><h3>{data.children.find(x=>x.id===c.child_id)?.nickname} · {checkinHabitName(data,c)}</h3><p>{reviewDay(c.day)} · +{c.stars} 星星 {c.reason&&`· ${c.reason}`}</p><p>申请于 {requestTime(c.created_at,data.family.timezone)}</p></div><div className="review-actions"><button className="secondary" disabled={disabled} onClick={()=>mutate('checkin_review',{id:c.id,approve:false})}>暂不确认</button><button className="primary" disabled={disabled} onClick={()=>mutate('checkin_review',{id:c.id,approve:true})}>确认完成</button></div></div>)}
 </div>;
}

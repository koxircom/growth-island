"use client";
import {ChildQuickSwitch} from "./child-quick-switch";
import {useEffect,useRef,useState} from "react";
import {ShieldCheck} from "lucide-react";
import {type Dashboard,type Child,balance} from "@/lib/model";
import {starDeductionRemaining} from "@/lib/star-rules";
import {serverClock} from "@/lib/server-clock";
import {DeductionForm,AdjustmentHistory} from "./star-rules";
export function ParentPenalties({data,busy,mutate}:{data:Dashboard;busy:boolean;mutate:(action:string,payload:Record<string,unknown>)=>Promise<any>}){
 const [childId,setChildId]=useState(data.children[0]?.id||"");
 const child=data.children.find(c=>c.id===childId)||data.children[0];
 if(!child)return <section className="panel"><h2>惩罚</h2><p>请先添加孩子。</p></section>;
 return <section className="panel parent-penalties">
  <div className="panel-heading"><h2><ShieldCheck size={22}/> 惩罚</h2><ChildQuickSwitch children={data.children} value={child.id} onChange={setChildId} disabled={busy} label="惩罚页面的孩子"/></div>
  <p className="notice">先沟通，再按事先约定扣星。不因情绪、吃多少或能力差异扣星，不限制基本食物、阅读和陪伴。</p>
  <QuickPenalty key={"quick:"+child.id} data={data} child={child} busy={busy} mutate={mutate}/>
  <DeductionForm key={"penalty:"+child.id} data={data} child={child} busy={busy} mutate={mutate}/>
  <AdjustmentHistory key={"penalty-history:"+child.id} data={data} child={child} busy={busy} mutate={mutate} deductionsOnly/>
 </section>;
}

 function QuickPenalty({data,child,busy,mutate}:{data:Dashboard;child:Child;busy:boolean;mutate:(action:string,payload:Record<string,unknown>)=>Promise<any>}){
 const [amount,setAmount]=useState("1");
 const inFlight=useRef(false),cooldownTimer=useRef<ReturnType<typeof setTimeout>|null>(null),[sending,setSending]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>()=>{if(cooldownTimer.current)clearTimeout(cooldownTimer.current);},[]);
 const available=balance(data,child.id),remaining=starDeductionRemaining(data,child.id,new Date(serverClock.now()??Date.now()));
 const value=Number(amount);
 const disabled=busy||sending||!Number.isInteger(value)||value<1||value>Math.min(10,available,remaining);
 async function deduct(){
  if(disabled||inFlight.current)return;
  inFlight.current=true;setSending(true);setNotice("");
  try{const result=await mutate("star_deduct",{child_id:child.id,amount:value,reason:"未遵守事先约定：吃饭时走来走去",confirmed:true});if(result)setNotice(`${child.nickname}已扣${value}星。误操作可在下方记录中撤销。`);}
  finally{if(cooldownTimer.current)clearTimeout(cooldownTimer.current);cooldownTimer.current=setTimeout(()=>{inFlight.current=false;setSending(false)},700)}
 }
 return <section className="star-rule-card penalty-quick"><h3>快捷扣星</h3><p>{child.nickname} · 现有 {available} 星 · 剩余额度 {remaining} 星</p><label className="field"><span>本次扣星</span><input aria-label="快捷扣星数量" type="number" min={1} max={Math.max(1,Math.min(10,available,remaining))} step={1} value={amount} disabled={busy||sending} onChange={e=>setAmount(e.target.value)}/></label><button className="secondary" disabled={disabled} onClick={deduct} aria-label={`${child.nickname}吃饭时走来走去，扣${amount}星`}>吃饭时走来走去 · 扣{amount || "—"}星</button><p className="small">点击立即扣除，仅用于已经说好的用餐约定。</p>{notice&&<p role="status">{notice}</p>}</section>;
}

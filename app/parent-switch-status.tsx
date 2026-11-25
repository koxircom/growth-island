'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {redemptionDiagnosis,type SwitchOperations} from '../lib/switch-status';
import type {Dashboard,SwitchStatus} from '@/lib/model';
const minutes=(seconds:number|string)=>`${Math.round(Number(seconds)/60*10)/10} 分钟`;
type Console={binding_id:string;device_id:string;label:string;enabled:boolean;online:boolean;status?:SwitchStatus|null};
export function ParentSwitchStatus({token,timezone,dashboard}:{token:string;timezone:string;dashboard:Dashboard}) {
 const [data,setData]=useState<SwitchOperations|null>(null),[binding,setBinding]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const consoles=(dashboard as Dashboard&{switch_consoles?:Console[]}).switch_consoles??[];
 const selected=consoles.find(c=>c.binding_id===binding);
 const device=selected?.device_id??'';
 const sequence=useRef(0);
 const refresh=useCallback(async()=>{
  const id=++sequence.current; setLoading(true); setError(''); setData(null);
  try {
   const response=await fetch('/api/parent/switch-status',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent_token:token})});
   if(!response.ok) throw new Error(response.status===401||response.status===403?'家长身份已过期，请重新解锁。':'记录读取失败，请稍后重试；没有向 Switch 发送指令。');
   const result=await response.json();
   if(sequence.current===id) setData(result.data);
  } catch(e) { if(sequence.current===id) setError(e instanceof Error?e.message:'记录读取失败'); }
  finally {if(sequence.current===id)setLoading(false);}
 },[token]);
 useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
 const date=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,dateStyle:'short',timeStyle:'medium'}).format(new Date(value));
 const name=(id:string)=>data?.children.find(c=>c.id===id)?.nickname??'孩子';
 const orders=data?.redemptions.filter(r=>r.device_id===device)??[];
 const usage=data?.usage.filter(r=>r.device_id===device)??[];
 return <section className="panel switch-status-panel" aria-label="Switch 状态与操作记录">
  <div className="panel-heading"><div><span className="eyebrow">仅家长可见 · 只读核查</span><h2>Switch 状态与操作记录</h2></div><button className="secondary" disabled={loading} onClick={()=>void refresh()}>{loading?'读取中…':'刷新记录'}</button></div>
  <div className="notice"><strong>设备最后上报：{selected?.status?.checked_at?date(selected.status.checked_at):'未知'}</strong><p>当前主机剩余时间：未知</p><p>余额和网页倒计时不能代表主机实际剩余时间。</p></div>
  <p>本页不会解锁、加时、重发指令或扣星星。设备未接入时不能把“发送成功”或“钱包到账”当作设备已执行。</p>
  {error&&<p role="alert">{error}</p>}
  {data&&<>
   <p>账本读取时间：{date(data.read_at)}。主机状态来自最近一次上报。</p>
   <label>选择 Switch 主机<select value={binding} onChange={e=>setBinding(e.target.value)}><option value="">请选择主机</option>{consoles.map(c=><option key={c.binding_id} value={c.binding_id}>{c.label}{!c.enabled?'（已停用）':''}</option>)}</select></label>
   <p>下方显示该主机对应的共享时间账本；两台主机可能使用同一本账。最近最多显示各 200 条兑换/使用记录。</p>
   {!device?<p>请先选择对应设备，再核查孩子的兑换记录。</p>:<>
    <h3>孩子各自的钱包余额</h3>{data.children.map(c=><p key={c.id}>{c.nickname}：{minutes(data.balances.find(b=>b.device_id===device&&b.child_id===c.id)?.seconds??0)}（小岛余额，不是主机余额）</p>)}
    <h3>最近一次兑换</h3>{orders.length?<p>{name(orders[0].child_id)} · {orders[0].reward_name}：{redemptionDiagnosis(orders[0]).label}</p>:<p>本次读取范围内暂无该设备兑换记录。</p>}
    <h3>需要人工处理</h3><p>先在 Switch 上确认 PlayGuard 后台代理及远程连接，再核对设备当前日限额。不要因为没有回执而重复加时。旧协议缺少订单编号，保留消息可能延后执行，无法用单条通用回执确认某次兑换。</p>
    {orders.filter(r=>redemptionDiagnosis(r).attention).length>0&&<p role="status">有 {orders.filter(r=>redemptionDiagnosis(r).attention).length} 条兑换需要核查设备生效情况，详情见下方。</p>}
    <h3>兑换记录</h3>{orders.map(r=>{const d=redemptionDiagnosis(r);return <article className="notice" key={r.id}><strong>{name(r.child_id)} · {r.reward_name} · {minutes(r.duration_seconds)} · {r.cost} 星星</strong><p>{date(r.created_at)} · {d.label}</p><p>{d.detail}</p><small style={{overflowWrap:"anywhere"}}>兑换编号：{r.id}{r.reviewed_at?' · 确认时间：'+date(r.reviewed_at):''}</small></article>;})}
    <h3>小岛计时使用记录</h3><p>以下是网页计时记录，不是 Switch 实际游戏时长或开锁记录。</p>{usage.length===0?<p>本次读取范围内暂无使用记录。</p>:usage.map(u=><article className="notice" key={u.id}><strong>{name(u.child_id)} · {u.status==='running'?'网页计时中':u.status==='stopped'?'提前结束':'已结束'}</strong><p>{date(u.started_at)} · 预留 {minutes(u.reserved_seconds)} · 已结算 {minutes(u.actual_seconds)}</p><small style={{overflowWrap:"anywhere"}}>使用编号：{u.id}</small></article>)}
   </>}
  </>}
 </section>;
}

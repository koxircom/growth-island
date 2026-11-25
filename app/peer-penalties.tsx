"use client";
import {useEffect,useRef,useState} from 'react';
import {ShieldCheck,Toilet,Droplets,Utensils,Heart} from 'lucide-react';
import {type Dashboard,balance} from '@/lib/model';
import type {PenaltyRule} from '@/lib/penalty-rules';
import {starDeductionRemaining} from '@/lib/star-rules';
import {serverClock} from '@/lib/server-clock';
import {ChildQuickSwitch} from './child-quick-switch';
function PenaltyIcon({name}:{name:string}){const Icon=/马桶|坐垫/.test(name)?Toilet:/冲|洗手|水/.test(name)?Droplets:/吃饭|餐|食/.test(name)?Utensils:/情绪|闹|生气/.test(name)?Heart:ShieldCheck;return <Icon size={24} aria-hidden="true"/>;}
export function PeerPenalties({data,onSaved}:{data:Dashboard;onSaved:()=>Promise<void>}){
 const [target,setTarget]=useState(''),[sending,setSending]=useState(false),[notice,setNotice]=useState(''),[unknown,setUnknown]=useState(false),[cooldown,setCooldown]=useState(''),[rules,setRules]=useState<PenaltyRule[]>([]),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
 const lock=useRef(false);
 useEffect(()=>{const abort=new AbortController();setLoading(true);fetch('/api/penalty-rules',{cache:'no-store',signal:abort.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error();setRules(body.data);}).catch(e=>{if(e.name!=='AbortError')setNotice('事项暂时无法读取，请刷新重试。');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[reload]);
 const child=data.children.find(c=>c.id===target)||data.children[0];if(!child)return null;
 const available=balance(data,child.id),remaining=starDeductionRemaining(data,child.id,new Date(serverClock.now()??Date.now()));
 const disabled=(r:PenaltyRule)=>sending||unknown||cooldown===child.id+r.rule_id||available<r.stars||remaining<r.stars;
 async function deduct(rule:PenaltyRule){if(disabled(rule)||lock.current||!child)return;lock.current=true;setSending(true);setNotice('');const id=child.id,name=child.nickname;
 try{const res=await fetch('/api/peer-penalty',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({child_id:id,rule_id:rule.rule_id,expected_revision:Number(rule.revision),request_id:crypto.randomUUID()})});const body=await res.json();if(!res.ok){const messages:Record<string,string>={peer_penalty_recent:'刚刚已记录，请勿重复点击。',star_daily_limit:'今天已到约定上限。',insufficient_stars:'星星不足，不会透支。',penalty_rule_conflict:'事项已变更，已重新读取，请核对。'};if(messages[body.error]){setNotice(messages[body.error]);setReload(n=>n+1);await onSaved();return;}throw new Error('unknown');}setNotice(`${name} · 已扣 ${rule.stars} 星`);setCooldown(id+rule.rule_id);setTimeout(()=>setCooldown(''),5000);await onSaved();}
 catch{setUnknown(true);setNotice('结果未确认，请先刷新核对记录，不要重复扣星。');}finally{setSending(false);lock.current=false;}}
 const records=(data.star_adjustments||[]).filter(a=>a.child_id===child.id&&a.detail?.peer_rule_id).slice(0,8);
 return <><div className="heading peer-penalties-heading"><div><span className="eyebrow">一起遵守约定</span><h1>惩罚</h1></div><ChildQuickSwitch children={data.children} value={child.id} onChange={id=>{setTarget(id);setNotice('');}} disabled={sending||unknown} label="选择扣星的孩子"/></div><section className="panel peer-penalties">
 <p><strong>{child.nickname}</strong> · 现有 {available} 星 · 今日还可扣 {remaining} 星</p>
 {loading&&<p role="status">正在读取事项…</p>}{!loading&&!rules.some(r=>r.enabled)&&<p>还没有启用的惩罚事项。</p>}
 {rules.filter(r=>r.enabled).map(rule=><div className="task-row peer-penalty-row" key={rule.rule_id}><div className="task-icon"><PenaltyIcon name={rule.name}/></div><div className="task-detail"><h3>{rule.name}</h3>{rule.description&&<p className="penalty-description">{rule.description}</p>}</div><button className="secondary" disabled={disabled(rule)} onClick={()=>void deduct(rule)} aria-label={`给${child.nickname}记录${rule.name}，扣 ${rule.stars} 星`}>{sending?'记录中…':cooldown===child.id+rule.rule_id?'已记录':`扣 ${rule.stars} 星`}</button></div>)}
 {notice&&<p role="status">{notice}</p>}
 <details><summary>最近监督记录</summary>{!records.length?<p>暂无记录。</p>:records.map(a=><p key={a.id}>{new Date(a.created_at).toLocaleString('zh-CN',{timeZone:data.family.timezone})} · {a.detail.peer_rule_name as string} · {a.amount} 星 · {a.detail?.actor_mode==='authenticated_child'?`已解锁孩子：${data.children.find(c=>c.id===a.detail.authenticated_child_id)?.nickname||'孩子'}`:'家庭共享访问（未认证个人）'}</p>)}</details></section></>;
}

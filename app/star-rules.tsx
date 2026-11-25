"use client";
import {FamilyRuleSettings} from "./family-rule-settings";
import {ChildQuickSwitch} from "./child-quick-switch";
import {RuleSpeaker} from './rule-speaker';
import {RULE_STREAK_TEXT,RULE_SAVINGS_TEXT,RULE_TIMING_REVIEW_TEXT,RULE_BASICS_TEXT} from '@/lib/child-audio-manifest';
import {useState} from "react";
import {Star,ShieldCheck,Undo2,Settings2} from "lucide-react";
import {type Dashboard,type Child,balance,localDay} from "@/lib/model";
import {latestStarRule,activeStarRule,starTimezonePreview,starDeductionRemaining,starKindLabel,type StarAdjustment} from "@/lib/star-rules";
import {serverClock} from "@/lib/server-clock";
type Mutate=(action:string,payload:Record<string,unknown>)=>Promise<any>;
const now=()=>new Date(serverClock.now()??Date.now());

function RuleExplanation({audio=false}:{audio?:boolean}){
 return <div className="star-rule-explanation">
  <p><strong>连续奖励</strong>{audio&&<RuleSpeaker label="连续奖励" text={RULE_STREAK_TEXT}/>}：{RULE_STREAK_TEXT}</p>
  <p><strong>存星奖励</strong>{audio&&<RuleSpeaker label="存星奖励" text={RULE_SAVINGS_TEXT}/>}：{RULE_SAVINGS_TEXT}</p>
  <p>{audio&&<RuleSpeaker label="规则生效与补卡" text={RULE_TIMING_REVIEW_TEXT}/>}{RULE_TIMING_REVIEW_TEXT}</p>
 </div>;
}

export function ChildStarRules({data,child}:{data:Dashboard;child:Child}){
 const current=now(),daily=activeStarRule(data,child.id,"day",current),weekly=activeStarRule(data,child.id,"week",current),latest=latestStarRule(data,child.id);
 const history=(data.star_adjustments||[]).filter(a=>a.child_id===child.id).slice(0,8);
 return <section className="panel star-rules-child">
  <div className="panel-heading"><h3><Star size={20}/> 我的星星约定</h3><span className="small">只看自己的记录</span></div>
  <p>连续奖励：{daily?.streak_enabled?"已开启":"未开启"} · 存星奖励：{weekly?.savings_enabled?"已开启":"未开启"}</p>
  {(data.star_rule_transitions||[]).some(t=>t.child_id===child.id)&&<p className="small">家庭换了时区，连续记录重新开始；过渡中的未完整奖励周期不发奖。下面显示新的生效日。</p>}
  {latest&&<p className="small">最新设置：连续规则 {latest.effective_day} 起，存星规则 {latest.effective_week} 起。规则时区 {latest.timezone}。</p>}
  <details><summary>看看奖励怎么算</summary><RuleExplanation audio/></details>
  <p className="gentle-note"><RuleSpeaker label="生活与星星" text={RULE_BASICS_TEXT}/>{RULE_BASICS_TEXT}</p>
  {history.map(a=><div className="history-row" key={a.id}><strong>{starKindLabel[a.kind]} · {a.amount>0?"+":""}{a.amount} 星</strong><span>{a.reason}</span><small>{a.period_day}</small></div>)}
 </section>;
}

export function ParentStarRules({data,busy,mutate}:{data:Dashboard;busy:boolean;mutate:Mutate}){
 const [childId,setChildId]=useState(data.children[0]?.id||"");
 const child=data.children.find(c=>c.id===childId)||data.children[0];
 if(!child)return <p>请先添加孩子。</p>;
 const latest=latestStarRule(data,child.id);
 return <section className="panel star-rules-parent">
  <div className="panel-heading"><div><span className="eyebrow">先约定，再一起复盘</span><h2><ShieldCheck size={22}/> 星星约定</h2></div>
   <ChildQuickSwitch children={data.children} value={child.id} onChange={setChildId} disabled={busy} label="星星约定的孩子"/>
  </div>
  <p className="notice">只调整已经说好的、孩子能做到的具体行为。不因情绪、吃多少或能力差异扣星，不限制基本食物、阅读和陪伴。先沟通或安排休息，也可以不扣星。</p>
  <RuleExplanation/>
  <div className="star-rules-grid">
   <DeductionForm key={"deduct:"+child.id} data={data} child={child} busy={busy} mutate={mutate}/>
   <FamilyRuleSettings data={data} busy={busy} mutate={mutate}/>
  </div>
  <AdjustmentHistory key={"history:"+child.id} data={data} child={child} busy={busy} mutate={mutate}/>
  <details><summary>配置版本与结算记录</summary>
   {(data.star_rule_transitions||[]).filter(t=>t.child_id===child.id).map(t=><p className="notice" key={t.id}>时区迁移：{t.old_timezone} → {t.new_timezone}。过渡中的未完整奖励周期不发奖，连续重新开始。新连续规则从 {t.new_day_start} 起，存星规则从 {t.new_week_start} 起。</p>)}
   <p className="small">修改家庭时区会明确迁移奖励规则：未完整周期不发奖，连续重新开始；旧完整周期按旧时区补结算。扣星额度设置立即生效，自动奖励开关按各自生效日执行。</p>
   {(data.star_rule_versions||[]).filter(r=>r.child_id===child.id).map(r=><div className="history-row" key={r.id}><strong>版本 {r.revision}</strong><span>连续 {r.streak_enabled?"开":"关"} · 存星 {r.savings_enabled?"开":"关"} · 每日最多扣 {r.deduction_limit}</span><small>{r.effective_day} / {r.effective_week} · {r.timezone}</small></div>)}
   {(data.star_settlements||[]).filter(s=>s.child_id===child.id).slice(0,20).map(s=><div className="history-row" key={s.id}><span>{s.period_day} · {s.kind==="week"?"周结算":"日结算"}</span><span>{s.kind==="week"?"最低余额 "+(s.detail.minimum??"不适用")+" · 奖励 "+(s.detail.award??0):"当日结果已记录，不重复发奖"}</span></div>)}
   <p className="small">后台最近成功检查：{data.star_settler_last_success_at?new Date(data.star_settler_last_success_at).toLocaleString("zh-CN",{timeZone:latest?.timezone||data.family.timezone}):"尚无记录，请确认家庭服务器结算服务已运行"}。页面关闭后仍由服务器处理；离线期间的周期会在恢复后依次结算。</p>
  </details>
 </section>;
}

export function DeductionForm({data,child,busy,mutate}:{data:Dashboard;child:Child;busy:boolean;mutate:Mutate}){
 const [amount,setAmount]=useState("1"),[reason,setReason]=useState(""),[confirm,setConfirm]=useState<{amount:number;reason:string}|null>(null),[notice,setNotice]=useState("");
 const remaining=starDeductionRemaining(data,child.id,now()),available=balance(data,child.id);
 return <div className="star-rule-card">
  <h3>约定调整 / 扣星</h3><p>{child.nickname}现有 <strong>{available}</strong> 星，可调整额度 <strong>{remaining}</strong> 星。</p>
  <p className="small">默认每次1星、每天最多3星。当天及最近24小时都受限；不允许负余额，撤销后也不恢复额度。</p>
  {notice&&<p role="status">{notice}</p>}
  {!confirm?<form onSubmit={e=>{e.preventDefault();setNotice("");setConfirm({amount:Number(amount),reason:reason.trim()});}}>
   <label className="field"><span>扣除星星</span><input aria-label="扣除星星" required type="number" min={1} max={Math.min(10,remaining,available)||1} step={1} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <label className="field"><span>具体约定与原因</span><textarea aria-label="扣星原因" required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="只记录事先说好的具体行为"/></label>
   <button className="secondary" disabled={busy||remaining<1||available<1||!reason.trim()}>下一步：确认扣星</button>
  </form>:<div role="group" aria-label="确认约定调整">
   <h4>确认给{child.nickname}扣除 {confirm.amount} 星？</h4><p>{confirm.reason}</p><p>余额将变为 {available-confirm.amount} 星。会保留原因与记录，可以由家长撤销一次。</p>
   <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setConfirm(null)}>取消扣星</button><button className="primary" disabled={busy||confirm.amount>remaining||confirm.amount>available} onClick={async()=>{const result=await mutate("star_deduct",{child_id:child.id,...confirm,confirmed:true});if(result){setConfirm(null);setReason("");setAmount("1");setNotice("已记录约定调整。");}}}>确认扣除星星</button></div>
  </div>}
 </div>;
}

export function AdjustmentHistory({data,child,busy,mutate,deductionsOnly=false}:{data:Dashboard;child:Child;busy:boolean;mutate:Mutate;deductionsOnly?:boolean}){
 const history=(data.star_adjustments||[]).filter(a=>a.child_id===child.id),[selected,setSelected]=useState<StarAdjustment|null>(null),[reason,setReason]=useState(""),[confirm,setConfirm]=useState(false);
 const deductions=new Set(history.filter(a=>a.kind==="deduction").map(a=>a.id));
 const visible=deductionsOnly?history.filter(a=>a.kind==="deduction"||(a.kind==="reversal"&&!!a.related_id&&deductions.has(a.related_id))):history;
 const reversed=new Set(history.filter(a=>a.related_id).map(a=>a.related_id));
 return <section className="star-rule-history"><h3>{deductionsOnly?"扣星记录":"调整与奖励记录"}</h3>
  {!visible.length&&<p className="muted">{deductionsOnly?"暂无扣星记录。":"还没有调整记录。启用规则不会立即改动余额。"}</p>}
  {visible.slice(0,60).map(a=><div className="history-row" key={a.id}>
   <div><strong>{starKindLabel[a.kind]} · {a.amount>0?"+":""}{a.amount} 星</strong><small>{localDay(a.timezone,new Date(a.created_at))} · 对应周期 {a.period_day}</small></div><span>{a.reason}</span>
   {a.kind!=="reversal"&&(reversed.has(a.id)?<span>已撤销</span>:<button className="text-button" disabled={busy} onClick={()=>{setSelected(a);setReason("");setConfirm(false);}}><Undo2 size={16}/>撤销这条调整</button>)}
  </div>)}
  {selected&&<div className="star-rule-card" role="group" aria-label="撤销星星调整">
   <h4>撤销{starKindLabel[selected.kind]}：{selected.amount>0?"+":""}{selected.amount} 星</h4>
   {!confirm?<form onSubmit={e=>{e.preventDefault();setConfirm(true);}}>
    <label className="field"><span>撤销原因</span><input aria-label="撤销调整原因" required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消撤销</button><button className="primary" disabled={busy||!reason.trim()}>下一步：确认撤销</button></div>
   </form>:<>
    <p>将{selected.amount<0?"返还":"扣回"} {Math.abs(selected.amount)} 星。原始记录会保留，不能再次撤销；撤销扣星不会恢复当日额度。余额不足时不能扣回奖励。</p><p>原因：{reason}</p>
    <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消撤销</button><button className="primary" disabled={busy||reversed.has(selected.id)} onClick={async()=>{const result=await mutate("star_reverse",{id:selected.id,reason:reason.trim(),confirmed:true});if(result){setSelected(null);setConfirm(false);}}}>确认撤销调整</button></div>
   </>}
  </div>}
 </section>;
}


export function TimezoneStarNotice({data,timezone}:{data:Dashboard;timezone:string}){
 if(timezone===data.family.timezone||!data.star_rule_versions?.length)return null;
 const preview=starTimezonePreview(data,timezone,now());
 return <div className="notice timezone-star-notice" role="group" aria-label="时区变更对星星奖励的影响">
  <strong>改时区也会迁移星星奖励规则</strong>
  <p>当前未完整的奖励日和奖励周不发奖，连续计数重新开始。旧完整周期仍按旧时区结算；已有星星和记录不变，奖励时间钱包不受影响。若新时区重复旧日期，会跳过重复周期，避免重复奖励。</p>
  {preview?.map(p=><p key={p.child.id}>{p.child.nickname}：连续从 {p.day} 起，存星从 {p.week} 起（{timezone}）。最终生效日会保存在星星约定中。</p>)}
  {!preview&&<p>请输入有效的 IANA 时区，再查看新生效日。</p>}
  <label className="star-rule-check"><input key={timezone} type="checkbox" name="confirm_star_timezone" required/>我已了解过渡周期和连续重置，确认迁移规则</label>
 </div>;
}

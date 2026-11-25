"use client";
import {useState} from 'react';
import type {Dashboard} from '@/lib/model';
import {latestStarRule} from '@/lib/star-rules';
type Props={data:Dashboard;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<any>};
export function FamilyRuleSettings(props:Props){const [reset,setReset]=useState(0);return <FamilyRuleEditor key={reset} {...props} reload={()=>setReset(n=>n+1)}/>;}
function FamilyRuleEditor({data,busy,mutate,reload}:Props&{reload:()=>void}){
 const [snapshot]=useState(()=>data.children.map(c=>({child_id:c.id,rule:latestStarRule(data,c.id)})));
 const shared=(key:'deduction_limit'|'streak_enabled'|'savings_enabled',fallback:number|boolean)=>{const values=snapshot.map(s=>s.rule?.[key]??fallback);return values.every(v=>v===values[0])?String(values[0]):'';};
 const [cap,setCap]=useState(()=>shared('deduction_limit',3)),[streak,setStreak]=useState(()=>shared('streak_enabled',false)),[savings,setSavings]=useState(()=>shared('savings_enabled',false));
 const [chosen,setChosen]=useState<Record<string,string[]>>(()=>Object.fromEntries(snapshot.map(s=>[s.child_id,(s.rule?.habit_ids||[]).filter(id=>data.habits.some(h=>h.id===id&&h.active&&!h.archived_at))]))),[confirm,setConfirm]=useState(false),[notice,setNotice]=useState('');
 const stale=snapshot.length!==data.children.length||snapshot.some(s=>!data.children.some(c=>c.id===s.child_id)||(s.rule?.id||null)!==(latestStarRule(data,s.child_id)?.id||null));
 const valid=Number.isInteger(Number(cap))&&Number(cap)>=1&&Number(cap)<=10&&streak!==''&&savings!==''&&(streak!=='true'||data.children.every(c=>(chosen[c.id]||[]).length>0));
 const payload={deduction_limit:Number(cap),streak_enabled:streak==='true',savings_enabled:savings==='true',targets:snapshot.map(s=>({child_id:s.child_id,expected_rule_id:s.rule?.id||null,habit_ids:chosen[s.child_id]||[]}))};
 return <section className="star-rule-card family-rule-settings"><h3>全家统一规则设置</h3><p className="small">扣星上限及奖励开关一次设置、同时保存给全部孩子。余额、历史及每个孩子的习惯仍独立。</p>
 <details><summary>查看现有设置（保存前不改变）</summary>{snapshot.map(s=><p key={s.child_id}>{data.children.find(c=>c.id===s.child_id)?.nickname}：每日上限 {s.rule?.deduction_limit??3} 星 · 连续奖励{ s.rule?.streak_enabled?'开':'关'} · 存星奖励{s.rule?.savings_enabled?'开':'关'}</p>)}</details>
 {stale&&<p role="alert">现有规则或孩子列表已变化，未自动覆盖。<button type="button" className="secondary" disabled={busy} onClick={reload}>重新读取设置</button></p>}
 {!confirm?<form onSubmit={e=>{e.preventDefault();if(valid&&!stale)setConfirm(true);}}>
 <label className="field"><span>全家每日最多扣星（1–10）</span><input required type="number" min={1} max={10} value={cap} placeholder="现有值不同，请明确选择" onChange={e=>setCap(e.target.value)}/></label>
 <label className="field"><span>连续奖励</span><select required value={streak} onChange={e=>setStreak(e.target.value)}><option value="" disabled>现有设置不同，请选择</option><option value="false">全家关闭</option><option value="true">全家开启</option></select></label>
 {streak==='true'&&data.children.map(c=>{const habits=data.habits.filter(h=>h.child_id===c.id&&h.active&&!h.archived_at),ids=chosen[c.id]||[];return <fieldset key={c.id}><legend>{c.nickname} · 纳入连续奖励的习惯</legend><div className="button-row"><button type="button" className="secondary" disabled={busy||!habits.length} onClick={()=>setChosen(v=>({...v,[c.id]:habits.map(h=>h.id)}))}>全选习惯</button><button type="button" className="secondary" disabled={busy||!ids.length} onClick={()=>setChosen(v=>({...v,[c.id]:[]}))}>清除选择</button><span>已选 {ids.length} / {habits.length}</span></div>{habits.map(h=><label key={h.id} className="star-rule-check"><input type="checkbox" checked={ids.includes(h.id)} onChange={e=>setChosen(v=>({...v,[c.id]:e.target.checked?[...ids,h.id]:ids.filter(id=>id!==h.id)}))}/>{h.name}</label>)}{!habits.length&&<p>需要先添加或启用习惯，才能全家开启连续奖励。</p>}</fieldset>;})}
 <label className="field"><span>存星奖励</span><select required value={savings} onChange={e=>setSavings(e.target.value)}><option value="" disabled>现有设置不同，请选择</option><option value="false">全家关闭</option><option value="true">全家开启</option></select></label>
 <button className="secondary" disabled={busy||stale||!valid}>预览全家规则变更</button>
 </form>:<div role="group" aria-label="确认全家规则"><p>对 {data.children.map(c=>c.nickname).join('、')} 统一设置每日最多扣 {cap} 星，连续奖励{streak==='true'?'开':'关'}、存星奖励{savings==='true'?'开':'关'}。</p>
 {streak==='true'&&data.children.map(c=><p key={c.id}>{c.nickname}：{data.habits.filter(h=>(chosen[c.id]||[]).includes(h.id)).map(h=>h.name).join('、')}</p>)}
 <p>保存新的配置版本，不覆盖历史版本或账目。扣星上限立即生效，连续规则从下个完整家庭日、存星规则从下个完整家庭周生效；旧周期仍沿用旧规则。</p>
 <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setConfirm(false)}>返回修改</button><button className="primary" disabled={busy||stale||!valid||!!notice} onClick={async()=>{try{const result=await mutate('star_rules_family_save',payload);if(result)reload();else setNotice('保存未确认，请刷新核对后重新读取设置，不会自动重试。');}catch{setNotice('保存未确认，请刷新核对后重新读取设置。');}}}>确认保存全家规则</button></div></div>}
 {notice&&<p role="alert">{notice}<button className="secondary" disabled={busy} onClick={reload}>重新读取设置</button></p>}
 </section>;
}

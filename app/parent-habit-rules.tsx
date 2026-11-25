"use client";
import {ChildQuickSwitch} from "./child-quick-switch";
import {useEffect,useMemo,useRef,useState,type MouseEvent} from "react";
import {displayHabitGroups} from '@/lib/habit-display-groups';
import {HabitRuleDialog} from "./habit-rule-dialog";
import {Plus,Search,Pause,Play,CheckSquare,Trash2} from "lucide-react";
import type {Dashboard,Habit} from "@/lib/model";
import {habitTemplates} from "@/lib/habit-templates";
import {habitRule,habitRuleFingerprint,groupHabits,rangeSelection,type HabitGroup,type HabitRule} from "@/lib/habit-rule-groups";
type Props={data:Dashboard;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<unknown>};
const days=["一","二","三","四","五","六","日"];
const blank:HabitRule={category:"routine",name:"",icon:"star",color:"#69b5a6",weekdays:[1,2,3,4,5,6,7],target_count:1,target_minutes:0,stars:1,requires_approval:true,active:true};

export function ParentHabitRules({data,busy,mutate}:Props){
 const groups=useMemo(()=>displayHabitGroups(data.habits).map(g=>({...g,habits:g.habits.sort((a,b)=>data.children.findIndex(c=>c.id===a.child_id)-data.children.findIndex(c=>c.id===b.child_id))})),[data.habits,data.children]);
 const [query,setQuery]=useState(""),[child,setChild]=useState(""),[status,setStatus]=useState("");
 const [batchEditing,setBatchEditing]=useState<Habit[][]|null>(null);
 const [adding,setAdding]=useState(false),[editing,setEditing]=useState<HabitGroup|null>(null);
 const [selected,setSelected]=useState<string[]>([]),[pending,setPending]=useState<boolean|null>(null),[error,setError]=useState("");
 const anchor=useRef<string|null>(null);
 const [deleting,setDeleting]=useState<Habit[]|null>(null),[deleteBusy,setDeleteBusy]=useState(false),[deleteError,setDeleteError]=useState("");
 const deleteLock=useRef(false),deleteDialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(deleting&&!deleteDialog.current?.open)deleteDialog.current?.showModal();},[deleting]);
 const beginDelete=(items:Habit[])=>{if(deleteLock.current||busy)return;setDeleting(items.map(h=>({...h,weekdays:[...h.weekdays]})));setDeleteError("");setPending(null);};
 const deleteStale=!!deleting?.some(h=>!data.habits.some(now=>now.id===h.id&&!now.archived_at&&habitRuleFingerprint(now)===habitRuleFingerprint(h)));
 const confirmDelete=async()=>{if(!deleting||deleteLock.current||deleteStale)return;deleteLock.current=true;setDeleteBusy(true);setDeleteError("");
  try{const ok=await mutate("habit_batch_delete",{targets:deleting.map(h=>({id:h.id,child_id:h.child_id,expected:habitRuleFingerprint(h)}))});
   if(ok){setDeleting(null);setSelected([]);}else setDeleteError("未收到删除成功确认。请刷新核对后再操作，不会自动重发。");
  }catch{setDeleteError("未收到删除成功确认。请刷新核对后再操作，不会自动重发。");}
  finally{deleteLock.current=false;setDeleteBusy(false);}
 };

 const visible=groups.filter(g=>(!query||g.rule.name.toLowerCase().includes(query.trim().toLowerCase()))&&(!child||g.habits.some(h=>h.child_id===child))&&(!status||g.habits.some(h=>h.active===(status==="active"))));
 const selectedGroups=visible.filter(g=>selected.includes(g.key));
 const targets=selectedGroups.flatMap(g=>g.habits);
 const filter=(fn:()=>void)=>{fn();setSelected([]);setPending(null);anchor.current=null;};
 return <section className="panel habit-rules-panel">
 <div className="habit-toolbar"><div><h2>习惯规则</h2></div><button className="primary" disabled={adding||busy} onClick={()=>setAdding(true)}><Plus size={17}/>新增习惯规则</button></div>
 <div className="rule-filter">
 <label className="field"><span>搜索习惯</span><div className="rule-search"><Search size={17}/><input value={query} placeholder="按名称查找" onChange={e=>filter(()=>setQuery(e.target.value))}/></div></label>
 <ChildQuickSwitch children={data.children} value={child} onChange={id=>filter(()=>setChild(id))} label="适用孩子" allLabel="全部孩子"/>
 <label className="field"><span>启用状态</span><select aria-label="启用状态" value={status} onChange={e=>filter(()=>setStatus(e.target.value))}><option value="">全部状态</option><option value="active">启用中</option><option value="paused">已暂停</option></select></label>
 </div>
 <div className="habit-editors rule-editors">
 {adding&&<HabitRuleDialog targets={[]} data={data} busy={busy} mutate={mutate} close={()=>setAdding(false)}/>}
 {editing&&<HabitRuleDialog key={editing.key} targets={editing.habits} audienceGroups={[editing.habits]} data={data} busy={busy} mutate={mutate} close={()=>setEditing(null)}/>}
 {batchEditing&&<HabitRuleDialog targets={batchEditing.flat()} audienceGroups={batchEditing} data={data} busy={busy} mutate={mutate} close={()=>setBatchEditing(null)}/>}
 </div>
 <div className="batch-toolbar">
 <label className="checkbox"><input type="checkbox" aria-label="全选当前规则" checked={visible.length>0&&selectedGroups.length===visible.length} ref={el=>{if(el)el.indeterminate=selectedGroups.length>0&&selectedGroups.length<visible.length;}} onChange={e=>{setSelected(e.target.checked?visible.map(g=>g.key):[]);setPending(null);}}/>全选当前结果</label>
 <span>已选 {selectedGroups.length} 条规则 / {targets.length} 个孩子习惯</span>
 <button className="secondary" disabled={!targets.length||busy} onClick={()=>setBatchEditing(selectedGroups.map(g=>g.habits.map(h=>({...h,weekdays:[...h.weekdays]}))))}>编辑所选</button>
 <button className="secondary" disabled={!targets.length||busy} onClick={()=>{setPending(true);setError("");}}><Play size={16}/>批量启用</button>
 <button className="secondary" disabled={!targets.length||busy} onClick={()=>{setPending(false);setError("");}}><Pause size={16}/>批量暂停</button>
 {selectedGroups.length>0&&<button className="text-button" onClick={()=>{setSelected([]);setPending(null);}}>取消选择</button>}
 <button className="secondary habit-delete-action" disabled={!targets.length||busy||deleteBusy} onClick={()=>beginDelete(targets)}><Trash2 size={16}/>删除所选</button>
 </div>
 <p className="small">按住 Shift 可连续多选规则；平板直接勾选或全选。批量操作会作用于所选规则下的全部孩子，孩子筛选仅用于查找。</p>
 {pending!==null&&<div className="rule-review" role="region" aria-label="确认批量操作"><strong>确认{pending?"启用":"暂停"} {selectedGroups.length} 条规则？</strong><ul>{selectedGroups.map(g=><li key={g.key}>{g.rule.name}：{g.habits.map(h=>data.children.find(c=>c.id===h.child_id)?.nickname).join("、")}</li>)}</ul><p>共 {targets.length} 个孩子习惯，历史记录及星星不变。</p>{error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setPending(null)}>取消</button><button className="primary" disabled={busy} onClick={async()=>{const ok=await mutate("habit_batch_active",{active:pending,targets:targets.map(h=>({id:h.id,child_id:h.child_id,expected:habitRuleFingerprint(h)}))});if(ok){setPending(null);setSelected([]);}else setError("未能完成，所选规则没有部分保存。请刷新检查后重试。");}}>确认{pending?"启用":"暂停"}</button></div></div>}
 {error&&pending===null&&<p role="alert" className="error">{error}</p>}
 <div className="rule-list">{visible.map(g=><article className={"rule-row"+(selected.includes(g.key)?" is-selected":"")} key={g.key}>
 <label className="checkbox rule-select"><input type="checkbox" aria-label={"选择规则 "+g.rule.name} checked={selected.includes(g.key)} onClick={e=>{const checked=e.currentTarget.checked,shift=e.shiftKey,previous=anchor.current;setSelected(v=>rangeSelection(visible.map(g=>g.key),v,previous,g.key,shift,checked));anchor.current=g.key;setPending(null);}} onChange={()=>{}}/></label>
 <div className="rule-summary"><div className="rule-title"><strong>{g.rule.name}</strong></div>
 <p>{g.rule.category==="occasional"?"偶尔习惯":"日常习惯"} · 周{[...g.rule.weekdays].sort((a,b)=>a-b).map(n=>days[n-1]).join("、")} · 每天 {g.rule.target_count} 次{g.rule.target_minutes>0?" · "+g.rule.target_minutes+" 分钟":""} · {g.rule.stars} 星{g.rule.requires_approval?" · 需审核":""}</p>
 <div className="rule-children">{g.habits.map(h=>{const c=data.children.find(c=>c.id===h.child_id);return <button type="button" key={h.id} className="habit-child-chip" data-child-tone={data.children.findIndex(child=>child.id===h.child_id)%2===0?'leaf':'sand'} aria-pressed={h.active} aria-label={(c?.nickname||'孩子')+'：'+(h.active?'已启用，点击暂停':'已暂停，点击启用')} disabled={busy} onClick={async()=>{setError('');const ok=await mutate('habit_batch_active',{active:!h.active,targets:[{id:h.id,child_id:h.child_id,expected:habitRuleFingerprint(h)}]});if(!ok)setError('未保存启用状态，请刷新核对后重试。');}}>{h.active?'✓ ':'○ '}{c?.nickname||'孩子'}{!h.active?' · 暂停':''}</button>;})}</div></div>
 <div className="rule-row-actions"><button className="secondary" disabled={!!editing||busy} onClick={()=>setEditing({key:g.key,rule:habitRule(g.rule),habits:g.habits.map(h=>({...h,weekdays:[...h.weekdays]}))})}><CheckSquare size={16}/>编辑规则</button><button className="secondary habit-delete-action" disabled={busy||deleteBusy} onClick={()=>beginDelete(g.habits)}><Trash2 size={16}/>删除规则</button></div>
 </article>)}</div>
 {!visible.length&&<div className="empty"><p>没有符合条件的习惯规则。可以调整筛选，或新增一条。</p></div>}
 {deleting&&<dialog ref={deleteDialog} className="rule-delete-dialog" aria-label="确认删除习惯" onCancel={e=>{e.preventDefault();if(!deleteBusy)setDeleting(null);}}>
 <h3>删除 {deleting.length} 个习惯？</h3><p>将从当前习惯列表移除并停止后续打卡；已有打卡、历史记录与星星保留，不会清空。当天任务进度会按剩余习惯重新计算。</p>
 <ul>{deleting.map(h=><li key={h.id}>{h.name} · {data.children.find(c=>c.id===h.child_id)?.nickname||"孩子"}</li>)}</ul>
 <p className="small">删除规则会影响上面列出的全部孩子，请核对范围。</p>
 {deleteStale&&<p role="alert" className="error">习惯已变化，请取消后重新选择。</p>}
 {deleteError&&<p role="alert" className="error">{deleteError}</p>}
 <div className="dialog-actions"><button className="secondary" disabled={deleteBusy} onClick={()=>setDeleting(null)}>取消</button><button className="primary habit-delete-action" disabled={busy||deleteBusy||deleteStale||!!deleteError} onClick={()=>void confirmDelete()}>{deleteBusy?"删除中…":"确认删除"}</button></div>
 </dialog>}
 </section>;
}

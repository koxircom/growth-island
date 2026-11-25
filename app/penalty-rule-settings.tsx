"use client";
import {useEffect,useRef,useState} from 'react';
import {Plus,ShieldCheck} from 'lucide-react';
import type {PenaltyRule} from '@/lib/penalty-rules';
type Draft={rule_id:string|null;expected_revision:number;name:string;description:string;stars:number;enabled:boolean};
const blank:Draft={rule_id:null,expected_revision:0,name:'',description:'',stars:1,enabled:true};
export function PenaltyRuleSettings({token,busy}:{token:string;busy:boolean}){
 const [rules,setRules]=useState<PenaltyRule[]>([]),[draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[unknown,setUnknown]=useState(false),[reload,setReload]=useState(0);const lock=useRef(false);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(draft)dialog.current?.showModal();},[Boolean(draft)]);
 const [readStatus,setReadStatus]=useState<'loading'|'success'|'error'>('loading');
 const loading=readStatus==='loading';
 useEffect(()=>{
   const abort=new AbortController();
   setReadStatus('loading');
   fetch('/api/penalty-rules',{cache:'no-store',signal:abort.signal}).then(async r=>{
     if(!r.ok)throw Error();
     const body=await r.json();
     if(abort.signal.aborted)return;
     setRules(body.data);
     setReadStatus('success');
   }).catch(()=>{
     if(abort.signal.aborted)return;
     setReadStatus('error');
     setError('事项暂时无法读取，请重试。');
   });
   return()=>abort.abort();
 },[reload]);
 async function save(){if(!draft||lock.current||unknown)return;lock.current=true;setSaving(true);setError('');try{const r=await fetch('/api/penalty-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),parent_token:token,payload:draft})});const body=await r.json();if(!r.ok){if(body.error==='penalty_rule_conflict'){setError('事项已被修改，请取消后刷新列表再编辑。');setUnknown(true);return;}throw Error();}setRules(body.data);setDraft(null);}catch{setUnknown(true);setError('保存结果未确认，请取消后刷新核对，勿重复提交。');}finally{setSaving(false);lock.current=false;}}
 return <section className="panel penalty-rule-settings"><div className="panel-heading"><h2>一起遵守的小约定</h2><button className="primary" disabled={busy||saving||loading} onClick={()=>{setDraft({...blank});setUnknown(false);setError('');}}><Plus size={17}/>创建惩罚</button></div><p className="small">全家共用事项；扣星时选择孩子，账目互不合并。</p>
 {loading&&<p role="status">正在读取…</p>}{error&&!draft&&<p role="alert">{error}<button className="text-button" disabled={saving} onClick={()=>{setDraft(null);setUnknown(false);setReload(n=>n+1);setError('');}}>刷新核对</button></p>}
 {readStatus==='success'&&!rules.length&&<p className="history-empty">还没有配置惩罚事项。</p>}
 {rules.map(r=><div className="admin-row" key={r.rule_id}><ShieldCheck size={22}/><div><strong>{r.name}</strong><p>扣 {r.stars} 星 · 全家共用{r.enabled?'':' · 已停用'}</p>{r.description&&<p className="penalty-description">{r.description}</p>}</div><button className="text-button" disabled={busy||saving} onClick={()=>{setDraft({rule_id:r.rule_id,expected_revision:Number(r.revision),name:r.name,description:r.description,stars:r.stars,enabled:r.enabled});setUnknown(false);setError('');}}>编辑</button></div>)}
 {draft&&<dialog ref={dialog} className="habit-rule-dialog" aria-label={draft.rule_id?'编辑惩罚':'创建惩罚'} onCancel={e=>{e.preventDefault();if(!saving)setDraft(null);}}><form className="star-rule-card" aria-label={draft.rule_id?'编辑惩罚':'创建惩罚'} onSubmit={e=>{e.preventDefault();void save();}}><h3>{draft.rule_id?'编辑惩罚':'创建惩罚'}</h3><label className="field"><span>事项名称</span><input disabled={saving} required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="field"><span>扣除星星</span><input disabled={saving} required type="number" min={1} max={10} step={1} value={draft.stars} onChange={e=>setDraft({...draft,stars:Number(e.target.value)})}/></label><label className="field"><span>说明</span><textarea disabled={saving} maxLength={500} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label><label className="checkbox"><input disabled={saving} type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>启用事项</label><p className="small">保存新版本，不修改已经发生的扣星记录；停用后儿童页不再显示。</p>{error&&<p role="alert">{error}<button type="button" className="text-button" disabled={saving} onClick={()=>{setDraft(null);setUnknown(false);setReload(n=>n+1);setError('');}}>刷新核对</button></p>}<div className="dialog-actions"><button type="button" className="secondary" disabled={saving} onClick={()=>setDraft(null)}>取消</button><button className="primary" disabled={busy||saving||unknown||!draft.name.trim()}>{saving?'保存中…':'保存惩罚'}</button></div></form></dialog>}
 </section>;
}

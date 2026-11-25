'use client';
import {ChildQuickSwitch} from './child-quick-switch';
import {csvCell} from "@/lib/csv";
import {useCallback,useEffect,useRef,useState} from 'react';
import {type Dashboard,safeError} from '@/lib/model';
type Entry={balance_after?:number|null;id:string;child_id:string;amount:number;source_type:string;source_id:string;created_at:string;description:string;status:string;related_id?:string;can_reverse:boolean};
type Book={read_at:string;unit:string;page:number;total:number;entries:Entry[];summaries:{child_id:string;balance:number;income:number;expense:number;pending_stars:number;pending_earnings:number;expected_balance:number}[];time_accounts:{child_id:string;device_id:string;name:string;available:number;running_seconds:number;device_pending:boolean}[]};
const labels:Record<string,string>={checkin:'习惯入账',undo:'打卡撤销',redemption:'兑换扣星',refund:'退回',manual_bonus:'家长加星',manual_reversal:'误加星纠正',star_adjustment:'星星约定调整',grant:'兑换时间到账',reserve:'使用预留',reversal:'撤销兑换时间'};
const statuses:Record<string,string>={pending:'待家长确认，星星已预留',approved:'已确认',rejected:'未通过，已退回',undone:'已撤销',reversed:'已反向纠正',posted:'已记账',wallet_credited:'小岛时间到账（不是设备回执）',ledger_only:'本地时间流水（不是实际播放记录）'};
const cell=csvCell;
export function ParentAccountBook({data,token,busy,mutate}:{data:Dashboard;token:string;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<any>}) {
 const [loaded,setLoaded]=useState<{key:string;book:Book}|null>(null),[child,setChild]=useState(''),[unit,setUnit]=useState('stars'),[page,setPage]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [reverse,setReverse]=useState<Entry|null>(null),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
 const key=JSON.stringify([token,child,unit,page]);
 const book=loaded?.key===key?loaded.book:null;
 const seq=useRef(0);
 const refresh=useCallback(async()=>{
  const n=++seq.current;setLoading(true);setError('');
  try{const res=await fetch('/api/parent/account-book',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent_token:token,child_id:child||null,unit,page})});
   if(!res.ok)throw new Error(res.status===401||res.status===403?'家长身份已过期，请重新解锁。':'账本读取失败，请重试。');
   const result=await res.json();if(n===seq.current)setLoaded({key,book:result.data});
  }catch(e){if(n===seq.current)setError(safeError(e));}finally{if(n===seq.current)setLoading(false);}
 },[token,child,unit,page,key]);
 useEffect(()=>{void refresh();return()=>{seq.current++;};},[refresh,data]);
 const name=(id:string)=>data.children.find(c=>c.id===id)?.nickname||'孩子';
 const date=(v:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:data.family.timezone,dateStyle:'short',timeStyle:'medium'}).format(new Date(v));
 const amount=(n:number,u=unit)=>u==='stars'?n+' 星星':(Number(n)/60).toFixed(1)+' 分钟';
 function download(){if(!book)return;const content='\uFEFF'+[['孩子','记账时间','类型','变化','当笔后余额','单位','说明','状态','流水编号','来源编号'],...book.entries.map(e=>[name(e.child_id),date(e.created_at),labels[e.source_type]||e.source_type,e.amount,unit==='stars'?(e.balance_after??'未记录'):'',unit==='stars'?'星星':'秒',e.description,statuses[e.status]||e.status,e.id,e.source_id])].map(row=>row.map(cell).join(',')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='小岛账本-'+unit+'-第'+(page+1)+'页.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="panel account-book" aria-label="星星与时间账本">
  <div className="panel-heading"><div><span className="eyebrow">仅家长可见 · 每一笔都有来处</span><h2>星星与时间账本</h2></div><button className="secondary" disabled={loading||busy} onClick={()=>void refresh()}>刷新核对</button></div>
  <p>星星和时间分开记账。兑换申请会先扣除星星，未通过会返还；待审核的打卡还没有到账。</p>
  <div className="account-filters"><ChildQuickSwitch children={data.children} value={child} allLabel="全部" onChange={id=>{setChild(id);setPage(0);setReverse(null);}}/><label className="field"><span>账本</span><select aria-label="账本" value={unit} onChange={e=>{setUnit(e.target.value);setPage(0);setReverse(null);}}><option value="stars">星星收支</option><option value="seconds">设备时间</option></select></label></div>
  <p className="account-refresh-status" role="status">{loading?(book?"正在局部更新，当前记录保留…":"正在读取账本…"):"账本已读取"}</p>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {book&&<>
   <div className="account-summary-grid">{book.summaries.map(s=><article className="reward-card" key={s.child_id}><h3>{name(s.child_id)}</h3><strong>可用 {s.balance} 星星</strong><p>累计入账 {s.income||0} · 累计支出 {s.expense||0}</p><p>待审核打卡 {s.pending_earnings}（未计入余额）<br/>待确认兑换 {s.pending_stars}（已扣除，不重复扣）</p><p className={Number(s.balance)===Number(s.expected_balance)?'small':'error'}>{Number(s.balance)===Number(s.expected_balance)?'✓ 星星流水与业务记录核对一致':'需要核查：流水余额 '+s.balance+'，业务记录应为 '+s.expected_balance+'。未自动修改余额。'}</p></article>)}</div>
   {unit==='seconds'&&<><p className="notice">预留时间已从可用余额移出，不是重复扣除。提前结束会返还未用部分。时间到账不代表电视或 Switch 已实际解锁；设备不确定时不要反复点击加时。</p>{book.time_accounts.map(t=><article className="notice" key={t.child_id+t.device_id}><strong>{name(t.child_id)} · {t.name}</strong><p>可用 {amount(t.available)} · 普通网页计时中剩余 {amount(t.running_seconds)}</p>{t.device_pending&&<p>电视操作正在等待回执，请到电视记录核查。此处不推测电视剩余时间。</p>}</article>)}</>}
   <div className="panel-heading"><div><h3>收支流水</h3><p className="small">共 {book.total} 条，每页 50 条。读取于 {date(book.read_at)}；累计收支包括退款和纠正。</p></div><button className="secondary" disabled={!book.entries.length} onClick={download}>导出当前页 CSV</button></div>
   {!book.entries.length?<p className="history-empty">本页还没有流水。</p>:book.entries.map(e=><article className="ledger-entry" key={e.id}><div className="ledger-entry-top"><strong>{name(e.child_id)} · {labels[e.source_type]||e.source_type}</strong><strong>{Number(e.amount)>0?'+':''}{amount(e.amount)}</strong></div><p>{e.description}{unit==='stars'&&<> · {e.balance_after==null?"历史余额未记录":"余额 "+e.balance_after+" 星星"}</>}</p><p className="small">{date(e.created_at)} · {statuses[e.status]||e.status}</p><details><summary>查看关联编号</summary><p>流水：{e.id}<br/>来源：{e.source_id}{e.related_id&&<><br/>原加星记录：{e.related_id}</>}</p></details>{e.can_reverse&&<button className="text-button" disabled={busy} onClick={()=>{setReverse(e);setReason('');setNotice('');}}>纠正这笔误加星</button>}</article>)}
   <div className="button-row"><button className="secondary" disabled={page===0||loading} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page+1} 页</span><button className="secondary" disabled={(page+1)*50>=book.total||loading} onClick={()=>setPage(p=>p+1)}>下一页</button></div>
  </>}
  {reverse&&<div className="notice ledger-reversal" role="group" aria-label="确认纠正误加星"><h3>纠正 {name(reverse.child_id)} 的 {reverse.amount} 颗误加星</h3><p>保留原记录，另记一笔 −{reverse.amount} 星星。不是惩罚，不占扣星额度；余额不足时不会透支。</p><label className="field"><span>纠正原因</span><input maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setReverse(null)}>取消纠正</button><button className="primary" disabled={busy||!reason.trim()} onClick={async()=>{const result=await mutate('manual_star_reverse',{id:reverse.source_id,reason:reason.trim(),confirmed:true});if(result){setReverse(null);setNotice('已添加反向流水，原记录仍然保留。');void refresh();}}}>确认纠正</button></div></div>}
 </section>;
}

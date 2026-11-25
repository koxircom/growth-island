"use client";
import {useEffect,useMemo,useState} from 'react';
import {BarChart,Bar,CartesianGrid,XAxis,YAxis,Tooltip,Legend,ResponsiveContainer} from 'recharts';
import {CalendarDays,RefreshCw,Star,Timer,Gift} from 'lucide-react';
import {ChildQuickSwitch} from './child-quick-switch';
import type {Dashboard} from '@/lib/model';
type Stats={unallocated_tv_count?:number;timezone:string;period:string;start:string;end:string;as_of:string;buckets:{date:string;child_id:string;category:string;seconds:number;count:number}[];stars:{date:string;child_id:string;source_type:string;amount:number;count:number}[];redemptions:{date:string;child_id:string;status:string;kind:string;count:number;cost:number;seconds:number}[];balances:{child_id:string;balance:number}[];notes:string[]};
const titles:Record<string,string>={focus:'专注计时',game:'游戏练习计时',tv_confirmed:'电视已确认消耗'};
const sources:Record<string,string>={checkin:'习惯获得',undo:'撤销打卡',redemption:'兑换消费',refund:'兑换退回',manual_bonus:'家长鼓励',manual_reversal:'误加纠正',star_adjustment:'约定调整',star_deduction:'约定扣星',star_reversal:'调整撤销',star_streak:'连续奖励',star_savings:'存星奖励'};
const colors=['#64a48d','#e3ad63','#7d9fc4','#c291b5','#d68873','#83b9b2'];
const duration=(seconds:number)=>`${Math.floor(seconds/3600)}小时${Math.floor(seconds%3600/60)}分${Math.floor(seconds%60)}秒`;
const label=(key:string)=>key.endsWith(':pending')?'未结算记录':titles[key]||key.replace(/^device:/,'设备计时 · ');
export function GrowthStatistics({data,today}:{data:Dashboard;today:string}){
 const [period,setPeriod]=useState('week'),[anchor,setAnchor]=useState(today),[child,setChild]=useState(''),[retry,setRetry]=useState(0);
 const [stats,setStats]=useState<Stats|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setStats(null);
  const params=new URLSearchParams({period,anchor});if(child)params.set('child_id',child);
  fetch('/api/statistics?'+params,{cache:'no-store',signal:controller.signal}).then(async r=>{const v=await r.json();if(!r.ok||!v.data)throw new Error('统计暂时无法读取，请重试。');setStats(v.data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[period,anchor,child,retry]);
 return <><div className="heading growth-view-heading"><div><span className="eyebrow">各自成长，一起被看见</span><h1>两座小岛，两种精彩</h1><p>看各自的完成比例与变化，不比较星星多少。</p></div><ChildQuickSwitch children={data.children} value={child} onChange={setChild} allLabel="合并" label="统计所属孩子"/></div><section className="panel island-statistics" aria-label="成长统计">
  <div className="panel-heading"><div><span className="eyebrow">把每一点成长看清楚</span><h2><CalendarDays size={22}/>成长统计</h2></div><button className="secondary" aria-label="刷新统计" onClick={()=>setRetry(n=>n+1)} disabled={loading}><RefreshCw size={17}/>刷新</button></div>
  <p>游戏、电视、专注与星星账本，按各自的节奏回顾。查看不需要家长密码。</p>
  <div className="stats-filters">
   <label className="field"><span>统计周期</span><select aria-label="统计周期" value={period} onChange={e=>setPeriod(e.target.value)}><option value="week">周统计</option><option value="month">月统计</option><option value="year">年统计</option></select></label>
   <label className="field"><span>选择所在日期</span><input aria-label="统计日期" type="date" value={anchor} onChange={e=>{if(e.target.value)setAnchor(e.target.value);}}/></label>
   <button className="secondary" onClick={()=>setAnchor(today)}>回到今天</button>
  </div>
  {loading&&<p role="status">正在读取完整记录…</p>}{error&&<p className="notice" role="alert">{error}</p>}
  {stats&&<><p className="small">全部孩子按各自记录独立展示，不合并，也不排名。</p>{!!stats.unallocated_tv_count&&<p className="notice">当前范围内有 {stats.unallocated_tv_count} 条电视记录无法可靠归入日期，未分摊给任何孩子。</p>}{data.children.filter(c=>!child||c.id===child).map(c=><ChildStatistics key={c.id} data={data} childId={c.id} stats={{...stats,unallocated_tv_count:0,buckets:stats.buckets.filter(r=>r.child_id===c.id),stars:stats.stars.filter(r=>r.child_id===c.id),redemptions:stats.redemptions.filter(r=>r.child_id===c.id),balances:stats.balances.filter(r=>r.child_id===c.id)}}/>)}</>}

 </section></>;
}

function ChildStatistics({data,stats,childId}:{data:Dashboard;stats:Stats;childId:string}){
 const period=stats.period;
 const view=useMemo(()=>statisticsView(stats),[stats]);
 return <section className="stats-child-section" aria-label={(data.children.find(c=>c.id===childId)?.nickname||"孩子")+"的统计"}><h3>{data.children.find(c=>c.id===childId)?.nickname}</h3>
  <>
   <p className="small">{stats.start.slice(0,10)} 至 {stats.end.slice(0,10)}（结束日期不含） · {stats.timezone} · 统计读取于 {new Date(stats.as_of).toLocaleString('zh-CN',{timeZone:stats.timezone})}</p>
   <div className="stats-cards">
    <article><Star size={20}/><span>本期获得</span><strong>{view.income} 星</strong><small>习惯、家长鼓励、连续与存星奖励</small></article>
    <article><Gift size={20}/><span>本期兑换消费</span><strong>{view.spent} 星</strong><small>退回另计 {view.refunds} 星</small></article>
    <article><Star size={20}/><span>约定调整</span><strong>{view.adjustment>0?'+':''}{view.adjustment} 星</strong><small>纠正 / 撤销净额 {view.corrections} 星</small></article>
    <article><Star size={20}/><span>当前可用余额</span><strong>{view.balance} 星</strong><small>全部历史累计，不限本期</small></article>
   </div>
   <h3><Timer size={20}/> 时间记录</h3>
   <p className="small">这些是应用计时或已确认的额度消耗，不等于孩子实际看屏幕的时长；不同来源可能重叠，不相加为总屏幕时间。</p>
   {!view.cats.length?<p className="history-empty">这个周期还没有已结算的时间记录。</p>:<>
    <div className="stats-time-totals">{view.cats.map(c=><div key={c}><span>{label(c)}</span><strong>{duration(view.totals.get(c)||0)}</strong></div>)}</div>
    <div className="stats-chart" aria-label="时间趋势，单位分钟"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={view.chart} margin={{top:10,right:8,left:0,bottom:5}}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e7eee8"/><XAxis dataKey="date" tickFormatter={v=>String(v).slice(5,period==='year'?7:10)} minTickGap={24}/><YAxis width={44} tick={{fontSize:12}}/><Tooltip formatter={(value)=>`${Number(value).toFixed(1)} 分钟`}/><Legend/>{view.cats.map((c,i)=><Bar key={c} dataKey={row=>Number(row[c]||0)} name={label(c)} fill={colors[i%colors.length]} radius={[4,4,0,0]} isAnimationActive={false}/>)}</BarChart></ResponsiveContainer></div>
   </>}
   {view.pending>0&&<p className="notice">有 {view.pending} 条进行中或待确认记录，未计入已结算时长。</p>}
   {!!stats.unallocated_tv_count&&<p className="notice">有 {stats.unallocated_tv_count} 条电视记录缺少可靠起始时间，暂不能归入周月年统计。</p>}
   <div className="stats-detail-grid"><div><h3>星星流水分类</h3>{!view.starSources.size?<p className="history-empty">本期没有星星流水。</p>:<ul className="stats-list">{[...view.starSources].map(([key,value])=><li key={key}><span>{sources[key]||key}</span><strong>{value>0?'+':''}{value} 星</strong></li>)}</ul>}</div>
   <div><h3>奖励兑换记录</h3><p className="small">本期已通过兑换的时间额度：{duration(stats.redemptions.filter(r=>r.status==='approved'&&r.kind==='device_time').reduce((n,r)=>n+Number(r.seconds),0))}</p>{!stats.redemptions.length?<p className="history-empty">本期还没有兑换奖励。</p>:<ul className="stats-list">{Object.entries(stats.redemptions.reduce((out,r)=>{const key=`${r.kind==='device_time'?'时间奖励':'家庭奖励'} · ${{pending:'待审核',approved:'已通过',rejected:'已拒绝',cancelled:'已取消'}[r.status]||r.status}`;out[key]=(out[key]||0)+Number(r.count);return out;},{} as Record<string,number>)).map(([key,count])=><li key={key}><span>{key}</span><strong>{count} 次</strong></li>)}</ul>}<p className="small">兑换时间是额度到账，不代表已经使用；拒绝或取消的兑换不算成功使用。</p></div></div>
   <details className="stats-method"><summary>查看统计口径与逐期记录</summary><ul>{stats.notes.map((n,i)=><li key={i}>{n}</li>)}</ul><div className="stats-table-scroll"><table><caption>时间明细汇总（秒）</caption><thead><tr><th>日期</th><th>孩子</th><th>来源</th><th>秒数</th><th>记录数</th></tr></thead><tbody>{stats.buckets.map((r,i)=><tr key={i}><td>{r.date.slice(0,10)}</td><td>{data.children.find(c=>c.id===r.child_id)?.nickname||'小岛居民'}</td><td>{label(r.category)}</td><td>{r.seconds}</td><td>{r.count}</td></tr>)}</tbody></table></div></details>
  </>
</section>;
}

export function statisticsView(stats:Stats){

  
  const totals=new Map<string,number>();let pending=0;
  for(const row of stats.buckets){if(row.category.endsWith(':pending')){pending+=Number(row.count);continue;}totals.set(row.category,(totals.get(row.category)||0)+Number(row.seconds));}
  const cats=[...totals.keys()].sort();const days=new Map<string,Record<string,string|number>>();
  for(let cursor=new Date(stats.start.slice(0,10)+'T00:00:00Z');cursor<new Date(stats.end.slice(0,10)+'T00:00:00Z');stats.period==='year'?cursor.setUTCMonth(cursor.getUTCMonth()+1):cursor.setUTCDate(cursor.getUTCDate()+1)){const date=cursor.toISOString().slice(0,10);days.set(date,{date,...Object.fromEntries(cats.map(c=>[c,0]))});}

  for(const row of stats.buckets){if(row.category.endsWith(':pending'))continue;const day=row.date.slice(0,10);const point=days.get(day)||{date:day};point[row.category]=Number(point[row.category]||0)+Number(row.seconds)/60;days.set(day,point);}
  let income=0,spent=0,refunds=0,adjustment=0,corrections=0;const starSources=new Map<string,number>();
  for(const r of stats.stars){const n=Number(r.amount);starSources.set(r.source_type,(starSources.get(r.source_type)||0)+n);if(r.source_type==='redemption')spent-=n;else if(r.source_type==='refund')refunds+=n;else if((r.source_type==='star_adjustment'||r.source_type==='star_deduction'||r.source_type==='star_reversal'))adjustment+=n;else if(r.source_type==='undo'||r.source_type==='manual_reversal')corrections+=n;else if(n>0&&['checkin','manual_bonus','star_streak','star_savings'].includes(r.source_type))income+=n;else corrections+=n;}
  return{totals,cats,chart:[...days.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))),pending,income,spent,refunds,adjustment,corrections,starSources,balance:stats.balances.reduce((n,r)=>n+Number(r.balance),0)};

}

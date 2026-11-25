"use client";
import {useState} from 'react';
import type {Dashboard} from '@/lib/model';
export type TvPolicy={session_duration_min:number;max_sessions_per_day:number;cooldown_min:number;max_extensions:number};
export type TvConfig={manual_block:boolean;schedules:{id:string;name:string;days:number[];start:string;end:string;enabled:boolean}[];workday:TvPolicy;weekend:TvPolicy};
export type TvSettings={device_id:string;revision:number;config:TvConfig;pending?:boolean;last_result?:{accepted:boolean;reason:string|null}};
const defaults:TvConfig={manual_block:false,schedules:[],workday:{session_duration_min:55,max_sessions_per_day:1,cooldown_min:15,max_extensions:1},weekend:{session_duration_min:55,max_sessions_per_day:2,cooldown_min:15,max_extensions:1}};
export function ParentTvSettings({data,busy,mutate,token}:{data:Dashboard;busy:boolean;token:string;mutate:(a:string,p:Record<string,unknown>)=>Promise<any>}) {
 const saved=data.tv_settings;
 const [device,setDevice]=useState(saved?.device_id??'');
 const [config,setConfig]=useState<TvConfig>(saved?.config??defaults);
 const [message,setMessage]=useState('');
 const [opening,setOpening]=useState(false);
 const [accessMessage,setAccessMessage]=useState('');
 async function openHomeAccess(){
  if(opening)return;setOpening(true);setAccessMessage('正在开启并核对电视网络与 DLNA…');
  try{const response=await fetch('/api/parent/home-access',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent_token:token})});
   if(!response.ok)throw new Error();const {data:result}=await response.json();
   const network=result?.network==='open'?'规则已放行':'未确认';const dlna=result?.dlna==='open'?'已开启':'未确认';
   setAccessMessage(`电视网络：${network}；DLNA：${dlna}。`);
  }catch{setAccessMessage('未能确认开启结果，请稍后查看设备状态。');}finally{setOpening(false);}
 }
 async function submit(e:React.FormEvent) {e.preventDefault();setMessage('');try {if(!await mutate('tv_config_save',{config,revision:saved?.revision})) throw new Error();setMessage('设置已提交，等待电视确认。');}catch{setMessage('设置尚未保存，请检查家长身份后重试。');}}
 return <section className="panel tv-settings"><span className="eyebrow">一起约定，好好休息</span><h2>电视时间</h2><p>规定时段与已批准兑换余额同时满足，才能观看。孩子各有余额，电视共享轮数和冷却时间。</p>
 <div className="home-access"><button type="button" className="secondary" disabled={busy||opening} onClick={()=>void openHomeAccess()}>{opening?"正在开启…":"一键开启电视网络和 DLNA"}</button><p role="status">{accessMessage}</p></div>
 <details><summary>电视奖励时间账本设置</summary><p>这里只设置奖励时间的账本分类，无需在小岛绑定实体电视。</p><label>奖励时间分类<select value={device} onChange={e=>setDevice(e.target.value)}><option value="">请选择账本分类</option>{data.devices?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><button className="secondary" disabled={busy||!device} onClick={()=>mutate('tv_bind',{device_id:device})}>保存账本分类</button></details>
 {saved && !saved.config && <p role="status">正在读取电视现有设置，请稍候再修改。</p>}{saved?.last_result?.accepted===false&&<p role="alert">电视未接受上次设置，请核对已读取的当前设置后重新保存。</p>}<form onSubmit={submit}><label><input type="checkbox" checked={config.manual_block} onChange={e=>setConfig({...config,manual_block:e.target.checked})}/>暂停观看</label>
 <div className="tv-policy-grid">{(['workday','weekend'] as const).map(kind=><fieldset key={kind}><legend>{kind==='workday'?'工作日':'周末'}</legend>{([['session_duration_min','每轮最多（分钟）',1,1440],['max_sessions_per_day','每天最多（轮）',0,100],['cooldown_min','两轮间休息（分钟）',1,1440],['max_extensions','每轮最多追加（次）',0,100]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" required min={min} max={max} value={config[kind][key]} onChange={e=>setConfig({...config,[kind]:{...config[kind],[key]:Number(e.target.value)}})}/></label>)}</fieldset>)}</div>
 <h3>允许观看的时段</h3><p>没有启用的时段时保持锁定。缩短时段会立即重新评估当前观看。</p>
 {config.schedules.map((s,i)=><fieldset key={s.id}><legend>时段 {i+1}</legend><label><input type="checkbox" checked={s.enabled} onChange={e=>setConfig({...config,schedules:config.schedules.map((x,j)=>i===j?{...x,enabled:e.target.checked}:x)})}/>启用</label><div className="button-row"><button type="button" className="secondary" onClick={()=>setConfig({...config,schedules:config.schedules.map((x,j)=>i===j?{...x,days:[1,2,3,4,5,6,7]}:x)})}>全选星期</button><button type="button" className="secondary" onClick={()=>setConfig({...config,schedules:config.schedules.map((x,j)=>i===j?{...x,days:[]}:x)})}>清除星期</button></div><div className="tv-days">{['一','二','三','四','五','六','日'].map((d,k)=><label key={d}><input type="checkbox" checked={s.days.includes(k+1)} onChange={e=>setConfig({...config,schedules:config.schedules.map((x,j)=>i===j?{...x,days:e.target.checked?[...x.days,k+1]:x.days.filter(v=>v!==k+1)}:x)})}/>周{d}</label>)}</div>{(['start','end'] as const).map(key=><label key={key}>{key==='start'?'开始':'结束'}<input type="time" required value={s[key]} onChange={e=>setConfig({...config,schedules:config.schedules.map((x,j)=>i===j?{...x,[key]:e.target.value}:x)})}/></label>)}<button type="button" className="secondary" onClick={()=>setConfig({...config,schedules:config.schedules.filter((_,j)=>j!==i)})}>移除时段</button></fieldset>)}
 <button type="button" className="secondary" disabled={config.schedules.length>=50} onClick={()=>setConfig({...config,schedules:[...config.schedules,{id:crypto.randomUUID(),name:'观看时间',days:[1,2,3,4,5],start:'18:00',end:'20:00',enabled:false}]})}>添加时段</button><p>兑换只增加余额，不会自动延长观看。只有电视确认追加成功才计入次数。</p><button className="primary" disabled={busy||!saved?.device_id||!saved.config||saved.pending} type="submit">保存电视约定</button><p role="status">{message}</p></form></section>;
}





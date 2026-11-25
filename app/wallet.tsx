"use client";
import {ChildQuickSwitch} from "./child-quick-switch";
import {deviceScheduleReason} from "@/lib/device-schedule";
import {speakChildFeedback} from "@/lib/child-voice";
import {walletStartReason} from "@/lib/child-action-reasons";
import {TvWallet} from "./tv-wallet";
import {SwitchWallet} from "./switch-wallet";
import {useEffect,useRef,useState} from "react";
import {Clock,Play,Square,Plus,Star} from "lucide-react";
import {type Child,type Dashboard,type DeviceUsage,type FamilyDevice,formatDuration,newestFirst} from "@/lib/model";
import {serverClock} from "@/lib/server-clock";
import {synchronizeServerClock,rpc} from "@/lib/client";
import {usageRemaining,usageChoices,usageExtensionChoices,usageCooldownRemaining,usageExtensionsLeft} from "@/lib/time-wallet";
import {enableCountdownSound,playCountdownSound} from "@/lib/countdown-audio";
type Mutate=(action:string,payload:Record<string,unknown>)=>Promise<any>;

/** Stays mounted across child/page switches; only database-authorized deadlines trigger alerts. */
export function WalletCountdownBridge({data}:{data:Dashboard}) {
 const latest=useRef(data);latest.current=data;
 const watched=useRef(new Map<string,{id:string;child_id:string;device_name:string;deadline_at:string;status:string}>()),played=useRef(new Set<string>());
 const [notice,setNotice]=useState("");
 useEffect(()=>{
  let active=true,confirming=false,lastConfirmation=-Infinity;
  const tick=()=>{
   if(!active)return;
   for(const usage of latest.current.device_usage_sessions||[])if(usage.status==='running')watched.current.set(usage.id,usage);
   for(const timer of latest.current.timers){
    if(timer.status==='running')watched.current.set(timer.id,{id:timer.id,child_id:timer.child_id,device_name:timer.kind==='focus'?'专注':'游戏约定',deadline_at:new Date(Date.parse(timer.started_at)+(timer.target_seconds+Number(timer.paused_seconds||0))*1000).toISOString(),status:timer.status});
    else if(timer.status==='paused'||timer.status==='stopped')watched.current.delete(timer.id);
   }
   const now=serverClock.now();if(now===null||document.visibilityState==='hidden')return;
   for(const usage of watched.current.values()){
    const current=(latest.current.device_usage_sessions||[]).find(u=>u.id===usage.id);
    if(current?.status==='stopped'){watched.current.delete(usage.id);continue;}
    if(now>=Date.parse(usage.deadline_at)&&!played.current.has(usage.id)){
     if(!confirming&&performance.now()-lastConfirmation>=2000){
      confirming=true;lastConfirmation=performance.now();
      void (async()=>{
       await synchronizeServerClock();
       // Another browser may have extended, paused or stopped the session.
       const fresh=await rpc<Dashboard>('get_dashboard');
       if(!active||document.visibilityState==='hidden')return;
       for(const candidate of watched.current.values()){
        const device=(fresh.device_usage_sessions||[]).find(u=>u.id===candidate.id);
        const normal=fresh.timers.find(t=>t.id===candidate.id);
        if(!device&&!normal)continue;
        if(device?.status==='stopped'||normal?.status==='stopped'||normal?.status==='paused'){watched.current.delete(candidate.id);continue;}
        const deadline=device?Date.parse(device.deadline_at):Date.parse(normal!.started_at)+(normal!.target_seconds+Number(normal!.paused_seconds||0))*1000;
        if((serverClock.confirmed()??-Infinity)<deadline||played.current.has(candidate.id))continue;
        played.current.add(candidate.id);playCountdownSound();
        const child=fresh.children.find(c=>c.id===candidate.child_id);
        setNotice(`${child?.nickname||'孩子'}的${candidate.device_name}时间到了，请保存进度并结束。`);
       }
      })().catch(()=>{}).finally(()=>{confirming=false;});
     }
    }
   }
  };
  const sync=async()=>{try{await synchronizeServerClock();}catch{}finally{tick();}};
  const resume=()=>{if(document.visibilityState!=='hidden'){serverClock.invalidate();void sync();}};
  const timer=setInterval(tick,250),calibration=setInterval(()=>{if(document.visibilityState!=='hidden')void sync();},30000);
  void sync();
  document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);
  return()=>{active=false;clearInterval(timer);clearInterval(calibration);document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);};
 },[]);
 return notice?<div className="notice" role="alert"><strong>{notice}</strong><button className="text-button" onClick={()=>setNotice('')}>知道了</button></div>:null;
}

export function TimeWallet({data,child,busy,mutate}:{data:Dashboard;child:Child;busy:boolean;mutate:Mutate}) {
 const [,tick]=useState(0),[choices,setChoices]=useState<Record<string,number>>({}),[feedback,setFeedback]=useState<{id:string;text:string}|null>(null);
 useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),250);return()=>clearInterval(timer);},[]);
 const now=serverClock.now();
 const live=(data.device_usage_sessions||[]).find(u=>u.child_id===child.id&&u.status==='running');
 const boundSwitchId=data.switch_settings?.enabled?data.switch_settings.device_id:null;
 const devices=(data.devices||[]).filter(d=>d.active||d.id===live?.device_id||Number((data.device_time_balances||[]).find(b=>b.child_id===child.id&&b.device_id===d.id)?.balance_seconds)>0);
 const history=newestFirst((data.device_usage_sessions||[]).filter(u=>u.child_id===child.id&&u.status!=='running'),u=>u.started_at).slice(0,8);
 return <section className="panel time-wallet" aria-label={`${child.nickname}的奖励时间`}>
  <div className="panel-heading"><div><h2><Clock size={21}/> {child.nickname}的奖励时间</h2><p>兑换即到账，开始才计时。</p></div></div>
  {!devices.length&&<p className="muted">先去奖励小屋兑换时间。</p>}
  <div className="reward-grid wallet-grid">
<TvWallet data={data} child={child} busy={busy} mutate={mutate}/>
   <SwitchWallet data={data} child={child} busy={busy} mutate={mutate}/>
   {devices.filter(device=>device.id!==data.tv_settings?.device_id&&device.id!==boundSwitchId).map(device=>{
    const available=Number((data.device_time_balances||[]).find(b=>b.child_id===child.id&&b.device_id===device.id)?.balance_seconds||0);
    const running=live?.device_id===device.id?live:null;
    const options=usageChoices(available),preferred=choices[device.id]||Math.min(900,Math.max(0,available));
    const selected=options.includes(preferred)?preferred:options.at(-1)||0;
    const left=running?usageRemaining(running,now):null;
    const cooldown=usageCooldownRemaining(data.device_usage_sessions||[],child.id,device.id,now);
    const blocked=deviceScheduleReason(device,data.family.timezone,now)||walletStartReason({active:device.active,available,hasLive:!!live,cooldown,selected});
    return <article className="reward-card wallet-card" key={device.id}>
     <h3>{device.name}{!device.active&&<small> · 已停用</small>}</h3>
     <p>可用时间 <strong>{formatDuration(available)}</strong></p>
     {running?<div className="wallet-running-panel">
      <div className="timer-number" role="timer" aria-label={`${device.name}奖励剩余时间`}>{left===null?'校准中…':formatDuration(left)}</div>
      <p>{left===0?'时间到了，记录正在自动结算。':'正在使用，切换页面或锁屏也会继续计时。'}</p>
      <UsageExtension key={running.id} usage={running} device={device} timezone={data.family.timezone} available={available} enabled={device.active} busy={busy} mutate={mutate}/>
      <button className="secondary" disabled={busy} onClick={()=>void mutate('device_time_stop',{id:running.id}).then(result=>{if(result)speakChildFeedback('已经结束啦，没用完的时间已退回。')})}><Square size={17}/>结束并退回未用时间</button>
     </div>:<>
      <div className="wallet-status" role="status"><p>{feedback?.id===device.id?feedback.text:blocked||(device.schedule_enabled?"允许时段内可用":"仅计时，未连接设备")}</p></div>
      <label className="field"><span>本次时长</span><select aria-label={`${device.name}本次使用时间`} disabled={!options.length||!!live} value={selected||''} onChange={e=>setChoices(v=>({...v,[device.id]:Number(e.target.value)}))}>
       {!options.length&&<option value="">暂无可用时间</option>}
       {options.map(seconds=><option key={seconds} value={seconds}>{formatDuration(seconds)}{seconds===available?'（全部剩余）':''}</option>)}
      </select></label>
      <button className="primary wallet-action" disabled={busy} aria-disabled={!!blocked||busy} data-explainable={!!blocked} onClick={()=>{
       if(blocked){setFeedback({id:device.id,text:blocked});speakChildFeedback(blocked);return;}
       setFeedback(null);
       // Audio resume starts inside the gesture, before the HTTP promise.
       void enableCountdownSound(false);
       void mutate('device_time_start',{child_id:child.id,device_id:device.id,seconds:selected}).then(result=>{if(result){const text='计时开始啦，记得按约定结束哦。';setFeedback({id:device.id,text});speakChildFeedback(text);}});
      }}><Play size={17}/>开始计时</button>

     </>}
    </article>;
   })}
  </div>
  <details className="wallet-help"><summary>计时说明</summary><p>电视确认后计时，其他设备仅记录时间。提前结束退回余量；锁屏后继续计时，提示音可能受系统限制。网络中断时请等待核对，勿重复提交。</p></details>
  <h3>奖励时间使用记录</h3>
  {!history.length?<p className="muted">开始使用后，记录会保存在这里。</p>:history.map(u=><div className="history-row" key={u.id}><div><strong>{u.device_name}</strong><small>{new Intl.DateTimeFormat('zh-CN',{timeZone:data.family.timezone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(u.started_at))}</small></div><span>已用 {formatDuration(Number(u.actual_seconds||0))}</span><span>{u.status==='completed'?'时间用完':'提前结束，余量已退回'}</span></div>)}
 </section>;
}

function UsageExtension({usage,device,timezone,available,enabled,busy,mutate}:{usage:DeviceUsage;device:FamilyDevice;timezone:string;available:number;enabled:boolean;busy:boolean;mutate:Mutate}) {
 const [selected,setSelected]=useState(60),[confirmation,setConfirmation]=useState<number|null>(null);
 const options=usageExtensionChoices(available,usage.reserved_seconds);
 const amount=options.includes(selected)?selected:options[0]||0;
 const extensionsLeft=usageExtensionsLeft(usage);
 const now=serverClock.now(),expired=extensionsLeft===0||!enabled||now===null||now>=Date.parse(usage.deadline_at);
 const reason=deviceScheduleReason(device,timezone,now)||(!enabled?"这个奖励暂时停用啦，请家长帮忙看看。":extensionsLeft===0?"这次的追加次数已经用完啦，按约定结束后休息一下吧。":now===null?"正在校准时间，稍等一下哦。":now>=Date.parse(usage.deadline_at)?"这次时间已经到了，等记录结算后再看看吧。":!amount?"暂时没有可追加时间，可以先到奖励小屋看看。":"");
 return <div className="usage-extension">
  <p className="small">{usage.max_extensions===undefined||usage.max_extensions>20?"此会话保留原追加约定":`本次还可追加 ${extensionsLeft} 次`}；结束后休息 {Math.round(Number(usage.cooldown_seconds||0)/60)} 分钟。</p>
  {confirmation===null?<>
   <label className="field"><span>从已批准余额追加</span><select aria-label={usage.device_name+'追加时长'} value={amount||''} disabled={busy||expired||!options.length} onChange={e=>setSelected(Number(e.target.value))}>
    {!options.length&&<option value="">暂无可追加时间</option>}
    {options.map(n=><option key={n} value={n}>{formatDuration(n)}</option>)}
   </select></label>
   <button className="secondary" disabled={busy} aria-disabled={busy||!!reason} data-explainable={!!reason} onClick={()=>{if(reason){speakChildFeedback(reason);return;}setConfirmation(amount);speakChildFeedback("要追加这段时间吗？确认后才会使用余额哦。");}}>追加本次时间</button>
   {!options.length&&<p className="small">需要已批准的同设备余额，且本次总时间不超过180分钟。</p>}
  </>:<div role="group" aria-label="确认追加本次时间">
   <p>确认追加 {formatDuration(confirmation)}？将预留已有余额，延长本次结束时间，不重新开始计时。</p>
   <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>取消追加</button><button className="primary" disabled={busy||expired||!!deviceScheduleReason(device,timezone,now)||confirmation>available||confirmation+usage.reserved_seconds>10800} onClick={async()=>{const result=await mutate('device_time_extend',{id:usage.id,seconds:confirmation});if(result){setConfirmation(null);speakChildFeedback("已经追加好了，结束后记得休息哦。");}}}>确认追加时间</button></div>
  </div>}
 </div>;
}

/** Sound is controlled only by the persistent navigation switch. */
export function CountdownSoundControls() { return null; }

export function DevicesPanel({data,edit}:{data:Dashboard;edit:(modal:any)=>void}) {
 return <section><div className="panel-heading"><h3>奖励时间设备</h3><button className="secondary" onClick={()=>edit({kind:'device',item:{name:'',active:true}})}><Plus size={17}/>添加设备名称</button></div>
 <p className="small">这里只区分电视、游戏机等时间余额，不连接设备或改变家里的网络。</p>
 {(data.devices||[]).map(d=><div className="admin-row" key={d.id}><strong>{d.name}</strong><span>{d.active?'启用':'停用（保留余额）'}</span><button className="text-button" onClick={()=>edit({kind:'device',item:d})}>编辑设备</button></div>)}</section>;
}

export function ManualStarsForm({data,initialChild,busy,error,mutate,close}:{data:Dashboard;initialChild?:string;busy:boolean;error:string;mutate:Mutate;close:()=>void}) {
 const [draft,setDraft]=useState<{child_id:string;amount:number;reason:string}|null>(null);
 const [form,setForm]=useState({child_id:initialChild||data.children[0]?.id||'',amount:'1',reason:''});
 const child=data.children.find(c=>c.id===(draft?.child_id||form.child_id));
 return <>
 {error&&<p className="error" role="alert">{error}</p>}
 {!draft?<form onSubmit={e=>{e.preventDefault();setDraft({child_id:form.child_id,amount:Number(form.amount),reason:form.reason.trim()});}}>
  <ChildQuickSwitch children={data.children} value={form.child_id} onChange={id=>setForm({...form,child_id:id})} label="给哪个孩子"/>
  <label className="field"><span>增加星星（正整数）</span><input name="amount" type="number" min="1" max="10000" step="1" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
  <label className="field"><span>鼓励原因</span><input name="reason" required maxLength={300} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
  <p className="small">只增加，不扣减。填写具体的努力或帮助，记录会保留。</p>
  <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy||!form.reason.trim()}>下一步：确认加星</button></div>
 </form>:<>
  <h3><Star size={22}/> 给{child?.nickname}增加 {draft.amount} 颗星星</h3><p>原因：{draft.reason}</p><p className="small">确认后写入这个孩子的余额和家长鼓励记录，不会自动批准兑换。</p>
  <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setDraft(null)}>返回修改</button><button className="primary" disabled={busy} onClick={async()=>{const result=await mutate('manual_star_grant',draft);if(result)close();}}>确认增加星星</button></div>
 </>}
 </>;
}

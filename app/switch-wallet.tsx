"use client";
import {RuleSpeaker} from "./rule-speaker";
import {SWITCH_HELP_TEXT} from "@/lib/child-audio-manifest";
import {walletVoiceGate,dashboardWalletBalance} from "@/lib/wallet-start-balance";
import {useEffect,useState,useRef} from "react";
import {Play,Square} from "lucide-react";
import {speakChildFeedback} from "@/lib/child-voice";
import {formatDuration,type Child,type Dashboard,type SwitchSession,type SwitchStatus} from "@/lib/model";
import {serverClock} from "@/lib/server-clock";

import {switchActiveSessionForBinding,switchCanQueue,switchHostHasUnmatchedSession,switchHostSleeping,switchSessionView} from "@/lib/switch-wallet";

type Mutate=(action:string,payload:Record<string,unknown>)=>Promise<any>;
type Confirmation={kind:"start"|"extend"|"stop";seconds?:number;sessionId?:string;bindingId?:string|null};
type SwitchConsole={binding_id:string;label:string;enabled:boolean;online:boolean;status?:SwitchStatus|null};
type SwitchDashboard=Dashboard&{switch_consoles?:SwitchConsole[]|null};
type SwitchSessionWithBinding=SwitchSession&{binding_id?:string|null};

function sessionBindingId(session:SwitchSession|null|undefined) {
 const bindingId=(session as SwitchSessionWithBinding|undefined)?.binding_id;
 return typeof bindingId==="string"&&bindingId.trim()?bindingId:null;
}

function activeChildSession(sessions:SwitchSession[],deviceId:string,childId:string) {
 return sessions.find(session=>session.device_id===deviceId&&session.child_id===childId&&session.state!=="ended") || null;
}

function uniqueSwitchConsoles(value:SwitchConsole[]) {
 const seen=new Set<string>();
 return value.filter(console=>{
  const bindingId=console.binding_id.trim();
  if(!bindingId||seen.has(bindingId))return false;
  seen.add(bindingId);return true;
 });
}

export function switchMinuteChoices(availableSeconds:number,grantedSeconds:number|string=0) {
 const available=Number(availableSeconds),granted=Number(grantedSeconds);
 const maxSeconds=Number.isFinite(available)&&Number.isFinite(granted)?Math.min(Math.max(0,Math.floor(available)),Math.max(0,10800-Math.max(0,granted))):0;
 const fullMinutes=Math.floor(maxSeconds/60);
 const choices=Array.from({length:fullMinutes},(_,index)=>(index+1)*60);
 if(maxSeconds>fullMinutes*60)choices.push(maxSeconds);
 return choices;
}

/** Device-authoritative Switch allocation. This card never derives remaining time from browser time. */
export function SwitchWallet({data,child,busy,mutate}:{data:Dashboard;child:Child;busy:boolean;mutate:Mutate}) {
 const dashboard=data as SwitchDashboard;
 const scope=useRef({key:child.id+":"+dashboard.switch_settings?.device_id,generation:0});
 const key=child.id+":"+dashboard.switch_settings?.device_id;
 if(scope.current.key!==key)scope.current={key,generation:scope.current.generation+1};
 const inFlight=useRef(false);
 const guardedMutate=async(a:string,p:Record<string,unknown>)=>{if(inFlight.current)return;inFlight.current=true;const generation=scope.current.generation;try{const r=await mutate(a,p);return scope.current.generation===generation?r:undefined;}finally{inFlight.current=false;}};
 const settings=dashboard.switch_settings;
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
 const [message,setMessage]=useState("");
 const [selectedBindingId,setSelectedBindingId]=useState<string|null>(null);
 const [selectedSeconds,setSelectedSeconds]=useState<number|null>(null);
 const [now,setNow]=useState<number|null>(serverClock.now());
 const [online,setOnline]=useState(true);
 useEffect(()=>{
  const refresh=()=>{setNow(serverClock.now());setOnline(navigator.onLine);};
  refresh();
  const timer=setInterval(refresh,1000);
  window.addEventListener("online",refresh);window.addEventListener("offline",refresh);
  return()=>{clearInterval(timer);window.removeEventListener("online",refresh);window.removeEventListener("offline",refresh);};
 },[]);
 useEffect(()=>{setConfirmation(null);setMessage("");setSelectedBindingId(null);setSelectedSeconds(null);},[child.id,settings?.device_id]);
 if(!settings?.enabled)return null;
 const device=dashboard.devices?.find(device=>device.id===settings.device_id);
 const deviceName=device?.name||"Switch";
 const hasConsoleList=Object.prototype.hasOwnProperty.call(dashboard,"switch_consoles");
 const rawConsoles=dashboard.switch_consoles;
 const switchConsoles=uniqueSwitchConsoles(hasConsoleList?
  (Array.isArray(rawConsoles)?rawConsoles.filter(console=>console&&typeof console.binding_id==="string"&&typeof console.label==="string"&&typeof console.enabled==="boolean"&&typeof console.online==="boolean"):[]):
  [{binding_id:settings.binding_id,label:deviceName,enabled:true,online:true}]);
 const selectableSwitchConsoles=switchConsoles.filter(console=>console.enabled);
 const sessions=dashboard.switch_sessions||[];
 const childLive=activeChildSession(sessions,settings.device_id,child.id);
 const lockedBindingId=childLive?(sessionBindingId(childLive)||settings.binding_id):null;
 const defaultBindingId=selectableSwitchConsoles.length===1?(selectableSwitchConsoles.find(console=>console.binding_id===settings.binding_id)?.binding_id||selectableSwitchConsoles[0]?.binding_id||null):null;
 const requestedBindingId=selectedBindingId===null?defaultBindingId:selectedBindingId;
 const targetBindingId=lockedBindingId||requestedBindingId;
 const targetConsole=targetBindingId?switchConsoles.find(console=>console.binding_id===targetBindingId)||null:null;
 const rawBalance=dashboardWalletBalance(dashboard.device_time_balances,child.id,settings.device_id);
 const balanceGate=walletVoiceGate(rawBalance,dashboard.redemptions,child.id,settings.device_id);
 const available=Number(rawBalance??0);
 const live=childLive||switchActiveSessionForBinding(sessions,settings.device_id,targetBindingId);
 const mine=!!live&&live.child_id===child.id;
 const targetLabel=targetConsole?.label||(live?"当前会话主机":"Switch主机");
 const other=!!live&&!mine?dashboard.children.find(candidate=>candidate.id===live.child_id):null;
 const otherName=other?.nickname||"另一位孩子";
 const status=hasConsoleList?(targetConsole?.status||((switchConsoles.length===1)?dashboard.switch_status||null:null)):dashboard.switch_status||null;
 const view=switchSessionView(live,status,now,online);
 const snapshot=view.snapshot;
 const hostWithoutSession=!live&&view.fresh&&switchHostHasUnmatchedSession(snapshot);
 const hostSleeping=switchHostSleeping(snapshot);
 const deviceInactive=device?.active===false;
 const scheduleUnsupported=device?.schedule_enabled===true;
 const options=switchMinuteChoices(available,mine&&live?live.granted_seconds:0);
 const preferred=selectedSeconds??Math.min(900,Math.max(0,available));
 const selected=options.includes(preferred)?preferred:options.filter(value=>value<=900).at(-1)||options[0]||0;
 const exceedsCap=selected+(mine&&live?Number(live.granted_seconds):0)>10800;
 const hostReady=view.ready&&(targetConsole?.online!==false);
 const hasStartHost=!!targetBindingId&&!!targetConsole?.enabled;
 const hasSessionHost=!!live&&!!targetBindingId;
 const hostOffline=targetConsole?.online===false;
 const canQueueWhileHostUnavailable=switchCanQueue({
  online,ready:hostReady,pending:view.pending,hasLive:!!live,mine,other:!!other,
  hostWithoutSession,deviceActive:!deviceInactive&&(hasStartHost||hasSessionHost),scheduleUnsupported,selected,
 });
 const queueReason=hostOffline?`${targetLabel} 当前离线，时间先预留，恢复联网并确认后生效。`:`${targetLabel} 时间先预留，等待主机点亮联网并确认。`;
 const notReadyReason=balanceGate||(exceedsCap?"全部可用时间超过本次三小时安全上限，请让家长调整后再使用。":"")||(!online?"网络暂时不可用，恢复连接并确认主机状态后再发送。":
  deviceInactive?`${deviceName} 暂时停用，请让家长查看设备设置。`:
  !live&&!targetConsole?"暂无可用 Switch 主机，暂不能发送时间；请让家长先启用 Switch 1 或 Switch 2。":
  !live&&targetConsole&&!targetConsole.enabled?`${targetLabel} 已停用，暂不能发送时间；请改选可用的 Switch 主机。`:
  scheduleUnsupported?`${deviceName} 已启用设备允许时段，但 Switch 主机暂不支持主机端时段校验，暂不能发送或追加。请让家长关闭该设备的允许时段设置，或等待主机端支持。`:
  !hostReady?
   (canQueueWhileHostUnavailable?queueReason:view.fresh?`${targetLabel} 还没有完成可信计时校验，请稍候再试。`:`正在确认 ${targetLabel} 状态，请稍候。`):
  hostWithoutSession?`${targetLabel} 已有一段活动时间，正在核对归属，请稍候。`:
  !selected?(mine&&live&&Number(live.granted_seconds)>=10800?"本次累计额度已达上限，不能再追加；可以结束本次使用。":"暂无可用时间。"):"");
 const blocked=exceedsCap||!!balanceGate||!!other||!!hostWithoutSession||!!view.pending||(!live&&!hasStartHost)||(!canQueueWhileHostUnavailable&&!!notReadyReason);
 const confirmAmount=confirmation?.seconds||0;
 const confirmWithinWallet=confirmAmount>0&&confirmAmount<=available;
 const confirmWithinCap=confirmation?.kind==="extend"?!!live&&Number(live.granted_seconds)+confirmAmount<=10800:confirmAmount<=10800;
 const confirmationBindingStable=!!confirmation&&confirmation.bindingId===targetBindingId;
 const confirmReady=confirmation?.kind==="stop"?!!live&&confirmationBindingStable&&!view.pending&&live.id===confirmation.sessionId:(
  !!confirmation&&confirmationBindingStable&&!balanceGate&&online&&(hostReady||canQueueWhileHostUnavailable)&&!view.pending&&!deviceInactive&&!scheduleUnsupported&&confirmWithinWallet&&confirmWithinCap&&(!other&&!hostWithoutSession)&&
  (confirmation.kind==="start"?hasStartHost:hasSessionHost)&&
  (confirmation.kind==="start"?!live:!!live&&live.id===confirmation.sessionId)
 );
 const explain=(text:string)=>{setMessage(text);speakChildFeedback(text);};
 const send=async(kind:"start"|"extend",seconds:number,sessionId?:string,expectedBindingId?:string|null)=>{
  if(balanceGate){explain(balanceGate);return;}
  const queueWhileHostUnavailable=!hostReady&&canQueueWhileHostUnavailable;
  if(!online||expectedBindingId!==targetBindingId||(!hostReady&&!queueWhileHostUnavailable)||view.pending||deviceInactive||scheduleUnsupported||!!other||hostWithoutSession||(!targetBindingId||(kind==="start"&&!hasStartHost)||(kind==="extend"&&!hasSessionHost))||seconds<=0||seconds>available||seconds>10800||
   (kind==="start"&&!!live)||(kind==="extend"&&(!live||live.id!==sessionId||Number(live.granted_seconds)+seconds>10800))){
   explain(!online?"网络暂时不可用，恢复连接并确认主机状态后再发送。":expectedBindingId!==targetBindingId?"主机选择已变化，请取消后重新选择。":deviceInactive?`${deviceName} 暂时停用，请让家长查看设备设置。`:scheduleUnsupported?notReadyReason:!targetBindingId||(!hasStartHost&&kind==="start")?"暂无可用 Switch 主机，请重新选择后再试。":!hostReady&&!queueWhileHostUnavailable?`${targetLabel} 状态已过期或尚未完成可信校验，请取消后刷新再试。`:"Switch 钱包或本次累计额度已变化，请取消后重新选择。");
   return;
  }
  const action=kind==="start"?"device_time_start":"device_time_extend";
  const payload=kind==="start"?{child_id:child.id,device_id:settings.device_id,binding_id:targetBindingId,seconds}:{id:live!.id,seconds};
  const result=await guardedMutate(action,payload);
  if(result){setConfirmation(null);explain(queueWhileHostUnavailable?`请求已保存，时间已预留；等待 ${targetLabel} 联网和设备确认。`:`请求已保存，可能仍在排队或等待 ${targetLabel} 回执；确认后才生效。`);}
 };
 const stop=async()=>{
  if(!live)return;
  const result=await guardedMutate("device_time_stop",{id:live.id});
  if(result){setConfirmation(null);explain(`已提交结束 ${targetLabel} 的请求，等待主机回执；收到可信回执后才退回未用时间。`);}
 };
 const hostOptions=targetBindingId&&!switchConsoles.some(console=>console.binding_id===targetBindingId)?
  [...switchConsoles,{binding_id:targetBindingId,label:targetLabel,enabled:true,online:targetConsole?.online!==false}]:switchConsoles;
 return <article className="reward-card wallet-card switch-wallet-card" aria-label={`${child.nickname}的Switch奖励时间`}>
  <div className="reward-title"><h3>{deviceName}</h3><RuleSpeaker label="Switch使用" text={SWITCH_HELP_TEXT}/></div>
  <p>可用时间 <strong>{formatDuration(available)}</strong></p>
  <div className="field">
  {!childLive&&<label className="field" style={{margin:0}}><span>使用主机</span><select aria-label={child.nickname+"选择Switch主机"} value={targetBindingId||""} disabled={busy||!selectableSwitchConsoles.length} onChange={event=>{setConfirmation(null);setMessage("");setSelectedBindingId(event.target.value||null);}}>
   {selectableSwitchConsoles.length>1&&<option value="">请选择 Switch 主机</option>}
   {!hostOptions.length&&<option value="">暂无可用 Switch 主机</option>}
   {hostOptions.map(console=><option key={console.binding_id} value={console.binding_id} disabled={!console.enabled}>{console.label}{!console.enabled?"（已停用）":console.online?"（在线）":"（离线，可排队）"}</option>)}
  </select></label>}
  {!other&&!hostWithoutSession&&(!live||mine)&&!view.pending&&<>
    <label className="field" style={{margin:0}}><span>{live&&mine?"追加本次分钟数":"本次分钟数"}</span><select aria-label={`${targetLabel}${live&&mine?"追加":"选择本次"}分钟数`} disabled={busy||!options.length||blocked} value={selected||""} onChange={event=>setSelectedSeconds(Number(event.target.value)||null)}>
     {!options.length&&<option value="">暂无可用时间</option>}
     {options.map(seconds=><option key={seconds} value={seconds}>{formatDuration(seconds)}{seconds===available&&!live?"（全部余额）":""}</option>)}
    </select></label>
  </>}
  </div>
  <div className="wallet-status" role="status">
   {message&&<p className="child-action-feedback">{message}</p>}
   {other?<p>{targetLabel} 正在由 {otherName} 使用，请先等当前会话结束。</p>:hostWithoutSession?<p>{targetLabel} 已有活动会话，正在核对归属。</p>:<>
   {live&&mine&&<div className="wallet-running-panel">
    <p className="small">当前会话主机：{targetLabel}</p>
    {view.remaining_seconds!==null?<div className="timer-number" aria-label={`${targetLabel}最后确认剩余时间`}>{formatDuration(view.remaining_seconds)}</div>:<p className="wallet-status">{targetLabel}剩余时间尚未确认。</p>}
    {!view.fresh&&view.remaining_seconds!==null?<p>最后确认的主机剩余时间 · 待同步；页面不会自行倒计时。</p>:!view.fresh?<p>主机状态待同步；断网或心跳中断不代表主机已暂停。</p>:hostSleeping?<p>主机正在休眠，点亮联网后继续确认。</p>:snapshot?.session_state==="exhausted"?<p>主机回报本次时间已用完，可从钱包追加，或结束本次使用。</p>:<p>主机已回报当前状态；剩余时间以主机回执为准。</p>}
    {canQueueWhileHostUnavailable&&<p className="small">{queueReason}</p>}
    {view.pending&&<p className="small">请求已保存，可能仍在等待发送或主机回执；尚未确认生效，请勿重复提交。</p>}
    {confirmation?.kind==="stop"?<div className="notice" role="group" aria-label={`确认结束${targetLabel}会话`}>
      <p>确认请求结束这次 {targetLabel} 使用？只有主机返回可信回执后，未用时间才会退回钱包；不会按网页经历的时间估算退款。</p>
      <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>取消结束</button><button className="primary" disabled={busy||!confirmReady} onClick={()=>void stop()}>确认结束并等待主机回执</button></div>
    </div>:<button className="secondary" disabled={busy||view.pending} onClick={()=>setConfirmation({kind:"stop",sessionId:live.id,bindingId:targetBindingId})}><Square size={17}/>请求结束并结算</button>}
   </div>}
   {!live&&!targetBindingId&&!balanceGate&&<p>{selectableSwitchConsoles.length?"请选择 Switch 主机后再发送。":"暂无可用 Switch 主机，暂不能发送时间。"}</p>}
   {!live&&targetBindingId&&!view.fresh&&!balanceGate&&<p>{targetLabel}待同步</p>}

   </>}
  </div>
  {!other&&!hostWithoutSession&&<>
   {(!live||mine)&&!view.pending&&<>
    <div className="wallet-action">{confirmation&&confirmation.kind!=="stop"?<div className="notice" role="group" aria-label="确认发送Switch时间">
      <p>{confirmation.kind==="extend"?(canQueueWhileHostUnavailable?`确认排队追加 ${formatDuration(confirmation.seconds||0)} 到 ${targetLabel}？时间先预留，点亮联网并确认后生效。`:`确认追加 ${formatDuration(confirmation.seconds||0)} 到 ${targetLabel}？这会增加当前主机剩余时间，不会重新开始或清空已用时间。`):(canQueueWhileHostUnavailable?`确认排队 ${formatDuration(confirmation.seconds||0)} 到 ${targetLabel}？时间先预留，点亮联网并确认后生效。`:`确认发送 ${formatDuration(confirmation.seconds||0)} 到 ${targetLabel}？这会预留 Switch 钱包，主机确认后才开始使用。`)}</p>
      <p className="small">{canQueueWhileHostUnavailable?`预留 ${formatDuration(confirmation.seconds||0)}，不是已用时间。`:`服务器确认后钱包预计剩余 ${formatDuration(Math.max(0,available-(confirmation.seconds||0)))}；页面不会先行扣减。取消不会扣除钱包。`}</p>
      {!confirmReady&&<p className="small">主机状态、设备启用状态、钱包余额或累计上限已变化，请取消后重新确认。</p>}
      <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>取消</button><button className="primary" disabled={busy||!confirmReady} onClick={()=>void send(confirmation.kind==="extend"?"extend":"start",confirmation.seconds||0,confirmation.sessionId,confirmation.bindingId)}>确认发送</button></div>
    </div>:<button className="primary" disabled={busy} aria-disabled={blocked} data-explainable={blocked} onClick={()=>{
      if(balanceGate){explain(balanceGate);return;}
      if(blocked){explain(other?`${targetLabel} 正在由 ${otherName} 使用，请先等当前会话结束。`:notReadyReason||"请先确认主机状态。");return;}
      setConfirmation({kind:live?"extend":"start",seconds:selected,sessionId:live?.id,bindingId:targetBindingId});
    }}><Play size={17}/>{live&&mine?"追加到主机":"开始使用"}</button>}</div>
   </>}
  </>}
 </article>;
}

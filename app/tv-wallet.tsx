"use client";
import {RuleSpeaker} from "./rule-speaker";
import {TV_HELP_TEXT} from "@/lib/child-audio-manifest";
import {walletVoiceGate,dashboardWalletBalance,trustedTvStart,TV_STARTED_VOICE} from "@/lib/wallet-start-balance";
import {speakChildFeedback} from '@/lib/child-voice';
import {tvStartReason} from '@/lib/child-action-reasons';
import {Play} from 'lucide-react';
import {useEffect,useState,useRef} from 'react';
import {formatDuration,type Dashboard,type Child} from '@/lib/model';
import {serverClock} from '@/lib/server-clock';
export type TvSession={id:string;child_id:string;device_id:string;state:'pending'|'active'|'ended';remote?:{started_at:number;ends_at:number;extensions_used:number};granted_seconds:number};
export function TvWallet({data,child,busy,mutate}:{data:Dashboard;child:Child;busy:boolean;mutate:(a:string,p:Record<string,unknown>)=>Promise<any>}) {
 const inFlight=useRef(false);
 const guardedMutate=async(a:string,p:Record<string,unknown>)=>{if(inFlight.current)return;inFlight.current=true;try{return await mutate(a,p);}finally{inFlight.current=false;}};
 const spoken=useRef(new Set<string>());
 const visibleScope=useRef({key:child.id+':'+(data.tv_settings?.device_id||''),generation:0});
 const scopeKey=child.id+':'+(data.tv_settings?.device_id||'');
 if(visibleScope.current.key!==scopeKey)visibleScope.current={key:scopeKey,generation:visibleScope.current.generation+1};
 const [requested,setRequested]=useState<{id:string;childId:string;deviceId:string}|null>(null);
 const [message,setMessage]=useState('');
 // Submission feedback is transient; authoritative pending/active state remains below.
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),6000);return()=>clearTimeout(timer);},[message]);
 const explain=(text:string)=>{setMessage(text);speakChildFeedback(text);};
 useEffect(()=>{
  if(requested&&!spoken.current.has(requested.id)&&requested.childId===child.id&&requested.deviceId===data.tv_settings?.device_id&&trustedTvStart(data.tv_sessions?.find(s=>s.id===requested.id),requested,serverClock.now())){
   spoken.current.add(requested.id);setRequested(null);setMessage(TV_STARTED_VOICE);speakChildFeedback(TV_STARTED_VOICE);
  }
 },[data.tv_sessions,requested,child.id,data.tv_settings?.device_id]);
 useEffect(()=>{setRequested(null);},[child.id,data.tv_settings?.device_id]);
 const settings=data.tv_settings;if(!settings)return null;
 const rawBalance=dashboardWalletBalance(data.device_time_balances,child.id,settings.device_id);
 const balanceGate=walletVoiceGate(rawBalance,data.redemptions,child.id,settings.device_id);
 const available=Number(rawBalance??0);
 const live=data.tv_sessions?.find(s=>s.state!=='ended');
 const mine=live?.child_id===child.id;
 const now=serverClock.now();
 const status=data.tv_status;
 const snapshot=status?.snapshot;
 const fresh=now!==null&&status?.checked_at&&snapshot&&now-Date.parse(status.checked_at)<15000;
 const allowed=fresh&&snapshot.allowed_window_ends_at!==null&&snapshot.allowed_window_ends_at*1000>now!&&snapshot.cooldown_until*1000<=now!&&!settings.config?.manual_block;
 const amount=available;
 const seconds=available;
 const blocked=balanceGate||(available>10800?"可用时间超过本次三小时安全上限，请让家长调整后再使用。":"")||tvStartReason({available,fresh:!!fresh,manualBlock:!!settings.config?.manual_block,cooldown:!!(now!==null&&snapshot&&snapshot.cooldown_until*1000>now),windowOpen:!!(now!==null&&snapshot&&snapshot.allowed_window_ends_at!==null&&snapshot.allowed_window_ends_at*1000>now),seconds,exactSeconds:true});
 return <article className="reward-card wallet-card"><div className="reward-title"><h3>电视</h3><RuleSpeaker label="电视使用" text={TV_HELP_TEXT}/></div><p>可用时间 <strong>{formatDuration(available)}</strong></p>
 <div className="wallet-status" role="status">{message&&message!==blocked&&<p className="child-action-feedback">{message}</p>}{live?<><p>{mine?(live.state==='pending'?'等待电视确认，余额已预留':'正在观看'):'电视正在使用中'}</p>{mine&&live.state==='active'&&<><div className="timer-number">{now===null?'校准中…':formatDuration(Math.max(0,Math.ceil(((live.remote?.ends_at??0)*1000-now)/1000)))}</div><button className="secondary" disabled={busy} onClick={()=>void guardedMutate('device_time_stop',{id:live.id}).then(r=>{if(r)explain('结束请求已提交');})}>结束观看</button></>}</>:<p>{blocked||(allowed?'允许时段内可用':fresh?'等待允许时段或休息结束':'正在确认电视状态')}</p>}</div>
 <div className="wallet-action">{!live?<button className="primary" disabled={busy} aria-disabled={busy||!!blocked} data-explainable={!!blocked} onClick={()=>{if(blocked){explain(blocked);return;}const requestGeneration=visibleScope.current.generation;const knownIds=new Set((data.tv_sessions||[]).map(s=>s.id));void guardedMutate('device_time_start',{child_id:child.id,device_id:settings.device_id,seconds:amount}).then((r:Dashboard|undefined)=>{if(r&&visibleScope.current.key===scopeKey&&visibleScope.current.generation===requestGeneration){const session=r.tv_sessions?.find(s=>!knownIds.has(s.id)&&s.child_id===child.id&&s.device_id===settings.device_id);if(session)setRequested({id:session.id,childId:child.id,deviceId:settings.device_id});setMessage('开始请求已提交');}});}}><Play size={17}/>开始观看</button>:mine&&live.state==='active'?<button className="secondary" disabled={busy} aria-disabled={busy||!!blocked} data-explainable={!!blocked} onClick={()=>{if(blocked){explain(blocked);return;}void guardedMutate('device_time_extend',{id:live.id,seconds:amount}).then(r=>{if(r)explain('追加请求已提交');});}}>追加观看</button>:null}</div>
 </article>;
}

"use client";
import {useEffect,useRef,useState} from "react";
import {Volume2,Square} from "lucide-react";
import {prepareChildRecording,getChildVoiceSettings,subscribeChildVoice,childVoiceGeneration,getChildVoiceState} from "@/lib/child-voice";
import {HABIT_VOICE_PENDING_TEXT,PENDING_HABIT_VOICE_RECORDING} from "@/lib/habit-voice-pending";
type Props={id:string;childId:string;name:string;parentToken?:string};
export function AutoHabitSpeaker({id,childId,name,parentToken}:Props){
 const [message,setMessage]=useState(""),[playing,setPlaying]=useState(false),[busy,setBusy]=useState(false);
 const version=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),abort=useRef<AbortController|null>(null);
 const playback=useRef<ReturnType<typeof prepareChildRecording>|null>(null),token=useRef<number|null>(null);
 function cancel(){version.current++;abort.current?.abort();if(timer.current)clearTimeout(timer.current);timer.current=null;playback.current?.cancel();playback.current=null;setBusy(false);setPlaying(false);}
 useEffect(()=>{setMessage("");const hide=()=>{if(document.hidden)cancel()};document.addEventListener("visibilitychange",hide);
 const off=subscribeChildVoice(()=>{if(token.current!==null&&token.current!==childVoiceGeneration()){setPlaying(false);}else if(/语音播放结束|语音已停止/.test(getChildVoiceState().status)){setPlaying(false);}});
 return()=>{cancel();off();document.removeEventListener("visibilitychange",hide)};},[id,childId,name,parentToken]);
 async function request(own:number,play:boolean,remaining=60){
  const controller=new AbortController();abort.current=controller;
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort()},10000);
  try{
   const r=await fetch("/api/habit-voice",{method:"POST",cache:"no-store",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({habit_id:id,child_id:childId,parent_token:parentToken||null}),signal:controller.signal});
   const v=await r.json().catch(()=>({}));if(own!==version.current||document.hidden)return;
   if(!r.ok){setMessage(r.status===401||r.status===403?"请先解锁当前孩子，再播放语音。":"语音暂时无法加载，请稍后再试。");return;}
   if(!v?.data)throw Error("invalid_response");
   if(v.data.text!==name.normalize("NFC").trim().replace(/\s+/gu," "))throw Error("changed");
   if(v.data.state==="ready"){
    if(!play){setMessage("语音已准备好，点击喇叭播放。");return;}
    const bytes=Uint8Array.from(atob(v.data.audio_base64.replace(/\s/g,"")),c=>c.charCodeAt(0));
    const ok=await playback.current?.play(bytes.buffer,name);if(own===version.current){setPlaying(!!ok);setMessage(ok?"":"语音暂时无法播放，请重新点击。");}
   }else if(["pending","leased"].includes(v.data.state)){
    setMessage(v.data.worker_state==="waiting_resources"?"Windows 内存暂不足，任务已保留，资源恢复后自动生成。":v.data.state==="pending"&&(!v.data.worker_state||v.data.worker_state==="offline")?"近期未收到 Windows 语音脚本状态，任务已保留。":v.data.state==="leased"?"语音任务已领取，等待生成结果；完成后自动添加。":"已加入语音队列，等待 Windows 自动生成。");
    if(play&&PENDING_HABIT_VOICE_RECORDING){try{
     const asset=PENDING_HABIT_VOICE_RECORDING;
     const prompt=await fetch(asset.url,{cache:"force-cache",signal:controller.signal});
     if(prompt.ok){
      const bytes=await prompt.arrayBuffer();
      if(bytes.byteLength<=4194304&&own===version.current&&!document.hidden){
       const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
       if(hash===asset.sha256&&own===version.current){const ok=await playback.current?.play(bytes);if(own===version.current)setPlaying(!!ok);}
      }
     }
    }catch{/* Missing prompt never hides the real queue state. */}}
    if(own!==version.current||document.hidden)return;
    if(remaining>0)timer.current=setTimeout(()=>void request(own,false,remaining-1),10000);
    else setMessage("语音仍在后台队列中；Windows 恢复后会继续生成。");
   }else setMessage("语音生成多次失败，已暂停重试并记录，等待修复。");
  }catch(e){if(own===version.current&&(timedOut||(e as Error).name!=="AbortError"))setMessage(timedOut?"语音查询超时，请重新点击。":"语音暂时无法加载，请稍后再试。");}
  finally{clearTimeout(timeout);if(own===version.current)setBusy(false);}
 }
 function click(){if(playing){cancel();setMessage("");return;}cancel();const settings=getChildVoiceSettings();if(!settings.enabled||settings.volume===0){setMessage("语音已静音，请开启顶部声音开关。");return;}
 const own=version.current;playback.current=prepareChildRecording(HABIT_VOICE_PENDING_TEXT);token.current=childVoiceGeneration();setBusy(true);void request(own,true);}
 return <span className="rule-speaker-wrap"><button type="button" className="rule-speaker icon-button" style={{minWidth:44,minHeight:44}} aria-label={(playing?"停止":"播放")+name.trim()+"说明"} aria-pressed={playing} disabled={busy} onClick={e=>{e.stopPropagation();click();}}>{playing?<Square size={18}/>:<Volume2 size={18}/>}</button>{message&&<span role="status" className="small habit-voice-error">{message}</span>}</span>;
}


"use client";
import {useEffect,useRef,useState} from 'react';
import {Volume2,VolumeX,X} from 'lucide-react';
import {enableCountdownSound,muteCountdownSound} from '@/lib/countdown-audio';
import {getChildVoiceState,setChildVoiceSettings,speakChildFeedback,subscribeChildVoice,type ChildVoiceState} from '@/lib/child-voice';
/** A single navigation switch; useful feedback is temporary and never shifts page content. */
export function ChildVoiceSettings(){
 const [state,setState]=useState<ChildVoiceState>({settings:{enabled:true,volume:0.7},message:'',status:''});
 const [feedback,setFeedback]=useState('');
 const dismiss=useRef<ReturnType<typeof setTimeout>|null>(null),suppress=useRef(false);
 useEffect(()=>{
  const update=(announce=true)=>{const next=getChildVoiceState();setState(next);if(announce&&!suppress.current&&next.message){setFeedback(next.message);if(dismiss.current)clearTimeout(dismiss.current);dismiss.current=setTimeout(()=>setFeedback(''),8000);}};
  update(false);const unsubscribe=subscribeChildVoice(()=>update());const storage=()=>update(false);window.addEventListener('storage',storage);
  return()=>{unsubscribe();window.removeEventListener('storage',storage);if(dismiss.current)clearTimeout(dismiss.current);};
 },[]);
 const muted=!state.settings.enabled||state.settings.volume===0;
 return <>
  <button className={'icon-button voice-nav-toggle '+(muted?'voice-is-muted':'voice-is-on')} type="button" role="switch" aria-checked={!muted} aria-label="语音提示" title={muted?'开启语音提示':'关闭语音提示'} onClick={()=>{
   suppress.current=true;setChildVoiceSettings({enabled:muted,...(state.settings.volume===0?{volume:0.7}:{})});suppress.current=false;setFeedback('');
   if(muted){void enableCountdownSound();speakChildFeedback('你好呀！别着急，我们一步一步来。');}
   else muteCountdownSound();
  }}>{muted?<VolumeX size={20} aria-hidden="true"/>:<Volume2 size={20} aria-hidden="true"/>}</button>
  <div className={'voice-nav-feedback'+(feedback?' is-visible':'')} role="status" aria-live="polite" aria-atomic="true">
   {feedback&&<><span>{feedback}{/(没有加载成功|暂时不能播放|请关闭后重新开启)/.test(state.status)&&<small className="voice-feedback-detail">{state.status}</small>}</span><button className="icon-button" type="button" aria-label="收起语音文字提示" onClick={()=>setFeedback('')}><X size={16}/></button></>}
  </div>
 </>;
}

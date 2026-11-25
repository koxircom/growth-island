"use client";
import {AutoHabitSpeaker} from './auto-habit-speaker';
import {useEffect,useId,useRef,useState} from "react";
import {Volume2,Square} from "lucide-react";
import {HABIT_AUDIO,habitVoiceText} from "@/lib/habit-voice-static";
import {getChildVoiceState,subscribeChildVoice,speakChildFeedback,childVoiceGeneration,stopChildFeedbackIfCurrent} from "@/lib/child-voice";
let owner:string|null=null;
const listeners=new Set<()=>void>();
function publish(){listeners.forEach(fn=>fn());}
export function HabitSpeaker({name,id,childId,parentToken}:{name:string;id?:string;childId?:string;parentToken?:string}){
 if(!Object.hasOwn(HABIT_AUDIO,name.trim())&&id&&childId)return <AutoHabitSpeaker id={id} childId={childId} name={name} parentToken={parentToken}/>;
 return <StaticHabitSpeaker name={name}/>;
}
function StaticHabitSpeaker({name}:{name:string}){
 const id=useId(),text=habitVoiceText(name),token=useRef<number|null>(null);
 const [state,setState]=useState(getChildVoiceState),[,rerender]=useState(0),[requested,setRequested]=useState(false);
 useEffect(()=>{const update=()=>rerender(x=>x+1);listeners.add(update);const unsubscribe=subscribeChildVoice(()=>setState(getChildVoiceState()));
 return()=>{unsubscribe();listeners.delete(update);if(owner===id){owner=null;if(token.current!==null)stopChildFeedbackIfCurrent(token.current);publish();}};},[id]);
 const playing=owner===id&&token.current===childVoiceGeneration()&&state.message===text&&/正在准备|正在播放/.test(state.status);
 const unavailable=requested&&state.message===text&&/^(?:语音已静音|这台浏览器暂时不能播放|这次语音没有加载成功|请关闭后重新开启顶部声音开关|页面在后台，语音不排队)/.test(state.status);
 return <span className="rule-speaker-wrap"><button type="button" className="rule-speaker icon-button" style={{minWidth:44,minHeight:44}} aria-label={(playing?"停止":"播放")+name.trim()+"说明"} aria-pressed={playing} title={playing?"停止朗读":"听习惯"} onClick={e=>{e.stopPropagation();setRequested(true);if(playing){owner=null;if(token.current!==null)stopChildFeedbackIfCurrent(token.current);token.current=null;publish();}else{const accepted=speakChildFeedback(text);if(accepted){owner=id;token.current=childVoiceGeneration();}else{if(owner===id)owner=null;token.current=null;}publish();}}}>{playing?<Square size={18}/>:<Volume2 size={18}/>}</button>{unavailable&&<span role="status" className="small habit-voice-error">{state.status}</span>}</span>;
}

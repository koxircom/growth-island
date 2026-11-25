"use client";
import {useEffect,useState} from 'react';
import {Volume2,Square} from 'lucide-react';
import {getChildVoiceState,subscribeChildVoice,speakChildExplanation,stopChildFeedback} from '@/lib/child-voice';
export function RuleSpeaker({label,text}:{label:string;text:string}){
 const [state,setState]=useState(getChildVoiceState);
 const [requested,setRequested]=useState(false);
 useEffect(()=>subscribeChildVoice(()=>setState(getChildVoiceState())),[]);
 const active=state.message===text.trim().slice(0,600);
 const playing=active&&/正在准备|正在播放/.test(state.status);
 const unavailable=requested&&active&&/请看说明|语音已静音|不能播放|没有加载成功/.test(state.status);
 return <span className="rule-speaker-wrap"><button type="button" className="rule-speaker icon-button" style={{minWidth:44,minHeight:44}} aria-label={(playing?'停止':'播放')+label+'说明'} aria-pressed={playing} title={playing?'停止说明':'听说明'} onClick={e=>{e.stopPropagation();setRequested(true);if(playing)stopChildFeedback();else speakChildExplanation(text);}}>{playing?<Square size={18}/>:<Volume2 size={18}/>}</button>{unavailable&&<span role="status" className="small">{state.status}<span className="rule-speaker-fallback">{text}</span></span>}</span>;
}

import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AutoHabitSpeaker}from'../app/auto-habit-speaker';import{setChildVoiceSettings}from'../lib/child-voice';
function Fixture(){const[name,setName]=useState('整理书包。');const[show,setShow]=useState(true);Object.assign(window,{setName,setShow,setVoice:setChildVoiceSettings});return <div>{show&&<AutoHabitSpeaker id="00000000-0000-4000-8000-000000000004" childId="00000000-0000-4000-8000-000000000003" name={name}/>}</div>;}createRoot(document.getElementById('root')!).render(<Fixture/>);


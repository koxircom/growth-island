import {CHILD_AUDIO} from './child-audio-manifest';
/** Automatic feedback uses local recordings; explicit explanation taps may use local Chinese speech. */
export type ChildVoiceSettings={enabled:boolean;volume:number};
export type ChildVoiceState={settings:ChildVoiceSettings;message:string;status:string};
const KEY='island-child-voice-v1',defaults:ChildVoiceSettings={enabled:true,volume:0.7};
let message='',status='',generation=0,lastText='',lastAt=0;
let utterance:SpeechSynthesisUtterance|null=null,speechTimer:ReturnType<typeof setTimeout>|null=null;
let memorySettings={...defaults},storageOverride=false;
let context:AudioContext|null=null,source:AudioBufferSourceNode|null=null,gain:GainNode|null=null;
let resumed:Promise<boolean>=Promise.resolve(false),visibilityAttached=false;
const buffers=new Map<string,Promise<AudioBuffer>>(),listeners=new Set<()=>void>();
const hidden=()=>typeof document!=='undefined'&&document.visibilityState==='hidden';
function notify(){for(const listener of listeners)listener();}
function stop(){if(speechTimer){clearTimeout(speechTimer);speechTimer=null;}if(utterance){utterance=null;try{globalThis.speechSynthesis?.cancel();}catch{}}const previous=source;source=null;try{previous?.stop();}catch{}try{previous?.disconnect();gain?.disconnect();}catch{}gain=null;}
export function getChildVoiceSettings():ChildVoiceSettings{
 try{const saved=storageOverride?null:globalThis.localStorage?.getItem(KEY);if(saved){const value=JSON.parse(saved);memorySettings={enabled:typeof value.enabled==='boolean'?value.enabled:defaults.enabled,volume:typeof value.volume==='number'&&Number.isFinite(value.volume)?Math.max(0,Math.min(1,value.volume)):defaults.volume};}}catch{/* Storage restriction cannot break child buttons. */}return {...memorySettings};
}
export function getChildVoiceState():ChildVoiceState{return{settings:getChildVoiceSettings(),message,status};}
export function subscribeChildVoice(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function setChildVoiceSettings(next:Partial<ChildVoiceSettings>){
 const current=getChildVoiceSettings();memorySettings={enabled:typeof next.enabled==='boolean'?next.enabled:current.enabled,volume:typeof next.volume==='number'&&Number.isFinite(next.volume)?Math.max(0,Math.min(1,next.volume)):current.volume};
 try{globalThis.localStorage?.setItem(KEY,JSON.stringify(memorySettings));storageOverride=false;}catch{storageOverride=true;}
 if(!memorySettings.enabled||memorySettings.volume===0){generation++;stop();status='语音已静音，文字提示仍会显示。';}
 else{if(gain)gain.gain.value=memorySettings.volume;status='可关闭后重新开启顶部声音开关，确认这台设备能听见。';}notify();
}
/** Call synchronously in a tap/click, before awaiting HTTP. Best effort, not proof of audibility. */
export function primeChildVoice():boolean{
 const settings=getChildVoiceSettings();if(hidden()||!settings.enabled||settings.volume===0)return false;
 try{
  const Ctor=globalThis.AudioContext||(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Ctor)return false;
  if(!context||context.state==='closed'){
   context=new Ctor();
   if(!visibilityAttached&&typeof document!=='undefined'&&document.addEventListener){document.addEventListener('visibilitychange',()=>{if(hidden()){generation++;stop();if(message){status='页面在后台，语音不排队；回到小岛查看这条提示。';notify();}}});visibilityAttached=true;}
   const silent=context.createBufferSource();silent.buffer=context.createBuffer(1,1,context.sampleRate);silent.connect(context.destination);silent.onended=()=>silent.disconnect();silent.start();
  }
  resumed=context.state==='running'?Promise.resolve(true):context.resume().then(()=>context?.state==='running',()=>false);return true;
 }catch{return false;}
}
function asset(text:string){const path=CHILD_AUDIO[text];return typeof path==='string'&&/^\/audio\/child-v\d+\/[a-zA-Z0-9_-]+\.(wav|mp3|ogg)$/.test(path)?path:null;}
function load(path:string,ctx:AudioContext){
 let pending=buffers.get(path);if(pending)return pending;
 pending=(async()=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(path,{credentials:'same-origin',redirect:'error',cache:'force-cache',signal:controller.signal});if(!response.ok)throw Error('audio_unavailable');const length=Number(response.headers.get('content-length')||0);if(length>3*1024*1024)throw Error('audio_too_large');const bytes=await response.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>3*1024*1024)throw Error('audio_invalid');return await ctx.decodeAudioData(bytes);}finally{clearTimeout(timeout);}})();
 buffers.set(path,pending);void pending.catch(()=>{if(buffers.get(path)===pending)buffers.delete(path);});return pending;
}
/** True means prerecorded playback requested, not guaranteed audible. */
export function speakChildFeedback(text:string):boolean{
 const clean=String(text).trim().slice(0,180);if(!clean)return false;message=clean;
 const settings=getChildVoiceSettings();
 if(hidden()){generation++;stop();status='页面在后台，语音不排队；回到小岛查看这条提示。';notify();return false;}
 if(!settings.enabled||settings.volume===0){generation++;stop();status='语音已静音，文字提示仍会显示。';notify();return false;}
 const path=asset(clean);if(!path){generation++;stop();status='这条提示还没有预录语音，先看文字；不会改用系统声音。';notify();return false;}
 const now=Date.now();if(clean===lastText&&now-lastAt<900){notify();return false;}
 lastText=clean;lastAt=now;const own=++generation;stop();
 if(!primeChildVoice()||!context){status='这台浏览器暂时不能播放语音，文字提示仍然保留。';notify();return false;}
 const ctx=context,activation=resumed;status='正在准备预录语音…';notify();
 void (async()=>{
  try{
   const wait=new Promise<boolean>(resolve=>{const timeout=setTimeout(()=>resolve(false),2000);void activation.then(value=>{clearTimeout(timeout);resolve(value);});});
   const [buffer,ready]=await Promise.all([load(path,ctx),wait]);if(own!==generation||hidden())return;
   const latest=getChildVoiceSettings();if(!latest.enabled||latest.volume===0)return;
   if(!ready||ctx.state!=='running'){status='请关闭后重新开启顶部声音开关，也检查设备音量和静音开关。';notify();return;}
   const next=ctx.createBufferSource(),volume=ctx.createGain();next.buffer=buffer;volume.gain.value=latest.volume;next.connect(volume);volume.connect(ctx.destination);source=next;gain=volume;
   next.onended=()=>{try{next.disconnect();volume.disconnect();}catch{}if(own===generation&&source===next){source=null;gain=null;status='预录语音播放结束；若没有听见，请检查设备音量和静音开关。';notify();}};
   next.start();status='正在播放儿童预录语音。';notify();
  }catch{if(own===generation){status='这次语音没有加载成功，文字提示已保留，可关闭后重新开启顶部声音开关。';notify();}}
 })();return true;
}

export function stopChildFeedback(){generation++;stop();lastText='';lastAt=0;status='语音已停止。';notify();}

/** User-tap only; no remote voices or custom-text TTS requests. */
export function speakChildExplanation(text:string):boolean{
 const clean=String(text).trim().slice(0,600);if(!clean)return false;
 if(asset(clean))return speakChildFeedback(clean);
 generation++;stop();message=clean;
 const settings=getChildVoiceSettings();
 if(hidden()||!settings.enabled||settings.volume===0){status=hidden()?'页面在后台，语音已停止。':'语音已静音。';notify();return false;}
 try{
  const synth=globalThis.speechSynthesis,Ctor=globalThis.SpeechSynthesisUtterance;
  const voice=synth?.getVoices().find(v=>v.localService===true&&/^zh(?:-|_)/i.test(v.lang));
  if(!Ctor||!voice){status='此设备暂无本地中文朗读，请看说明。';notify();return false;}
  const own=generation,next=new Ctor(clean);utterance=next;next.voice=voice;next.lang=voice.lang;next.volume=settings.volume;next.rate=.9;
  const current=()=>own===generation&&utterance===next;
  const clearTimer=()=>{if(speechTimer){clearTimeout(speechTimer);speechTimer=null;}};
  next.onstart=()=>{if(!current())return;clearTimer();status='正在播放说明。';notify();};
  next.onend=()=>{if(!current())return;utterance=null;clearTimer();status='说明朗读结束。';notify();};
  next.onerror=()=>{if(!current())return;utterance=null;clearTimer();status='朗读未成功，请看说明。';notify();};
  if(!visibilityAttached&&typeof document!=='undefined'&&document.addEventListener){document.addEventListener('visibilitychange',()=>{if(hidden()){generation++;stop();status='页面在后台，语音已停止。';notify();}});visibilityAttached=true;}
  status='正在准备说明…';notify();
  speechTimer=setTimeout(()=>{if(current()){generation++;stop();status='朗读未开始，请看说明或再点一次。';notify();}},5000);
  synth.speak(next);return true;
 }catch{stop();status='朗读未成功，请看说明。';notify();return false;}
}

/** Opaque in-memory playback generation for caller-scoped cancellation. */
export function childVoiceGeneration():number{return generation;}
export function stopChildFeedbackIfCurrent(token:number):boolean{
 if(token!==generation)return false;
 stopChildFeedback();return true;
}

export function prepareChildRecording(text:string){
 const own=++generation;stop();primeChildVoice();
 const cancel=()=>{if(own===generation){generation++;stop();}};
 return {cancel,play:async(bytes:ArrayBuffer,label=text)=>{
  if(own!==generation||hidden()||!context||bytes.byteLength>4194304)return false;
  const ctx=context;
  try{
   const buffer=await ctx.decodeAudioData(bytes);const ready=await new Promise<boolean>(resolve=>{const t=setTimeout(()=>resolve(false),2000);void resumed.then(v=>{clearTimeout(t);resolve(v)},()=>{clearTimeout(t);resolve(false)})});
   const settings=getChildVoiceSettings();
   if(own!==generation||hidden()||!ready||ctx.state!=='running'||!settings.enabled||settings.volume===0)return false;
   const next=ctx.createBufferSource(),volume=ctx.createGain();next.buffer=buffer;volume.gain.value=settings.volume;
   next.connect(volume);volume.connect(ctx.destination);source=next;gain=volume;message=label;status='正在播放习惯语音。';
   next.onended=()=>{next.disconnect();volume.disconnect();if(own===generation&&source===next){source=null;gain=null;status='语音播放结束。';notify();}};
   next.start();notify();return true;
  }catch{if(own===generation){status='语音暂时无法播放';notify();}return false;}
 }};
}

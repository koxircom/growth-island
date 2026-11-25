import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('./child-audio-manifest',()=>({CHILD_AUDIO:{'你好。':'/audio/child-v1/hello.wav','再试试。':'/audio/child-v1/retry.wav','问好。':'/audio/child-v1/hello.wav','外链。':'https://example.com/voice.wav'}}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
function setup(){
 const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)});
 const sources:any[]=[],gains:any[]=[],decoded={audio:true},resume=vi.fn(),decode=vi.fn(async(_bytes:ArrayBuffer)=>decoded),contexts:any[]=[];
 class Context{
  state='suspended';sampleRate=44100;destination={};
  constructor(){contexts.push(this);}
  resume(){resume();this.state='running';return Promise.resolve();}
  createBuffer(){return{silent:true};}
  createBufferSource(){const source={buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(source);return source;}
  createGain(){const gain={gain:{value:1},connect:vi.fn(),disconnect:vi.fn()};gains.push(gain);return gain;}
  decodeAudioData(bytes:ArrayBuffer){return decode(bytes);}
 }
 const fetcher=vi.fn(async()=>({ok:true,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(16)}));
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('fetch',fetcher);const systemSpeak=vi.fn();vi.stubGlobal('speechSynthesis',{speak:systemSpeak});
 return {sources,gains,decoded,resume,decode,contexts,store,fetcher,systemSpeak};
}
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
describe('local prerecorded child voice',()=>{
 it('primes WebAudio synchronously and plays only a fixed same-origin asset',async()=>{
  const m=setup(),voice=await import('./child-voice');expect(voice.speakChildFeedback('你好。')).toBe(true);expect(m.resume).toHaveBeenCalledTimes(1);await settle();
  expect(m.fetcher).toHaveBeenCalledWith('/audio/child-v1/hello.wav',expect.objectContaining({credentials:'same-origin',redirect:'error',cache:'force-cache'}));expect(m.sources).toHaveLength(2);expect(m.sources[1].buffer).toBe(m.decoded);expect(m.sources[1].start).toHaveBeenCalled();expect(m.gains[0].gain.value).toBe(.7);expect(m.systemSpeak).not.toHaveBeenCalled();
 });
 it('missing and unsafe mappings are text only with no system speech or network',async()=>{
  const m=setup(),voice=await import('./child-voice');expect(voice.speakChildFeedback('未知提示。')).toBe(false);expect(voice.speakChildFeedback('外链。')).toBe(false);expect(m.fetcher).not.toHaveBeenCalled();expect(m.systemSpeak).not.toHaveBeenCalled();expect(voice.getChildVoiceState().status).toContain('不会改用系统声音');
 });
 it('mute persists and stops active audio while retaining readable feedback',async()=>{
  const m=setup(),voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();voice.setChildVoiceSettings({enabled:false,volume:.25});expect(m.sources[1].stop).toHaveBeenCalled();expect(voice.speakChildFeedback('再试试。')).toBe(false);expect(voice.getChildVoiceState().message).toBe('再试试。');vi.resetModules();expect((await import('./child-voice')).getChildVoiceSettings()).toEqual({enabled:false,volume:.25});
 });
 it('volume clamps and updates active GainNode, zero immediately stops',async()=>{
  const m=setup(),voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();voice.setChildVoiceSettings({volume:9});expect(m.gains[0].gain.value).toBe(1);voice.setChildVoiceSettings({volume:0});expect(m.sources[1].stop).toHaveBeenCalled();expect(voice.primeChildVoice()).toBe(false);
 });
 it('does not let delayed loads play after mute or after a newer prompt',async()=>{
  const m=setup();let finish:(x:any)=>void=()=>{};m.fetcher.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const voice=await import('./child-voice');voice.speakChildFeedback('你好。');voice.speakChildFeedback('再试试。');await settle();expect(m.sources).toHaveLength(2);finish({ok:true,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(16)});await settle();expect(m.sources).toHaveLength(2);
 });
 it('background requests do not fetch and visibility change stops current audio',async()=>{
  const m=setup(),callbacks:Record<string,()=>void>={};const doc={visibilityState:'visible',addEventListener:(key:string,fn:()=>void)=>callbacks[key]=fn};vi.stubGlobal('document',doc);
  const voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();doc.visibilityState='hidden';callbacks.visibilitychange();expect(m.sources[1].stop).toHaveBeenCalled();expect(voice.speakChildFeedback('再试试。')).toBe(false);expect(m.fetcher).toHaveBeenCalledTimes(1);expect(voice.getChildVoiceState().status).toContain('后台');
 });
 it('unsupported WebAudio retains text without trying system voices',async()=>{
  const m=setup();vi.stubGlobal('AudioContext',undefined);vi.stubGlobal('webkitAudioContext',undefined);const voice=await import('./child-voice');expect(voice.speakChildFeedback('你好。')).toBe(false);expect(voice.getChildVoiceState().status).toContain('不能播放');expect(m.systemSpeak).not.toHaveBeenCalled();
 });
 it('denied gesture activation displays explicit retry advice, never false playing',async()=>{
  const m=setup();const voice=await import('./child-voice');voice.primeChildVoice();m.contexts[0].state='suspended';m.contexts[0].resume=()=>Promise.reject(Error('NotAllowed'));voice.speakChildFeedback('你好。');await settle();expect(m.sources).toHaveLength(1);expect(voice.getChildVoiceState().status).toContain('顶部声音开关');
 });
 it('missing audio is retriable, with no cached failure or system fallback',async()=>{
  const m=setup();m.fetcher.mockResolvedValueOnce({ok:false,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(0)});const voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();expect(voice.getChildVoiceState().status).toContain('没有加载成功');voice.speakChildFeedback('问好。');await settle();expect(m.fetcher).toHaveBeenCalledTimes(2);expect(m.sources).toHaveLength(2);expect(m.systemSpeak).not.toHaveBeenCalled();
 });
 it('reuses decoded buffers and suppresses rapid duplicate prompts',async()=>{
  const m=setup(),voice=await import('./child-voice');voice.speakChildFeedback('你好。');expect(voice.speakChildFeedback('你好。')).toBe(false);await settle();voice.speakChildFeedback('问好。');await settle();expect(m.fetcher).toHaveBeenCalledTimes(1);expect(m.decode).toHaveBeenCalledTimes(1);expect(m.sources[1].stop).toHaveBeenCalled();
 });
 it('stale read-only storage cannot undo session mute and subscriptions work',async()=>{
  setup();vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({enabled:true,volume:.8}),setItem:()=>{throw Error('quota')}});const voice=await import('./child-voice'),listener=vi.fn(),off=voice.subscribeChildVoice(listener);voice.setChildVoiceSettings({enabled:false});expect(voice.getChildVoiceSettings().enabled).toBe(false);expect(listener).toHaveBeenCalled();off();listener.mockClear();voice.speakChildFeedback('你好。');expect(listener).not.toHaveBeenCalled();
 });
});

it('explicit stop cancels playback and a late loading response',async()=>{
 const m=setup(),voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();voice.stopChildFeedback();expect(m.sources[1].stop).toHaveBeenCalled();expect(voice.getChildVoiceState().status).toBe('语音已停止。');
 let finish:(x:any)=>void=()=>{};m.fetcher.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));voice.speakChildFeedback('再试试。');const count=m.sources.length;voice.stopChildFeedback();finish({ok:true,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(16)});await settle();expect(m.sources).toHaveLength(count);
});

it('explicit stop permits immediate replay without duplicate debounce swallowing it',async()=>{
 const m=setup(),voice=await import('./child-voice');voice.speakChildFeedback('你好。');await settle();const first=m.sources[1];voice.stopChildFeedback();expect(first.stop).toHaveBeenCalled();expect(voice.speakChildFeedback('你好。')).toBe(true);await settle();expect(m.sources).toHaveLength(3);first.onended();expect(voice.getChildVoiceState().status).toContain('正在播放');m.sources[2].onended();expect(voice.getChildVoiceState().status).toContain('播放结束');
});

it("caller-scoped cleanup cannot stop newer feedback or explanation",async()=>{
 const m=setup(),voice=await import('./child-voice');
 voice.speakChildFeedback('你好。');await settle();const old=voice.childVoiceGeneration();
 voice.speakChildFeedback('再试试。');await settle();const current=m.sources.at(-1);
 expect(voice.stopChildFeedbackIfCurrent(old)).toBe(false);expect(current.stop).not.toHaveBeenCalled();expect(voice.getChildVoiceState().status).toContain('正在播放');
 expect(voice.stopChildFeedbackIfCurrent(voice.childVoiceGeneration())).toBe(true);expect(current.stop).toHaveBeenCalled();
 voice.speakChildFeedback('你好。');await settle();const stale=voice.childVoiceGeneration();
 voice.speakChildExplanation('未知说明');expect(voice.stopChildFeedbackIfCurrent(stale)).toBe(false);
});

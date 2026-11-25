
import {afterEach,expect,it,vi} from 'vitest';
import {rewardExplanation} from './reward-explanation';
vi.mock('./child-audio-manifest',()=>({CHILD_AUDIO:{}}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();});
function setup(voices:any[]=[{localService:true,lang:'zh-CN'}]){
 const synth={getVoices:()=>voices,speak:vi.fn(),cancel:vi.fn()};
 class Utterance {text:string;constructor(text:string){this.text=text;}}
 vi.stubGlobal('speechSynthesis',synth);vi.stubGlobal('SpeechSynthesisUtterance',Utterance);
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('no network allowed');}));
 return synth;
}
it('custom reward text is read with an explicitly local Chinese voice, only starts on event',async()=>{
 const s=setup(),m=await import('./child-voice');
 expect(m.speakChildExplanation('拼图，需要三颗星星。')).toBe(true);
 expect(s.speak.mock.calls[0][0].voice.localService).toBe(true);
 expect(m.getChildVoiceState().status).toContain('准备');
 s.speak.mock.calls[0][0].onstart();expect(m.getChildVoiceState().status).toContain('播放');
 expect(fetch).not.toHaveBeenCalled();m.stopChildFeedback();expect(s.cancel).toHaveBeenCalled();
});
it('rejects remote and non-Chinese voices instead of silent fake playback',async()=>{
 const s=setup([{lang:'zh-CN',localService:false},{lang:'en-US',localService:true}]),m=await import('./child-voice');
 expect(m.speakChildExplanation('说明')).toBe(false);expect(s.speak).not.toHaveBeenCalled();expect(m.getChildVoiceState().status).toContain('暂无本地中文');
});
it('new explanation cancels previous one and late callbacks cannot overwrite',async()=>{
 const s=setup(),m=await import('./child-voice');m.speakChildExplanation('一');const old=s.speak.mock.calls[0][0];
 m.speakChildExplanation('二');old.onend();expect(m.getChildVoiceState().message).toBe('二');expect(m.getChildVoiceState().status).toContain('准备');m.stopChildFeedback();
});
it('mute prevents and stops speech',async()=>{
 const s=setup(),m=await import('./child-voice');m.speakChildExplanation('一');m.setChildVoiceSettings({enabled:false});
 expect(s.cancel).toHaveBeenCalled();expect(m.speakChildExplanation('二')).toBe(false);expect(s.speak).toHaveBeenCalledTimes(1);
});
it('no start event times out honestly',async()=>{
 vi.useFakeTimers();setup();const m=await import('./child-voice');m.speakChildExplanation('说明');vi.advanceTimersByTime(5001);
 expect(m.getChildVoiceState().status).toContain('未开始');
});
it('reward rules use real binding and price, not title guesses',()=>{
 const r={name:'我的奖励',cost:5,kind:'device_time',device_id:'s',duration_seconds:600};
 expect(rewardExplanation(r,{switch:'s'})).toContain('10分钟');expect(rewardExplanation(r,{switch:'s'})).toContain('联网确认');
 expect(rewardExplanation({...r,kind:'activity'})).toContain('星星先预留');
 expect(rewardExplanation({...r,device_id:'tv'},{tv:'tv'})).toContain('电视余额');
});

it('background transition cancels local speech and cannot resume it',async()=>{
 const s=setup(),events:Record<string,()=>void>={},doc={visibilityState:'visible',addEventListener:(n:string,f:()=>void)=>{events[n]=f;}};
 vi.stubGlobal('document',doc);const m=await import('./child-voice');m.speakChildExplanation('说明');
 doc.visibilityState='hidden';events.visibilitychange();expect(s.cancel).toHaveBeenCalled();
 expect(m.speakChildExplanation('再说明')).toBe(false);expect(s.speak).toHaveBeenCalledTimes(1);
});
it('speech error displays failure rather than completion',async()=>{
 const s=setup(),m=await import('./child-voice');m.speakChildExplanation('说明');
 s.speak.mock.calls[0][0].onerror();expect(m.getChildVoiceState().status).toContain('未成功');
});

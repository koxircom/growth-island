import {afterEach,describe,it,expect,vi} from "vitest";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe("foreground countdown audio",()=>{
 it("unlocks during the gesture, plays real oscillators and respects explicit mute",async()=>{
  const starts=vi.fn(),resume=vi.fn();
  class FakeContext {
   state="suspended";currentTime=10;destination={};
   resume(){resume();this.state="running";return Promise.resolve();}
   createOscillator(){return {type:"",frequency:{value:0},connect:vi.fn(),disconnect:vi.fn(),start:starts,stop:vi.fn(),onended:null};}
   createGain(){return {gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};}
  }
  vi.stubGlobal("AudioContext",FakeContext);
  const audio=await import("./countdown-audio");const pending=audio.enableCountdownSound(false);
  expect(resume).toHaveBeenCalledTimes(1); // called before awaiting network/audio promises
  expect(await pending).toBe(true);expect(audio.playCountdownSound()).toBe(true);expect(starts).toHaveBeenCalledTimes(3);
  const voice=await import("./child-voice");
  voice.setChildVoiceSettings({enabled:false});
  expect(audio.countdownSoundEnabled()).toBe(false);
  expect(audio.playCountdownSound()).toBe(false);
  expect(await audio.enableCountdownSound()).toBe(false);
  voice.setChildVoiceSettings({enabled:true,volume:0});
  expect(await audio.enableCountdownSound()).toBe(false);
  voice.setChildVoiceSettings({enabled:true,volume:0.7});
  expect(await audio.enableCountdownSound()).toBe(true);
  audio.muteCountdownSound();expect(await audio.enableCountdownSound(false)).toBe(false);expect(audio.playCountdownSound()).toBe(false);
  expect(await audio.enableCountdownSound()).toBe(true);expect(audio.playCountdownSound()).toBe(true);
 });
 it("reports unsupported audio without throwing",async()=>{
  vi.stubGlobal("AudioContext",undefined);vi.stubGlobal("webkitAudioContext",undefined);
  const audio=await import("./countdown-audio");expect(await audio.enableCountdownSound()).toBe(false);expect(audio.playCountdownSound()).toBe(false);
 });
});

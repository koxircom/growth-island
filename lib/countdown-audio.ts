import {getChildVoiceSettings} from './child-voice';
const soundAllowed=()=>{const settings=getChildVoiceSettings();return settings.enabled&&settings.volume>0;};
let context: AudioContext | null = null;
let enabled = false;
let explicitlyMuted = false;
/** Call in the click handler before awaiting a network request: iPad needs a user gesture. */
export async function enableCountdownSound(explicit = true): Promise<boolean> {
  if (!soundAllowed() || (!explicit && explicitlyMuted)) return false;
  if (explicit) explicitlyMuted = false;
  try {
    const Ctor = globalThis.AudioContext || (globalThis as typeof globalThis & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Ctor) return false;
    if (!context || context.state === "closed") context = new Ctor();
    if (context.state !== "running") await context.resume();
    enabled = context.state === "running"; return enabled;
  } catch { enabled = false; return false; }
}
export function muteCountdownSound() {enabled = false; explicitlyMuted = true;}
export function countdownSoundEnabled() {return soundAllowed() && enabled && context?.state === "running";}
export function playCountdownSound(): boolean {
  if (!soundAllowed() || !enabled || !context || context.state !== "running") return false;
  try {
    const start = context.currentTime;
    for (let index=0;index<3;index++) {
      const tone=context.createOscillator(), volume=context.createGain();
      tone.type="sine"; tone.frequency.value=index===2?880:660;
      volume.gain.setValueAtTime(0,start+index*.4);
      volume.gain.linearRampToValueAtTime(.12,start+index*.4+.02);
      volume.gain.exponentialRampToValueAtTime(.001,start+index*.4+.25);
      tone.connect(volume);volume.connect(context.destination);
      tone.start(start+index*.4);tone.stop(start+index*.4+.3);
      tone.onended=()=>{tone.disconnect();volume.disconnect();};
    }
    return true;
  }catch{return false;}
}

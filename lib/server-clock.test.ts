import { describe, it, expect, vi } from 'vitest';
import { ServerClock } from './server-clock';
import { elapsed, type Timer } from './model';
const base = Date.parse('2026-11-11T12:00:00Z');
const timer = { started_at: new Date(base).toISOString(), paused_at: null, ended_at: null, paused_seconds: 0, target_seconds: 300, status:'running' } as Timer;
describe('database-anchored timer clock', () => {
  for (const offset of [13000,33000,60000,-33000,-60000,86400000]) it(`ignores client wall-clock skew ${offset}`, () => {
    let mono=100; const clock=new ServerClock(()=>mono);
    const wall=vi.spyOn(Date,'now').mockReturnValue(base+offset);
    // A 40ms request contains 30ms server work and ~5ms each network leg.
    clock.observe({serverTime:base+35,processingMs:30},100,140);mono=140;
    expect(300-elapsed(timer,clock.now()!)).toBe(300);
    mono+=1500;expect(300-elapsed(timer,clock.now()!)).toBe(299);
    wall.mockRestore();
  });
  it('wall clock jumps cannot advance or rewind an active timer',()=>{
    let mono=0;const c=new ServerClock(()=>mono);c.observe({serverTime:base,processingMs:0},0,0);
    const wall=vi.spyOn(Date,'now').mockReturnValue(base+9e9);mono=2000;expect(elapsed(timer,c.now()!)).toBe(2);
    wall.mockReturnValue(base-9e9);mono=3000;expect(elapsed(timer,c.now()!)).toBe(3);wall.mockRestore();
  });
  it('subtracts server work before estimating response transit and never resets existing elapsed time',()=>{
    let mono=5000;const c=new ServerClock(()=>mono);
    c.observe({serverTime:base+4500,processingMs:4000},0,5000);
    expect(elapsed(timer,c.now()!)).toBe(5);
    expect(c.confirmed()).toBe(base+4500); // auto-finish uses only a confirmed DB instant
  });
  it('ignores an older response even when it arrives later',()=>{
    let mono=100;const c=new ServerClock(()=>mono);c.observe({serverTime:base+100,processingMs:0},90,100);
    mono=1000;expect(c.observe({serverTime:base-10000,processingMs:0},0,1000)).toBe(false);
    expect(c.now()).toBe(base+1005);
  });
  it('foreground recovery requires a new sample and rejects pre-sleep responses',()=>{
    let mono=0;const c=new ServerClock(()=>mono);c.observe({serverTime:base,processingMs:0},0,0);
    mono=200;c.invalidate();expect(c.now()).toBeNull();
    expect(c.observe({serverTime:base+100,processingMs:0},100,200)).toBe(false);
    mono=300;c.observe({serverTime:base+600100,processingMs:0},200,300);
    expect(elapsed(timer,c.now()!)).toBe(600);
  });
  it('fresh page restores an existing timer instead of starting another five minutes',()=>{
    const c=new ServerClock(()=>0);expect(c.now()).toBeNull();c.observe({serverTime:base+13000,processingMs:0},0,0);
    expect(300-elapsed(timer,c.now()!)).toBe(287);
  });
  it('pause uses stored timestamp and resume subtracts fractional pauses before flooring',()=>{
    expect(elapsed({...timer,paused_at:new Date(base+2000).toISOString()},base+90000)).toBe(2);
    expect(elapsed({...timer,paused_seconds:1.8},base+3900)).toBe(2);
  });
});

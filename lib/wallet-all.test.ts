import {it,expect} from 'vitest';import{tvStartReason}from './child-action-reasons';
const b={available:564,fresh:true,manualBlock:false,cooldown:false,windowOpen:true,seconds:564,exactSeconds:true};
it('allows exact full seconds including subminute',()=>{expect(tvStartReason(b)).toBe('');expect(tvStartReason({...b,seconds:24,available:24})).toBe('')});
it('preserves all safety gates',()=>{for(const p of [{fresh:false},{manualBlock:true},{cooldown:true},{windowOpen:false},{seconds:10801},{seconds:1.5},{seconds:0}])expect(tvStartReason({...b,...p})).not.toBe('')});

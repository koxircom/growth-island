import {describe,it,expect} from 'vitest';
import {walletStartReason,tvStartReason} from './child-action-reasons';
describe('blocked child actions remain explanatory not executable',()=>{
 const wallet={active:true,available:60,hasLive:false,cooldown:0,selected:60};
 it('wallet distinguishes zero balance, cooldown, pending time and ready',()=>{expect(walletStartReason({...wallet,available:0})).toContain('兑换');expect(walletStartReason({...wallet,cooldown:10})).toContain('休息');expect(walletStartReason({...wallet,cooldown:null})).toContain('校准');expect(walletStartReason({...wallet,hasLive:true})).toContain('正在使用');expect(walletStartReason(wallet)).toBe('');});
 const tv={available:300,fresh:true,manualBlock:false,cooldown:false,windowOpen:true,seconds:300};
 it('TV distinguishes unavailable, blocked and stale with no false success',()=>{expect(tvStartReason({...tv,available:0})).toContain('兑换');expect(tvStartReason({...tv,fresh:false})).toContain('确认');expect(tvStartReason({...tv,manualBlock:true})).toContain('家长');expect(tvStartReason({...tv,cooldown:true})).toContain('休息');expect(tvStartReason({...tv,windowOpen:false})).toContain('观看时间');expect(tvStartReason(tv)).toBe('');});
 it('TV refuses NaN, empty zero, negative, fractions and excessive input',()=>{for(const seconds of [NaN,0,-60,90,10860])expect(tvStartReason({...tv,seconds})).not.toBe('');});
});

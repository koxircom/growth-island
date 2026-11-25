import {describe,it,expect} from 'vitest';
import {effectiveEarnedStarDays} from './earned-stars';
import type {Dashboard} from './model';
const day='2026-11-18', now='2026-11-18T01:00:00Z';
const row=(child_id:string,source_type:string,amount:number,source_id:string,created_at=now)=>({id:source_type+source_id,posting_seq:null,balance_before:null,balance_after:null,child_id,source_type,amount,source_id,created_at});
const base={family:{timezone:'Asia/Singapore'},star_ledger:[],star_adjustments:[],manual_star_grants:[]} as unknown as Dashboard;
const amount=(data:Dashboard,id='a',d=day)=>effectiveEarnedStarDays(data,id,d,1)[0].amount;
describe('effective income by original posting day',()=>{
 it('subtracts matching undo but not spending/refund or other child undo',()=>{const f={...base,star_ledger:[row('a','checkin',4,'one'),row('a','undo',-4,'one'),row('a','checkin',3,'two'),row('b','undo',-3,'two'),row('a','redemption',-2,'r'),row('a','refund',2,'r')]};expect(amount(f)).toBe(3)});
 it('redo has a distinct identity and earns once',()=>expect(amount({...base,star_ledger:[row('a','checkin',2,'old'),row('a','undo',-2,'old'),row('a','checkin',2,'new')]})).toBe(2));
 it('later undo revises original day, does not reduce unrelated current income',()=>{const f={...base,star_ledger:[row('a','checkin',4,'old','2026-11-17T01:00:00Z'),row('a','undo',-4,'old'),row('a','checkin',3,'new')]};expect(amount(f)).toBe(3);expect(amount(f,'a','2026-11-17')).toBe(0)});
 it('uses manual reversal metadata, excludes reversal refund',()=>{const f={...base,manual_star_grants:[{id:'g',child_id:'a',reversed_at:now}],star_ledger:[row('a','manual_bonus',8,'g'),row('a','manual_reversal',-8,'rev'),row('a','manual_bonus',2,'g2')]} as Dashboard;expect(amount(f)).toBe(2)});
 it('links adjustment reversals to source; penalty reversal never becomes earnings',()=>{const f={...base,star_adjustments:[{id:'s',child_id:'a',kind:'streak'},{id:'sr',child_id:'a',kind:'reversal',related_id:'s'},{id:'p',child_id:'a',kind:'deduction'},{id:'pr',child_id:'a',kind:'reversal',related_id:'p'}],star_ledger:[row('a','star_adjustment',5,'s'),row('a','star_adjustment',-5,'sr'),row('a','star_adjustment',-2,'p'),row('a','star_adjustment',2,'pr')]} as Dashboard;expect(amount(f)).toBe(0)});
 it('does not apply another child manual or adjustment reversal',()=>{const f={...base,manual_star_grants:[{id:'g',child_id:'b',reversed_at:now}],star_adjustments:[{id:'s',child_id:'a',kind:'savings'},{id:'r',child_id:'b',kind:'reversal',related_id:'s'}],star_ledger:[row('a','manual_bonus',4,'g'),row('a','star_adjustment',3,'s')]} as Dashboard;expect(amount(f)).toBe(7)});
 it('uses family posting timezone, not completion day; only posted ledger counts',()=>{const f={...base,star_ledger:[row('a','checkin',4,'past-completion','2026-11-17T16:00:00Z'),row('a','checkin',2,'yesterday','2026-11-17T15:59:59Z') ]};expect(amount(f)).toBe(4);expect(amount(f,'b')).toBe(0);expect(amount(f,'a','2026-11-19')).toBe(0)});
});

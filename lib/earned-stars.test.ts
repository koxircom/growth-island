import {describe,it,expect} from 'vitest';
import {earnedStarDays} from './earned-stars';
import type {Dashboard} from './model';
const fixture={family:{timezone:'Asia/Shanghai'},star_adjustments:[{id:'streak-a',child_id:'a',kind:'streak'},{id:'rev-a',child_id:'a',kind:'reversal'}],star_ledger:[
 ...[['a','checkin',2,'2026-11-17T15:59:00Z',''],['a','manual_bonus',3,'2026-11-17T16:00:00Z',''],['a','refund',99,'2026-11-18T01:00:00Z',''],['a','star_adjustment',4,'2026-11-18T01:00:00Z','streak-a'],['a','star_adjustment',6,'2026-11-18T01:00:00Z','rev-a'],['a','redemption',-5,'2026-11-18T01:00:00Z',''],['a','undo',-2,'2026-11-18T01:00:00Z',''],['b','checkin',19,'2026-11-18T01:00:00Z','']].map(([child_id,source_type,amount,created_at,source_id])=>({child_id,source_type,amount,created_at,source_id}))]} as unknown as Dashboard;
describe('daily gross earned stars',()=>{
 it('splits unequal children and excludes refund/reversal/spending',()=>{const a=earnedStarDays(fixture,'a','2026-11-18',30),b=earnedStarDays(fixture,'b','2026-11-18',30);expect(a.at(-1)).toEqual({day:'2026-11-18',amount:7,count:2});expect(b.at(-1)?.amount).toBe(19);expect(a.at(-2)?.amount).toBe(2)});
 it('zero fills and uses adjustable timezone',()=>{expect(earnedStarDays(fixture,'none','2026-11-18',30)).toHaveLength(30);expect(earnedStarDays(fixture,'none','2026-11-18',30).every(p=>p.amount===0)).toBe(true);const utc={...fixture,family:{...fixture.family,timezone:'UTC'}};expect(earnedStarDays(utc,'a','2026-11-18',30).at(-2)?.amount).toBe(5)});
 it('does not treat unknown positive or negative reward entries as earned',()=>{const f={...fixture,star_ledger:[{child_id:'a',source_type:'new_unknown',amount:500,created_at:'2026-11-18T01:00:00Z'},{child_id:'a',source_type:'checkin',amount:-8,created_at:'2026-11-18T01:00:00Z'}]} as Dashboard;expect(earnedStarDays(f,'a','2026-11-18',2).at(-1)?.amount).toBe(0)});
});

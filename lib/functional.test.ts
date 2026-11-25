import {describe,it,expect} from 'vitest';
import {newestFirst,latestCheckin,visibleHabits,redemptionName,gameSecondsRemaining,startOfLocalDay, type Dashboard,type Child,type Timer,type Habit,type Checkin} from './model';
describe('functional regression calculations',()=>{
 it('shows newest history first without mutating server data',()=>{
  const rows=[{id:'old',at:'2026-11-01T00:00:00Z'},{id:'new',at:'2026-11-11T00:00:00Z'}];
  expect(newestFirst(rows,x=>x.at).map(x=>x.id)).toEqual(['new','old']);expect(rows[0].id).toBe('old');
 });
 it('undo selects newest across approved and pending records',()=>{
  expect(latestCheckin([{id:'new',created_at:'2026-11-11T02:00:00Z'},{id:'old',created_at:'2026-11-11T01:00:00Z'}] as Checkin[]).id).toBe('new');
 });
 it('hides archived habits but retains paused habits for editing',()=>{
  expect(visibleHabits([{id:'deleted',archived_at:'2026-11-11'},{id:'paused',active:false},{id:'active',active:true}] as Habit[]).map(x=>x.id)).toEqual(['paused','active']);
 });
 it('uses the immutable reward snapshot after rename or removal',()=>{
  expect(redemptionName({id:'x',reward_id:'r',reward_name:'Original'} as any,[{id:'r',name:'Changed'}] as any)).toBe('Original');
  expect(redemptionName({id:'x',reward_id:'r',reward_name:'Original'} as any,[])).toBe('Original');
 });
 it('finds timezone day boundaries including daylight saving',()=>{
  expect(new Date(startOfLocalDay('2026-11-11','Asia/Shanghai')).toISOString()).toBe('2026-11-10T16:00:00.000Z');
  expect(startOfLocalDay('2026-03-09','America/New_York')-startOfLocalDay('2026-03-08','America/New_York')).toBe(23*3600000);
  expect(startOfLocalDay('2026-11-02','America/New_York')-startOfLocalDay('2026-11-01','America/New_York')).toBe(25*3600000);
 });
 it('subtracts actual game usage only for this child and current day',()=>{
  const child={id:'a',weekday_minutes:20,weekend_minutes:30} as Child;
  const timers=[
   {child_id:'a',kind:'game',started_at:'2026-11-10T15:50:00Z',ended_at:'2026-11-10T16:05:00Z'},
   {child_id:'a',kind:'game',started_at:'2026-11-11T01:00:00Z',ended_at:'2026-11-11T01:02:00Z'},
   {child_id:'b',kind:'game',started_at:'2026-11-11T01:00:00Z',ended_at:'2026-11-11T01:10:00Z'},
   {child_id:'a',kind:'focus',started_at:'2026-11-11T01:00:00Z',ended_at:'2026-11-11T01:10:00Z'},
  ] as Timer[];
  const data={family:{timezone:'Asia/Shanghai'},timers} as Dashboard;
  expect(gameSecondsRemaining(data,child,'2026-11-11')).toBe(13*60);
  expect(gameSecondsRemaining({...data,timers:[...timers,{child_id:'a',kind:'game',started_at:'2026-11-11T02:00:00Z',ended_at:'2026-11-11T04:00:00Z'} as Timer]},child,'2026-11-11')).toBe(0);
 });
});
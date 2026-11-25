import {describe,it,expect} from 'vitest';
import {approvedActivityCount,habitCategory,scheduled,progress,habitsAt,type Habit,type Dashboard} from './model';
import {groupHabits,habitRuleFingerprint,habitRule} from './habit-rule-groups';
const h:Habit={id:'r',child_id:'a',name:'睡觉',icon:'moon',color:'#aabbcc',weekdays:[1,2,3,4,5,6,7],target_count:2,target_minutes:0,stars:1,requires_approval:false,active:true};
const day='2026-11-16';
const base:Dashboard={family:{id:'f',name:'test',timezone:'Asia/Shanghai'},children:[],habits:[h],checkins:[],timers:[],rewards:[],redemptions:[],rests:[],star_balances:[]};
const c=(id:string,status='approved',date=day)=>({id,habit_id:id.startsWith('o')?'o':'r',child_id:'a',day:date,status,stars:1} as any);
describe('versioned occasional goals',()=>{
 it('legacy defaults routine and fingerprint normalizes',()=>{expect(habitCategory(h)).toBe('routine');expect(habitRule(h).category).toBe('routine');expect(habitRuleFingerprint(h)).toBe(habitRuleFingerprint({...h,category:'routine'}));});
 it('optional stays available but does not inflate numerator or denominator',()=>{const o={...h,id:'o',category:'occasional' as const,target_count:3};expect(scheduled(o,day)).toBe(true);expect(progress({...base,habits:[h,o],checkins:[c('r1'),c('o1'),c('o2'),c('o3')]},'a',day)).toEqual({done:1,total:2,rate:50,rest:false});});
 it('optional approvals still count as activity, not daily goals',()=>{const d={...base,habits:[{...h,id:'o',category:'occasional' as const}],checkins:[c('o1'),c('o2','pending')]};expect(approvedActivityCount(d,'a',day)).toBe(1);expect(progress(d,'a',day).done).toBe(0);});
 it('all optional is neutral zero goals, including pending/undone',()=>{expect(progress({...base,habits:[{...h,id:'o',category:'occasional'}],checkins:[c('o1'),c('o2','pending'),c('o3','undone')]},'a',day)).toEqual({done:0,total:0,rate:0,rest:false});});
 it('historical category is effective-day scoped',()=>{const versions=[{...h,id:'v1',habit_id:'r',effective_day:'2026-11-15',archived:false,category:'routine' as const},{...h,id:'v2',habit_id:'r',effective_day:day,archived:false,category:'occasional' as const}];const d={...base,habits:[{...h,category:'occasional' as const}],habit_versions:versions};expect(progress(d,'a','2026-11-15').total).toBe(2);expect(progress(d,'a',day).total).toBe(0);expect(habitsAt(d,'2026-11-15')[0].category).toBe('routine');});
 it('different categories cannot collapse grouped rules',()=>{expect(groupHabits([h,{...h,id:'o',child_id:'b',category:'occasional'}])).toHaveLength(2);});
 it('rest and schedule constraints retain prior behavior',()=>{expect(scheduled({...h,category:'occasional',active:false},day)).toBe(false);expect(progress({...base,rests:[{child_id:'a',day} as any]},'a',day).rest).toBe(true);});
});

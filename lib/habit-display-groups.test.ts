import {describe,it,expect} from 'vitest';
import {displayHabitGroups} from './habit-display-groups';
import {habitRuleFingerprint} from './habit-rule-groups';
import type {Habit} from './model';
const h=(id:string,child_id:string,active:boolean)=>({id,child_id,name:'读书',icon:'book',color:'#ffffff',weekdays:[1],target_count:1,target_minutes:0,stars:1,requires_approval:false,active,archived_at:null} as Habit);
describe('per-child enabled chips stay in one rule row',()=>{
 it('keeps mixed active status and original fingerprints',()=>{const a=h('a','c1',true),b=h('b','c2',false),g=displayHabitGroups([a,b]);expect(g).toHaveLength(1);expect(g[0].habits).toEqual([a,b]);expect(habitRuleFingerprint(g[0].habits[1])).toBe(habitRuleFingerprint(b));});
 it('keeps row key after toggle and keeps distinct rules apart',()=>{expect(displayHabitGroups([h('a','c1',true),h('b','c2',true)])[0].key).toBe(displayHabitGroups([h('a','c1',false),h('b','c2',true)])[0].key);expect(displayHabitGroups([h('a','c1',true),{...h('b','c2',true),stars:2}])).toHaveLength(2);});
 it('does not combine duplicate same-child habits or archived rows',()=>{expect(displayHabitGroups([h('a','c1',true),h('b','c1',false)])).toHaveLength(2);expect(displayHabitGroups([{...h('a','c1',true),archived_at:'2026-01-01'}])).toHaveLength(0);});
});

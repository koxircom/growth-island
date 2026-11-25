import {describe,it,expect} from "vitest";
import {groupHabits,rangeSelection,habitRuleFingerprint} from "./habit-rule-groups";
import type {Habit} from "./model";
const h:Habit={id:"1",child_id:"a",name:"阅读",icon:"book",color:"#123456",weekdays:[2,1],target_count:1,target_minutes:5,stars:2,requires_approval:false,active:true};
describe("habit rules grouping",()=>{
 it("groups exact rules without merging historical identifiers",()=>{const g=groupHabits([h,{...h,id:"2",child_id:"b"}]);expect(g).toHaveLength(1);expect(g[0].habits.map(h=>h.id)).toEqual(["1","2"]);});
 it("keeps different rules and duplicate same-child rules separate",()=>{expect(groupHabits([h,{...h,id:"2",stars:3},{...h,id:"3"}])).toHaveLength(3);});
 it("ignores archives, compares weekdays irrespective of order",()=>{expect(groupHabits([h,{...h,id:"2",child_id:"b",weekdays:[1,2]},{...h,id:"3",archived_at:"today"}])).toHaveLength(1);expect(h.weekdays).toEqual([2,1]);expect(habitRuleFingerprint(h)).toContain("阅读");});
 it("supports forward/backward shift ranges and deselect",()=>{expect(rangeSelection([1,2,3,4],[1],1,3,true,true)).toEqual([1,2,3]);expect(rangeSelection([1,2,3,4],[1,2,3,4],4,2,true,false)).toEqual([1]);expect(rangeSelection([1,2,3],[],null,3,true,true)).toEqual([3]);});
});

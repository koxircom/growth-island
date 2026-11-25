import {describe,it,expect} from "vitest";
import {activeStarRule,latestStarRule,starDeductionRemaining,type StarRule} from "./star-rules";
import type {Dashboard} from "./model";
const r:StarRule={id:"one",epoch_id:"epoch-one",revision:1,child_id:"a",timezone:"Asia/Shanghai",effective_day:"2026-11-12",effective_week:"2026-11-16",deduction_limit:3,streak_enabled:true,savings_enabled:true,habit_ids:["h"],created_at:"2026-11-11T12:00:00Z"};
const base={family:{timezone:"Asia/Shanghai"},star_rule_versions:[r],star_adjustments:[]} as unknown as Dashboard;
describe("star rule display",()=>{
 it("shows day and week configurations only after their separate local boundaries",()=>{
  expect(activeStarRule(base,"a","day",new Date("2026-11-11T15:59:59Z"))).toBeUndefined();
  expect(activeStarRule(base,"a","day",new Date("2026-11-11T16:00:00Z"))?.id).toBe("one");
  expect(activeStarRule(base,"a","week",new Date("2026-11-15T15:59:59Z"))).toBeUndefined();
  expect(activeStarRule(base,"a","week",new Date("2026-11-15T16:00:00Z"))?.id).toBe("one");
 });
 it("selects immutable revisions and keeps sibling rules separate",()=>{
  const d={...base,star_rule_versions:[r,{...r,id:"two",revision:2,streak_enabled:false,effective_day:"2026-11-14"}]};
  expect(latestStarRule(d,"a")?.id).toBe("two");expect(latestStarRule(d,"b")).toBeUndefined();
  expect(activeStarRule(d,"a","day",new Date("2026-11-13T00:00:00Z"))?.id).toBe("one");
 });
 it("counts gross deductions including reversed ones and the prior 24 hours",()=>{
  const d={...base,star_adjustments:[{child_id:"a",kind:"deduction",amount:-2,created_at:"2026-11-11T15:00:00Z"},{child_id:"a",kind:"reversal",amount:2,created_at:"2026-11-11T16:00:00Z"},{child_id:"b",kind:"deduction",amount:-3,created_at:"2026-11-11T16:00:00Z"}]} as unknown as Dashboard;
  expect(starDeductionRemaining(d,"a",new Date("2026-11-12T10:00:00Z"))).toBe(1);
  expect(starDeductionRemaining(d,"a",new Date("2026-11-12T15:01:00Z"))).toBe(3);
 });
});


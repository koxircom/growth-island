import {describe,it,expect} from "vitest";
import {deviceScheduleReason} from "./device-schedule";
describe("device schedules",()=>{
 const rules={schedule_enabled:true,schedules:[{enabled:true,days:[1],start:"18:00",end:"20:00"}]};
 const at=(s:string)=>Date.parse(s);
 it("allows exact start, rejects exact end in family timezone",()=>{
 expect(deviceScheduleReason(rules,"Asia/Shanghai",at("2026-11-16T10:00:00Z"))).toBe("");
 expect(deviceScheduleReason(rules,"Asia/Shanghai",at("2026-11-16T12:00:00Z"))).not.toBe("");
 });
 it("keeps empty or disabled windows locked",()=>{
 expect(deviceScheduleReason({...rules,schedules:[]},"UTC",Date.now())).not.toBe("");
 expect(deviceScheduleReason({schedule_enabled:false},"UTC",null)).toBe("");
 });
 it("supports overnight windows tied to start weekday",()=>{
 const d={schedule_enabled:true,schedules:[{enabled:true,days:[7],start:"23:00",end:"01:00"}]};
 expect(deviceScheduleReason(d,"Asia/Shanghai",at("2026-11-15T16:30:00Z"))).toBe("");
 expect(deviceScheduleReason(d,"Asia/Shanghai",at("2026-11-15T17:00:00Z"))).not.toBe("");
 });
});

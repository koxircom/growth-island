import {describe,it,expect} from "vitest";
import {usageChoices,usageRemaining,usageExtensionChoices,usageCooldownRemaining,usageExtensionsLeft} from "./time-wallet";
import type {DeviceUsage} from "./model";
describe("time wallet display",()=>{
 const usage={status:"running",deadline_at:"2026-11-11T10:01:00Z"} as DeviceUsage;
 it("uses only calibrated server time and caps overdue at zero",()=>{
  expect(usageRemaining(usage,null)).toBe(null);
  expect(usageRemaining(usage,Date.parse("2026-11-11T10:00:29.500Z"))).toBe(31);
  expect(usageRemaining(usage,Date.parse("2026-11-11T11:00:00Z"))).toBe(0);
  expect(usageRemaining({...usage,status:"stopped"},null)).toBe(0);
 });
 it("allows leftover seconds and never offers more than available or maximum",()=>{
  expect(usageChoices(0)).toEqual([]);expect(usageChoices(25)).toEqual([25]);
  expect(usageChoices(350)).toEqual([60,300,350]);
  expect(usageChoices(99999).at(-1)).toBe(10800);
  expect(new Set(usageChoices(900)).size).toBe(usageChoices(900).length);
 });
});

it("caps extensions by both approved balance and original reservation total",()=>{
 expect(usageExtensionChoices(500,10775)).toEqual([25]);
 expect(usageExtensionChoices(500,10800)).toEqual([]);
 expect(usageExtensionChoices(0,60)).toEqual([]);
 expect(usageExtensionChoices(350,60)).toEqual([60,300,350]);
});

it("isolates cooldown by child/device and uses session snapshot, not local wall clock",()=>{
 const end="2026-11-12T10:00:00Z",now=Date.parse(end);
 const u={child_id:"a",device_id:"console",status:"stopped",ended_at:end,cooldown_seconds:900} as DeviceUsage;
 expect(usageCooldownRemaining([u],"a","console",now)).toBe(900);
 expect(usageCooldownRemaining([u],"b","console",now)).toBe(0);
 expect(usageCooldownRemaining([u],"a","other",now)).toBe(0);
 expect(usageCooldownRemaining([u],"a","console",null)).toBe(null);
 expect(usageCooldownRemaining([u],"a","console",now+900000)).toBe(0);
 expect(usageCooldownRemaining([{...u,cooldown_seconds:0}],"a","console",now)).toBe(0);
});
it("caps new extension count and retains legacy session policy",()=>{
 const u={max_extensions:1,extension_count:0} as DeviceUsage;
 expect(usageExtensionsLeft(u)).toBe(1);
 expect(usageExtensionsLeft({...u,extension_count:1})).toBe(0);
 expect(usageExtensionsLeft({...u,extension_count:3})).toBe(0);
 expect(usageExtensionsLeft({} as DeviceUsage)).toBe(10800);
});

import type {DeviceUsage} from "./model";
export function usageRemaining(usage: DeviceUsage, serverNow: number | null) {
 if (usage.status !== "running") return 0;
 if (serverNow === null || !Number.isFinite(serverNow)) return null;
 return Math.max(0,Math.ceil((Date.parse(usage.deadline_at)-serverNow)/1000));
}
export function usageChoices(available: number) {
 const seconds=Math.max(0,Math.floor(available));
 return [...new Set([60,300,600,900,1800,3600,Math.min(seconds,10800)].filter(n=>n>0&&n<=seconds))].sort((a,b)=>a-b);
}

export function usageExtensionChoices(available:number,reserved:number) {
 return usageChoices(Math.min(available,Math.max(0,10800-reserved)));
}

/** Cooldowns belong to each child's ended session, never to a sibling's wallet. */
export function usageCooldownRemaining(usages: DeviceUsage[], childId: string, deviceId: string, now: number | null): number | null {
 if (now === null || !Number.isFinite(now)) return null;
 const until = usages.filter(u=>u.child_id===childId&&u.device_id===deviceId&&u.status!=='running'&&u.ended_at)
  .reduce((latest,u)=>Math.max(latest,Date.parse(u.ended_at!)+Number(u.cooldown_seconds||0)*1000),0);
 return Math.max(0,Math.ceil((until-now)/1000));
}
export function usageExtensionsLeft(usage: DeviceUsage): number {
 return Math.max(0,Number(usage.max_extensions??10800)-Number(usage.extension_count||0));
}

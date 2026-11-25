import type {FamilyDevice} from "./model";
/** Advisory UI only; PostgreSQL enforces the actual timezone-aware deadline. */
export function deviceScheduleReason(device:Pick<FamilyDevice,"schedule_enabled"|"schedules">,timezone:string,now:number|null):string {
 if(!device.schedule_enabled)return "";
 if(now===null)return "正在校准时间，稍等一下哦。";
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const get=(type:string)=>parts.find(p=>p.type===type)?.value||"";
 const day=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(get("weekday"))+1;
 const minute=Number(get("hour"))*60+Number(get("minute"));
 const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
 const allowed=(device.schedules||[]).some(s=>{
  if(!s.enabled)return false;
  const start=minutes(s.start),end=minutes(s.end);
  return end>start?s.days.includes(day)&&minute>=start&&minute<end:
   end<start&&((s.days.includes(day)&&minute>=start)||(s.days.includes(day===1?7:day-1)&&minute<end));
 });
 return allowed?"":"现在不在允许使用的时段内，兑换的时间会保留，等约定时间再开始哦。";
}

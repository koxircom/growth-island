import {type Dashboard,localDay,offsetDay,weekday} from "./model";
export type StarRule={id:string;epoch_id:string;revision:number;child_id:string;timezone:string;effective_day:string;effective_week:string;deduction_limit:number;streak_enabled:boolean;savings_enabled:boolean;habit_ids:string[];created_at:string};
export type StarTransition={id:string;child_id:string;old_epoch:string;new_epoch:string;old_timezone:string;new_timezone:string;old_day_end:string;old_week_end:string;new_day_start:string;new_week_start:string;created_at:string};
export type StarAdjustment={id:string;child_id:string;kind:"deduction"|"streak"|"savings"|"reversal";amount:number;reason:string;related_id:string|null;rule_id:string|null;period_day:string;timezone:string;habit_id:string|null;detail:Record<string,unknown>;created_at:string};
export type StarSettlement={id:number;child_id:string;kind:"day"|"week";period_day:string;rule_id:string|null;detail:Record<string,unknown>;created_at:string};
export function latestStarRule(data:Dashboard,childId:string){return (data.star_rule_versions||[]).filter(r=>r.child_id===childId).sort((a,b)=>Number(b.revision)-Number(a.revision))[0];}
export function activeStarRule(data:Dashboard,childId:string,kind:"day"|"week",now:Date){
 return (data.star_rule_versions||[]).filter(r=>r.child_id===childId&&!(data.star_rule_transitions||[]).some(t=>t.old_epoch===r.epoch_id&&Date.parse(t.created_at)<=now.getTime())&&(kind==="day"?r.effective_day:r.effective_week)<=localDay(r.timezone,now)).sort((a,b)=>Number(b.revision)-Number(a.revision))[0];
}
export function starDeductionRemaining(data:Dashboard,childId:string,now:Date){
 const rule=latestStarRule(data,childId),tz=rule?.timezone||data.family.timezone,day=localDay(tz,now);
 const used=(data.star_adjustments||[]).filter(a=>a.child_id===childId&&a.kind==="deduction"&&(localDay(tz,new Date(a.created_at))>=day||Date.parse(a.created_at)>now.getTime()-86400000)).reduce((n,a)=>n-a.amount,0);
 return Math.max(0,(rule?.deduction_limit||3)-used);
}
export const starKindLabel={deduction:"约定调整",streak:"连续奖励",savings:"存星奖励",reversal:"撤销调整"};


export function starTimezonePreview(data:Dashboard,newTimezone:string,now:Date){
 try{
  const day=localDay(newTimezone,now),nextDay=offsetDay(day,1),nextWeek=offsetDay(day,8-(weekday(day)||7));
  return data.children.flatMap(child=>{
   const rule=latestStarRule(data,child.id);if(!rule)return [];
   const oldDay=localDay(rule.timezone,now),oldWeek=offsetDay(oldDay,1-(weekday(oldDay)||7));
   const transitions=(data.star_rule_transitions||[]).filter(t=>t.child_id===child.id);
   return [{child,day:[nextDay,offsetDay(oldDay,1),...transitions.map(t=>offsetDay(t.old_day_end,1))].sort().at(-1)!,
    week:[nextWeek,offsetDay(oldWeek,7),...transitions.map(t=>offsetDay(t.old_week_end,7))].sort().at(-1)!}];
  });
 }catch{return null;}
}

import type { Habit } from "./model";
export type HabitRule = Pick<Habit,"category"|"name"|"icon"|"color"|"weekdays"|"target_count"|"target_minutes"|"stars"|"requires_approval"|"active">;
export function habitRuleFingerprint(h: HabitRule): string {
 return JSON.stringify([h.name,h.icon,h.color,[...h.weekdays].sort((a,b)=>a-b),h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active,h.category||"routine"]);
}
export function habitRule(h: HabitRule): HabitRule {
 return {category:h.category||"routine",name:h.name,icon:h.icon,color:h.color,weekdays:[...h.weekdays],target_count:h.target_count,target_minutes:h.target_minutes,stars:h.stars,requires_approval:h.requires_approval,active:h.active};
}
export type HabitGroup = { key:string; rule:HabitRule; habits:Habit[] };
/** Visual grouping only. Never merges database IDs or children's history. Duplicate same-child rules remain separate. */
export function groupHabits(habits: Habit[]): HabitGroup[] {
 const result:HabitGroup[]=[];
 for(const h of habits.filter(h=>!h.archived_at)) {
   const fingerprint=habitRuleFingerprint(h);
   let group=result.find(g=>habitRuleFingerprint(g.rule)===fingerprint&&!g.habits.some(x=>x.child_id===h.child_id));
   if(!group){group={key:h.id,rule:habitRule(h),habits:[]};result.push(group);}
   group.habits.push(h);
 }
 return result;
}
export function rangeSelection<T>(ordered:T[], selected:T[], anchor:T|null, target:T, shift:boolean, checked:boolean):T[]{
 const a=anchor===null?-1:ordered.indexOf(anchor),b=ordered.indexOf(target);
 const range=shift&&a>=0&&b>=0?ordered.slice(Math.min(a,b),Math.max(a,b)+1):[target];
 const set=new Set(selected);for(const id of range)checked?set.add(id):set.delete(id);
 return ordered.filter(id=>set.has(id));
}

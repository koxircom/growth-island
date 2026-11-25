import type{Habit}from './model';import{habitRule,habitRuleFingerprint,type HabitRule}from './habit-rule-groups';
export function audienceOperations(groups:ReadonlyArray<ReadonlyArray<Habit>>,children:string[],patch:Partial<HabitRule>){
 const operations:{action:string;payload:Record<string,unknown>}[]=[];
 const seenIds=new Set<string>();
 for(const habits of groups){
  if(!habits.length||new Set(habits.map(h=>h.child_id)).size!==habits.length)throw new Error("invalid audience group");
  for(const h of habits){if(h.archived_at||seenIds.has(h.id))throw new Error("invalid audience target");seenIds.add(h.id); }
  for(const h of habits){const p={...patch,active:children.includes(h.child_id)?(patch.active??true):false};operations.push({action:'habit_batch_patch',payload:{targets:[{id:h.id,child_id:h.child_id,expected:habitRuleFingerprint(h)}],patch:p}})}
  const additions=[...new Set(children)].filter(id=>!habits.some(h=>h.child_id===id));
  if(additions.length)operations.push({action:'habit_batch_save',payload:{targets:additions.map(child_id=>({child_id})),rule:{...habitRule(habits[0]),...patch,active:patch.active??true}}});
 }return operations;
}

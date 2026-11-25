import type {Habit} from './model';
import {groupHabits,type HabitGroup} from './habit-rule-groups';
/** Enablement belongs to each child's chip, not to the visual rule grouping. */
export function displayHabitGroups(habits:Habit[]):HabitGroup[]{
 const original=new Map(habits.map(h=>[h.id,h]));
 return groupHabits(habits.map(h=>({...h,active:true}))).map(g=>({...g,habits:g.habits.map(h=>original.get(h.id)!)}));
}
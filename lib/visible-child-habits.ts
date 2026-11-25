import { habitCategory, habitsAt, scheduled, visibleHabits, type Dashboard } from "./model";

/** Select list rows inside the child page's existing non-rest-day branch. */
export function visibleChildHabits(data: Dashboard, childId: string, day: string) {
  const habits = data.habit_versions ? habitsAt(data, day) : visibleHabits(data.habits);
  return habits.filter(h =>
    h.child_id === childId &&
    (habitCategory(h) === "occasional" ? h.active : scheduled(h, day))
  );
}

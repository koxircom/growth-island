import { deepStrictEqual, strictEqual } from "node:assert";
import { it as test } from "vitest";
import { progress, scheduled, type Dashboard, type Habit, type HabitVersion } from "./model";
import { visibleChildHabits } from "./visible-child-habits";

const child = "fixture-child";
const monday = "2026-11-23", tuesday = "2026-11-24";
// Same habit, version and selected dates as task-27's singleMonday/singleTuesday.
const occasional: Habit = {
  id: "偶尔甲", name: "偶尔甲", child_id: child, icon: "book", color: "#008866",
  category: "occasional", weekdays: [1], active: true, archived_at: null,
  target_count: 1, target_minutes: 0, stars: 1, requires_approval: false,
};
const routine: Habit = { ...occasional, id: "日常甲", name: "日常甲", category: "routine" };
const version = (h: Habit, change: Partial<HabitVersion> = {}): HabitVersion =>
  ({ ...h, habit_id: h.id, effective_day: "2026-11-16", archived: false, ...change });
function dashboard(habits: Habit[], habit_versions?: HabitVersion[]): Dashboard {
  return { family: { id: "f", name: "fixture", timezone: "Asia/Shanghai" }, children: [],
    habits, habit_versions, checkins: [], timers: [], rewards: [], redemptions: [],
    rests: [], star_balances: {} };
}
const ids = (d: Dashboard, day: string, childId = child) =>
  visibleChildHabits(d, childId, day).map(h => h.id);

test("Monday-only occasional is visible Tuesday, its check-in schedule stays false", () => {
  const d = dashboard([occasional], [version(occasional)]);
  deepStrictEqual(ids(d, tuesday), [occasional.id]);
  deepStrictEqual(ids(d, monday), [occasional.id]);
  strictEqual(scheduled(occasional, tuesday), false);
});

test("Monday routine stays hidden Tuesday, seven-day routine stays visible", () => {
  const daily = { ...routine, id: "daily", weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const d = dashboard([routine, daily], [version(routine), version(daily)]);
  deepStrictEqual(ids(d, monday), [routine.id, daily.id]);
  deepStrictEqual(ids(d, tuesday), [daily.id]);
});

test("inactive and not-yet-effective occasional versions stay hidden", () => {
  const d = dashboard([occasional], [version(occasional, { effective_day: tuesday })]);
  deepStrictEqual(ids(d, monday), []);
  deepStrictEqual(ids(d, tuesday), [occasional.id]);
  deepStrictEqual(ids(dashboard([occasional], []), tuesday), []);
  const paused = dashboard([occasional], [version(occasional, { active: false })]);
  deepStrictEqual(ids(paused, monday), []);
});

test("archive applies from its effective day and legacy archive stays hidden", () => {
  const archived = { ...occasional, archived_at: tuesday + "T00:00:00Z" };
  const d = dashboard([archived], [version(occasional), version(archived, {
    effective_day: tuesday, archived: true,
  })]);
  deepStrictEqual(ids(d, monday), [occasional.id]);
  deepStrictEqual(ids(d, tuesday), []);
  const legacy = { ...occasional, archived_at: "2026-11-22T00:00:00Z" };
  deepStrictEqual(ids(dashboard([legacy]), monday), []);
  deepStrictEqual(ids(dashboard([occasional]), tuesday), [occasional.id]);
});

test("switching children selects only that child's occasional rows", () => {
  const other = { ...occasional, id: "other-habit", child_id: "other-child" };
  const d = dashboard([occasional, other], [version(occasional), version(other)]);
  deepStrictEqual(ids(d, tuesday), [occasional.id]);
  deepStrictEqual(ids(d, tuesday, other.child_id), [other.id]);
});

test("occasional completion contributes zero to daily goal done and total", () => {
  const d = dashboard([occasional, routine], [version(occasional), version(routine)]);
  d.checkins.push({ id: "check", child_id: child, habit_id: occasional.id,
    day: monday, status: "approved", stars: 1 });
  deepStrictEqual(progress(d, child, monday), { done: 0, total: 1, rate: 0, rest: false });
  deepStrictEqual(ids(d, tuesday), [occasional.id]);
  deepStrictEqual(progress(d, child, tuesday), { done: 0, total: 0, rate: 0, rest: false });
});

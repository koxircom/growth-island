import { describe, it, expect } from "vitest";
import {
  localDay,
  offsetDay,
  scheduled,
  elapsed,
  progress,
  habitsAt,
  type Dashboard,
  type Habit,
  type Timer,
} from "./model";
const h: Habit = {
  id: "h",
  child_id: "a",
  name: "read",
  icon: "book",
  color: "#aaa",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  target_count: 1,
  target_minutes: 0,
  stars: 1,
  requires_approval: false,
  active: true,
};
const base = {
  family: { id: "f", name: "family", timezone: "Asia/Shanghai" },
  children: [],
  habits: [h],
  checkins: [],
  timers: [],
  rewards: [],
  redemptions: [],
  rests: [],
  star_balances: [],
} satisfies Dashboard;
describe("family calculations", () => {
  it("uses UTC+8 date and month rollover", () => {
    expect(localDay("Asia/Shanghai", new Date("2026-11-10T18:00:00Z"))).toBe(
      "2026-11-11",
    );
    expect(offsetDay("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("uses ISO Sunday 7", () => {
    expect(scheduled({ ...h, weekdays: [7] }, "2026-11-15")).toBe(true);
  });
  it("does not mix children or pending records", () => {
    const d = {
      ...base,
      checkins: [
        {
          id: "c",
          child_id: "a",
          habit_id: "h",
          day: "2026-11-11",
          status: "pending",
          stars: 1,
        },
      ],
    };
    expect(progress(d, "a", "2026-11-11").done).toBe(0);
    expect(progress(d, "b", "2026-11-11").total).toBe(0);
  });
  it("excludes rest days", () => {
    expect(
      progress(
        { ...base, rests: [{ id: "r", child_id: "a", day: "2026-11-11" }] },
        "a",
        "2026-11-11",
      ),
    ).toMatchObject({ total: 0, rest: true });
  });
  it("preserves previous habit targets", () => {
    const d = {
      ...base,
      habit_versions: [
        {
          ...h,
          id: "v1",
          habit_id: "h",
          effective_day: "2026-11-01",
          archived: false,
        },
        {
          ...h,
          id: "v2",
          habit_id: "h",
          effective_day: "2026-11-11",
          target_count: 3,
          archived: false,
        },
      ],
    };
    expect(progress(d, "a", "2026-11-10").total).toBe(1);
    expect(progress(d, "a", "2026-11-11").total).toBe(3);
    expect(habitsAt(d, "2026-10-01")).toHaveLength(0);
  });
  it("derives elapsed from persisted timestamps across reload", () => {
    const t = {
      started_at: "2026-11-11T00:00:00Z",
      paused_at: null,
      ended_at: null,
      paused_seconds: 10,
    } as Timer;
    expect(elapsed(t, Date.parse("2026-11-11T00:02:00Z"))).toBe(110);
    expect(
      elapsed({ ...t, paused_at: "2026-11-11T00:01:00Z" }, Date.now()),
    ).toBe(50);
  });
});

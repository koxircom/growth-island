import {describe, expect, it} from "vitest";
import {
  effectiveEarnedStarBreakdown,
  SAVINGS_BAR_COLOR,
  STREAK_BAR_COLOR,
} from "./earned-stars";
import type {Dashboard} from "./model";

const day = "2026-11-28";
const ts = (isoDay: string, hourUtc = "04:00:00Z") => `${isoDay}T${hourUtc}`;

const baseDashboard = {
  family: {id: "fam-1", name: "测试家庭", timezone: "Asia/Shanghai"},
  children: [
    {id: "a", nickname: "老大", avatar: "bear", color: "#40a99a", weekday_minutes: 0, weekend_minutes: 0},
    {id: "b", nickname: "老二", avatar: "rabbit", color: "#f28b73", weekday_minutes: 0, weekend_minutes: 0},
  ],
  habits: [
    {
      id: "h-read",
      child_id: "a",
      name: "自主阅读",
      icon: "book",
      color: "#40a99a",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      target_count: 1,
      target_minutes: 15,
      stars: 3,
      requires_approval: false,
      active: true,
    },
    {
      id: "h-sleep",
      child_id: "a",
      name: "独立一个人睡觉",
      icon: "sleep",
      color: "#40a99a",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      target_count: 1,
      target_minutes: 0,
      stars: 1,
      requires_approval: false,
      active: true,
    },
  ],
  checkins: [
    {id: "c1", child_id: "a", habit_id: "h-read", day: "2026-11-28", status: "approved", stars: 3},
    {id: "c2", child_id: "a", habit_id: "h-sleep", day: "2026-11-28", status: "approved", stars: 1},
    {id: "c3", child_id: "a", habit_id: "h-read", day: "2026-11-27", status: "undone", stars: 3},
  ],
  manual_star_grants: [
    {id: "g1", child_id: "a", amount: 5, reason: "主动帮妈妈收拾", created_at: ts("2026-11-28"), reversed_at: null},
    {id: "g2", child_id: "a", amount: 4, reason: "误加撤销", created_at: ts("2026-11-28"), reversed_at: ts("2026-11-28")},
  ],
  star_adjustments: [
    {id: "s1", child_id: "a", kind: "streak", amount: 1, reason: "连续完成约定奖励", related_id: null, rule_id: null, period_day: "2026-11-28", timezone: "Asia/Shanghai", habit_id: "h-read", detail: {}, created_at: ts("2026-11-28")},
    {id: "s2", child_id: "a", kind: "streak", amount: 1, reason: "连续完成约定奖励", related_id: null, rule_id: null, period_day: "2026-11-28", timezone: "Asia/Shanghai", habit_id: "h-read", detail: {}, created_at: ts("2026-11-28")},
    {id: "sav1", child_id: "a", kind: "savings", amount: 2, reason: "存星利息", related_id: null, rule_id: null, period_day: "2026-11-28", timezone: "Asia/Shanghai", habit_id: null, detail: {}, created_at: ts("2026-11-28")},
    {id: "sav-rev", child_id: "a", kind: "savings", amount: 9, reason: "被撤销利息", related_id: null, rule_id: null, period_day: "2026-11-28", timezone: "Asia/Shanghai", habit_id: null, detail: {}, created_at: ts("2026-11-28")},
    {id: "rev1", child_id: "a", kind: "reversal", amount: -9, reason: "纠正", related_id: "sav-rev", rule_id: null, period_day: "2026-11-28", timezone: "Asia/Shanghai", habit_id: null, detail: {}, created_at: ts("2026-11-28")},
  ],
  star_ledger: [
    {id: "l1", child_id: "a", amount: 3, source_type: "checkin", source_id: "c1", created_at: ts("2026-11-28"), posting_seq: 1, balance_before: 0, balance_after: 3},
    {id: "l2", child_id: "a", amount: 1, source_type: "checkin", source_id: "c2", created_at: ts("2026-11-28"), posting_seq: 2, balance_before: 3, balance_after: 4},
    {id: "l3", child_id: "a", amount: 5, source_type: "manual_bonus", source_id: "g1", created_at: ts("2026-11-28"), posting_seq: 3, balance_before: 4, balance_after: 9},
    {id: "l4", child_id: "a", amount: 4, source_type: "manual_bonus", source_id: "g2", created_at: ts("2026-11-28"), posting_seq: 4, balance_before: 9, balance_after: 13},
    {id: "l5", child_id: "a", amount: 1, source_type: "star_adjustment", source_id: "s1", created_at: ts("2026-11-28"), posting_seq: 5, balance_before: 13, balance_after: 14},
    {id: "l6", child_id: "a", amount: 1, source_type: "star_adjustment", source_id: "s2", created_at: ts("2026-11-28"), posting_seq: 6, balance_before: 14, balance_after: 15},
    {id: "l7", child_id: "a", amount: 2, source_type: "star_adjustment", source_id: "sav1", created_at: ts("2026-11-28"), posting_seq: 7, balance_before: 15, balance_after: 17},
    {id: "l8", child_id: "a", amount: 9, source_type: "star_adjustment", source_id: "sav-rev", created_at: ts("2026-11-28"), posting_seq: 8, balance_before: 17, balance_after: 26},
    {id: "l9", child_id: "a", amount: 3, source_type: "star_savings", source_id: "direct-sav", created_at: ts("2026-11-27"), posting_seq: 9, balance_before: 26, balance_after: 29},
    {id: "l10", child_id: "a", amount: 2, source_type: "star_streak", source_id: "direct-str", created_at: ts("2026-11-27"), posting_seq: 10, balance_before: 29, balance_after: 31},
    {id: "l11", child_id: "a", amount: 3, source_type: "checkin", source_id: "c3", created_at: ts("2026-11-27"), posting_seq: 11, balance_before: 31, balance_after: 34},
    {id: "l12", child_id: "a", amount: -3, source_type: "undo", source_id: "c3", created_at: ts("2026-11-27"), posting_seq: 12, balance_before: 34, balance_after: 31},
    {id: "l13", child_id: "a", amount: 99, source_type: "refund", source_id: "red-1", created_at: ts("2026-11-28"), posting_seq: 13, balance_before: 31, balance_after: 130},
  ],
  timers: [],
  rewards: [],
  redemptions: [],
  rests: [],
  star_balances: {a: 10, b: 0},
} as unknown as Dashboard;

describe("effectiveEarnedStarBreakdown & shared bonus colors", () => {
  it("separates regular, streak, and savings stars and excludes undone/reversed rows", () => {
    const points = effectiveEarnedStarBreakdown(baseDashboard, "a", day, 2);
    expect(points).toHaveLength(2);

    const prev = points[0];
    expect(prev.day).toBe("2026-11-27");
    expect(prev.regularAmount).toBe(0);
    expect(prev.streakAmount).toBe(2);
    expect(prev.savingsAmount).toBe(3);
    expect(prev.amount).toBe(5);
    expect(prev.items.map((i) => i.sourceType)).toEqual(["savings", "streak"]);

    const curr = points[1];
    expect(curr.day).toBe("2026-11-28");
    expect(curr.checkinAmount).toBe(4);
    expect(curr.manualAmount).toBe(5);
    expect(curr.regularAmount).toBe(9);
    expect(curr.streakAmount).toBe(2);
    expect(curr.savingsAmount).toBe(2);
    expect(curr.amount).toBe(curr.regularAmount + curr.streakAmount + curr.savingsAmount);
    expect(curr.count).toBe(6);

    expect(curr.items).toEqual([
      {category: "savings", sourceType: "savings", label: "存星利息", amount: 2, count: 1},
      {category: "streak", sourceType: "streak", label: "连续奖励 · 自主阅读", amount: 2, count: 2},
      {category: "regular", sourceType: "manual_bonus", label: "家长鼓励：主动帮妈妈收拾", amount: 5, count: 1},
      {category: "regular", sourceType: "checkin", label: "自主阅读", amount: 3, count: 1},
      {category: "regular", sourceType: "checkin", label: "独立一个人睡觉", amount: 1, count: 1},
    ]);
  });

  it("uses fixed shared colors for streak and savings distinct from both children's colors", () => {
    expect(STREAK_BAR_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(SAVINGS_BAR_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(STREAK_BAR_COLOR.toLowerCase()).not.toBe(SAVINGS_BAR_COLOR.toLowerCase());
    expect(STREAK_BAR_COLOR.toLowerCase()).not.toBe("#40a99a");
    expect(STREAK_BAR_COLOR.toLowerCase()).not.toBe("#f28b73");
    expect(SAVINGS_BAR_COLOR.toLowerCase()).not.toBe("#40a99a");
    expect(SAVINGS_BAR_COLOR.toLowerCase()).not.toBe("#f28b73");
  });
});

import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {CHILD_AUDIO, RULE_SAVINGS_TEXT} from "./child-audio-manifest";
import type {Dashboard} from "./model";
import {
  redemptionSavingsImpact,
  SAVINGS_ARRIVED_VOICE,
  SAVINGS_DROP_WARNING_VOICE,
  SAVINGS_VAULT_VOICE,
  savingsAwardForAverage,
  savingsWeekBounds,
  weeklySavingsPreview,
} from "./savings-interest";

describe("savings interest weekly average & tier-drop protection", () => {
  it("computes the 5 savings award tiers accurately at every boundary", () => {
    const cases: [number, number][] = [
      [0, 0],
      [19.9, 0],
      [20, 1],
      [39.9, 1],
      [40, 2],
      [59.9, 2],
      [60, 3],
      [79.9, 3],
      [80, 4],
      [99.9, 4],
      [100, 6],
      [180, 6],
    ];
    for (const [avg, expected] of cases) {
      expect(savingsAwardForAverage(avg)).toBe(expected);
    }
  });

  it("computes Monday..Sunday bounds and next Monday payout day", () => {
    expect(savingsWeekBounds("2026-11-28")).toEqual({
      weekStart: "2026-11-23",
      weekEnd: "2026-11-29",
      payoutDay: "2026-11-30",
      isoDow: 6,
      daysRemaining: 1,
    });
    expect(savingsWeekBounds("2026-11-29").daysRemaining).toBe(0);
  });

  it("projects weekly EOD average, detects recent arrival, and fails closed when ledger is hidden", () => {
    const dashboard = {
      family: {id: "f1", name: "家", timezone: "Asia/Shanghai"},
      children: [{id: "a", nickname: "老大", avatar: "bear", color: "#40a99a", weekday_minutes: 0, weekend_minutes: 0}],
      star_balances: {a: 64},
      star_rule_versions: [
        {
          id: "r1",
          epoch_id: "e1",
          revision: 1,
          child_id: "a",
          timezone: "Asia/Shanghai",
          effective_day: "2026-11-16",
          effective_week: "2026-11-16",
          deduction_limit: 3,
          streak_enabled: true,
          savings_enabled: true,
          habit_ids: [],
          created_at: "2026-11-15T00:00:00Z",
        },
      ],
      star_adjustments: [
        {
          id: "adj-sav",
          child_id: "a",
          kind: "savings",
          amount: 2,
          reason: "整周存星利息",
          related_id: null,
          rule_id: "r1",
          period_day: "2026-11-16",
          timezone: "Asia/Shanghai",
          habit_id: null,
          detail: {},
          created_at: "2026-11-28T02:00:00Z",
        },
      ],
      star_ledger: [
        {id: "l0", child_id: "a", amount: 50, source_type: "manual_bonus", source_id: "g0", created_at: "2026-11-20T04:00:00Z"},
        {id: "l1", child_id: "a", amount: 12, source_type: "checkin", source_id: "c1", created_at: "2026-11-25T04:00:00Z"},
        {id: "l2", child_id: "a", amount: 2, source_type: "star_adjustment", source_id: "adj-sav", created_at: "2026-11-28T02:00:00Z"},
      ],
      habits: [],
      checkins: [],
      timers: [],
      rewards: [],
      redemptions: [],
      rests: [],
    } as unknown as Dashboard;

    const preview = weeklySavingsPreview(dashboard, "a", "2026-11-28");
    expect(preview.visible).toBe(true);
    expect(preview.enabled).toBe(true);
    // Mon 50, Tue 50, Wed 62, Thu 62, Fri 62, Sat 64, Sun 64 => sum 414 / 7 = 59.1
    expect(preview.projectedAverage).toBe(59.1);
    expect(preview.projectedAward).toBe(2);
    expect(preview.nextTier).toEqual({threshold: 60, award: 3});
    expect(preview.recentPayout?.id).toBe("adj-sav");

    const hidden = weeklySavingsPreview(
      {...dashboard, ledger_read_scope: {kind: "locked", child_id: null, channel_id: "x"}},
      "a",
      "2026-11-28",
    );
    expect(hidden.visible).toBe(false);
    expect(hidden.recentPayout).toBeNull();
  });

  it("flags tier-drop impact cleanly on redemption confirmation", () => {
    const dashboard = {
      family: {id: "f1", name: "家", timezone: "Asia/Shanghai"},
      children: [{id: "a", nickname: "老大", avatar: "bear", color: "#40a99a", weekday_minutes: 0, weekend_minutes: 0}],
      star_balances: {a: 62},
      star_rule_versions: [
        {
          id: "r1",
          epoch_id: "e1",
          revision: 1,
          child_id: "a",
          timezone: "Asia/Shanghai",
          effective_day: "2026-11-16",
          effective_week: "2026-11-16",
          deduction_limit: 3,
          streak_enabled: true,
          savings_enabled: true,
          habit_ids: [],
          created_at: "2026-11-15T00:00:00Z",
        },
      ],
      star_adjustments: [],
      star_ledger: [
        {id: "l0", child_id: "a", amount: 62, source_type: "manual_bonus", source_id: "g0", created_at: "2026-11-20T04:00:00Z"},
      ],
      habits: [],
      checkins: [],
      timers: [],
      rewards: [],
      redemptions: [],
      rests: [],
    } as unknown as Dashboard;

    // 62 -> 60 stays in tier 60 (+3/+3)
    expect(redemptionSavingsImpact(dashboard, "a", "2026-11-28", 2).dropsTier).toBe(false);
    // 62 -> 47 crosses 60 threshold on balance (next week drops 3 -> 2)
    const impact = redemptionSavingsImpact(dashboard, "a", "2026-11-28", 15);
    expect(impact.dropsTier).toBe(true);
    expect(impact.afterBalance).toBe(47);
    expect(impact.crossedThreshold).toBe(60);
    expect(impact.lostNextWeek).toBe(1);
  });

  it("ships valid RIFF WAV audio files for all 4 v11 savings voice lines", () => {
    const lines = [RULE_SAVINGS_TEXT, SAVINGS_VAULT_VOICE, SAVINGS_ARRIVED_VOICE, SAVINGS_DROP_WARNING_VOICE];
    for (const line of lines) {
      const url = CHILD_AUDIO[line];
      expect(url).toMatch(/^\/audio\/child-v11\/.*\.wav$/);
      const buf = readFileSync("public" + url);
      expect(buf.subarray(0, 4).toString()).toBe("RIFF");
      expect(buf.length).toBeGreaterThan(30000);
    }
  });
});

import {balanceStarDays} from "./balance-trend";
import {ledgerVisibleForChild} from "./earned-stars";
import {balance, type Dashboard, localDay, offsetDay, weekday} from "./model";
import {serverClock} from "./server-clock";
import {activeStarRule, latestStarRule, type StarAdjustment} from "./star-rules";

export const SAVINGS_TIERS = [
  {threshold: 20, award: 1},
  {threshold: 40, award: 2},
  {threshold: 60, award: 3},
  {threshold: 80, award: 4},
  {threshold: 100, award: 6},
] as const;

export const SAVINGS_VAULT_VOICE =
  "把星星存起来，下周一就能多领存星利息哦！存得越多，长出的小星星越多。";
export const SAVINGS_ARRIVED_VOICE =
  "存星利息到账啦！你好好存住了星星，又长出新的小星星咯！";
export const SAVINGS_DROP_WARNING_VOICE =
  "现在换完星星会变少，下周的存星利息也会少一点哦，要现在换还是等周一领完利息再换呀？";

export function savingsAwardForAverage(avg: number) {
  if (!Number.isFinite(avg)) return 0;
  for (let i = SAVINGS_TIERS.length - 1; i >= 0; i--) {
    if (avg >= SAVINGS_TIERS[i].threshold) return SAVINGS_TIERS[i].award;
  }
  return 0;
}

export function nextSavingsTier(avg: number): {threshold: number; award: number} | null {
  for (const tier of SAVINGS_TIERS) {
    if (avg < tier.threshold) return tier;
  }
  return null;
}

export function savingsWeekBounds(today: string) {
  const isoDow = weekday(today) || 7;
  const weekStart = offsetDay(today, 1 - isoDow);
  const weekEnd = offsetDay(weekStart, 6);
  const payoutDay = offsetDay(weekStart, 7);
  const daysRemaining = 7 - isoDow;
  return {weekStart, weekEnd, payoutDay, isoDow, daysRemaining};
}

export type WeeklySavingsPreview = {
  visible: boolean;
  enabled: boolean;
  effectiveNextWeek: boolean;
  weekStart: string;
  weekEnd: string;
  payoutDay: string;
  daysRemaining: number;
  currentBalance: number;
  projectedAverage: number;
  projectedAward: number;
  nextTier: {threshold: number; award: number} | null;
  recentPayout: StarAdjustment | null;
  dailyBalances: {day: string; balance: number}[];
  reconciled: boolean;
};

export function weeklySavingsPreview(data: Dashboard, childId: string, today: string): WeeklySavingsPreview {
  const {weekStart, weekEnd, payoutDay, daysRemaining} = savingsWeekBounds(today);
  const nowDate = new Date(serverClock.now() ?? Date.parse(`${today}T12:00:00Z`));
  const activeRule = activeStarRule(data, childId, "week", nowDate);
  const latestRule = latestStarRule(data, childId);
  const enabled = Boolean(activeRule?.savings_enabled);
  const effectiveNextWeek = Boolean(!enabled && latestRule?.savings_enabled);
  const currentBalance = balance(data, childId);
  const visible = ledgerVisibleForChild(data.ledger_read_scope, childId);

  const reversedIds = new Set(
    (data.star_adjustments || [])
      .filter((a) => a.child_id === childId && a.kind === "reversal" && a.related_id)
      .map((a) => a.related_id as string),
  );
  const recentCutoff = offsetDay(today, -2);
  const recentPayout = visible
    ? (data.star_adjustments || [])
        .filter(
          (a) =>
            a.child_id === childId &&
            a.kind === "savings" &&
            !reversedIds.has(a.id) &&
            localDay(data.family.timezone, new Date(a.created_at)) >= recentCutoff,
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
    : null;

  if (!visible) {
    return {
      visible: false,
      enabled,
      effectiveNextWeek,
      weekStart,
      weekEnd,
      payoutDay,
      daysRemaining,
      currentBalance,
      projectedAverage: 0,
      projectedAward: 0,
      nextTier: SAVINGS_TIERS[0],
      recentPayout: null,
      dailyBalances: [],
      reconciled: false,
    };
  }

  const trend = balanceStarDays(data, childId, today, 14);
  const trendMap = new Map(trend.points.map((p) => [p.day, p.balance]));
  const reconciled = !trend.reason && (trend.points.length > 0 || trend.empty);

  const dailyBalances: {day: string; balance: number}[] = [];
  for (let i = 0; i < 7; i++) {
    const d = offsetDay(weekStart, i);
    let bal = currentBalance;
    if (d < today && !trend.reason && trendMap.has(d)) {
      bal = trendMap.get(d)!;
    } else if (d < today && trend.empty) {
      bal = 0;
    }
    dailyBalances.push({day: d, balance: bal});
  }

  const sum = dailyBalances.reduce((acc, item) => acc + item.balance, 0);
  const projectedAverage = Math.round((sum / 7) * 10) / 10;
  const projectedAward = savingsAwardForAverage(projectedAverage);
  const nextTier = nextSavingsTier(projectedAverage);

  return {
    visible: true,
    enabled,
    effectiveNextWeek,
    weekStart,
    weekEnd,
    payoutDay,
    daysRemaining,
    currentBalance,
    projectedAverage,
    projectedAward,
    nextTier,
    recentPayout,
    dailyBalances,
    reconciled,
  };
}

export type RedemptionSavingsImpact = {
  dropsTier: boolean;
  beforeBalance: number;
  afterBalance: number;
  beforeAverage: number;
  afterAverage: number;
  beforeAward: number;
  afterAward: number;
  lostThisWeek: number;
  beforeNextWeekAward: number;
  afterNextWeekAward: number;
  lostNextWeek: number;
  crossedThreshold: number | null;
  payoutDay: string;
};

export function redemptionSavingsImpact(
  data: Dashboard,
  childId: string,
  today: string,
  cost: number,
): RedemptionSavingsImpact {
  const preview = weeklySavingsPreview(data, childId, today);
  const afterBalance = Math.max(0, preview.currentBalance - Math.max(0, cost));
  if (!preview.visible || (!preview.enabled && !preview.effectiveNextWeek) || cost <= 0) {
    return {
      dropsTier: false,
      beforeBalance: preview.currentBalance,
      afterBalance,
      beforeAverage: preview.projectedAverage,
      afterAverage: preview.projectedAverage,
      beforeAward: preview.projectedAward,
      afterAward: preview.projectedAward,
      lostThisWeek: 0,
      beforeNextWeekAward: 0,
      afterNextWeekAward: 0,
      lostNextWeek: 0,
      crossedThreshold: null,
      payoutDay: preview.payoutDay,
    };
  }

  const afterSum = preview.dailyBalances.reduce((acc, item) => {
    const bal = item.day >= today ? Math.max(0, item.balance - cost) : item.balance;
    return acc + bal;
  }, 0);
  const afterAverage = Math.round((afterSum / 7) * 10) / 10;
  const afterAward = savingsAwardForAverage(afterAverage);
  const lostThisWeek = preview.enabled ? Math.max(0, preview.projectedAward - afterAward) : 0;

  const beforeNextWeekAward = savingsAwardForAverage(preview.currentBalance);
  const afterNextWeekAward = savingsAwardForAverage(afterBalance);
  const lostNextWeek = Math.max(0, beforeNextWeekAward - afterNextWeekAward);
  const dropsTier = lostThisWeek > 0 || lostNextWeek > 0;

  let crossedThreshold: number | null = null;
  for (let i = SAVINGS_TIERS.length - 1; i >= 0; i--) {
    const threshold = SAVINGS_TIERS[i].threshold;
    const droppedWeek = preview.enabled && preview.projectedAverage >= threshold && afterAverage < threshold;
    const droppedBal = preview.currentBalance >= threshold && afterBalance < threshold;
    if (droppedWeek || droppedBal) {
      crossedThreshold = threshold;
      break;
    }
  }

  return {
    dropsTier,
    beforeBalance: preview.currentBalance,
    afterBalance,
    beforeAverage: preview.projectedAverage,
    afterAverage,
    beforeAward: preview.projectedAward,
    afterAward,
    lostThisWeek,
    beforeNextWeekAward,
    afterNextWeekAward,
    lostNextWeek,
    crossedThreshold,
    payoutDay: preview.payoutDay,
  };
}

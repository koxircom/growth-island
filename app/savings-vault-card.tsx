"use client";

import {Sparkles, Star} from "lucide-react";
import type {Child, Dashboard} from "@/lib/model";
import {
  SAVINGS_ARRIVED_VOICE,
  SAVINGS_TIERS,
  SAVINGS_VAULT_VOICE,
  weeklySavingsPreview,
} from "@/lib/savings-interest";
import {RuleSpeaker} from "./rule-speaker";

export function SavingsVaultCard({
  data,
  child,
  today,
  compact = false,
}: {
  data: Dashboard;
  child: Child;
  today: string;
  compact?: boolean;
}) {
  const preview = weeklySavingsPreview(data, child.id, today);
  if (!preview.enabled && !preview.effectiveNextWeek && !preview.recentPayout) return null;

  const badgeText =
    preview.effectiveNextWeek && !preview.enabled
      ? "下周一生效"
      : preview.daysRemaining === 0
        ? `明早周一 预计 +${preview.projectedAward} 星`
        : `${preview.payoutDay.slice(5)} 周一 预计 +${preview.projectedAward} 星`;

  return (
    <section className={`panel savings-vault-card${compact ? " is-compact" : ""}`} aria-label={`${child.nickname}的存星小金库`}>
      <div className="savings-vault-head">
        <div className="savings-vault-title">
          <Sparkles size={18} aria-hidden="true" />
          <strong>存星小金库</strong>
          <RuleSpeaker label="存星小金库" text={SAVINGS_VAULT_VOICE} />
        </div>
        <span className="savings-vault-badge">{badgeText}</span>
      </div>

      {!preview.visible ? (
        <p className="small">解锁后可查看本周存星利息进度。</p>
      ) : (
        <>
          {preview.recentPayout && (
            <div className="savings-arrived-banner" role="status">
              <div className="savings-arrived-copy">
                <Star size={16} fill="currentColor" aria-hidden="true" />
                <span>
                  <strong>存星利息已到账：+{preview.recentPayout.amount} 颗星</strong>
                  {preview.recentPayout.reason ? ` · ${preview.recentPayout.reason}` : ""}
                </span>
              </div>
              <RuleSpeaker label="存星利息到账" text={SAVINGS_ARRIVED_VOICE} />
            </div>
          )}

          <p className="savings-vault-metrics">
            本周日均余额 <strong>{preview.projectedAverage}</strong> 星 · 当前{" "}
            <strong>{preview.currentBalance}</strong> 星 · 发息日 {preview.payoutDay.slice(5)}（周一）
          </p>

          <div className="savings-tiers" aria-label="存星利息档位">
            {SAVINGS_TIERS.map((tier) => {
              const reached = preview.projectedAverage >= tier.threshold;
              return (
                <div
                  key={tier.threshold}
                  className={`savings-tier${reached ? " is-reached" : ""}`}
                >
                  <span>{tier.threshold}星</span>
                  <strong>+{tier.award}</strong>
                </div>
              );
            })}
          </div>

          <p className="small savings-vault-tip">
            {preview.effectiveNextWeek && !preview.enabled
              ? `新规则将从下周一（${preview.payoutDay.slice(5)}）起开始累计本周日均利息。`
              : preview.daysRemaining === 0
                ? preview.projectedAward > 0
                  ? `今晚保持当前星星，明早周一就能领到 +${preview.projectedAward} 颗存星利息！`
                  : `今晚或下周攒到日均 ${SAVINGS_TIERS[0].threshold} 星以上，周一就能开始领利息哦！`
                : preview.nextTier
                  ? `继续攒星，本周日均达到 ${preview.nextTier.threshold} 星可领 +${preview.nextTier.award} 颗存星利息！`
                  : "太棒啦！已达到最高档，下周一可领满 +6 颗存星利息！"}
          </p>
        </>
      )}
    </section>
  );
}

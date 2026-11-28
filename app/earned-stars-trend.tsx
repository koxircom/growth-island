"use client";

import {useId, useMemo, useRef, useState} from "react";
import {type Child, type Dashboard, formatTimezoneLabel} from "@/lib/model";
import {
  effectiveEarnedStarBreakdown,
  SAVINGS_BAR_COLOR,
  STREAK_BAR_COLOR,
  type EarnedStarCategory,
  type EarnedStarDayBreakdown,
} from "@/lib/earned-stars";

type SegmentSlice = {
  category: EarnedStarCategory;
  color: string;
  height: number;
};

function chartChildren(data: Dashboard, child: Child) {
  const seen = new Set<string>();
  return [...data.children, child].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sharedEarnedDomain(data: Dashboard, child: Child, today: string, days: number) {
  const maximum = Math.max(
    0,
    ...chartChildren(data, child).flatMap((item) =>
      effectiveEarnedStarBreakdown(data, item.id, today, days).map((point) => Number(point.amount) || 0),
    ),
  );
  const top = Math.max(4, Math.ceil(maximum / 4) * 4);
  return {bottom: 0, top, step: top / 4};
}

function dayLabel(point: EarnedStarDayBreakdown | undefined, fallback: string) {
  return point?.day || fallback;
}

function segmentColor(category: EarnedStarCategory, regularColor: string) {
  if (category === "savings") return SAVINGS_BAR_COLOR;
  if (category === "streak") return STREAK_BAR_COLOR;
  return regularColor;
}

/** Stack bottom->top (regular -> streak -> savings) while keeping bonus caps clearly visible. */
function computeBarSegments(
  point: EarnedStarDayBreakdown,
  totalH: number,
  regularColor: string,
): SegmentSlice[] {
  const rawEntries: {category: EarnedStarCategory; amount: number; minHeight: number}[] = [];
  if (point.regularAmount > 0) rawEntries.push({category: "regular", amount: point.regularAmount, minHeight: 1});
  if (point.streakAmount > 0) rawEntries.push({category: "streak", amount: point.streakAmount, minHeight: 3.5});
  if (point.savingsAmount > 0) rawEntries.push({category: "savings", amount: point.savingsAmount, minHeight: 3.5});
  if (!rawEntries.length || point.amount <= 0) return [];

  const minCap = totalH / rawEntries.length;
  let remainingH = totalH;
  const preliminary = rawEntries.map((entry) => {
    const proportional = (entry.amount / point.amount) * totalH;
    const minH = Math.min(entry.minHeight, minCap);
    return {
      category: entry.category,
      proportional,
      clampedToMin: proportional < minH,
      height: proportional < minH ? minH : proportional,
    };
  });

  const fixedSum = preliminary.filter((s) => s.clampedToMin).reduce((sum, s) => sum + s.height, 0);
  const flexSum = preliminary.filter((s) => !s.clampedToMin).reduce((sum, s) => sum + s.proportional, 0);
  remainingH = Math.max(0, totalH - fixedSum);

  return preliminary.map((s) => ({
    category: s.category,
    color: segmentColor(s.category, regularColor),
    height: s.clampedToMin ? s.height : flexSum > 0 ? (s.proportional / flexSum) * remainingH : 0,
  }));
}

function pointSummaryText(point: EarnedStarDayBreakdown) {
  if (point.amount <= 0) return `${point.day}：无加星记录`;
  const parts: string[] = [];
  if (point.regularAmount > 0) parts.push(`日常/鼓励 +${point.regularAmount}`);
  if (point.streakAmount > 0) parts.push(`连续奖励 +${point.streakAmount}`);
  if (point.savingsAmount > 0) parts.push(`存星利息 +${point.savingsAmount}`);
  const detail = point.items
    .map((item) => `${item.label}${item.count > 1 ? `×${item.count}` : ""} +${item.amount}`)
    .join("、");
  return `${point.day}：获得 ${point.amount} 星（${parts.join("，")}）${detail ? `｜${detail}` : ""}`;
}

export function EarnedStarsTrend({data, child, today, days = 30}: {data: Dashboard; child: Child; today: string; days?: number}) {
  const count = Math.max(1, Math.floor(days));
  const regularColor = child.color || "#377b67";
  const points = useMemo(
    () => effectiveEarnedStarBreakdown(data, child.id, today, count),
    [data, child.id, today, count],
  );
  const domain = useMemo(
    () => sharedEarnedDomain(data, child, today, count),
    [data, child, today, count],
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const touchHandled = useRef(false);
  const clipPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const chartTop = 26;
  const chartHeight = 104;
  const chartBaseline = chartTop + chartHeight;
  const chartLeft = 40;
  const chartWidth = 300;
  const pointCount = Math.max(1, points.length);
  const slotWidth = chartWidth / pointCount;
  const x = (index: number) => chartLeft + (index + 0.5) * slotWidth;
  const y = (value: number) => chartBaseline - ((Math.max(0, value) - domain.bottom) / (domain.top - domain.bottom)) * chartHeight;
  const barWidth = Math.max(1, Math.min(28, slotWidth - 2));

  const latest = points[points.length - 1];
  const firstDay = dayLabel(points[0], today);
  const lastDay = dayLabel(latest, today);
  const activeIndex = hoveredIndex ?? pinnedIndex;
  const activePoint = activeIndex !== null ? points[activeIndex] ?? null : null;
  const inspectedPoint = activePoint ?? latest;

  function indexFromClientX(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * 360;
    if (svgX < chartLeft - 6 || svgX > chartLeft + chartWidth + 6) return null;
    const raw = Math.floor(((svgX - chartLeft) / chartWidth) * pointCount);
    return Math.max(0, Math.min(pointCount - 1, raw));
  }

  function handleTouch(clientX: number) {
    const idx = indexFromClientX(clientX);
    if (idx === null) return;
    touchHandled.current = true;
    setHoveredIndex(null);
    setPinnedIndex(idx);
  }

  return (
    <section className="panel trend-panel earned-trend">
      <h3>近 {count} 天每日获得星星</h3>
      <p className="small">按家庭时区 {formatTimezoneLabel(data.family.timezone)} 统计实际到账且未撤销的收获；撤销冲回原入账日，历史补卡在批准到账日计入。待审批、兑换和退款不计入，不是余额。</p>
      <div className="earned-legend" aria-label="柱状图颜色说明">
        <span><i className="earned-swatch" style={{background: regularColor}} />日常 / 鼓励</span>
        <span><i className="earned-swatch" style={{background: STREAK_BAR_COLOR}} />连续奖励</span>
        <span><i className="earned-swatch" style={{background: SAVINGS_BAR_COLOR}} />存星利息</span>
      </div>
      <div
        className="earned-trend-chart"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 360 160"
          role="img"
          aria-label={`${child.nickname}每日获得星星柱图，纵轴单位星`}
          onTouchStart={(e) => {
            if (e.touches[0]) handleTouch(e.touches[0].clientX);
          }}
          onTouchMove={(e) => {
            if (e.touches[0]) handleTouch(e.touches[0].clientX);
          }}
        >
          <title>{child.nickname}近 {count} 天每日获得星星</title>
          <defs>
            {points.map((point, index) => {
              const value = Math.max(0, Number(point.amount) || 0);
              if (value <= 0) return null;
              const top = y(value);
              const totalH = Math.max(2, chartBaseline - top);
              const barY = chartBaseline - totalH;
              return (
                <clipPath key={point.day} id={`${clipPrefix}-bar-${index}`}>
                  <rect x={x(index) - barWidth / 2} y={barY} width={barWidth} height={totalH} rx="2" />
                </clipPath>
              );
            })}
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = domain.step * tick;
            return (
              <g key={tick}>
                <line x1="40" x2="340" y1={y(value)} y2={y(value)} stroke="#e4ebe5" strokeDasharray="4 5" />
                <text x="32" y={y(value) + 4} textAnchor="end" fontSize="11" fill="#52665b">{value}</text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const value = Math.max(0, Number(point.amount) || 0);
            const isSelected = activeIndex === index;
            const colX = chartLeft + index * slotWidth;
            const barX = x(index) - barWidth / 2;
            const totalH = value > 0 ? Math.max(2, chartBaseline - y(value)) : 0;
            const segments = value > 0 ? computeBarSegments(point, totalH, regularColor) : [];
            let cursorY = chartBaseline;

            return (
              <g
                key={point.day}
                className="earned-bar-group"
                tabIndex={0}
                role="button"
                aria-label={pointSummaryText(point)}
                aria-pressed={pinnedIndex === index}
                onMouseEnter={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                onClick={() => {
                  if (touchHandled.current) {
                    touchHandled.current = false;
                    return;
                  }
                  setPinnedIndex((cur) => (cur === index ? null : index));
                }}
              >
                <title>{pointSummaryText(point)}</title>
                <rect
                  className="earned-bar-hit"
                  x={colX}
                  y={chartTop}
                  width={slotWidth}
                  height={chartHeight}
                  rx="2.5"
                  fill={isSelected ? "rgba(55, 123, 103, 0.11)" : "transparent"}
                />
                {value > 0 && (
                  <g clipPath={`url(#${clipPrefix}-bar-${index})`}>
                    {segments.map((seg, segIdx) => {
                      cursorY -= seg.height;
                      const segTop = cursorY;
                      const hasNextAbove = segIdx < segments.length - 1;
                      return (
                        <g key={seg.category}>
                          <rect x={barX} y={segTop} width={barWidth} height={seg.height + 0.3} fill={seg.color} />
                          {hasNextAbove && (
                            <line
                              x1={barX}
                              x2={barX + barWidth}
                              y1={segTop}
                              y2={segTop}
                              stroke="#ffffff"
                              strokeWidth="0.9"
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}
          <text x="40" y="152" fontSize="11">{firstDay.slice(5)}</text>
          <text x="340" y="152" textAnchor="end" fontSize="11">{lastDay.slice(5)}</text>
        </svg>

        {activePoint && activeIndex !== null && (
          <div
            className="earned-tooltip"
            style={{left: `${Math.min(76, Math.max(24, (x(activeIndex) / 360) * 100))}%`}}
            aria-hidden="true"
          >
            <div className="earned-tooltip-head">
              <strong>{activePoint.day}</strong>
              <span>{activePoint.amount > 0 ? `+${activePoint.amount} 星（${activePoint.count} 笔）` : "无加星记录"}</span>
            </div>
            {activePoint.amount > 0 && (
              <>
                <div className="earned-tooltip-tags">
                  {activePoint.regularAmount > 0 && (
                    <span><i className="earned-swatch" style={{background: regularColor}} />日常/鼓励 +{activePoint.regularAmount}</span>
                  )}
                  {activePoint.streakAmount > 0 && (
                    <span><i className="earned-swatch" style={{background: STREAK_BAR_COLOR}} />连续奖励 +{activePoint.streakAmount}</span>
                  )}
                  {activePoint.savingsAmount > 0 && (
                    <span><i className="earned-swatch" style={{background: SAVINGS_BAR_COLOR}} />存星利息 +{activePoint.savingsAmount}</span>
                  )}
                </div>
                <ul className="earned-tooltip-items">
                  {activePoint.items.slice(0, 6).map((item) => (
                    <li key={`${item.sourceType}-${item.label}`}>
                      <span className="earned-tooltip-label">
                        <i className="earned-swatch" style={{background: segmentColor(item.category, regularColor)}} />
                        {item.label}{item.count > 1 ? ` ×${item.count}` : ""}
                      </span>
                      <strong>+{item.amount} 星</strong>
                    </li>
                  ))}
                  {activePoint.items.length > 6 && (
                    <li className="earned-tooltip-more">另有 {activePoint.items.length - 6} 项明细…</li>
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="earned-status-card" role="status">
        <div className="earned-status-head">
          <p>
            <strong>{inspectedPoint?.day || today} · 获得 {inspectedPoint?.amount || 0} 星</strong> · {inspectedPoint?.count || 0} 笔有效奖励
          </p>
          {pinnedIndex !== null ? (
            <button type="button" className="text-button earned-reset-btn" onClick={() => setPinnedIndex(null)}>
              回到今天
            </button>
          ) : (
            <span className="earned-hint">悬停或轻触柱子看明细</span>
          )}
        </div>
        {inspectedPoint && inspectedPoint.amount > 0 && (
          <>
            <div className="earned-detail-chips">
              {inspectedPoint.regularAmount > 0 && (
                <span><i className="earned-swatch" style={{background: regularColor}} />日常/鼓励 +{inspectedPoint.regularAmount} 星</span>
              )}
              {inspectedPoint.streakAmount > 0 && (
                <span><i className="earned-swatch" style={{background: STREAK_BAR_COLOR}} />连续奖励 +{inspectedPoint.streakAmount} 星</span>
              )}
              {inspectedPoint.savingsAmount > 0 && (
                <span><i className="earned-swatch" style={{background: SAVINGS_BAR_COLOR}} />存星利息 +{inspectedPoint.savingsAmount} 星</span>
              )}
            </div>
            <ul className="earned-detail-list">
              {inspectedPoint.items.map((item) => (
                <li key={`${item.sourceType}-${item.label}`}>
                  <i className="earned-swatch" style={{background: segmentColor(item.category, regularColor)}} />
                  <span>{item.label}{item.count > 1 ? ` ×${item.count}` : ""}</span>
                  <strong>+{item.amount} 星</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {!points.some((point) => point.amount > 0) && <p className="history-empty">这段时间没有获得星星的入账记录。</p>}
      <details>
        <summary>查看每日数据</summary>
        <div className="stats-table-scroll">
          <table>
            <caption>{child.nickname}每日获得星星</caption>
            <thead><tr><th>日期</th><th>合计</th><th>日常/鼓励</th><th>连续奖励</th><th>存星利息</th><th>笔数</th></tr></thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.day}>
                  <td>{point.day}</td>
                  <td>{point.amount}</td>
                  <td>{point.regularAmount}</td>
                  <td>{point.streakAmount}</td>
                  <td>{point.savingsAmount}</td>
                  <td>{point.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

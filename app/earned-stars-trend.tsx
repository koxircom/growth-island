"use client";

import {useMemo} from "react";
import type {Child, Dashboard} from "@/lib/model";
import {effectiveEarnedStarDays} from "@/lib/earned-stars";

type EarnedPoint = ReturnType<typeof effectiveEarnedStarDays>[number];

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
      effectiveEarnedStarDays(data, item.id, today, days).map((point) => Number(point.amount) || 0),
    ),
  );
  const top = Math.max(4, Math.ceil(maximum / 4) * 4);
  return {bottom: 0, top, step: top / 4};
}

function dayLabel(point: EarnedPoint | undefined, fallback: string) {
  return point?.day || fallback;
}

export function EarnedStarsTrend({data, child, today, days = 30}: {data: Dashboard; child: Child; today: string; days?: number}) {
  const count = Math.max(1, Math.floor(days));
  const points = useMemo(
    () => effectiveEarnedStarDays(data, child.id, today, count),
    [data, child.id, today, count],
  );
  const domain = useMemo(
    () => sharedEarnedDomain(data, child, today, count),
    [data, child, today, count],
  );
  const chartTop = 26;
  const chartHeight = 104;
  const chartLeft = 40;
  const chartWidth = 300;
  const pointCount = Math.max(1, points.length);
  const x = (index: number) => chartLeft + ((index + 0.5) * chartWidth) / pointCount;
  const y = (value: number) => chartTop + chartHeight - ((Math.max(0, value) - domain.bottom) / (domain.top - domain.bottom)) * chartHeight;
  const barWidth = Math.max(1, Math.min(28, chartWidth / pointCount - 2));
  const latest = points[points.length - 1];
  const firstDay = dayLabel(points[0], today);
  const lastDay = dayLabel(latest, today);

  return (
    <section className="panel trend-panel earned-trend">
      <h3>近 {count} 天每日获得星星</h3>
      <p className="small">按家庭时区 {data.family.timezone} 统计实际到账且未撤销的收获；撤销冲回原入账日，历史补卡在批准到账日计入。待审批、兑换和退款不计入，不是余额。</p>
      <svg viewBox="0 0 360 160" role="img" aria-label={`${child.nickname}每日获得星星柱图，纵轴单位星`}>
        <title>{child.nickname}近 {count} 天每日获得星星</title>
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
          const top = y(value);
          return (
            <rect key={point.day} x={x(index) - barWidth / 2} y={top} width={barWidth} height={Math.max(0, chartTop + chartHeight - top)} rx="2" fill={child.color || "#377b67"}>
              <title>{point.day}：获得 {value} 星，{point.count} 笔有效奖励</title>
            </rect>
          );
        })}
        <text x="40" y="152" fontSize="11">{firstDay.slice(5)}</text>
        <text x="340" y="152" textAnchor="end" fontSize="11">{lastDay.slice(5)}</text>
      </svg>
      <p role="status"><strong>{lastDay} · 获得 {latest?.amount || 0} 星</strong> · {latest?.count || 0} 笔有效奖励</p>
      {!points.some((point) => point.amount > 0) && <p className="history-empty">这段时间没有获得星星的入账记录。</p>}
      <details>
        <summary>查看每日数据</summary>
        <div className="stats-table-scroll">
          <table>
            <caption>{child.nickname}每日获得星星</caption>
            <thead><tr><th>日期</th><th>获得星星</th><th>笔数</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.amount}</td><td>{point.count}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

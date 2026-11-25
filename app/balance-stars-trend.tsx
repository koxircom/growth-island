"use client";

import {useMemo} from "react";
import type {Child, Dashboard} from "@/lib/model";
import {balanceStarDays} from "@/lib/balance-trend";

function chartChildren(data: Dashboard, child: Child) {
  const seen = new Set<string>();
  return [...data.children, child].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sharedBalanceDomain(data: Dashboard, child: Child, today: string, days: number) {
  const values = chartChildren(data, child).flatMap((item) => {
    const result = balanceStarDays(data, item.id, today, days);
    if (result.reason || result.empty) return [];
    return result.points.map((point) => Number(point.balance)).filter(Number.isFinite);
  });
  if (!values.length) return {bottom: 0, top: 4, step: 1};
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const step = Math.max(1, Math.ceil((high - low) / 4));
  const bottom = Math.floor(low / step) * step;
  const top = bottom + step * 4;
  return {bottom, top, step};
}

export function BalanceStarsTrend({data, child, today, days = 30}: {data: Dashboard; child: Child; today: string; days?: number}) {
  const count = Math.max(1, Math.floor(days));
  const result = useMemo(
    () => balanceStarDays(data, child.id, today, count),
    [data, child.id, today, count],
  );
  const domain = useMemo(
    () => sharedBalanceDomain(data, child, today, count),
    [data, child, today, count],
  );
  const chartTop = 26;
  const chartHeight = 104;
  const chartLeft = 40;
  const chartWidth = 300;
  const pointCount = Math.max(1, result.points.length);
  const x = (index: number) => chartLeft + (index * chartWidth) / Math.max(1, pointCount - 1);
  const span = Math.max(1, domain.top - domain.bottom);
  const y = (value: number) => chartTop + chartHeight - ((value - domain.bottom) / span) * chartHeight;
  const firstDay = result.points[0]?.day || today;
  const lastPoint = result.points[result.points.length - 1];
  const unavailable = result.reason || (result.empty ? "缺少可信历史流水，暂不推算余额走势。" : "");

  return (
    <section className="panel trend-panel balance-trend">
      <h3>近 {count} 天星星余额累计走势</h3>
      <p className="small">按家庭时区的星星流水核对每日结束余额；扣星、兑换、退款和补发均按服务器流水纳入。没有可信历史流水时不倒算余额。</p>
      {unavailable ? (
        <p role="status" className="notice">{unavailable}</p>
      ) : (
        <>
          <svg viewBox="0 0 360 160" role="img" aria-label={`${child.nickname}星星余额累计折线，纵轴单位星`}>
            <title>{child.nickname}近 {count} 天星星余额累计走势</title>
            {[0, 1, 2, 3, 4].map((tick) => {
              const value = domain.bottom + domain.step * tick;
              return (
                <g key={tick}>
                  <line x1="40" x2="340" y1={y(value)} y2={y(value)} stroke="#e4ebe5" strokeDasharray="4 5" />
                  <text x="32" y={y(value) + 4} textAnchor="end" fontSize="11" fill="#52665b">{Number(value.toFixed(1))}</text>
                </g>
              );
            })}
            <polyline fill="none" stroke={child.color || "#377b67"} strokeWidth="3" strokeLinejoin="round" points={result.points.map((point, index) => `${x(index)},${y(point.balance)}`).join(" ")} />
            {result.points.map((point, index) => (
              <g key={point.day}>
                <circle cx={x(index)} cy={y(point.balance)} r="2.5" fill={child.color || "#377b67"} />
                <title>{point.day}：余额 {point.balance} 星</title>
              </g>
            ))}
            <text x="40" y="152" fontSize="11">{firstDay.slice(5)}</text>
            <text x="340" y="152" textAnchor="end" fontSize="11">{(lastPoint?.day || today).slice(5)}</text>
          </svg>
          <p role="status"><strong>{lastPoint?.day || today} · {lastPoint?.day === today ? "当前" : "日终"}余额 {lastPoint?.balance || 0} 星</strong><br />当日流入 {lastPoint?.income || 0} 星 · 流出 {lastPoint?.expense || 0} 星 · 净变动 {(lastPoint?.delta || 0) > 0 ? "+" : ""}{lastPoint?.delta || 0} 星 · {lastPoint?.count || 0} 笔</p>
          <details>
            <summary>查看每日余额</summary>
            <p className="small">区间开始前余额：{result.opening} 星；由完整历史流水核对。</p>
            <div className="stats-table-scroll">
              <table>
                <caption>{child.nickname}每日星星余额</caption>
                <thead><tr><th>日期</th><th>余额</th><th>净变动</th></tr></thead>
                <tbody>{result.points.map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.balance}</td><td>{point.delta}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

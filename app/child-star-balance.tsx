import React from "react";
import { Star } from "lucide-react";
import { balance, type Dashboard } from "../lib/model";

/** The spendable wallet balance, shared with the reward and child views. */
export function ChildStarBalance({ data, child }: {
  data: Dashboard;
  child: Dashboard["children"][number];
}) {
  const available = balance(data, child.id);
  return <span className="child-star-balance" role="img"
    aria-label={`${child.nickname}的可用星星余额：${available}颗`}
    title={`可用星星：${available}颗`}>
    <Star size={14} aria-hidden="true" />
    <span aria-hidden="true">{available}</span>
  </span>;
}

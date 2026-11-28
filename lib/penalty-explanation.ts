export const PENALTY_INTRO_TEXT =
  "一起遵守约定。如果没做到约定事项，点一下对应的扣星按钮记录哦。";
export const PENALTY_RECORDED_VOICE =
  "已经记录好啦，下次我们一起记住约定哦。";

export function penaltyExplanation(rule: {
  name: string;
  description?: string | null;
  stars: number;
}): string {
  const desc = String(rule.description || "").trim();
  return `${rule.name}，扣${rule.stars}颗星星。${desc}`;
}

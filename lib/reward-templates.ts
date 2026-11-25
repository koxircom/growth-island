/** Suggestions only. No template selection grants device access or writes data. */
export const rewardTemplates = [
  {id:"story",name:"选择今晚读哪一个故事",cost:10},
  {id:"outing",name:"选择周末家庭活动",cost:20},
  {id:"movie",name:"家庭电影夜",cost:20,minutes:30},
  {id:"book",name:"挑一本新书",cost:30},
  {id:"toy",name:"小拼图或小玩具",cost:30},
  {id:"wish",name:"完成一个愿望储蓄目标",cost:40},
  {id:"snack",name:"选择一次特别点心",cost:10},
  {id:"tv",name:"看电视的约定",cost:10,minutes:15},
  {id:"game",name:"玩游戏的约定",cost:10,minutes:15},
] as const;
export function rewardTemplateName(name: string, minutes?: number) {
  if (minutes === undefined) return name;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error("invalid_reward_minutes");
  return `${name}（${minutes}分钟）`;
}

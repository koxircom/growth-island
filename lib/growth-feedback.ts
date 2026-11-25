import type { Checkin } from "./model";

export type GrowthFeedback = { childId: string; pending: boolean; message: string; key: string };
/** Only a newly persisted server record earns feedback. Retries/undo/failures do not. */
export function checkinFeedback(before: Checkin[], after: Checkin[], habitId: unknown, day: unknown): GrowthFeedback | null {
  const ids = new Set(before.map(c => c.id));
  const saved = after.find(c => !ids.has(c.id) && c.habit_id === habitId && c.day === day && (c.status === "approved" || c.status === "pending"));
  if (!saved) return null;
  const pending = saved.status === "pending";
  return { childId: saved.child_id, pending, key: saved.id, message: pending ? "已经记下你的尝试，等家长确认。" : "你完成了自己的一小步，给自己一个小小的赞！" };
}
export function gardenStage(done: number): number { return Math.min(3, Math.max(0, Math.floor(Number.isFinite(done) ? done : 0))); }

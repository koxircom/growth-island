const UNDO_WINDOW_MS = 8_000;

export function redemptionUndoSecondsLeft(createdAt: string, serverNow: number | null): number {
  if (serverNow === null) return 0;
  const remainingMs = Date.parse(createdAt) + UNDO_WINDOW_MS - serverNow;
  return remainingMs > 0 && remainingMs <= UNDO_WINDOW_MS ? Math.ceil(remainingMs / 1000) : 0;
}

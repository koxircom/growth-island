/** The UI accepts whole minutes only; invalid entries must never be silently clamped. */
export function focusDurationSeconds(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const minutes = Number(raw);
  return minutes >= 1 && minutes <= 120 ? minutes * 60 : null;
}

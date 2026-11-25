/** Validate the actual calendar date, not just an input[type=date] hint. */
export function validRecordDate(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  if (value.startsWith("0000-") || value > today) return false;
  const timestamp = Date.parse(value + "T12:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

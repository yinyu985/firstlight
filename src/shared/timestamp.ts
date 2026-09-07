/** Strict calendar-valid ISO timestamp, including exactly three milliseconds. */
export function isEastEightTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00") === value;
}

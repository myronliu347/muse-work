/** 相对时间。单位固定为 m / h / d / mo / y，方便侧栏按同一列宽右对齐。 */
export function formatRelativeActiveAt(
  timestamp: number,
  now = Date.now(),
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diffMs = Math.max(0, now - timestamp);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}d`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo`;
  return `${Math.floor(day / 365)}y`;
}

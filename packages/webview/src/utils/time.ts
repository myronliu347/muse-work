/** 相对时间格式化（侧栏 lastActiveAt、POPO 会话列表等共用）。 */
export function formatRelativeActiveAt(
  timestamp: number,
  now = Date.now(),
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diffMs = Math.max(0, now - timestamp);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}个月前`;
  return `${Math.floor(day / 365)}年前`;
}

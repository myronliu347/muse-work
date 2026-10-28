/**
 * The virtualizer's end-anchor adjustment uses the spacer offset. While the
 * user is following, that offset is short of the visual bottom (container
 * padding and the hints after the spacer). Writing the short offset, then
 * correcting to the visual bottom, is what shakes the scrollbar.
 * A follow adjustment has to land on the visual bottom in the same write.
 */
export function resolveFollowScrollTop(
  requestedTop: number,
  visualMax: number,
  following: boolean,
  adjustment: number,
): number {
  if (following && adjustment !== 0) return Math.max(0, visualMax);
  return requestedTop;
}

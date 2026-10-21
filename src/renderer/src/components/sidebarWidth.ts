/**
 * The side panel splitter's width rules (SidebarSplitter.tsx), kept free of
 * React so tests load them directly. The panel widens toward the office floor:
 * leftward in a left to right window, rightward in Arabic, where it sits on
 * the left.
 */

export interface SplitterLimits { min: number; max: number; viewportWidth: number }

/** How far one arrow key press moves the splitter. */
export const KEY_STEP = 24;

/** The widest the panel may be: its own max, and always 360 px of floor left. */
export function splitterMax({ min, max, viewportWidth }: SplitterLimits): number {
  return Math.min(max, Math.max(min, viewportWidth - 360));
}

function clamp(width: number, limits: SplitterLimits): number {
  return Math.min(splitterMax(limits), Math.max(limits.min, width));
}

/** The width after a drag from `startX` to `x`. */
export function dragWidth(startWidth: number, startX: number, x: number, limits: SplitterLimits, rtl: boolean): number {
  return clamp(startWidth + (rtl ? x - startX : startX - x), limits);
}

/** The width after an arrow key, or undefined for any other key. */
export function keyWidth(key: string, width: number, limits: SplitterLimits, rtl: boolean): number | undefined {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined;
  const towardFloor = rtl ? key === 'ArrowRight' : key === 'ArrowLeft';
  return clamp(width + (towardFloor ? KEY_STEP : -KEY_STEP), limits);
}

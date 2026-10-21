import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useRtl } from '@/i18n/useDirection';
import { dragWidth, keyWidth, splitterMax } from './sidebarWidth';

export interface SidebarSplitterProps {
  /** Current sidebar width in px. */
  width: number;
  /** Called with the new width (already clamped externally). */
  onChange: (px: number) => void;
  /** Containing viewport width — used to clamp delta to a sane max. */
  viewportWidth: number;
  min?: number;
  max?: number;
}

/**
 * Vertical drag handle between the office floor and the side panel. Dragging
 * or an arrow key toward the floor widens the panel; in Arabic the panel is on
 * the left and both directions flip (sidebarWidth.ts).
 */
export function SidebarSplitter({
  width, onChange, viewportWidth, min = 320, max = 1200
}: SidebarSplitterProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const limits = { min, max, viewportWidth };
  const startRef = useRef<{ clientX: number; width: number } | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      onChange(dragWidth(startRef.current.width, startRef.current.clientX, e.clientX, limits, rtl));
    };
    const onUp = () => {
      startRef.current = null;
      setActive(false);
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    if (active) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'ew-resize';
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [active, viewportWidth, min, max, onChange, rtl]);

  const clampMax = splitterMax(limits);

  // The same direction as the drag (sidebarWidth.ts).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = keyWidth(e.key, width, limits, rtl);
    if (next === undefined) return;
    e.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resizeLabel')}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={clampMax}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        startRef.current = { clientX: e.clientX, width };
        setActive(true);
        e.preventDefault();
      }}
      onDoubleClick={() => onChange(420)}
      title={t('sidebar.resizeTitle')}
      className="cth-splitter"
      style={{
        width: 10,
        cursor: 'ew-resize',
        flexShrink: 0,
        position: 'relative',
        zIndex: 61
      }}
    >
      {/* Invisible until hovered or dragged: a small rounded grip, no stripe
          (design v2; owner, 2026-09-30). */}
      <div className="cth-splitter-grip" style={{
        position: 'absolute',
        top: '50%', left: 3, transform: 'translateY(-50%)',
        width: 4, height: 36, borderRadius: 2,
        background: active ? 'var(--cth-indigo)' : 'var(--cth-ink-4)',
        opacity: active ? 1 : undefined
      }} />
    </div>
  );
}

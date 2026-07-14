import { useLayoutEffect, useRef } from "react";

/** Props for {@link BottomProgressBar}. */
export interface BottomProgressBarProps {
  /** Left-aligned bold label (e.g. the current phase). */
  label: string;
  /** Completion percentage, 0–100 (clamped). */
  pct: number;
  /** Right-aligned primary figure (e.g. `"12 / 340"`). */
  detail?: string;
  /** Optional muted text shown before `detail` (e.g. throughput / ETA). */
  hint?: string;
  /** Optional truncated sub-line under the bar (e.g. current item). */
  current?: string | null;
  /** Reports the live pixel height (0 on unmount) so other bottom-anchored
   *  overlays can stack above this bar. */
  onHeightChange?: (h: number) => void;
  /** Distance from the bottom in px — set to another bar's height to stack. */
  bottomOffset?: number;
}

/**
 * A slim, determinate progress bar pinned to the bottom of the content area.
 * Purely presentational and feature-agnostic — the scan pipeline and the face
 * indexer both render it. Position it inside a `relative` container (e.g. the
 * app shell's `<main>`).
 */
export function BottomProgressBar({
  label,
  pct,
  detail,
  hint,
  current,
  onHeightChange,
  bottomOffset = 0,
}: BottomProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // Report height after every render; the setter should no-op when unchanged.
  useLayoutEffect(() => {
    if (!onHeightChange) return;
    onHeightChange(barRef.current?.offsetHeight ?? 0);
  });
  useLayoutEffect(() => () => onHeightChange?.(0), [onHeightChange]);

  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute inset-x-0 z-30 animate-fade-in-up"
      style={{ bottom: bottomOffset }}
    >
      <div className="border-t border-border bg-card px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            {hint ? <span>{hint}</span> : null}
            {detail ? <span>{detail}</span> : null}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${clamped}%` }}
          />
        </div>
        {current ? (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{current}</p>
        ) : null}
      </div>
    </div>
  );
}

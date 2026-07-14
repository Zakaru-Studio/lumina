import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** A positioned label/tick on the scrubber track. */
export interface ScrubberMark {
  /** Owning day (`YYYY-MM-DD`) — used only as a React key. */
  date: string;
  /** Displayed text for year marks; empty for month ticks. */
  label: string;
  kind: "year" | "month";
  /** Vertical position as a 0..1 fraction of the full content height. */
  fraction: number;
}

/** Props for {@link TimelineScrubber}. */
export interface TimelineScrubberProps {
  /** Year labels + month ticks, positioned by scroll offset. */
  marks: ScrubberMark[];
  /** Current scroll position as a 0..1 fraction (top of the viewport). */
  scrollFraction: number;
  /** Called when the user drags/clicks the track to a 0..1 fraction. */
  onScrub: (fraction: number) => void;
  /** Human date label ("MMMM yyyy") for a given 0..1 fraction, for the bubble. */
  dateAtFraction: (fraction: number) => string | null;
}

/**
 * A Google-Photos-style timeline scrubber that doubles as the scroll control.
 *
 * The native scrollbar is hidden on the timeline; this wide track (recent at the
 * top → oldest at the bottom) is the visible way to move. Dragging anywhere on
 * it scrolls the timeline proportionally — all the way to the bottom — while a
 * floating bubble shows the month/year under the cursor. Year labels and month
 * ticks are placed at their true scroll offset so the whole span is legible at a
 * glance.
 */
export function TimelineScrubber({
  marks,
  scrollFraction,
  onScrub,
  dateAtFraction,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  /** Convert a pointer Y to a clamped 0..1 fraction of the track. */
  const fractionFromEvent = useCallback((e: ReactPointerEvent): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const f = (e.clientY - rect.top) / Math.max(1, rect.height);
    return Math.min(1, Math.max(0, f));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      trackRef.current?.setPointerCapture(e.pointerId);
      setDragging(true);
      const f = fractionFromEvent(e);
      setHoverFraction(f);
      onScrub(f);
    },
    [fractionFromEvent, onScrub],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const f = fractionFromEvent(e);
      setHoverFraction(f);
      if (dragging) onScrub(f);
    },
    [dragging, fractionFromEvent, onScrub],
  );

  const endDrag = useCallback((e: ReactPointerEvent) => {
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  if (marks.length === 0) return null;

  const bubbleFraction = hoverFraction ?? scrollFraction;
  const bubbleLabel = dateAtFraction(bubbleFraction);
  const showBubble = dragging || hoverFraction !== null;
  const thumbTop = Math.min(1, Math.max(0, scrollFraction)) * 100;

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuenow={Math.round(scrollFraction * 100)}
      className="relative h-full w-16 shrink-0 cursor-pointer touch-none select-none border-l border-border bg-card/30"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={(e) => {
        setHoverFraction(null);
        endDrag(e);
      }}
    >
      {/* Marks (positioned by real scroll offset): every month is a tick, and
          years are labelled discreetly with a slightly longer tick. */}
      {marks.map((m) => (
        <div
          key={`${m.kind}-${m.date}`}
          className="pointer-events-none absolute right-0 flex -translate-y-1/2 items-center justify-end gap-1.5"
          style={{ top: `${m.fraction * 100}%` }}
        >
          {m.kind === "year" && m.label ? (
            <span className="text-[10px] font-medium leading-none tabular-nums text-muted-foreground/80">
              {m.label}
            </span>
          ) : null}
          <span
            className={
              m.kind === "year"
                ? "h-px w-3 bg-muted-foreground/70"
                : "h-px w-2 bg-muted-foreground/45"
            }
          />
        </div>
      ))}

      {/* Current-position thumb */}
      <div
        className="pointer-events-none absolute right-0 h-0.5 w-full -translate-y-1/2 bg-primary/60"
        style={{ top: `${thumbTop}%` }}
      >
        <span className="absolute right-1 top-1/2 h-1.5 w-6 -translate-y-1/2 rounded-full bg-primary" />
      </div>

      {/* Floating date bubble */}
      {showBubble && bubbleLabel ? (
        <div
          className="pointer-events-none absolute right-full z-10 mr-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md"
          style={{ top: `${bubbleFraction * 100}%` }}
        >
          {bubbleLabel}
        </div>
      ) : null}
    </div>
  );
}

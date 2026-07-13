import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { format, parseISO } from "date-fns";

import { cn } from "@/lib/utils";
import type { TimelineSection } from "@/types";

/** Props for {@link TimelineScrubber}. */
export interface TimelineScrubberProps {
  /**
   * Authoritative, newest-first list of dates that actually contain media.
   * Marks are derived only from these — empty dates are never invented.
   */
  sections: TimelineSection[];
  /** Date currently at the top of the viewport (`YYYY-MM-DD`), highlighted. */
  activeDate: string | null;
  /** Jump the viewport to a date (nearest section on click/drag). */
  onJump: (date: string) => void;
}

/** A single month tick, positioned proportionally by section order. */
interface MonthMark {
  /** Representative (newest) section date of the month, `YYYY-MM-DD`. */
  date: string;
  /** Vertical position along the bar, 0 (top) → 1 (bottom). */
  frac: number;
  year: number;
  /** 1-based month. */
  month: number;
  /** True for the newest month of each year (renders the bold year label). */
  yearStart: boolean;
}

/** Clamp a number into the inclusive `[0, 1]` range. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A wide, Google-Photos-style timeline scrubber pinned to the right edge.
 *
 * Sections are distributed **evenly by their order** (not by wall-clock time),
 * which naturally compresses sparse periods just like Google Photos. Each month
 * that holds media gets a tick; each year boundary gets a bold label. Hovering
 * reveals the nearest month/year as a floating pill; clicking or dragging calls
 * {@link TimelineScrubberProps.onJump} with the nearest section's date.
 */
export function TimelineScrubber({ sections, activeDate, onJump }: TimelineScrubberProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hover, setHover] = useState<{ top: number; label: string } | null>(null);

  const count = sections.length;

  /** One tick per month that has media, positioned by section index. */
  const marks = useMemo<MonthMark[]>(() => {
    if (count === 0) return [];
    const out: MonthMark[] = [];
    let lastMonthKey = "";
    let lastYear: number | null = null;
    sections.forEach((section, i) => {
      const monthKey = `${section.year}-${section.month}`;
      if (monthKey === lastMonthKey) return;
      lastMonthKey = monthKey;
      const yearStart = section.year !== lastYear;
      lastYear = section.year;
      out.push({
        date: section.date,
        frac: count === 1 ? 0 : i / (count - 1),
        year: section.year,
        month: section.month,
        yearStart,
      });
    });
    return out;
  }, [sections, count]);

  /** Position (0..1) of the active date among sections, or null. */
  const activeFrac = useMemo<number | null>(() => {
    if (!activeDate) return null;
    const idx = sections.findIndex((s) => s.date === activeDate);
    if (idx < 0) return null;
    return count === 1 ? 0 : idx / (count - 1);
  }, [activeDate, sections, count]);

  const activeMonthKey = useMemo<string | null>(() => {
    if (!activeDate) return null;
    const d = parseISO(activeDate);
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
  }, [activeDate]);

  const activeLabel = useMemo<string | null>(
    () => (activeDate ? format(parseISO(activeDate), "MMMM yyyy") : null),
    [activeDate],
  );

  /** Nearest section for a vertical fraction along the bar. */
  const sectionAtFrac = useCallback(
    (frac: number): TimelineSection | null => {
      if (count === 0) return null;
      const idx = Math.round(clamp01(frac) * (count - 1));
      return sections[Math.min(count - 1, Math.max(0, idx))] ?? null;
    },
    [sections, count],
  );

  /** Resolve the nearest section from a pointer's Y, updating the hover pill. */
  const resolve = useCallback(
    (clientY: number): TimelineSection | null => {
      const bar = barRef.current;
      const track = trackRef.current;
      if (!bar || !track) return null;
      const trackRect = track.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const frac = clamp01((clientY - trackRect.top) / trackRect.height);
      const section = sectionAtFrac(frac);
      if (!section) return null;
      setHover({ top: clientY - barRect.top, label: format(parseISO(section.date), "MMMM yyyy") });
      return section;
    },
    [sectionAtFrac],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (count === 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      const section = resolve(e.clientY);
      if (section) onJump(section.date);
    },
    [count, resolve, onJump],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const section = resolve(e.clientY);
      if (draggingRef.current && section) onJump(section.date);
    },
    [resolve, onJump],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer was already released */
    }
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!draggingRef.current) setHover(null);
  }, []);

  if (count === 0) return null;

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Timeline"
      aria-valuetext={activeLabel ?? undefined}
      className="relative h-full w-16 shrink-0 cursor-pointer touch-none select-none border-l border-border bg-card/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {/* Padded track: marks are positioned proportionally within it. */}
      <div ref={trackRef} className="pointer-events-none absolute inset-x-0 bottom-6 top-6">
        {marks.map((mark) => {
          const active = activeMonthKey === `${mark.year}-${mark.month}`;
          return (
            <div
              key={`${mark.year}-${mark.month}`}
              className="absolute right-2 flex -translate-y-1/2 items-center gap-1.5"
              style={{ top: `${mark.frac * 100}%` }}
            >
              {mark.yearStart ? (
                <span
                  className={cn(
                    "text-[10px] font-semibold tabular-nums leading-none",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {mark.year}
                </span>
              ) : null}
              <span
                className={cn(
                  "h-px rounded-full transition-all",
                  active
                    ? "w-4 bg-primary"
                    : mark.yearStart
                      ? "w-3 bg-muted-foreground/60"
                      : "w-2 bg-muted-foreground/40",
                )}
              />
            </div>
          );
        })}
      </div>

      {/* Persistent active-position pill (hidden while scrubbing/hovering). */}
      {activeFrac !== null && activeLabel && !hover ? (
        <div
          className="pointer-events-none absolute right-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm animate-fade-in"
          style={{ top: `calc(1.5rem + ${activeFrac} * (100% - 3rem))` }}
        >
          {activeLabel}
        </div>
      ) : null}

      {/* Floating hover/drag label, to the left of the bar. */}
      {hover ? (
        <div
          className="pointer-events-none absolute right-full mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-lg"
          style={{ top: hover.top }}
        >
          {hover.label}
        </div>
      ) : null}
    </div>
  );
}

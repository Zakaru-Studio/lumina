import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { EmptyState } from "@/components/common/EmptyState";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoCell } from "@/components/library/PhotoCell";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { TimelineScrubber, type ScrubberMark } from "@/components/library/TimelineScrubber";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbums } from "@/hooks/useAlbums";
import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { usePhotoTimeline } from "@/hooks/usePhotos";
import { usePhotoIds, usePhotoWindow } from "@/hooks/useWindowedPhotos";
import { dateLocale } from "@/lib/format";
import { buildQuery } from "@/lib/query";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import type { Photo, TimelineSection } from "@/types";

/** Gap (px) between cells and rows — matches the library grid rhythm. */
const GAP = 10;
/** Fixed height (px) of a day-header row in the virtualized model. */
const HEADER_H = 52;

/**
 * A day header row: a large date label plus its photo count. Its `globalStart`
 * is the global index of the day's first photo (cumulative section count).
 */
interface HeaderRow {
  type: "header";
  /** `YYYY-MM-DD`, matching the scrubber section date. */
  date: string;
  /** Photos captured on this day. */
  count: number;
}

/**
 * One rendered row of up to `columns` cells within a day. `rowStartGlobal` is
 * the global (takenAt-desc) index of the leftmost cell; `sectionEndGlobal` is
 * the exclusive global index at which this day ends (for the trailing partial
 * row's break condition).
 */
interface PhotosRow {
  type: "photos";
  date: string;
  /** Global index of this row's first (leftmost) photo. */
  rowStartGlobal: number;
  /** Exclusive global index where the owning day's photos end. */
  sectionEndGlobal: number;
}

type TimelineRow = HeaderRow | PhotosRow;

/**
 * Build the flat, virtualizable row model from the authoritative day
 * {@link TimelineSection}s and the current column count.
 *
 * Sections are newest-first with per-day counts; concatenating them in order
 * yields the same sequence as the global takenAt-desc id list, so each day's
 * `globalStart` is the cumulative sum of previous days' counts. For every day we
 * emit one header row followed by `ceil(count / columns)` photo rows, tagging
 * each photo row with the global index of its first cell.
 */
function buildRows(sections: TimelineSection[], columns: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let globalStart = 0;
  for (const section of sections) {
    const sectionEndGlobal = globalStart + section.count;
    rows.push({ type: "header", date: section.date, count: section.count });
    const photoRows = Math.max(1, Math.ceil(section.count / columns));
    for (let r = 0; r < photoRows; r++) {
      rows.push({
        type: "photos",
        date: section.date,
        rowStartGlobal: globalStart + r * columns,
        sectionEndGlobal,
      });
    }
    globalStart = sectionEndGlobal;
  }
  return rows;
}

/**
 * A Google-Photos-style chronological view rendered at the FULL height of the
 * library. The complete day structure (and thus the total scroll height and the
 * scrubber span) comes from {@link usePhotoTimeline}, which returns every day
 * that holds media with its count — no photo details required. Only the photos
 * inside the visible window resolve their details on demand via
 * {@link usePhotoWindow}; every other cell renders a same-size skeleton.
 *
 * Because all days are known up-front, the scrubber can jump anywhere in the
 * entire timeline instantly, and you can scroll continuously to the very bottom
 * of tens of thousands of items with day headers throughout.
 */
export function TimelinePage() {
  const { t } = useTranslation();
  // `sortBy: "timeline"` orders ids by COALESCE(taken_at, imported_at) — the
  // exact key the day sections are grouped by — so the id list and the sections
  // partition photos identically. Plain "takenAt" would sort photos without a
  // taken_at to the end, desyncing the cumulative index mapping in buildRows.
  const timelineQuery = useMemo(() => buildQuery({ sortBy: "timeline", sortDir: "desc" }), []);

  // Authoritative, complete list of days-with-media (newest first) + counts.
  const { data: sections = [], isLoading: sectionsLoading } = usePhotoTimeline({});
  // Full ordered id list (lightweight) + windowed details for the visible range.
  const { data: ids = [] } = usePhotoIds(timelineQuery);
  const win = usePhotoWindow(timelineQuery);

  const { data: albums = [] } = useAlbums();
  const manualAlbums = useMemo(() => albums.filter((a) => a.kind === "manual"), [albums]);

  const cellSize = useUiStore((s) => s.cellSize);
  const [index, setIndex] = useState<number | null>(null);

  useGlobalShortcuts(ids, { onOpen: setIndex, enabled: index === null });

  // --- Selection (ordered by the full id list) ---
  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const selectRange = useSelectionStore((s) => s.selectRange);
  const selected = useSelectionStore((s) => s.selected);

  const handleClick = useCallback(
    (e: MouseEvent, id: string) => {
      if (e.shiftKey) selectRange(id, ids);
      else if (e.ctrlKey || e.metaKey) toggle(id);
      else select(id);
    },
    [ids, select, toggle, selectRange],
  );

  const handleDragStart = useCallback((e: DragEvent, id: string) => {
    const sel = useSelectionStore.getState().selected;
    const dragIds = sel.has(id) && sel.size > 0 ? Array.from(sel) : [id];
    e.dataTransfer.setData("application/x-lumina-ids", JSON.stringify(dragIds));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  // --- Measured layout → column count (like the library grid) ---
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRoRef = useRef<ResizeObserver | null>(null);
  const scrollTickRef = useRef<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // Callback ref for the scroll container: wires the virtualizer's scroll
  // element, tracks the current scroll offset, and observes viewport height.
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    scrollRoRef.current?.disconnect();
    if (!el) {
      scrollRoRef.current = null;
      return;
    }
    setViewportH(el.clientHeight);
    setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    scrollRoRef.current = ro;
  }, []);

  // rAF-throttled scroll tracking so the scrubber thumb stays in sync.
  const onScroll = useCallback(() => {
    if (scrollTickRef.current !== null) return;
    scrollTickRef.current = requestAnimationFrame(() => {
      scrollTickRef.current = null;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  // Callback ref so measurement happens the moment the inner node mounts —
  // which is *after* the loading/empty guards return, not on the first render.
  // A `useEffect([])` would run while the node is still null and never re-run,
  // leaving width=0 → columns=1 (the whole timeline collapsed to one column).
  const innerRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) {
      roRef.current = null;
      return;
    }
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const measured = width > 0;
  const columns = Math.max(1, Math.floor((width + GAP) / (cellSize + GAP)));
  // Actual cell size flexes so each row fills 100% of the content width;
  // `cellSize` (the zoom level) only picks the column count.
  const cell = Math.max(1, (width - (columns - 1) * GAP) / columns);

  // --- Flat row model (headers + photo rows), rebuilt on structure/zoom change ---
  // Held empty until the inner node's width is measured: building it at the
  // provisional 1-column count would allocate one row per photo (tens of
  // thousands) and instantiate the virtualizer at that size, only to rebuild it
  // one frame later at the real column count — wasted work and a 1-column flash.
  const rows = useMemo(
    () => (measured ? buildRows(sections, columns) : []),
    [sections, columns, measured],
  );

  const rowSize = cell + GAP;

  // Pixel offset of each day's header + the total content height. Row sizes are
  // exact (fixed header/photo-row heights), so these match the virtualizer's
  // total size and let the scrubber place marks at their true scroll position.
  const layout = useMemo(() => {
    const offsets: { date: string; offset: number; year: number; month: number }[] = [];
    let y = 0;
    for (const s of sections) {
      offsets.push({ date: s.date, offset: y, year: s.year, month: s.month });
      y += HEADER_H + Math.max(1, Math.ceil(s.count / columns)) * rowSize;
    }
    return { total: Math.max(1, y), offsets };
  }, [sections, columns, rowSize]);

  // Distinct months present (newest-first), each with the pixel offset of its
  // first day. The scrubber lays these out on an EVEN, month-indexed axis (each
  // month gets equal height) so every year stays visible no matter how photo
  // counts are distributed — a single huge day can't collapse the whole ruler.
  const months = useMemo(() => {
    const list: { year: number; month: number; date: string; offset: number }[] = [];
    let lastY: number | null = null;
    let lastM: number | null = null;
    for (const o of layout.offsets) {
      if (o.year !== lastY || o.month !== lastM) {
        list.push({ year: o.year, month: o.month, date: o.date, offset: o.offset });
        lastY = o.year;
        lastM = o.month;
      }
    }
    return list;
  }, [layout]);

  /** End scroll offset of month `i` (start of the next month, or total). */
  const monthEnd = useCallback(
    (i: number) => (i + 1 < months.length ? months[i + 1].offset : layout.total),
    [months, layout.total],
  );

  // Each month owns an EQUAL SEGMENT of the track: month `i` spans the fraction
  // range [i/n, (i+1)/n]. Crucially this uses n *segments* (not n-1 points), so
  // the LAST month spans [(n-1)/n, 1] and dragging to the very bottom reaches
  // the end of the content — the whole gallery is scrollable from the scrubber.
  const marks = useMemo(() => {
    const n = months.length;
    if (n === 0) return [] as ScrubberMark[];
    const tickEvery = Math.max(1, Math.round((n * 6) / Math.max(1, viewportH)));
    const out: ScrubberMark[] = [];
    let lastYear: number | null = null;
    months.forEach((m, i) => {
      const fraction = i / n; // top of month i's segment
      if (m.year !== lastYear) {
        out.push({ date: m.date, label: String(m.year), kind: "year", fraction });
        lastYear = m.year;
      } else if (i % tickEvery === 0) {
        out.push({ date: m.date, label: "", kind: "month", fraction });
      }
    });
    return out;
  }, [months, viewportH]);

  // Thumb position on the segment axis: locate the month the current scroll sits
  // in, interpolate within it, then place it inside that month's [i/n,(i+1)/n].
  const scrollFraction = useMemo(() => {
    const n = months.length;
    if (n === 0) return 0;
    let i = 0;
    for (let k = 0; k < n; k++) {
      if (months[k].offset <= scrollTop) i = k;
      else break;
    }
    const segStart = months[i].offset;
    const segEnd = monthEnd(i);
    const local = segEnd > segStart ? (scrollTop - segStart) / (segEnd - segStart) : 0;
    return Math.min(1, Math.max(0, (i + local) / n));
  }, [months, scrollTop, monthEnd]);

  /** Scroll to a 0..1 fraction of the segment axis (bottom of bar → bottom of content). */
  const onScrub = useCallback(
    (f: number) => {
      const el = scrollRef.current;
      const n = months.length;
      if (!el || n === 0) return;
      const pos = Math.min(n - 1e-6, Math.max(0, f) * n); // f=1 → deep in the last month
      const i = Math.min(n - 1, Math.floor(pos));
      const local = pos - i;
      const segStart = months[i].offset;
      const segEnd = monthEnd(i);
      const target = segStart + local * (segEnd - segStart);
      // Clamp to the REAL scrollable range so f=1 always lands at the true bottom.
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(target, max);
    },
    [months, monthEnd],
  );

  /** Month/year label for a 0..1 fraction of the segment axis. */
  const dateAtFraction = useCallback(
    (f: number): string | null => {
      const n = months.length;
      if (n === 0) return null;
      const i = Math.min(n - 1, Math.max(0, Math.floor(f * n)));
      return format(parseISO(months[i].date), "MMMM yyyy", { locale: dateLocale() });
    },
    [months],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.type === "header" ? HEADER_H : rowSize),
    overscan: 8,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // --- Visible-window loading, driven by the visible rows ---
  const lastRange = useRef<{ start: number; end: number } | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (virtualRows.length === 0) return;

    // Min/max visible GLOBAL photo index across visible photo rows.
    let minGi = Number.POSITIVE_INFINITY;
    let maxGi = -1;
    for (const vr of virtualRows) {
      const row = rows[vr.index];
      if (!row || row.type !== "photos") continue;
      const endGi = Math.min(row.sectionEndGlobal - 1, row.rowStartGlobal + columns - 1);
      if (row.rowStartGlobal < minGi) minGi = row.rowStartGlobal;
      if (endGi > maxGi) maxGi = endGi;
    }
    if (maxGi < 0) return;

    const prev = lastRange.current;
    if (prev && prev.start === minGi && prev.end === maxGi) return;
    lastRange.current = { start: minGi, end: maxGi };
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => win.setRange(minGi, maxGi));
  }, [virtualRows, rows, columns, win]);

  useEffect(
    () => () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    },
    [],
  );

  // --- Loading / empty states ---
  if (sectionsLoading && sections.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Skeleton className="mb-4 h-6 w-48" />
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-6 w-6" />}
        title={t("timelinePage.empty.title")}
        description={t("timelinePage.empty.description")}
      />
    );
  }

  return (
    <div className="flex h-full">
      <div
        ref={setScrollEl}
        onScroll={onScroll}
        className="no-scrollbar min-h-0 flex-1 overflow-y-scroll px-6 py-4"
      >
        <div
          ref={innerRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            if (row.type === "header") {
              return (
                <div
                  key={virtualRow.key}
                  className="absolute inset-x-0 top-0 flex flex-col justify-end pb-2"
                  style={{ height: HEADER_H, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <h2 className="text-lg font-semibold leading-tight text-foreground">
                    {format(parseISO(row.date), "EEEE d MMMM yyyy", { locale: dateLocale() })}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("timelinePage.photoCount", { count: row.count })}
                  </p>
                </div>
              );
            }

            // Photo row: up to `columns` cells starting at `rowStartGlobal`.
            const cells = [];
            for (let col = 0; col < columns; col++) {
              const gi = row.rowStartGlobal + col;
              if (gi >= row.sectionEndGlobal) break;
              const id = ids[gi];
              const photo: Photo | undefined = win.getPhoto(gi);
              cells.push(
                <div key={id ?? gi} style={{ width: cell, height: cell }}>
                  {id && photo ? (
                    <PhotoCell
                      photo={photo}
                      selected={selected.has(id)}
                      onClick={(e) => handleClick(e, id)}
                      onOpen={() => setIndex(gi)}
                      onDragStart={(e) => handleDragStart(e, id)}
                    />
                  ) : (
                    <Skeleton className="h-full w-full rounded-lg" />
                  )}
                </div>,
              );
            }

            return (
              <div
                key={virtualRow.key}
                className="absolute inset-x-0 top-0 flex"
                style={{
                  height: rowSize,
                  transform: `translateY(${virtualRow.start}px)`,
                  gap: GAP,
                }}
              >
                {cells}
              </div>
            );
          })}
        </div>
      </div>

      <TimelineScrubber
        marks={marks}
        scrollFraction={scrollFraction}
        onScrub={onScrub}
        dateAtFraction={dateAtFraction}
      />

      <Lightbox
        ids={ids}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
        getPhoto={win.getPhoto}
      />
      <SelectionToolbar albums={manualAlbums} />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent, WheelEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { PhotoCell } from "@/components/library/PhotoCell";
import { Skeleton } from "@/components/ui/skeleton";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import type { Photo } from "@/types";

const GAP = 13;

/** Props for {@link PhotoGrid}. */
export interface PhotoGridProps {
  /** The FULL ordered id list for the query. `total = ids.length`. */
  ids: string[];
  /** Resolve the loaded detail for a global index (undefined until its window loads). */
  getPhoto: (index: number) => Photo | undefined;
  /** Open the lightbox at the given flat photo index. */
  onOpen: (index: number) => void;
  /** Report the visible global index range (throttled) so the caller can load it. */
  onVisibleRangeChange?: (start: number, end: number) => void;
}

/**
 * A truly windowed photo grid. It row-virtualizes `ceil(ids.length / columns)`
 * rows so the scrollbar represents the WHOLE library — scroll to the very
 * bottom of 40k+ photos and jump anywhere — while only the visible cells resolve
 * their details through {@link getPhoto}. Cells whose details have not loaded yet
 * render a same-size skeleton; ids are always known, so selection, range-select,
 * click and drag work even before a cell's metadata is available.
 *
 * Columns derive from the measured container width and the `cellSize` zoom level.
 * Handles modifier-aware selection, Ctrl+wheel zoom and drag-and-drop. As the
 * viewport moves it reports the visible index range via {@link onVisibleRangeChange}.
 */
export function PhotoGrid({ ids, getPhoto, onOpen, onVisibleRangeChange }: PhotoGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const cellSize = useUiStore((s) => s.cellSize);

  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const selectRange = useSelectionStore((s) => s.selectRange);
  // NB: the current selection Set is deliberately NOT subscribed here — each
  // PhotoCell reads its own `selected.has(id)`, so toggling selection re-renders
  // only the affected cell(s) rather than the whole grid.
  const anchor = useSelectionStore((s) => s.anchor);

  // Measure the container's CONTENT width (excludes padding and the scrollbar)
  // so cells can be sized to fill it exactly.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
      setWidth(Math.max(1, el.clientWidth - padX));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `cellSize` (the zoom level) is the TARGET cell size: it picks the column
  // count, then the actual cell width flexes so every full row fills 100% of the
  // content width — no dead space on the right. The last partial row stays
  // left-aligned with same-size cells.
  const columns = Math.max(1, Math.floor((width + GAP) / (cellSize + GAP)));
  const cell = Math.max(1, (width - (columns - 1) * GAP) / columns);
  const rowCount = Math.ceil(ids.length / columns);
  const rowSize = cell + GAP;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    overscan: 6,
  });

  // The virtualizer estimates every row at `rowSize`, but it memoizes row
  // offsets on the row COUNT — not on the estimate. A window resize that changes
  // the cell size *without* crossing a column-count boundary therefore leaves
  // the cached offsets stale: rows keep their old `translateY` while rendering
  // at the new height, so they overlap. Re-measuring on `rowSize` change bumps
  // the measurement cache so offsets + total size recompute from the current
  // estimate; a layout effect runs it before paint, avoiding a flashed overlap.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowSize, rowVirtualizer]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Keep the keyboard cursor (anchor) visible during arrow navigation.
  useEffect(() => {
    if (!anchor || columns < 1) return;
    const idx = ids.indexOf(anchor);
    if (idx < 0) return;
    rowVirtualizer.scrollToIndex(Math.floor(idx / columns), { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Report the visible global index range so the window hook fetches its pages.
  // Throttled: only fire when the (start,end) actually changed, batched in a rAF.
  const lastRange = useRef<{ start: number; end: number } | null>(null);
  const rafId = useRef<number | null>(null);
  useEffect(() => {
    if (!onVisibleRangeChange || virtualRows.length === 0) return;
    const firstRow = virtualRows[0]!.index;
    const lastRow = virtualRows[virtualRows.length - 1]!.index;
    const start = firstRow * columns;
    const end = Math.min(ids.length - 1, lastRow * columns + columns - 1);
    const prev = lastRange.current;
    if (prev && prev.start === start && prev.end === end) return;
    lastRange.current = { start, end };
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => onVisibleRangeChange(start, end));
  }, [virtualRows, columns, ids.length, onVisibleRangeChange]);

  useEffect(
    () => () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    },
    [],
  );

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

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      useUiStore.getState().zoomBy(-e.deltaY * 0.15);
    }
  }, []);

  if (ids.length === 0) return null;

  return (
    <div ref={parentRef} onWheel={handleWheel} className="h-full w-full overflow-auto px-3 py-3">
      <div style={{ height: rowVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualRows.map((virtualRow) => {
          const rowStart = virtualRow.index * columns;
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 flex w-full"
              style={{
                height: rowSize,
                transform: `translateY(${virtualRow.start}px)`,
                gap: GAP,
              }}
            >
              {Array.from({ length: columns }).map((_, col) => {
                const index = rowStart + col;
                const id = ids[index];
                if (!id) return null;
                const photo = getPhoto(index);
                return (
                  <div key={id} style={{ width: cell, height: cell }}>
                    {photo ? (
                      <PhotoCell
                        photo={photo}
                        index={index}
                        onClick={handleClick}
                        onOpen={onOpen}
                        onDragStart={handleDragStart}
                      />
                    ) : (
                      <Skeleton className="h-full w-full rounded-lg" />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

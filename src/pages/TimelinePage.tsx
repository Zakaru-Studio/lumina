import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { format, fromUnixTime } from "date-fns";
import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoCell } from "@/components/library/PhotoCell";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { TimelineScrubber } from "@/components/library/TimelineScrubber";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbums } from "@/hooks/useAlbums";
import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { flattenPhotos, usePhotoList, usePhotoTimeline } from "@/hooks/usePhotos";
import { buildQuery } from "@/lib/query";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import type { Photo } from "@/types";

/** Best-known capture timestamp (seconds) used for day grouping. */
function photoTime(photo: Photo): number {
  return photo.takenAt ?? photo.fileCreated ?? photo.importedAt;
}

/** A contiguous run of photos captured on the same calendar day. */
interface DayGroup {
  /** `YYYY-MM-DD` — matches the scrubber's section dates and the DOM id. */
  key: string;
  ts: number;
  photos: { photo: Photo; index: number }[];
}

/** Group already-desc-sorted photos into contiguous per-day sections. */
function groupByDay(photos: Photo[]): DayGroup[] {
  const groups: DayGroup[] = [];
  photos.forEach((photo, index) => {
    const ts = photoTime(photo);
    const key = format(fromUnixTime(ts), "yyyy-MM-dd");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.photos.push({ photo, index });
    else groups.push({ key, ts, photos: [{ photo, index }] });
  });
  return groups;
}

/**
 * A Google-Photos-style chronological view: photos grouped by day under sticky
 * headers, with a wide interactive {@link TimelineScrubber} on the right that
 * marks only the dates holding media and lets you hover/click/drag to jump.
 */
export function TimelinePage() {
  const query = useMemo(
    () => buildQuery({ sortBy: "takenAt", sortDir: "desc", limit: 300 }),
    [],
  );
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = usePhotoList(query);
  // Authoritative list of dates that have media — drives the scrubber marks.
  const { data: sections = [] } = usePhotoTimeline({});
  const { data: albums = [] } = useAlbums();
  const manualAlbums = useMemo(() => albums.filter((a) => a.kind === "manual"), [albums]);

  const photos = useMemo(() => flattenPhotos(data?.pages), [data]);
  const order = useMemo(() => photos.map((p) => p.id), [photos]);
  const groups = useMemo(() => groupByDay(photos), [photos]);

  const cellSize = useUiStore((s) => s.cellSize);
  const [index, setIndex] = useState<number | null>(null);

  useGlobalShortcuts(order, { onOpen: setIndex, enabled: index === null });

  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const selectRange = useSelectionStore((s) => s.selectRange);
  const selected = useSelectionStore((s) => s.selected);

  const handleClick = useCallback(
    (e: MouseEvent, id: string) => {
      if (e.shiftKey) selectRange(id, order);
      else if (e.ctrlKey || e.metaKey) toggle(id);
      else select(id);
    },
    [order, select, toggle, selectRange],
  );

  const handleDragStart = useCallback((e: DragEvent, photo: Photo) => {
    const { selected: sel } = useSelectionStore.getState();
    const ids = sel.has(photo.id) && sel.size > 0 ? Array.from(sel) : [photo.id];
    e.dataTransfer.setData("application/x-lumina-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  // --- Active-date tracking (top-most visible day group) ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const rafRef = useRef<number | undefined>(undefined);
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const recomputeActive = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      const container = scrollRef.current;
      if (!container) return;
      const cTop = container.getBoundingClientRect().top;
      let current: string | null = null;
      for (const group of groups) {
        const el = groupRefs.current.get(group.key);
        if (!el) continue;
        if (el.getBoundingClientRect().top - cTop <= 24) current = group.key;
        else break;
      }
      setActiveDate(current ?? groups[0]?.key ?? null);
    });
  }, [groups]);

  // Recompute whenever the set of groups changes (e.g. a page loaded in).
  useEffect(() => {
    recomputeActive();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    };
  }, [recomputeActive]);

  // --- Infinite loading ---
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // --- Jump-to-date (scrubber) ---
  // Keep the latest `hasNextPage` readable inside the async jump loop.
  const hasNextRef = useRef(hasNextPage);
  useEffect(() => {
    hasNextRef.current = hasNextPage;
  }, [hasNextPage]);

  const handleJump = useCallback(
    async (date: string) => {
      // The target day may not be loaded yet — page in until it appears, with
      // a hard attempt cap so a missing id can never spin forever.
      for (let attempt = 0; attempt < 40; attempt++) {
        const el = document.getElementById(`day-${date}`);
        if (el) {
          el.scrollIntoView({ block: "start", behavior: "smooth" });
          return;
        }
        if (!hasNextRef.current) return;
        await fetchNextPage();
      }
    },
    [fetchNextPage],
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Skeleton className="mb-4 h-6 w-40" />
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

  if (photos.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-6 w-6" />}
        title="Nothing on the timeline yet"
        description="Import photos with capture dates and they'll appear here, grouped by day."
      />
    );
  }

  return (
    <div className="flex h-full">
      <div
        ref={scrollRef}
        onScroll={recomputeActive}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        {groups.map((group) => (
          <section
            key={group.key}
            id={`day-${group.key}`}
            data-date={group.key}
            ref={(el) => {
              if (el) groupRefs.current.set(group.key, el);
              else groupRefs.current.delete(group.key);
            }}
            className="mb-8 scroll-mt-2"
          >
            <div className="sticky top-0 z-10 -mx-6 mb-3 bg-background/80 px-6 py-2 backdrop-blur">
              <h2 className="text-lg font-semibold text-foreground">
                {format(fromUnixTime(group.ts), "EEEE, d MMMM yyyy")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {group.photos.length} {group.photos.length === 1 ? "photo" : "photos"}
              </p>
            </div>
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
            >
              {group.photos.map(({ photo, index: flatIndex }) => (
                <div key={photo.id} className="aspect-square">
                  <PhotoCell
                    photo={photo}
                    selected={selected.has(photo.id)}
                    onClick={(e) => handleClick(e, photo.id)}
                    onOpen={() => setIndex(flatIndex)}
                    onDragStart={(e) => handleDragStart(e, photo)}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        <div ref={sentinelRef} className="h-8" />
      </div>

      <TimelineScrubber sections={sections} activeDate={activeDate} onJump={handleJump} />

      <Lightbox
        photos={photos}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
      />
      <SelectionToolbar albums={manualAlbums} />
    </div>
  );
}

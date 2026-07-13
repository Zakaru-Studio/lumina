import { useMemo, useState } from "react";
import { ImageIcon, SearchX } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterBar } from "@/components/library/FilterBar";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbums } from "@/hooks/useAlbums";
import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { flattenPhotos, useLibraryStats, usePhotoList } from "@/hooks/usePhotos";
import { useScanControls } from "@/hooks/useScan";
import { buildQuery } from "@/lib/query";
import { useUiStore } from "@/stores/uiStore";
import type { PhotoQuery } from "@/types";

/** A responsive grid of skeleton cells shown while the first page loads. */
function GridSkeleton() {
  const cellSize = useUiStore((s) => s.cellSize);
  return (
    <div
      className="grid gap-2.5 p-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
    >
      {Array.from({ length: 24 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}

/** True when a query narrows the catalog beyond the default (any active facet). */
function isFiltered(query: PhotoQuery): boolean {
  const f = query.filter;
  return (
    f.isFavorite === true ||
    f.isRaw === true ||
    (f.minRating ?? 0) > 0 ||
    (!!f.colorLabel && f.colorLabel !== "none")
  );
}

/**
 * The main library view: an infinite, virtualized grid of every catalogued
 * photo, with a filter/sort bar, lightbox and bulk-selection toolbar.
 */
export function LibraryPage() {
  const [query, setQuery] = useState<PhotoQuery>(() => buildQuery());
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = usePhotoList(query);
  const { data: albums = [] } = useAlbums();
  useLibraryStats();

  const photos = useMemo(() => flattenPhotos(data?.pages), [data]);
  const order = useMemo(() => photos.map((p) => p.id), [photos]);

  const { importFolders } = useScanControls();
  const [index, setIndex] = useState<number | null>(null);
  useGlobalShortcuts(order, { onOpen: setIndex, enabled: index === null });

  const filtered = isFiltered(query);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border">
        <FilterBar query={query} onChange={setQuery} />
      </div>

      {isLoading ? (
        <GridSkeleton />
      ) : photos.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="No matches"
            description="No photos match the current filters. Try loosening or clearing them."
          />
        ) : (
          <EmptyState
            icon={<ImageIcon className="h-6 w-6" />}
            title="Your library is empty"
            description="Import a folder of photos to get started. Lumina indexes your files in place and never moves or modifies the originals."
            action={<Button onClick={() => importFolders.mutate()}>Import folders…</Button>}
          />
        )
      ) : (
        <div className="min-h-0 flex-1">
          <PhotoGrid
            photos={photos}
            onOpen={setIndex}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        </div>
      )}

      <Lightbox
        photos={photos}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
      />
      <SelectionToolbar albums={albums} />
    </div>
  );
}

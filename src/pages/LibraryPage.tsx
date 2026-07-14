import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, SearchX } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterBar } from "@/components/library/FilterBar";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbums } from "@/hooks/useAlbums";
import { usePhotoBrowser } from "@/hooks/usePhotoBrowser";
import { useLibraryStats } from "@/hooks/usePhotos";
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
    (f.minRating ?? 0) > 0
  );
}

/**
 * The main library view: an infinite, virtualized grid of every catalogued
 * photo, with a filter/sort bar, lightbox and bulk-selection toolbar.
 */
export function LibraryPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState<PhotoQuery>(() => buildQuery());
  // Windowed data + lightbox + grid shortcuts (shared with the search view).
  const browser = usePhotoBrowser(query);
  const ids = browser.ids;
  const { data: albums = [] } = useAlbums();
  useLibraryStats();

  const { importFolders } = useScanControls();

  const filtered = isFiltered(query);
  const loading = browser.windowLoading && ids.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border">
        <FilterBar query={query} onChange={setQuery} />
      </div>

      {loading ? (
        <GridSkeleton />
      ) : ids.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title={t("libraryPage.noMatches.title")}
            description={t("libraryPage.noMatches.description")}
          />
        ) : (
          <EmptyState
            icon={<ImageIcon className="h-6 w-6" />}
            title={t("libraryPage.empty.title")}
            description={t("libraryPage.empty.description")}
            action={<Button onClick={() => importFolders.mutate()}>{t("libraryPage.importFolders")}</Button>}
          />
        )
      ) : (
        <div className="min-h-0 flex-1">
          <PhotoGrid {...browser.grid} />
        </div>
      )}

      <Lightbox {...browser.lightbox} />
      <SelectionToolbar albums={albums} />
    </div>
  );
}

import { ArrowDownWideNarrow, ArrowUpWideNarrow, Aperture, Heart, LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StarRating } from "@/components/common/StarRating";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import type { PhotoQuery, SortBy, SortDir } from "@/types";

/** Five grid cell-size breakpoints (px), smallest → largest, for the size slider. */
const GRID_SIZE_STOPS = [112, 148, 184, 232, 300];

/** Props for {@link FilterBar}. */
export interface FilterBarProps {
  /** The active query whose filter/sort this bar reflects. */
  query: PhotoQuery;
  /** Called with a fresh query on every change (offset reset to 0). */
  onChange: (q: PhotoQuery) => void;
}

/** Sortable columns paired with their i18n label keys. */
const SORT_OPTIONS: { value: SortBy; labelKey: string }[] = [
  { value: "takenAt", labelKey: "filters.sort.takenAt" },
  { value: "importedAt", labelKey: "filters.sort.importedAt" },
  { value: "filename", labelKey: "filters.sort.filename" },
  { value: "rating", labelKey: "filters.sort.rating" },
  { value: "fileSize", labelKey: "filters.sort.fileSize" },
];

/**
 * A compact, airy toolbar for sorting and filtering a photo listing. It is a
 * pure controlled component: every interaction produces a new {@link PhotoQuery}
 * (never mutating the previous one) with `offset` reset so paging restarts.
 */
export function FilterBar({ query, onChange }: FilterBarProps) {
  const { t } = useTranslation();
  const { filter } = query;

  const cellSize = useUiStore((s) => s.cellSize);
  const setCellSize = useUiStore((s) => s.setCellSize);
  // Snap the current cell size to the nearest breakpoint for the slider position.
  const sizeIndex = GRID_SIZE_STOPS.reduce(
    (best, _, i) =>
      Math.abs(GRID_SIZE_STOPS[i] - cellSize) < Math.abs(GRID_SIZE_STOPS[best] - cellSize)
        ? i
        : best,
    0,
  );

  /** Emit a new query with a patched filter, resetting the paging offset. */
  const patchFilter = (patch: Partial<PhotoQuery["filter"]>): void => {
    onChange({ ...query, filter: { ...filter, ...patch }, offset: 0 });
  };

  /** Emit a new query with patched sort settings, resetting the offset. */
  const patchSort = (patch: { sortBy?: SortBy; sortDir?: SortDir }): void => {
    onChange({ ...query, ...patch, offset: 0 });
  };

  const minRating = filter.minRating ?? 0;
  const favoritesActive = filter.isFavorite === true;
  const rawActive = filter.isRaw === true;

  const isFiltered = favoritesActive || rawActive || minRating > 0;

  /** Reset every filter facet (leaving sort untouched). */
  const clearFilters = (): void => {
    onChange({
      ...query,
      filter: {
        ...filter,
        isFavorite: undefined,
        isRaw: undefined,
        minRating: undefined,
      },
      offset: 0,
    });
  };

  return (
    <div className="flex h-auto flex-wrap items-center gap-2 px-3 py-2">
      {/* Sort */}
      <Select value={query.sortBy} onValueChange={(v) => patchSort({ sortBy: v as SortBy })}>
        <SelectTrigger className="h-8 w-[9.5rem] border-transparent bg-transparent shadow-none hover:bg-accent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={query.sortDir === "asc" ? t("filters.ascending") : t("filters.descending")}
        title={query.sortDir === "asc" ? t("filters.ascending") : t("filters.descending")}
        onClick={() => patchSort({ sortDir: query.sortDir === "asc" ? "desc" : "asc" })}
      >
        {query.sortDir === "asc" ? (
          <ArrowUpWideNarrow className="h-4 w-4" />
        ) : (
          <ArrowDownWideNarrow className="h-4 w-4" />
        )}
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Quick filters */}
      <Button
        variant={favoritesActive ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={favoritesActive}
        className="h-8"
        onClick={() => patchFilter({ isFavorite: favoritesActive ? undefined : true })}
      >
        <Heart className={cn("h-4 w-4", favoritesActive && "fill-current text-red-500")} />
        {t("filters.favorites")}
      </Button>

      <Button
        variant={rawActive ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={rawActive}
        className="h-8"
        onClick={() => patchFilter({ isRaw: rawActive ? undefined : true })}
      >
        <Aperture className="h-4 w-4" />
        {t("filters.raw")}
      </Button>

      {/* Min rating: clicking the active value clears it (StarRating -> 0). */}
      <div className="flex items-center gap-1.5 px-1">
        <StarRating
          value={minRating}
          size={15}
          onChange={(v) => patchFilter({ minRating: v > 0 ? v : undefined })}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={clearFilters}
          >
            {t("filters.clear")}
          </Button>
        ) : null}

        {/* Grid cell size: five breakpoints from small to large. */}
        <div className="flex items-center gap-1.5" title={t("filters.gridSize")}>
          <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Slider
            className="w-24"
            min={0}
            max={GRID_SIZE_STOPS.length - 1}
            step={1}
            value={[sizeIndex]}
            onValueChange={(v) => setCellSize(GRID_SIZE_STOPS[v[0]])}
            aria-label={t("filters.gridSize")}
          />
        </div>
      </div>
    </div>
  );
}

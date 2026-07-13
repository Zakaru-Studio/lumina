import { ArrowDownWideNarrow, ArrowUpWideNarrow, Aperture, Heart } from "lucide-react";

import { ColorLabelPicker } from "@/components/common/ColorLabelPicker";
import { StarRating } from "@/components/common/StarRating";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ColorLabel, PhotoQuery, SortBy, SortDir } from "@/types";

/** Props for {@link FilterBar}. */
export interface FilterBarProps {
  /** The active query whose filter/sort this bar reflects. */
  query: PhotoQuery;
  /** Called with a fresh query on every change (offset reset to 0). */
  onChange: (q: PhotoQuery) => void;
}

/** Human labels for the sortable columns. */
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "takenAt", label: "Date taken" },
  { value: "importedAt", label: "Imported" },
  { value: "filename", label: "Name" },
  { value: "rating", label: "Rating" },
  { value: "fileSize", label: "Size" },
];

/**
 * A compact, airy toolbar for sorting and filtering a photo listing. It is a
 * pure controlled component: every interaction produces a new {@link PhotoQuery}
 * (never mutating the previous one) with `offset` reset so paging restarts.
 */
export function FilterBar({ query, onChange }: FilterBarProps) {
  const { filter } = query;

  /** Emit a new query with a patched filter, resetting the paging offset. */
  const patchFilter = (patch: Partial<PhotoQuery["filter"]>): void => {
    onChange({ ...query, filter: { ...filter, ...patch }, offset: 0 });
  };

  /** Emit a new query with patched sort settings, resetting the offset. */
  const patchSort = (patch: { sortBy?: SortBy; sortDir?: SortDir }): void => {
    onChange({ ...query, ...patch, offset: 0 });
  };

  const minRating = filter.minRating ?? 0;
  const colorLabel = (filter.colorLabel ?? "none") as ColorLabel;
  const favoritesActive = filter.isFavorite === true;
  const rawActive = filter.isRaw === true;

  const isFiltered =
    favoritesActive ||
    rawActive ||
    minRating > 0 ||
    colorLabel !== "none";

  /** Reset every filter facet (leaving sort untouched). */
  const clearFilters = (): void => {
    onChange({
      ...query,
      filter: {
        ...filter,
        isFavorite: undefined,
        isRaw: undefined,
        minRating: undefined,
        colorLabel: undefined,
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
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={query.sortDir === "asc" ? "Ascending" : "Descending"}
        title={query.sortDir === "asc" ? "Ascending" : "Descending"}
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
        Favorites
      </Button>

      <Button
        variant={rawActive ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={rawActive}
        className="h-8"
        onClick={() => patchFilter({ isRaw: rawActive ? undefined : true })}
      >
        <Aperture className="h-4 w-4" />
        RAW
      </Button>

      {/* Min rating: clicking the active value clears it (StarRating -> 0). */}
      <div className="flex items-center gap-1.5 px-1">
        <StarRating
          value={minRating}
          size={15}
          onChange={(v) => patchFilter({ minRating: v > 0 ? v : undefined })}
        />
      </div>

      {/* Color label filter */}
      <ColorLabelPicker
        value={colorLabel}
        onChange={(c) => patchFilter({ colorLabel: c === "none" ? undefined : c })}
      />

      {isFiltered ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-muted-foreground"
          onClick={clearFilters}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

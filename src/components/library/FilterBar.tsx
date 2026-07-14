import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, Heart, LayoutGrid, MapPin, Search, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";

import { FaceCrop } from "@/components/people/FaceCrop";
import { FilterCombobox, type ComboOption } from "@/components/library/FilterCombobox";
import { StarRating } from "@/components/common/StarRating";
import { SortControl } from "@/components/library/SortControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useFaceStatus, usePeople } from "@/hooks/useFaces";
import { listPlaces } from "@/lib/api";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import type { PhotoQuery, SortBy, SortDir } from "@/types";

/** Five grid cell-size breakpoints (px), smallest → largest, for the size slider. */
const GRID_SIZE_STOPS = [112, 148, 184, 232, 300];

/** Which single filter surface (if any) is currently expanded. */
type OpenField = "text" | "place" | "person" | null;

/** Props for {@link FilterBar}. */
export interface FilterBarProps {
  /** The active query whose filter/sort this bar reflects. */
  query: PhotoQuery;
  /** Called with a fresh query on every change (offset reset to 0). */
  onChange: (q: PhotoQuery) => void;
}

/**
 * A compact, airy toolbar for sorting and filtering a photo listing. It is a
 * pure controlled component: every interaction produces a new {@link PhotoQuery}
 * (never mutating the previous one) with `offset` reset so paging restarts.
 *
 * At most one of the text / place / person surfaces is expanded at a time
 * (`openField`), so opening or clicking any filter collapses the others.
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

  const [openField, setOpenField] = useState<OpenField>(filter.text ? "text" : null);
  // Auto-expand the text field when a term arrives from outside (e.g. a `?q=`
  // link), detected as an empty → non-empty transition so a manual collapse of a
  // still-applied term isn't undone.
  const prevText = useRef(filter.text ?? "");
  useEffect(() => {
    const cur = filter.text ?? "";
    if (cur && !prevText.current) setOpenField("text");
    prevText.current = cur;
  }, [filter.text]);

  // Read the latest query through a ref so the debounced text field always merges
  // into the current filter (never a stale snapshot).
  const queryRef = useRef(query);
  queryRef.current = query;

  /** Emit a new query with a patched filter, resetting the paging offset. */
  const patchFilter = useCallback(
    (patch: Partial<PhotoQuery["filter"]>): void => {
      const q = queryRef.current;
      onChange({ ...q, filter: { ...q.filter, ...patch }, offset: 0 });
    },
    [onChange],
  );

  /** Emit a new query with patched sort settings, resetting the offset. */
  const patchSort = (patch: { sortBy?: SortBy; sortDir?: SortDir }): void => {
    setOpenField(null);
    onChange({ ...queryRef.current, ...patch, offset: 0 });
  };

  const commitText = useCallback(
    (v: string | null) => patchFilter({ text: v }),
    [patchFilter],
  );

  const minRating = filter.minRating ?? 0;
  const favoritesActive = filter.isFavorite === true;
  const rawActive = filter.isRaw === true;

  const isFiltered =
    favoritesActive ||
    rawActive ||
    minRating > 0 ||
    !!filter.text ||
    !!filter.place ||
    !!filter.personId;

  /** Toggle a discrete (non-expanding) filter, collapsing any open surface. */
  const quickPatch = (patch: Partial<PhotoQuery["filter"]>): void => {
    setOpenField(null);
    patchFilter(patch);
  };

  /** Reset every filter facet (leaving sort untouched). */
  const clearFilters = (): void => {
    setOpenField(null);
    onChange({
      ...query,
      filter: {
        ...filter,
        isFavorite: undefined,
        isRaw: undefined,
        minRating: undefined,
        text: undefined,
        place: undefined,
        personId: undefined,
      },
      offset: 0,
    });
  };

  return (
    <div className="flex h-auto flex-wrap items-center gap-2 px-3 py-2">
      {/* Sort */}
      <SortControl sortBy={query.sortBy} sortDir={query.sortDir} onChange={patchSort} />

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Find: free-text, place and person */}
      <InlineFilterField
        icon={Search}
        value={filter.text ?? null}
        onCommit={commitText}
        placeholder={t("filters.searchPlaceholder")}
        label={t("filters.search")}
        open={openField === "text"}
        onOpenChange={(o) => setOpenField(o ? "text" : null)}
      />
      <PlaceFilter
        value={filter.place ?? null}
        onChange={(p) => patchFilter({ place: p ?? undefined })}
        open={openField === "place"}
        onOpenChange={(o) => setOpenField(o ? "place" : null)}
      />
      <PersonFilter
        selectedId={filter.personId ?? null}
        onSelect={(id) => patchFilter({ personId: id ?? undefined })}
        open={openField === "person"}
        onOpenChange={(o) => setOpenField(o ? "person" : null)}
      />

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Quick filters */}
      <Button
        variant={favoritesActive ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={favoritesActive}
        className="h-8"
        onClick={() => quickPatch({ isFavorite: favoritesActive ? undefined : true })}
      >
        <Heart className={cn("h-4 w-4", favoritesActive && "fill-current text-red-500")} />
        {t("filters.favorites")}
      </Button>

      <Button
        variant={rawActive ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={rawActive}
        className="h-8"
        onClick={() => quickPatch({ isRaw: rawActive ? undefined : true })}
      >
        <Aperture className="h-4 w-4" />
        {t("filters.raw")}
      </Button>

      {/* Min rating: clicking the active value clears it (StarRating -> 0). */}
      <div className="flex items-center gap-1.5 px-1">
        <StarRating
          value={minRating}
          size={15}
          onChange={(v) => quickPatch({ minRating: v > 0 ? v : undefined })}
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

/**
 * An icon button that expands into a debounced text field. `open` is controlled
 * by the toolbar so opening another filter collapses it; typing commits after a
 * short debounce, Escape collapses (keeping the term), and the ✕ clears it.
 */
function InlineFilterField({
  icon: Icon,
  value,
  onCommit,
  placeholder,
  label,
  open,
  onOpenChange,
}: {
  icon: LucideIcon;
  /** The externally-applied value (from the query). */
  value: string | null;
  /** Commit a new value (`null` clears it). Must be referentially stable. */
  onCommit: (value: string | null) => void;
  placeholder: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce local edits into the query; skip when unchanged (incl. on mount).
  useEffect(() => {
    const id = setTimeout(() => {
      const next = text.trim() || null;
      if (next !== (value ?? null)) onCommit(next);
    }, 200);
    return () => clearTimeout(id);
  }, [text, value, onCommit]);

  // Follow external changes (seed from a `?q=` link, or a global clear).
  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        variant={value ? "secondary" : "ghost"}
        size="icon"
        className="h-8 w-8"
        aria-label={label}
        title={label}
        onClick={() => onOpenChange(true)}
      >
        <Icon className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative flex items-center">
      <Icon className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Escape") onOpenChange(false);
        }}
        className="h-8 w-44 pl-8 pr-7"
      />
      <button
        type="button"
        aria-label={t("filters.clear")}
        onClick={() => {
          setText("");
          onCommit(null);
          onOpenChange(false);
        }}
        className="absolute right-1.5 flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Filter by a reverse-geocoded place (city / region / country). Renders nothing
 * until the cache holds at least one place (or one is already applied).
 */
function PlaceFilter({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: places = [] } = useQuery({
    queryKey: qk.places,
    queryFn: listPlaces,
    staleTime: 5 * 60_000,
  });

  if (places.length === 0 && !value) return null;

  const options: ComboOption[] = places.map((p) => ({ value: p, label: p }));

  return (
    <FilterCombobox
      active={!!value}
      triggerIcon={<MapPin className="h-4 w-4" />}
      triggerLabel={value ?? t("filters.place")}
      options={options}
      selectedValue={value}
      onSelect={onChange}
      searchPlaceholder={t("filters.placePlaceholder")}
      emptyText={t("filters.noPlaces")}
      clearLabel={t("filters.allPlaces")}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * Filter the library to a single person (face cluster). Renders nothing until
 * face recognition is on and at least one multi-face person exists.
 */
function PersonFilter({
  selectedId,
  onSelect,
  open,
  onOpenChange,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: status } = useFaceStatus();
  const { data: people = [] } = usePeople({
    includeHidden: false,
    namedOnly: false,
    minFaces: 2,
  });

  if (!status?.enabled || people.length === 0) return null;

  const selected = people.find((p) => p.id === selectedId);
  const options: ComboOption[] = people.map((p) => ({
    value: p.id,
    label: p.name ?? t("people.unnamed"),
    node: <FaceCrop face={p.cover} className="h-6 w-6 shrink-0 rounded-full" />,
    count: p.faceCount,
  }));

  return (
    <FilterCombobox
      active={!!selectedId}
      triggerIcon={
        selected ? (
          <FaceCrop face={selected.cover} className="h-5 w-5 rounded-full" />
        ) : (
          <Users className="h-4 w-4" />
        )
      }
      triggerLabel={selected ? selected.name ?? t("people.unnamed") : t("filters.person")}
      options={options}
      selectedValue={selectedId}
      onSelect={onSelect}
      searchPlaceholder={t("filters.searchPerson")}
      emptyText={t("filters.noPeople")}
      clearLabel={t("filters.allPeople")}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

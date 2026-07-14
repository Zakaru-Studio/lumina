import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Search, SlidersHorizontal } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { StarRating } from "@/components/common/StarRating";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAlbums } from "@/hooks/useAlbums";
import { usePhotoBrowser } from "@/hooks/usePhotoBrowser";
import { buildQuery } from "@/lib/query";
import type { PhotoFilter, SortBy, SortDir } from "@/types";

/** Human labels for the sortable columns (labelKey resolved via i18n). */
const SORT_OPTIONS: { value: SortBy; labelKey: string }[] = [
  { value: "takenAt", labelKey: "searchPage.sort.takenAt" },
  { value: "importedAt", labelKey: "searchPage.sort.importedAt" },
  { value: "filename", labelKey: "searchPage.sort.filename" },
  { value: "rating", labelKey: "searchPage.sort.rating" },
  { value: "fileSize", labelKey: "searchPage.sort.fileSize" },
];

/**
 * Instant, faceted search. Free-text query is debounced; rating, favorites,
 * RAW and camera/lens facets refine the result set live. Results render
 * in the same virtualized grid as the library.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialText = searchParams.get("q") ?? "";

  const [text, setText] = useState(initialText);
  const [debounced, setDebounced] = useState(initialText);
  const [minRating, setMinRating] = useState(0);
  const [favorites, setFavorites] = useState(false);
  const [rawOnly, setRawOnly] = useState(false);
  const [camera, setCamera] = useState("");
  const [lens, setLens] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("takenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 150);
    return () => clearTimeout(t);
  }, [text]);

  const filter: PhotoFilter = useMemo(
    () => ({
      text: debounced.trim() || null,
      minRating: minRating > 0 ? minRating : null,
      isFavorite: favorites ? true : null,
      isRaw: rawOnly ? true : null,
      cameraModel: camera.trim() || null,
      lens: lens.trim() || null,
    }),
    [debounced, minRating, favorites, rawOnly, camera, lens],
  );

  const hasCriteria =
    !!filter.text ||
    !!filter.minRating ||
    !!filter.isFavorite ||
    !!filter.isRaw ||
    !!filter.cameraModel ||
    !!filter.lens;

  const query = useMemo(
    () => buildQuery({ filter, sortBy, sortDir }),
    [filter, sortBy, sortDir],
  );
  // Windowed data + lightbox + shortcuts, active only once criteria are entered.
  const browser = usePhotoBrowser(query, hasCriteria);
  const ids = browser.ids;
  const { data: albums = [] } = useAlbums();
  const total = browser.total;

  return (
    <div className="flex h-full flex-col">
      {/* Search + facets */}
      <div className="shrink-0 space-y-3 px-6 pb-3 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("searchPage.searchPlaceholder")}
            className="h-11 pl-9 text-base"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            <span>{t("searchPage.filters")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("searchPage.minRating")}</Label>
            <StarRating value={minRating} onChange={setMinRating} size={16} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="fav-switch" className="text-muted-foreground">
              {t("searchPage.favorites")}
            </Label>
            <Switch id="fav-switch" checked={favorites} onCheckedChange={setFavorites} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="raw-switch" className="text-muted-foreground">
              {t("searchPage.rawOnly")}
            </Label>
            <Switch id="raw-switch" checked={rawOnly} onCheckedChange={setRawOnly} />
          </div>
          <Input
            value={camera}
            onChange={(e) => setCamera(e.target.value)}
            placeholder={t("searchPage.camera")}
            className="h-8 w-36"
          />
          <Input
            value={lens}
            onChange={(e) => setLens(e.target.value)}
            placeholder={t("searchPage.lens")}
            className="h-8 w-36"
          />
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("searchPage.sort.label")}</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
              <SelectTrigger className="h-8 w-[9.5rem]">
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
              aria-label={sortDir === "asc" ? t("searchPage.ascending") : t("searchPage.descending")}
              title={sortDir === "asc" ? t("searchPage.ascending") : t("searchPage.descending")}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? (
                <ArrowUpWideNarrow className="h-4 w-4" />
              ) : (
                <ArrowDownWideNarrow className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {hasCriteria ? (
          <p className="text-xs text-muted-foreground">
            {t("searchPage.resultCount", { count: total, formattedCount: total.toLocaleString() })}
          </p>
        ) : null}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1">
        {!hasCriteria ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title={t("searchPage.prompt.title")}
            description={t("searchPage.prompt.description")}
          />
        ) : browser.idsLoading ? (
          <div className="grid grid-cols-6 gap-2.5 p-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : ids.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title={t("searchPage.noMatches.title")}
            description={t("searchPage.noMatches.description")}
          />
        ) : (
          <PhotoGrid {...browser.grid} />
        )}
      </div>

      <Lightbox {...browser.lightbox} />
      <SelectionToolbar albums={albums} />
    </div>
  );
}

import { ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortBy, SortDir } from "@/types";

/** Sortable columns paired with their i18n label keys. */
export const SORT_OPTIONS: { value: SortBy; labelKey: string }[] = [
  { value: "takenAt", labelKey: "filters.sort.takenAt" },
  { value: "importedAt", labelKey: "filters.sort.importedAt" },
  { value: "filename", labelKey: "filters.sort.filename" },
  { value: "rating", labelKey: "filters.sort.rating" },
  { value: "fileSize", labelKey: "filters.sort.fileSize" },
];

/** Props for {@link SortControl}. */
export interface SortControlProps {
  sortBy: SortBy;
  sortDir: SortDir;
  /** Emit a patched sort. Callers reset paging on their side. */
  onChange: (patch: { sortBy?: SortBy; sortDir?: SortDir }) => void;
}

/**
 * The sort-field dropdown plus an ascending/descending toggle, shared by the
 * library's {@link FilterBar} and album views so sorting looks identical
 * everywhere. Renders as two flex children — the parent controls their spacing.
 */
export function SortControl({ sortBy, sortDir, onChange }: SortControlProps) {
  const { t } = useTranslation();
  return (
    <>
      <Select value={sortBy} onValueChange={(v) => onChange({ sortBy: v as SortBy })}>
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
        aria-label={sortDir === "asc" ? t("filters.ascending") : t("filters.descending")}
        title={sortDir === "asc" ? t("filters.ascending") : t("filters.descending")}
        onClick={() => onChange({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
      >
        {sortDir === "asc" ? (
          <ArrowUpWideNarrow className="h-4 w-4" />
        ) : (
          <ArrowDownWideNarrow className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}

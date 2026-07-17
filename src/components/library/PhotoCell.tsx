import { memo } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Check, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StarRating } from "@/components/common/StarRating";
import { PhotoCellMenu } from "@/components/library/PhotoCellMenu";
import { Thumbnail } from "@/components/library/Thumbnail";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useDedupeExitStore } from "@/stores/dedupeExitStore";
import { useSelectionStore } from "@/stores/selectionStore";
import type { Photo } from "@/types";

/** Props for {@link PhotoCell}. Handlers take the photo id/index so the parent
 * can pass ONE stable callback for every cell (keeping {@link PhotoCell} memoised). */
export interface PhotoCellProps {
  photo: Photo;
  /** Flat index of this photo, passed to `onOpen`. */
  index: number;
  /** Modifier-click (Ctrl/Cmd toggle, Shift range) for selection. */
  onClick: (e: MouseEvent, id: string) => void;
  /** Open the photo (by flat index) in the lightbox — plain (unmodified) click. */
  onOpen: (index: number) => void;
  onDragStart?: (e: DragEvent, id: string) => void;
}

/**
 * A single grid cell wrapping a {@link Thumbnail}. A plain click opens the photo
 * in the lightbox; selection is done via the hover checkbox (top-left) or
 * modifier-clicks (Ctrl/Cmd to toggle, Shift for a range). Selection shows a
 * primary ring and subtle scale; favorite and rating metadata reveal on
 * hover (and stay visible when set).
 *
 * Perf: memoised, and it subscribes to *only its own* selected flag
 * (`selected.has(id)`) rather than receiving `selected` as a prop — so toggling
 * the selection re-renders just the cell(s) whose state changed, not the whole
 * grid. Its right-click actions live in {@link PhotoCellMenu}, mounted lazily by
 * Radix only while the menu is open.
 */
export const PhotoCell = memo(function PhotoCell({
  photo,
  index,
  onClick,
  onOpen,
  onDragStart,
}: PhotoCellProps) {
  const { t } = useTranslation();
  const hasMeta = photo.rating > 0;
  const selected = useSelectionStore((s) => s.selected.has(photo.id));
  // True while this copy is animating out after a smart-dedupe removal.
  const exiting = useDedupeExitStore((s) => s.ids.has(photo.id));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative h-full w-full cursor-pointer overflow-hidden rounded-lg bg-muted transition-all duration-150",
            selected
              ? "scale-[0.97] ring-2 ring-primary"
              : "ring-0 hover:scale-[0.99] hover:ring-1 hover:ring-border",
            exiting && "pointer-events-none",
          )}
          // Inline so the 1.6s duration wins over the tile's `duration-150`
          // utility (which tailwindcss-animate also applies to animations).
          style={exiting ? { animation: "dedupe-exit 1.6s ease forwards" } : undefined}
          draggable
          onClick={(e) => {
            // A plain click opens the viewer directly; modifier-clicks
            // (Ctrl/Cmd toggle, Shift range) select instead. Selecting without
            // opening is still available via the hover checkbox (top-left).
            if (e.shiftKey || e.ctrlKey || e.metaKey) onClick(e, photo.id);
            else onOpen(index);
          }}
          onDoubleClick={() => onOpen(index)}
          onDragStart={(e) => onDragStart?.(e, photo.id)}
        >
          <Thumbnail photo={photo} />

          {/* Selection checkbox (top-left) */}
          <button
            type="button"
            aria-label={selected ? t("gallery.deselectPhoto") : t("gallery.selectPhoto")}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              // Shift extends the range from the last-clicked checkbox: defer to
              // the page handler, which owns the ordered id list. Plain/Ctrl just
              // toggles this photo (and updates the range anchor).
              if (e.shiftKey) onClick(e, photo.id);
              else useSelectionStore.getState().toggle(photo.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute left-1.5 top-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-[5px] transition-all",
              selected
                ? "bg-primary text-primary-foreground shadow"
                : "bg-black/30 text-white/90 ring-1 ring-inset ring-white/70 backdrop-blur-sm hover:bg-black/45",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" /> : null}
          </button>

          {/* Favorite (top-right) */}
          {photo.isFavorite ? (
            <div className="absolute right-1.5 top-1.5 text-red-500 drop-shadow">
              <Heart className="h-4 w-4 fill-current" />
            </div>
          ) : null}

          {/* Rating (bottom) */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5 transition-opacity",
              hasMeta ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {photo.rating > 0 ? (
              <StarRating value={photo.rating} size={11} readOnly className="text-white" />
            ) : null}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <PhotoCellMenu photo={photo} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

import type { DragEvent, MouseEvent } from "react";
import { Check, FolderOpen, Heart, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StarRating } from "@/components/common/StarRating";
import { Thumbnail } from "@/components/library/Thumbnail";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAlbums, useAddToAlbum } from "@/hooks/useAlbums";
import {
  useRemovePhotos,
  useSetColor,
  useSetFavorite,
  useSetRating,
} from "@/hooks/usePhotoMutations";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSelectionStore } from "@/stores/selectionStore";
import type { ColorLabel, Photo } from "@/types";

/** Props for {@link PhotoCell}. */
export interface PhotoCellProps {
  photo: Photo;
  selected: boolean;
  /** Single click (receives the event for modifier-aware selection). */
  onClick: (e: MouseEvent) => void;
  /** Double click / open in lightbox. */
  onOpen: () => void;
  onDragStart?: (e: DragEvent) => void;
}

/** Small label-dot rendered when a photo carries a color label. */
function ColorDot({ colorLabel }: { colorLabel: Photo["colorLabel"] }) {
  if (colorLabel === "none") return null;
  return <span className={cn("h-2.5 w-2.5 rounded-full bg-current", `label-${colorLabel}`)} />;
}

/** Ordered color-label options for the context-menu submenu. */
const COLOR_OPTIONS: { value: ColorLabel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "red", label: "Red" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
];

/**
 * A single grid cell wrapping a {@link Thumbnail}. Selection shows a primary
 * ring and subtle scale; favorite and rating/color metadata reveal on hover
 * (and stay visible when set).
 *
 * Right-clicking opens a context menu of non-destructive actions (rating,
 * color, favorite, album, reveal, remove). Actions target the whole current
 * selection when the right-clicked photo is part of it, otherwise this photo.
 */
export function PhotoCell({ photo, selected, onClick, onOpen, onDragStart }: PhotoCellProps) {
  const hasMeta = photo.rating > 0 || photo.colorLabel !== "none";

  const { data: albums = [] } = useAlbums();
  const setRating = useSetRating();
  const setColor = useSetColor();
  const setFavorite = useSetFavorite();
  const addToAlbum = useAddToAlbum();
  const removePhotos = useRemovePhotos();

  const manualAlbums = albums.filter((a) => a.kind === "manual");

  /** Resolve the ids this menu acts on: the selection (if the photo is in it),
   * otherwise just this photo. */
  const targetIds = (): string[] => {
    const { selected: sel } = useSelectionStore.getState();
    return sel.has(photo.id) ? Array.from(sel) : [photo.id];
  };

  /** Reveal the original file in the OS file manager. */
  const reveal = async (): Promise<void> => {
    try {
      await api.revealInExplorer(photo.path);
    } catch {
      toast.error("Could not reveal file in Explorer");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative h-full w-full cursor-pointer overflow-hidden rounded-lg bg-muted transition-all duration-150",
            selected
              ? "scale-[0.97] ring-2 ring-primary"
              : "ring-0 hover:scale-[0.99] hover:ring-1 hover:ring-border",
          )}
          draggable
          onClick={onClick}
          onDoubleClick={onOpen}
          onDragStart={onDragStart}
        >
          <Thumbnail photo={photo} />

          {/* Favorite (top-left) */}
          {photo.isFavorite ? (
            <div className="absolute left-1.5 top-1.5 text-red-500 drop-shadow">
              <Heart className="h-4 w-4 fill-current" />
            </div>
          ) : null}

          {/* Rating + color (bottom) */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5 transition-opacity",
              hasMeta ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {photo.rating > 0 ? (
              <StarRating value={photo.rating} size={11} readOnly className="text-white" />
            ) : (
              <span />
            )}
            <ColorDot colorLabel={photo.colorLabel} />
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        {/* Rating */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Star className="h-4 w-4 text-muted-foreground" />
            Rating
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {[5, 4, 3, 2, 1, 0].map((rating) => (
              <ContextMenuItem
                key={rating}
                onSelect={() => setRating.mutate({ ids: targetIds(), rating })}
              >
                {rating === 0 ? (
                  <span className="text-muted-foreground">No rating</span>
                ) : (
                  <span className="text-primary">{"★".repeat(rating)}</span>
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Color */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {photo.colorLabel === "none" ? (
              <span className="h-2.5 w-2.5 rounded-full border border-border" />
            ) : (
              <ColorDot colorLabel={photo.colorLabel} />
            )}
            Color
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {COLOR_OPTIONS.map((opt) => (
              <ContextMenuItem
                key={opt.value}
                onSelect={() => setColor.mutate({ ids: targetIds(), color: opt.value })}
              >
                {opt.value === "none" ? (
                  <span className="h-2.5 w-2.5 rounded-full border border-border" />
                ) : (
                  <span className={cn("h-2.5 w-2.5 rounded-full bg-current", `label-${opt.value}`)} />
                )}
                <span className={opt.value === "none" ? "text-muted-foreground" : undefined}>
                  {opt.label}
                </span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Favorite */}
        <ContextMenuItem
          onSelect={() =>
            setFavorite.mutate({ ids: targetIds(), favorite: !photo.isFavorite })
          }
        >
          <Heart className={cn("h-4 w-4", photo.isFavorite && "fill-current text-red-500")} />
          {photo.isFavorite ? "Unfavorite" : "Favorite"}
        </ContextMenuItem>

        {/* Add to album */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Add to album
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {manualAlbums.length === 0 ? (
              <ContextMenuItem disabled>No albums yet</ContextMenuItem>
            ) : (
              manualAlbums.map((album) => (
                <ContextMenuItem
                  key={album.id}
                  onSelect={() =>
                    addToAlbum.mutate({ albumId: album.id, photoIds: targetIds() })
                  }
                >
                  {album.name}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={reveal}>
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          Reveal in Explorer
        </ContextMenuItem>

        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => removePhotos.mutate(targetIds())}
        >
          <Trash2 className="h-4 w-4" />
          Remove from catalog
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

import type { DragEvent, MouseEvent } from "react";
import { Check, FolderMinus, FolderOpen, Heart, Pencil, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { useAlbums, useAddToAlbum, useRemoveFromAlbum } from "@/hooks/useAlbums";
import { useSetFavorite, useSetRating } from "@/hooks/usePhotoMutations";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAlbumContext } from "@/stores/albumContextStore";
import { useDedupeExitStore } from "@/stores/dedupeExitStore";
import { useDeleteDialog } from "@/stores/deleteDialogStore";
import { useEditorStore } from "@/stores/editorStore";
import { useRenamePhoto } from "@/stores/renamePhotoStore";
import { useSelectionStore } from "@/stores/selectionStore";
import type { Photo } from "@/types";

/** Props for {@link PhotoCell}. */
export interface PhotoCellProps {
  photo: Photo;
  selected: boolean;
  /** Modifier-click (Ctrl/Cmd toggle, Shift range) for selection. */
  onClick: (e: MouseEvent) => void;
  /** Open in the lightbox — triggered by a plain (unmodified) click. */
  onOpen: () => void;
  onDragStart?: (e: DragEvent) => void;
}

/**
 * A single grid cell wrapping a {@link Thumbnail}. A plain click opens the photo
 * in the lightbox; selection is done via the hover checkbox (top-right) or
 * modifier-clicks (Ctrl/Cmd to toggle, Shift for a range). Selection shows a
 * primary ring and subtle scale; favorite and rating metadata reveal on
 * hover (and stay visible when set).
 *
 * Right-clicking opens a context menu of non-destructive actions (rating,
 * favorite, album, reveal, remove). Actions target the whole current
 * selection when the right-clicked photo is part of it, otherwise this photo.
 */
export function PhotoCell({ photo, selected, onClick, onOpen, onDragStart }: PhotoCellProps) {
  const { t } = useTranslation();
  const hasMeta = photo.rating > 0;
  // True while this copy is animating out after a smart-dedupe removal.
  const exiting = useDedupeExitStore((s) => s.ids.has(photo.id));

  const { data: albums = [] } = useAlbums();
  const setRating = useSetRating();
  const setFavorite = useSetFavorite();
  const addToAlbum = useAddToAlbum();
  const removeFromAlbum = useRemoveFromAlbum();

  // Album currently being viewed (manual only), for "remove from this album".
  const albumCtxId = useAlbumContext((s) => s.albumId);
  const albumCtxName = useAlbumContext((s) => s.albumName);

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
      toast.error(t("gallery.revealError"));
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
            exiting && "pointer-events-none",
          )}
          // Inline so the 1.6s duration wins over the tile's `duration-150`
          // utility (which tailwindcss-animate also applies to animations).
          style={exiting ? { animation: "dedupe-exit 1.6s ease forwards" } : undefined}
          draggable
          onClick={(e) => {
            // A plain click opens the viewer directly; modifier-clicks
            // (Ctrl/Cmd toggle, Shift range) select instead. Selecting without
            // opening is still available via the hover checkbox (top-right).
            if (e.shiftKey || e.ctrlKey || e.metaKey) onClick(e);
            else onOpen();
          }}
          onDoubleClick={onOpen}
          onDragStart={onDragStart}
        >
          <Thumbnail photo={photo} />

          {/* Selection checkbox (top-right) */}
          <button
            type="button"
            aria-label={selected ? t("gallery.deselectPhoto") : t("gallery.selectPhoto")}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              // Shift extends the range from the last-clicked checkbox: defer to
              // the page handler, which owns the ordered id list. Plain/Ctrl just
              // toggles this photo (and updates the range anchor).
              if (e.shiftKey) onClick(e);
              else useSelectionStore.getState().toggle(photo.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-1.5 top-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-[5px] transition-all",
              selected
                ? "bg-primary text-primary-foreground shadow"
                : "bg-black/30 text-white/90 ring-1 ring-inset ring-white/70 backdrop-blur-sm hover:bg-black/45",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" /> : null}
          </button>

          {/* Favorite (top-left) */}
          {photo.isFavorite ? (
            <div className="absolute left-1.5 top-1.5 text-red-500 drop-shadow">
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
        {/* Edit in the non-destructive editor */}
        <ContextMenuItem onSelect={() => useEditorStore.getState().open(photo.id)}>
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {t("gallery.edit")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Rating */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Star className="h-4 w-4 text-muted-foreground" />
            {t("gallery.rating")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {[5, 4, 3, 2, 1, 0].map((rating) => (
              <ContextMenuItem
                key={rating}
                onSelect={() => setRating.mutate({ ids: targetIds(), rating })}
              >
                {rating === 0 ? (
                  <span className="text-muted-foreground">{t("gallery.noRating")}</span>
                ) : (
                  <span className="text-primary">{"★".repeat(rating)}</span>
                )}
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
          {photo.isFavorite ? t("gallery.unfavorite") : t("gallery.favorite")}
        </ContextMenuItem>

        {/* Add to album */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            {t("gallery.addToAlbum")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {manualAlbums.length === 0 ? (
              <ContextMenuItem disabled>{t("gallery.noAlbumsYet")}</ContextMenuItem>
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

        {/* Remove from the album currently being viewed (manual albums only) */}
        {albumCtxId ? (
          <ContextMenuItem
            onSelect={() =>
              removeFromAlbum.mutate({ albumId: albumCtxId, photoIds: targetIds() })
            }
          >
            <FolderMinus className="h-4 w-4 text-muted-foreground" />
            {albumCtxName
              ? t("gallery.removeFromNamedAlbum", { album: albumCtxName })
              : t("gallery.removeFromAlbum")}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        <ContextMenuItem
          onSelect={() =>
            useRenamePhoto.getState().open({ id: photo.id, filename: photo.filename })
          }
        >
          <Pencil className="h-4 w-4 text-muted-foreground" />
          {t("common.rename")}
        </ContextMenuItem>

        <ContextMenuItem onSelect={reveal}>
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          {t("gallery.revealInExplorer")}
        </ContextMenuItem>

        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => useDeleteDialog.getState().open(targetIds())}
        >
          <Trash2 className="h-4 w-4" />
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

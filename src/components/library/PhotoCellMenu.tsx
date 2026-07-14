import { FolderMinus, FolderOpen, Heart, Pencil, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useAlbums, useAddToAlbum, useRemoveFromAlbum } from "@/hooks/useAlbums";
import { useSetFavorite, useSetRating } from "@/hooks/usePhotoMutations";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAlbumContext } from "@/stores/albumContextStore";
import { useDeleteDialog } from "@/stores/deleteDialogStore";
import { useEditorStore } from "@/stores/editorStore";
import { useRenamePhoto } from "@/stores/renamePhotoStore";
import { useSelectionStore } from "@/stores/selectionStore";
import type { Photo } from "@/types";

/**
 * The right-click actions for a photo cell. Extracted from {@link PhotoCell} and
 * rendered *inside* `ContextMenuContent`, which Radix only mounts while the menu
 * is open — so the album query, the four mutation hooks and the i18n/context
 * subscriptions this needs are instantiated once per open menu instead of once
 * per visible cell (there can be hundreds). Actions target the whole current
 * selection when this photo is part of it, otherwise just this photo.
 */
export function PhotoCellMenu({ photo }: { photo: Photo }) {
  const { t } = useTranslation();
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
    <>
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
        onSelect={() => setFavorite.mutate({ ids: targetIds(), favorite: !photo.isFavorite })}
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
                onSelect={() => addToAlbum.mutate({ albumId: album.id, photoIds: targetIds() })}
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
          onSelect={() => removeFromAlbum.mutate({ albumId: albumCtxId, photoIds: targetIds() })}
        >
          <FolderMinus className="h-4 w-4 text-muted-foreground" />
          {albumCtxName
            ? t("gallery.removeFromNamedAlbum", { album: albumCtxName })
            : t("gallery.removeFromAlbum")}
        </ContextMenuItem>
      ) : null}

      <ContextMenuSeparator />

      <ContextMenuItem
        onSelect={() => useRenamePhoto.getState().open({ id: photo.id, filename: photo.filename })}
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
    </>
  );
}

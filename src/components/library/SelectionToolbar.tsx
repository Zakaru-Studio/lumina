import { useState } from "react";
import { CalendarClock, FolderMinus, FolderPlus, Heart, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DateTimeEditor } from "@/components/common/DateTimeEditor";
import { StarRating } from "@/components/common/StarRating";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAddToAlbum, useCreateAlbum, useRemoveFromAlbum } from "@/hooks/useAlbums";
import {
  useSetCaptureDate,
  useSetFavorite,
  useSetRating,
} from "@/hooks/usePhotoMutations";
import { useAlbumContext } from "@/stores/albumContextStore";
import { useDeleteDialog } from "@/stores/deleteDialogStore";
import { useScanStore } from "@/stores/scanStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import type { Album } from "@/types";

/** Props for {@link SelectionToolbar}. */
export interface SelectionToolbarProps {
  /** Manual albums, offered as "add to album" targets. */
  albums: Album[];
}

/**
 * Floating action bar shown while a selection is active. Applies bulk metadata
 * mutations (favorite, rating, add-to-album, remove) to every selected
 * photo. Fixed bottom-center, elevated, with a discreet entrance animation.
 */
export function SelectionToolbar({ albums }: SelectionToolbarProps) {
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const count = selected.size;

  // Lift the bar above the scan progress bar while it's visible, sitting exactly
  // 16px above it (using its measured height). Otherwise rest near the bottom.
  const scanVisible = useScanStore((s) => !!s.progress && s.progress.phase !== "idle");
  const scanBarHeight = useScanStore((s) => s.barHeight);
  const bottomPx = scanVisible ? scanBarHeight + 16 : 24;

  // Center over the content area, not the whole window: offset the left edge by
  // the sidebar's current width (64px collapsed / 240px expanded) so the bar
  // tracks the sidebar as it toggles.
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const leftPx = sidebarCollapsed ? 64 : 240;

  const setFavorite = useSetFavorite();
  const setRating = useSetRating();
  const setCaptureDate = useSetCaptureDate();
  const addToAlbum = useAddToAlbum();
  const createAlbum = useCreateAlbum();
  const removeFromAlbum = useRemoveFromAlbum();

  // When viewing a manual album, offer "remove from this album" (distinct from
  // removing from the catalog).
  const albumCtxId = useAlbumContext((s) => s.albumId);

  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  // Keep the toolbar mounted while a dialog is open so clearing the selection
  // mid-interaction doesn't tear the dialog down abruptly.
  if (count === 0 && !newAlbumOpen && !dateOpen) return null;

  const ids = Array.from(selected);
  const manualAlbums = albums.filter((a) => a.kind === "manual");

  /** Create a new album and add the current selection to it in one step. */
  const submitNewAlbum = () => {
    const name = newAlbumName.trim();
    // Guard against empty names and concurrent submits (e.g. rapid double-Enter)
    // so we never create duplicate albums.
    if (!name || createAlbum.isPending) return;
    // Read the selection at submit time in case it changed while typing.
    const photoIds = Array.from(useSelectionStore.getState().selected);
    createAlbum.mutate(
      { name },
      {
        onSuccess: (album) => {
          addToAlbum.mutate({ albumId: album.id, photoIds });
          setNewAlbumOpen(false);
          setNewAlbumName("");
        },
      },
    );
  };

  return (
    <div
      className="pointer-events-none fixed right-0 z-40 flex justify-center px-4 transition-[left,bottom] duration-200"
      style={{ left: leftPx, bottom: bottomPx }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-card px-4 py-2.5 shadow-lg animate-fade-in-up">
        <span className="whitespace-nowrap px-1 text-sm font-medium text-foreground">
          {t("selection.count", { n: count })}
        </span>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFavorite.mutate({ ids, favorite: true })}
              aria-label={t("selection.addToFavorites")}
            >
              <Heart className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("selection.favorite")}</TooltipContent>
        </Tooltip>

        <StarRating
          value={0}
          onChange={(rating) => setRating.mutate({ ids, rating })}
          size={16}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDateOpen(true)}
              aria-label={t("selection.setDate")}
            >
              <CalendarClock className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("selection.setDate")}</TooltipContent>
        </Tooltip>

        {/* Batch capture-date editor (applies the same date to the selection). */}
        <DateTimeEditor
          open={dateOpen}
          onOpenChange={setDateOpen}
          initial={null}
          count={count}
          onSubmit={(timestamp) => {
            // Read the selection at submit time in case it changed while open.
            const photoIds = Array.from(useSelectionStore.getState().selected);
            setCaptureDate.mutate({ ids: photoIds, timestamp });
            setDateOpen(false);
          }}
          pending={setCaptureDate.isPending}
        />

        <Separator orientation="vertical" className="h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <FolderPlus className="h-4 w-4" />
              {t("selection.album")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuLabel>{t("selection.addToAlbum")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setNewAlbumName("");
                setNewAlbumOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("selection.newAlbum")}
            </DropdownMenuItem>
            {manualAlbums.length > 0 ? <DropdownMenuSeparator /> : null}
            {manualAlbums.map((album) => (
              <DropdownMenuItem
                key={album.id}
                onSelect={() => addToAlbum.mutate({ albumId: album.id, photoIds: ids })}
              >
                {album.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Create-album dialog (adds the current selection on create). */}
        <Dialog open={newAlbumOpen} onOpenChange={setNewAlbumOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("selection.newAlbumTitle", { count })}</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={t("selection.albumNamePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && submitNewAlbum()}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNewAlbumOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={submitNewAlbum}
                disabled={!newAlbumName.trim() || createAlbum.isPending}
              >
                {t("selection.createAndAdd")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {albumCtxId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  removeFromAlbum.mutate(
                    { albumId: albumCtxId, photoIds: ids },
                    { onSuccess: () => clear() },
                  )
                }
                aria-label={t("selection.removeFromThisAlbum")}
              >
                <FolderMinus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("selection.removeFromAlbum")}</TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => useDeleteDialog.getState().open(ids)}
              aria-label={t("common.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common.delete")}</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="ghost" size="icon" onClick={() => clear()} aria-label={t("selection.clearSelection")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

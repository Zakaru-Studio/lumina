import { FolderPlus, Heart, Trash2, X } from "lucide-react";

import { ColorLabelPicker } from "@/components/common/ColorLabelPicker";
import { StarRating } from "@/components/common/StarRating";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAddToAlbum } from "@/hooks/useAlbums";
import {
  useRemovePhotos,
  useSetColor,
  useSetFavorite,
  useSetRating,
} from "@/hooks/usePhotoMutations";
import { useSelectionStore } from "@/stores/selectionStore";
import type { Album, ColorLabel } from "@/types";

/** Props for {@link SelectionToolbar}. */
export interface SelectionToolbarProps {
  /** Manual albums, offered as "add to album" targets. */
  albums: Album[];
}

/**
 * Floating action bar shown while a selection is active. Applies bulk metadata
 * mutations (favorite, rating, color, add-to-album, remove) to every selected
 * photo. Fixed bottom-center, elevated, with a discreet entrance animation.
 */
export function SelectionToolbar({ albums }: SelectionToolbarProps) {
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const count = selected.size;

  const setFavorite = useSetFavorite();
  const setRating = useSetRating();
  const setColor = useSetColor();
  const addToAlbum = useAddToAlbum();
  const removePhotos = useRemovePhotos();

  if (count === 0) return null;

  const ids = Array.from(selected);
  const manualAlbums = albums.filter((a) => a.kind === "manual");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-card px-4 py-2.5 shadow-lg animate-fade-in-up">
        <span className="whitespace-nowrap px-1 text-sm font-medium text-foreground">
          {count} selected
        </span>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFavorite.mutate({ ids, favorite: true })}
              aria-label="Add to favorites"
            >
              <Heart className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Favorite</TooltipContent>
        </Tooltip>

        <StarRating
          value={0}
          onChange={(rating) => setRating.mutate({ ids, rating })}
          size={16}
        />

        <ColorLabelPicker
          value={"none" as ColorLabel}
          onChange={(color) => setColor.mutate({ ids, color })}
        />

        <Separator orientation="vertical" className="h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <FolderPlus className="h-4 w-4" />
              Album
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuLabel>Add to album</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {manualAlbums.length === 0 ? (
              <DropdownMenuItem disabled>No albums yet</DropdownMenuItem>
            ) : (
              manualAlbums.map((album) => (
                <DropdownMenuItem
                  key={album.id}
                  onSelect={() =>
                    addToAlbum.mutate({ albumId: album.id, photoIds: ids })
                  }
                >
                  {album.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                removePhotos.mutate(ids, { onSuccess: () => clear() })
              }
              aria-label="Remove from catalog"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from catalog</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="ghost" size="icon" onClick={() => clear()} aria-label="Clear selection">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

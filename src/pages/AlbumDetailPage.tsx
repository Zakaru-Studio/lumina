import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImageIcon, Pencil, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAlbum,
  useAlbumPhotos,
  useAlbums,
  useDeleteAlbum,
  useRenameAlbum,
} from "@/hooks/useAlbums";
import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { flattenPhotos } from "@/hooks/usePhotos";
import { buildQuery } from "@/lib/query";

/**
 * A single album's contents. Manual albums can be renamed or deleted inline;
 * smart albums are read-only rule-driven collections.
 */
export function AlbumDetailPage() {
  const { albumId } = useParams();
  const id = albumId ?? null;
  const navigate = useNavigate();

  const { data: album, isLoading: albumLoading } = useAlbum(id);
  const query = useMemo(() => buildQuery(), []);
  const {
    data,
    isLoading: photosLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useAlbumPhotos(id, query);

  const { data: albums = [] } = useAlbums();
  const renameAlbum = useRenameAlbum();
  const deleteAlbum = useDeleteAlbum();

  const photos = useMemo(() => flattenPhotos(data?.pages), [data]);
  const order = useMemo(() => photos.map((p) => p.id), [photos]);

  const [index, setIndex] = useState<number | null>(null);
  useGlobalShortcuts(order, { onOpen: setIndex, enabled: index === null });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");

  const isManual = album?.kind === "manual";

  const submitRename = () => {
    if (!album) return;
    const name = renameName.trim();
    if (!name) return;
    renameAlbum.mutate({ id: album.id, name }, { onSuccess: () => setRenameOpen(false) });
  };

  const onDelete = () => {
    if (!album) return;
    if (confirm(`Delete album "${album.name}"?`))
      deleteAlbum.mutate(album.id, { onSuccess: () => navigate("/albums") });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
        <Link
          to="/albums"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Back to albums"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          {albumLoading || !album ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <>
              <h1 className="truncate text-lg font-semibold text-foreground">{album.name}</h1>
              <p className="text-xs text-muted-foreground">{album.count} photos</p>
            </>
          )}
        </div>
        {isManual ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rename album"
              onClick={() => {
                setRenameName(album?.name ?? "");
                setRenameOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete album"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {photosLoading ? (
          <div className="grid grid-cols-6 gap-2.5 p-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-6 w-6" />}
            title="This album is empty"
            description={
              isManual
                ? "Drag photos onto this album in the sidebar, or use the selection toolbar to add some."
                : "No photos match this smart album's rules yet."
            }
          />
        ) : (
          <PhotoGrid
            photos={photos}
            onOpen={setIndex}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        )}
      </div>

      <Lightbox
        photos={photos}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
      />
      <SelectionToolbar albums={albums} />

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename album</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Album name"
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={!renameName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

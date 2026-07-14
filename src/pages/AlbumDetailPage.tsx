import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderHeart, ImageIcon, Pencil, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { DedupeButton } from "@/components/library/DedupeButton";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { SortControl } from "@/components/library/SortControl";
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
import { albumLabel } from "@/lib/albumLabel";
import { buildQuery } from "@/lib/query";
import { useAlbumContext } from "@/stores/albumContextStore";
import { useAlbumDelete } from "@/stores/albumDeleteStore";
import type { Photo, PhotoQuery, SortBy, SortDir } from "@/types";

/**
 * A single album's contents. Manual albums can be renamed or deleted inline;
 * smart albums are read-only rule-driven collections.
 */
export function AlbumDetailPage() {
  const { t } = useTranslation();
  const { albumId } = useParams();
  const id = albumId ?? null;
  const navigate = useNavigate();

  const { data: album, isLoading: albumLoading } = useAlbum(id);
  // Sort is user-controllable (like the library's filter bar); paging resets on
  // every change. The filter stays default — smart albums drive it server-side.
  const [query, setQuery] = useState<PhotoQuery>(() => buildQuery());
  const patchSort = (patch: { sortBy?: SortBy; sortDir?: SortDir }): void =>
    setQuery((q) => ({ ...q, ...patch, offset: 0 }));
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
  const ids = useMemo(() => photos.map((p) => p.id), [photos]);
  /** Album photos are fully loaded into `photos`, so index maps directly. */
  const getPhoto = useCallback((i: number): Photo | undefined => photos[i], [photos]);

  const [index, setIndex] = useState<number | null>(null);
  useGlobalShortcuts(ids, { onOpen: setIndex, enabled: index === null });

  // Infinite-scroll trigger: prefetch the next page as the visible range nears
  // the end. Memoised so PhotoGrid's range effect doesn't re-run every render.
  const handleVisibleRange = useCallback(
    (_start: number, end: number) => {
      if (end >= ids.length - 24 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [ids.length, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");

  const isManual = album?.kind === "manual";
  const isDuplicates =
    album?.kind === "smart" && (album.rule?.preset as string | undefined) === "duplicates";
  const childAlbums = useMemo(
    () => albums.filter((a) => a.kind === "manual" && a.parentId === id),
    [albums, id],
  );
  const parentAlbum = useMemo(
    () => (album?.parentId ? albums.find((a) => a.id === album.parentId) ?? null : null),
    [albums, album],
  );

  // Expose this album as the "remove from album" context — but only for manual
  // albums (you can't remove photos from a rule-driven smart album).
  const setAlbumCtx = useAlbumContext((s) => s.set);
  const clearAlbumCtx = useAlbumContext((s) => s.clear);
  useEffect(() => {
    if (isManual && album) {
      setAlbumCtx(album.id, album.name);
      return () => clearAlbumCtx();
    }
    clearAlbumCtx();
    return undefined;
  }, [isManual, album, setAlbumCtx, clearAlbumCtx]);

  const submitRename = () => {
    if (!album) return;
    const name = renameName.trim();
    if (!name) return;
    renameAlbum.mutate({ id: album.id, name }, { onSuccess: () => setRenameOpen(false) });
  };

  const onDelete = () => {
    if (!album) return;
    // Mirror albums trash their real folder — route through the strong
    // confirmation dialog. Virtual albums keep the lighter native confirm.
    if (album.folderPath != null) {
      useAlbumDelete.getState().open({
        id: album.id,
        name: album.name,
        onDeleted: () => navigate("/albums"),
      });
    } else if (confirm(t("albumDetailPage.deleteConfirm", { name: album.name }))) {
      deleteAlbum.mutate(album.id, { onSuccess: () => navigate("/albums") });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
        <Link
          to="/albums"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("albumDetailPage.backToAlbums")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          {albumLoading || !album ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <>
              <h1 className="truncate text-lg font-semibold text-foreground">{albumLabel(album, t)}</h1>
              <p className="text-xs text-muted-foreground">
                {parentAlbum ? (
                  <>
                    <Link
                      to={`/albums/${parentAlbum.id}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {parentAlbum.name}
                    </Link>
                    {" · "}
                  </>
                ) : null}
                {t("albumDetailPage.photoCount", { count: album.count })}
              </p>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {album && album.count > 0 ? (
            <SortControl sortBy={query.sortBy} sortDir={query.sortDir} onChange={patchSort} />
          ) : null}
          {isDuplicates ? <DedupeButton /> : null}
          {isManual ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("albumDetailPage.renameAlbum")}
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
                aria-label={t("albumDetailPage.deleteAlbum")}
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Sub-albums */}
      {childAlbums.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("albumDetailPage.subAlbums")}
          </span>
          {childAlbums.map((child) => (
            <Link
              key={child.id}
              to={`/albums/${child.id}`}
              className="flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent"
            >
              <FolderHeart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[160px] truncate">{child.name}</span>
              <span className="text-muted-foreground">{child.count}</span>
            </Link>
          ))}
        </div>
      ) : null}

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
            title={t("albumDetailPage.empty.title")}
            description={
              isManual
                ? t("albumDetailPage.empty.manualDescription")
                : t("albumDetailPage.empty.smartDescription")
            }
          />
        ) : (
          <PhotoGrid
            ids={ids}
            getPhoto={getPhoto}
            onOpen={setIndex}
            onVisibleRangeChange={handleVisibleRange}
          />
        )}
      </div>

      <Lightbox
        ids={ids}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
        getPhoto={getPhoto}
      />
      <SelectionToolbar albums={albums} />

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albumDetailPage.renameAlbumTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder={t("albumDetailPage.albumNamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitRename} disabled={!renameName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

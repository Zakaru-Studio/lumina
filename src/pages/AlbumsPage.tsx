import { useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Aperture,
  Calendar,
  CalendarDays,
  Check,
  FolderHeart,
  Heart,
  MoreHorizontal,
  Plus,
  Sun,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddToAlbum,
  useAlbums,
  useCreateAlbum,
  useDeleteAlbum,
  useDeleteAlbums,
  useRenameAlbum,
} from "@/hooks/useAlbums";
import { assetSrc } from "@/lib/api";
import { albumLabel } from "@/lib/albumLabel";
import { albumOptions } from "@/lib/albumTree";
import { cn } from "@/lib/utils";
import { useAlbumDelete } from "@/stores/albumDeleteStore";
import type { Album } from "@/types";

/** Sentinel Select value for "no parent" (Radix Select forbids empty values). */
const ROOT_VALUE = "__root__";

/** Presets whose smart album should be hidden while it has no matching media. */
const HIDE_WHEN_EMPTY = new Set(["today", "week", "month"]);

/** Whether a smart album should be hidden right now (empty date-based view). */
function isHiddenSmart(album: Album): boolean {
  const preset = (album.rule?.preset as string | undefined) ?? "";
  return HIDE_WHEN_EMPTY.has(preset) && album.count === 0;
}

/** Extract dragged photo ids from a drop event (empty if none/invalid). */
function parseDragIds(e: DragEvent): string[] {
  try {
    const raw = e.dataTransfer.getData("application/x-lumina-ids");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Map a backend album icon name to a lucide icon, with a fallback. */
function albumIcon(name: string | null): LucideIcon {
  switch (name) {
    case "sun":
      return Sun;
    case "calendar":
      return Calendar;
    case "calendar-days":
      return CalendarDays;
    case "heart":
      return Heart;
    case "aperture":
      return Aperture;
    case "video":
      return Video;
    case "folder-heart":
      return FolderHeart;
    default:
      return FolderHeart;
  }
}

/**
 * Album gallery: smart (rule-driven) albums and user-created manual albums.
 * Supports creating, renaming and deleting manual albums.
 */
export function AlbumsPage() {
  const { t } = useTranslation();
  const { data: albums = [], isLoading } = useAlbums();
  const navigate = useNavigate();

  const createAlbum = useCreateAlbum();
  const renameAlbum = useRenameAlbum();
  const deleteAlbum = useDeleteAlbum();
  const deleteAlbums = useDeleteAlbums();
  const addToAlbum = useAddToAlbum();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>(ROOT_VALUE);
  const [renaming, setRenaming] = useState<Album | null>(null);
  const [renameName, setRenameName] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Multi-select for bulk deletion — manual albums only (smart albums can't be
  // deleted). Local to this page; the anchor drives Shift-range selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const anchorRef = useRef<string | null>(null);

  // Hide date-relative smart albums (Today/This Week/This Month) when empty.
  const smart = albums.filter((a) => a.kind === "smart" && !isHiddenSmart(a));
  const manual = albums.filter((a) => a.kind === "manual");

  const manualOrder = manual.map((a) => a.id);
  const selectionActive = selectedIds.size > 0;
  // How many of the selected albums are mirror albums (deleting them trashes a
  // real on-disk folder) — drives the escalated confirmation copy.
  const mirrorCount = manual.filter(
    (a) => selectedIds.has(a.id) && a.folderPath != null,
  ).length;

  const toggleSelect = (id: string) => {
    anchorRef.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Select the inclusive range from the anchor to `id` within the manual grid. */
  const selectRangeTo = (id: string) => {
    const anchor = anchorRef.current;
    const a = anchor === null ? -1 : manualOrder.indexOf(anchor);
    const b = manualOrder.indexOf(id);
    if (a === -1 || b === -1) {
      toggleSelect(id);
      return;
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(manualOrder[i]!);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    anchorRef.current = null;
  };

  /** Card click: modifier / active-selection toggles; a plain click navigates. */
  const handleCardClick = (e: MouseEvent<HTMLElement>, id: string) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectRangeTo(id);
    } else if (e.ctrlKey || e.metaKey || selectionActive) {
      toggleSelect(id);
    } else {
      navigate(`/albums/${id}`);
    }
  };

  const confirmDeleteSelected = () => {
    const ids = manualOrder.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    deleteAlbums.mutate(ids, {
      onSuccess: () => {
        setConfirmDeleteOpen(false);
        clearSelection();
      },
    });
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createAlbum.mutate(
      { name, parentId: newParent === ROOT_VALUE ? null : newParent },
      {
        onSuccess: () => {
          setNewName("");
          setNewParent(ROOT_VALUE);
          setCreateOpen(false);
        },
      },
    );
  };

  const submitRename = () => {
    if (!renaming) return;
    const name = renameName.trim();
    if (!name) return;
    renameAlbum.mutate(
      { id: renaming.id, name },
      { onSuccess: () => setRenaming(null) },
    );
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {smart.length > 0 ? (
            <section>
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {t("albumsPage.smartAlbums")}
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {smart.map((album) => {
                  const Icon = albumIcon(album.icon);
                  return (
                    <Card
                      key={album.id}
                      onClick={() => navigate(`/albums/${album.id}`)}
                      className="group relative cursor-pointer overflow-hidden border-0 bg-card transition-colors hover:bg-accent"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                        {album.coverThumbPath ? (
                          <img
                            src={assetSrc(album.coverThumbPath)}
                            alt={album.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Icon className="h-8 w-8 text-primary" />
                          </div>
                        )}
                        <Badge variant="secondary" className="absolute right-2 top-2 text-xs">
                          {t("albumsPage.smartBadge")}
                        </Badge>
                      </div>
                      <CardContent className="p-4">
                        <p className="truncate font-medium text-foreground">{albumLabel(album, t)}</p>
                        <p className="text-xs text-muted-foreground">{t("albumsPage.photoCount", { count: album.count })}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-4 flex min-h-8 items-center justify-between gap-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {t("albumsPage.myAlbums")}
              </h2>
              {selectionActive ? (
                <div className="flex items-center gap-1.5">
                  <span className="px-1 text-sm text-muted-foreground">
                    {t("albumsPage.selectedCount", { count: selectedIds.size })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("common.delete")}
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={clearSelection}>
                    <X className="h-4 w-4" />
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {manual.map((album) => {
                const Icon = albumIcon(album.icon);
                const selected = selectedIds.has(album.id);
                return (
                  <Card
                    key={album.id}
                    onClick={(e) => handleCardClick(e, album.id)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("application/x-lumina-ids")) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        setDropTarget(album.id);
                      }
                    }}
                    onDragLeave={() => setDropTarget((c) => (c === album.id ? null : c))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTarget(null);
                      const photoIds = parseDragIds(e);
                      if (photoIds.length)
                        addToAlbum.mutate({ albumId: album.id, photoIds });
                    }}
                    className={cn(
                      "group relative cursor-pointer overflow-hidden border-0 bg-card transition-colors hover:bg-accent",
                      (selected || dropTarget === album.id) && "ring-2 ring-primary",
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                      {/* Selection checkbox (top-left; the actions menu owns top-right). */}
                      <button
                        type="button"
                        aria-label={selected ? t("albumsPage.deselectAlbum") : t("albumsPage.selectAlbum")}
                        aria-pressed={selected}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey) selectRangeTo(album.id);
                          else toggleSelect(album.id);
                        }}
                        className={cn(
                          "absolute left-2 top-2 z-10 flex h-[23px] w-[23px] items-center justify-center rounded-[5px] transition-all",
                          selected
                            ? "bg-primary text-primary-foreground shadow"
                            : "bg-black/30 text-white/90 ring-1 ring-inset ring-white/70 backdrop-blur-sm hover:bg-black/45",
                          selected || selectionActive
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>

                      {album.coverThumbPath ? (
                        <img
                          src={assetSrc(album.coverThumbPath)}
                          alt={album.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Icon className="h-8 w-8 text-primary" />
                        </div>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-2 top-2 h-7 w-7 bg-background/70 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background/90 group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t("albumsPage.albumActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            onSelect={() => {
                              setRenaming(album);
                              setRenameName(album.name);
                            }}
                          >
                            {t("common.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() => {
                              // Mirror albums trash their real folder — route
                              // through the strong confirmation dialog.
                              if (album.folderPath != null) {
                                useAlbumDelete
                                  .getState()
                                  .open({ id: album.id, name: album.name });
                              } else if (
                                confirm(t("albumsPage.deleteConfirm", { name: album.name }))
                              ) {
                                deleteAlbum.mutate(album.id);
                              }
                            }}
                          >
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <CardContent className="p-4">
                      <p className="truncate font-medium text-foreground">{album.name}</p>
                      <p className="text-xs text-muted-foreground">{t("albumsPage.photoCount", { count: album.count })}</p>
                    </CardContent>
                  </Card>
                );
              })}

              {/* New album */}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-medium">{t("albumsPage.newAlbum")}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Bulk-delete confirmation. Escalates its copy when the selection includes
          mirror albums, whose real folders would be moved to the Recycle Bin. */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        icon={
          mirrorCount > 0 ? (
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          ) : undefined
        }
        title={t("albumsPage.deleteSelectedTitle", { count: selectedIds.size })}
        description={
          mirrorCount > 0
            ? t("albumsPage.deleteSelectedMirror", { count: mirrorCount })
            : t("albumsPage.deleteSelectedDescription")
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        isPending={deleteAlbums.isPending}
        onConfirm={confirmDeleteSelected}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albumsPage.newAlbumTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("albumsPage.albumNamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && submitCreate()}
          />
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t("albumsPage.parentLabel")}</label>
            <Select value={newParent} onValueChange={setNewParent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>{t("albumsPage.noParent")}</SelectItem>
                {albumOptions(albums).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {" ".repeat(o.depth * 2) + o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitCreate} disabled={!newName.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albumsPage.renameAlbumTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder={t("albumsPage.albumNamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
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

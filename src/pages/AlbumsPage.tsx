import { useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Aperture,
  Calendar,
  CalendarDays,
  FolderHeart,
  Heart,
  MoreHorizontal,
  Plus,
  Sun,
  Video,
  type LucideIcon,
} from "lucide-react";

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
  useRenameAlbum,
} from "@/hooks/useAlbums";
import { albumLabel } from "@/lib/albumLabel";
import { albumOptions } from "@/lib/albumTree";
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
  const addToAlbum = useAddToAlbum();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>(ROOT_VALUE);
  const [renaming, setRenaming] = useState<Album | null>(null);
  const [renameName, setRenameName] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Hide date-relative smart albums (Today/This Week/This Month) when empty.
  const smart = albums.filter((a) => a.kind === "smart" && !isHiddenSmart(a));
  const manual = albums.filter((a) => a.kind === "manual");

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
                      className="group relative cursor-pointer border-0 bg-card transition-colors hover:bg-accent"
                    >
                      <CardContent className="flex flex-col gap-3 p-5">
                        <div className="flex items-center justify-between">
                          <Icon className="h-6 w-6 text-primary" />
                          <Badge variant="secondary" className="text-xs">
                            {t("albumsPage.smartBadge")}
                          </Badge>
                        </div>
                        <div>
                          <p className="truncate font-medium text-foreground">{albumLabel(album, t)}</p>
                          <p className="text-xs text-muted-foreground">{t("albumsPage.photoCount", { count: album.count })}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t("albumsPage.myAlbums")}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {manual.map((album) => {
                const Icon = albumIcon(album.icon);
                return (
                  <Card
                    key={album.id}
                    onClick={() => navigate(`/albums/${album.id}`)}
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
                    className={`group relative cursor-pointer border-0 bg-card transition-colors hover:bg-accent ${
                      dropTarget === album.id ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <CardContent className="flex flex-col gap-3 p-5">
                      <div className="flex items-center justify-between">
                        <Icon className="h-6 w-6 text-primary" />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
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
                      <div>
                        <p className="truncate font-medium text-foreground">{album.name}</p>
                        <p className="text-xs text-muted-foreground">{t("albumsPage.photoCount", { count: album.count })}</p>
                      </div>
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

import { useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAlbums,
  useCreateAlbum,
  useDeleteAlbum,
  useRenameAlbum,
} from "@/hooks/useAlbums";
import type { Album } from "@/types";

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
  const { data: albums = [], isLoading } = useAlbums();
  const navigate = useNavigate();

  const createAlbum = useCreateAlbum();
  const renameAlbum = useRenameAlbum();
  const deleteAlbum = useDeleteAlbum();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Album | null>(null);
  const [renameName, setRenameName] = useState("");

  const smart = albums.filter((a) => a.kind === "smart");
  const manual = albums.filter((a) => a.kind === "manual");

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createAlbum.mutate(name, {
      onSuccess: () => {
        setNewName("");
        setCreateOpen(false);
      },
    });
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
                Smart Albums
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
                            Smart
                          </Badge>
                        </div>
                        <div>
                          <p className="truncate font-medium text-foreground">{album.name}</p>
                          <p className="text-xs text-muted-foreground">{album.count} photos</p>
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
              My Albums
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {manual.map((album) => {
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Album actions"
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
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                if (confirm(`Delete album "${album.name}"?`))
                                  deleteAlbum.mutate(album.id);
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div>
                        <p className="truncate font-medium text-foreground">{album.name}</p>
                        <p className="text-xs text-muted-foreground">{album.count} photos</p>
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
                <span className="text-sm font-medium">New Album</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New album</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Album name"
            onKeyDown={(e) => e.key === "Enter" && submitCreate()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
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
            <Button variant="ghost" onClick={() => setRenaming(null)}>
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

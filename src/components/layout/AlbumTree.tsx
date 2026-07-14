/**
 * Collapsible, drag-and-drop tree of manual albums for the sidebar.
 *
 * Drag an album onto the middle of another to nest it; onto the top/bottom edge
 * to reorder it before/after that sibling; onto the root strip to un-nest it.
 * Dropping *photos* (payload `application/x-lumina-ids`) onto an album still
 * adds them to that album — the two gestures are told apart by MIME type.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useMatch } from "react-router-dom";
import {
  Aperture,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FolderHeart,
  FolderSync,
  Heart,
  Pencil,
  Sun,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { useAddToAlbum, useDeleteAlbum, useMoveAlbum, useRenameAlbum } from "@/hooks/useAlbums";
import {
  buildAlbumTree,
  descendantIds,
  flattenVisible,
  type AlbumNode,
} from "@/lib/albumTree";
import { cn } from "@/lib/utils";
import { useAlbumDelete } from "@/stores/albumDeleteStore";
import { useUiStore } from "@/stores/uiStore";
import type { Album } from "@/types";

const ALBUM_MIME = "application/x-lumina-album";
const PHOTO_MIME = "application/x-lumina-ids";

/** Map a backend album icon name to a lucide icon, with a sensible fallback. */
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

function bySiblingOrder(a: Album, b: Album): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

type Position = "before" | "inside" | "after";
interface Indicator {
  targetId: string | null; // null = the root drop strip
  position: Position | "root";
}

/** Read dragged Lumina photo ids off a drag event, or null when absent. */
function readPhotoIds(e: DragEvent): string[] | null {
  const raw = e.dataTransfer.getData(PHOTO_MIME);
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

export function AlbumTree({ albums }: { albums: Album[] }) {
  const { t } = useTranslation();
  const collapsedList = useUiStore((s) => s.collapsedAlbums);
  const toggleCollapsed = useUiStore((s) => s.toggleAlbumCollapsed);
  const moveAlbum = useMoveAlbum();
  const addToAlbum = useAddToAlbum();
  const renameAlbum = useRenameAlbum();
  const deleteAlbum = useDeleteAlbum();

  const [dragId, setDragId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Commit an inline rename, ignoring empty or unchanged names. */
  const commitRename = (album: Album, raw: string) => {
    const name = raw.trim();
    if (name && name !== album.name) renameAlbum.mutate({ id: album.id, name });
    setEditingId(null);
  };

  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const tree = useMemo(() => buildAlbumTree(albums), [albums]);
  const visible = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed]);

  const manual = useMemo(() => albums.filter((a) => a.kind === "manual"), [albums]);
  const idSet = useMemo(() => new Set(manual.map((a) => a.id)), [manual]);
  const parentOf = (a: Album): string | null =>
    a.parentId && idSet.has(a.parentId) ? a.parentId : null;
  const siblingsOf = (parentId: string | null): Album[] =>
    manual.filter((a) => parentOf(a) === parentId).sort(bySiblingOrder);

  const clearDrag = () => {
    setDragId(null);
    setIndicator(null);
    setPhotoTarget(null);
  };

  /** Resolve where a reorder/reparent would land, or null if it's not allowed. */
  const resolveDrop = (
    target: Album,
    position: Position,
    dragged: string,
  ): { parentId: string | null; index: number } | null => {
    if (target.id === dragged) return null;
    const descendants = descendantIds(albums, dragged);
    const resultParent = position === "inside" ? target.id : parentOf(target);
    if (resultParent === dragged) return null;
    if (resultParent && descendants.has(resultParent)) return null;

    if (position === "inside") {
      const others = siblingsOf(target.id).filter((a) => a.id !== dragged);
      return { parentId: target.id, index: others.length };
    }
    const parentId = parentOf(target);
    const others = siblingsOf(parentId).filter((a) => a.id !== dragged);
    const ti = others.findIndex((a) => a.id === target.id);
    return { parentId, index: position === "before" ? ti : ti + 1 };
  };

  const onRowDragOver = (album: Album) => (e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes(ALBUM_MIME) && dragId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;
      const position: Position = y < third ? "before" : y > 2 * third ? "after" : "inside";
      if (!resolveDrop(album, position, dragId)) {
        setIndicator(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIndicator({ targetId: album.id, position });
    } else if (types.includes(PHOTO_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setPhotoTarget(album.id);
    }
  };

  const onRowDrop = (album: Album) => (e: DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(ALBUM_MIME);
    if (draggedId) {
      const position = indicator?.targetId === album.id ? indicator.position : "inside";
      const landing = resolveDrop(album, position as Position, draggedId);
      if (landing) {
        // Reveal the destination when nesting into a collapsed parent, so the
        // moved album doesn't silently vanish under a folded row.
        if (position === "inside" && collapsed.has(album.id)) toggleCollapsed(album.id);
        moveAlbum.mutate({ id: draggedId, parentId: landing.parentId, newIndex: landing.index });
      }
      clearDrag();
      return;
    }
    const ids = readPhotoIds(e);
    if (ids && ids.length > 0) addToAlbum.mutate({ albumId: album.id, photoIds: ids });
    clearDrag();
  };

  const onRootDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(ALBUM_MIME) || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIndicator({ targetId: null, position: "root" });
  };

  const onRootDrop = (e: DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(ALBUM_MIME);
    if (draggedId) {
      const others = siblingsOf(null).filter((a) => a.id !== draggedId);
      moveAlbum.mutate({ id: draggedId, parentId: null, newIndex: others.length });
    }
    clearDrag();
  };

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map((node) => (
        <AlbumRow
          key={node.album.id}
          node={node}
          collapsed={collapsed.has(node.album.id)}
          dimmed={dragId === node.album.id}
          indicator={indicator?.targetId === node.album.id ? indicator.position : null}
          photoActive={photoTarget === node.album.id}
          editing={editingId === node.album.id}
          onStartRename={() => setEditingId(node.album.id)}
          onCommitRename={(name) => commitRename(node.album, name)}
          onCancelRename={() => setEditingId(null)}
          onDelete={() => {
            // Deleting a mirror album trashes its real folder — gate that behind
            // a strong confirmation. Virtual albums delete immediately as before.
            if (node.album.folderPath != null) {
              useAlbumDelete.getState().open({ id: node.album.id, name: node.album.name });
            } else {
              deleteAlbum.mutate(node.album.id);
            }
          }}
          onToggle={() => toggleCollapsed(node.album.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData(ALBUM_MIME, node.album.id);
            e.dataTransfer.effectAllowed = "move";
            setDragId(node.album.id);
          }}
          onDragOver={onRowDragOver(node.album)}
          onDragLeave={() => {
            setIndicator((c) => (c?.targetId === node.album.id ? null : c));
            setPhotoTarget((c) => (c === node.album.id ? null : c));
          }}
          onDrop={onRowDrop(node.album)}
          onDragEnd={clearDrag}
        />
      ))}
      {/* Root drop strip: drag an album here to move it out of any parent. */}
      <div
        onDragOver={onRootDragOver}
        onDrop={onRootDrop}
        onDragLeave={() => setIndicator((c) => (c?.position === "root" ? null : c))}
        className={cn(
          "mt-0.5 h-2 rounded transition-colors",
          indicator?.position === "root" && "h-6 bg-primary/15 ring-1 ring-primary",
          dragId && indicator?.position !== "root" && "h-4",
        )}
        aria-hidden
      >
        {indicator?.position === "root" ? (
          <span className="flex h-full items-center px-3 text-xs text-primary">
            {t("shell.moveToRoot")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface RowProps {
  node: AlbumNode;
  collapsed: boolean;
  dimmed: boolean;
  indicator: Position | "root" | null;
  photoActive: boolean;
  editing: boolean;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: (e: DragEvent) => void;
}

function AlbumRow({
  node,
  collapsed,
  dimmed,
  indicator,
  photoActive,
  editing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onToggle,
  ...drag
}: RowProps) {
  const { t } = useTranslation();
  const { album, depth, children } = node;
  const Icon = albumIcon(album.icon);
  const hasChildren = children.length > 0;
  // Compute active state manually: NavLink's function-className form is
  // incompatible with the Radix ContextMenuTrigger Slot (it stringifies the
  // function, turning its source into bogus class names), so we pass a plain
  // string className instead.
  const isActive = !!useMatch(`/albums/${album.id}`);

  // Ensure Enter/Escape and the trailing blur don't both fire an action: the
  // first one to resolve wins, the blur that follows unmount is ignored.
  const resolved = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) resolved.current = false;
  }, [editing]);

  const commit = (value: string) => {
    if (resolved.current) return;
    resolved.current = true;
    onCommitRename(value);
  };
  const cancel = () => {
    if (resolved.current) return;
    resolved.current = true;
    onCancelRename();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") commit(e.currentTarget.value);
    else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <NavLink
          to={`/albums/${album.id}`}
          draggable={!editing}
          {...drag}
          // Suppress navigation while inline-editing the album's name.
          onClick={(e) => {
            if (editing) e.preventDefault();
          }}
          style={{ paddingLeft: 12 + depth * 14 }}
          className={cn(
            "group flex items-center gap-2 rounded-lg py-2 pr-3 text-sm outline-none transition-colors",
            isActive
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            dimmed && "opacity-40",
            (indicator === "inside" || photoActive) &&
              "bg-accent text-foreground ring-1 ring-primary",
            indicator === "before" && "[box-shadow:inset_0_2px_0_0_hsl(var(--primary))]",
            indicator === "after" && "[box-shadow:inset_0_-2px_0_0_hsl(var(--primary))]",
          )}
        >
          {hasChildren ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
              }}
              className="flex h-[18px] w-[14px] shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
          <Icon className="h-[18px] w-[18px] shrink-0" />
          {editing ? (
            <Input
              ref={inputRef}
              defaultValue={album.name}
              autoFocus
              onFocus={(e) => e.target.select()}
              // The row is an <a>: a bare stopPropagation would keep the click
              // from reaching NavLink's edit-mode guard, so the link would
              // still navigate (stopPropagation doesn't cancel default nav).
              // preventDefault cancels the navigation; stopPropagation keeps the
              // click from bubbling to the now-redundant NavLink handler.
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={onInputKeyDown}
              onBlur={(e) => commit(e.currentTarget.value)}
              className="h-6 flex-1 px-1.5 py-0 text-sm"
            />
          ) : (
            <span className="flex-1 truncate">{album.name}</span>
          )}
          {album.folderPath != null ? (
            <FolderSync
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-label={t("shell.mirrorAlbum")}
            />
          ) : null}
          <span className="text-xs text-muted-foreground">{album.count}</span>
        </NavLink>
      </ContextMenuTrigger>

      <ContextMenuContent
        className="w-44"
        // Radix returns focus to the trigger (this row's <a>) when the menu
        // closes, which would steal focus from the rename input that just
        // mounted. Suppress that and focus the input ourselves instead.
        onCloseAutoFocus={(e) => {
          if (inputRef.current) {
            e.preventDefault();
            inputRef.current.focus();
            inputRef.current.select();
          }
        }}
      >
        <ContextMenuItem onSelect={() => onStartRename()}>
          <Pencil className="h-4 w-4 text-muted-foreground" />
          {t("shell.renameAlbum")}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete()}
        >
          <Trash2 className="h-4 w-4" />
          {t("shell.deleteAlbum")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

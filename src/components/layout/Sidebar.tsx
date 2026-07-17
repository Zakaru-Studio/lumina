import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Aperture,
  Calendar,
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderHeart,
  Heart,
  Images,
  Map as MapIcon,
  Plus,
  Settings,
  Sun,
  Tag as TagIcon,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import { AlbumTree } from "@/components/layout/AlbumTree";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAlbums, useCreateAlbum } from "@/hooks/useAlbums";
import { useLibraryStats } from "@/hooks/usePhotos";
import { useTags } from "@/hooks/useTags";
import { albumLabel } from "@/lib/albumLabel";
import { albumOptions } from "@/lib/albumTree";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import type { Album } from "@/types";

/** Sentinel Select value for "no parent" (Radix Select forbids empty values). */
const ROOT_VALUE = "__root__";

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

/**
 * Smart albums that are just noise when empty — the date-relative ones plus
 * Favorites — are hidden from the sidebar while they contain no media.
 */
const HIDE_WHEN_EMPTY = new Set(["today", "week", "month", "favorites"]);
function hideEmptySmart(album: Album): boolean {
  const preset = (album.rule?.preset as string | undefined) ?? "";
  return HIDE_WHEN_EMPTY.has(preset) && album.count === 0;
}

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", labelKey: "nav.library", icon: Images, end: true },
  { to: "/timeline", labelKey: "nav.timeline", icon: CalendarDays },
  { to: "/map", labelKey: "nav.map", icon: MapIcon },
  { to: "/people", labelKey: "nav.people", icon: Users },
  { to: "/albums", labelKey: "nav.albums", icon: FolderHeart, end: true },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, end: true },
];

/**
 * Left navigation rail. Collapses to a 64px icon-only rail. Lists primary nav,
 * smart albums, manual albums (droppable — dropping photos adds them), and the
 * first handful of tags. An import action sits at the bottom.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const collapsedAlbums = useUiStore((s) => s.collapsedAlbums);
  const setCollapsedAlbums = useUiStore((s) => s.setCollapsedAlbums);
  const navigate = useNavigate();
  const { data: albums = [] } = useAlbums();
  const { data: tags = [] } = useTags();
  const { data: stats } = useLibraryStats();
  const createAlbum = useCreateAlbum();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>(ROOT_VALUE);

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createAlbum.mutate(
      { name, parentId: newParent === ROOT_VALUE ? null : newParent },
      {
        onSuccess: (album) => {
          setNewName("");
          setNewParent(ROOT_VALUE);
          setCreateOpen(false);
          navigate(`/albums/${album.id}`);
        },
      },
    );
  };

  const smartAlbums = albums.filter((a) => a.kind === "smart" && !hideEmptySmart(a));

  // Ids of manual albums that have at least one manual child — the only rows
  // that can be folded, and thus the targets of the collapse/expand-all action.
  const manualAlbums = albums.filter((a) => a.kind === "manual");
  const manualIds = new Set(manualAlbums.map((a) => a.id));
  const expandableIds = manualAlbums
    .filter((a) => a.parentId && manualIds.has(a.parentId))
    .map((a) => a.parentId as string);
  const parentIds = Array.from(new Set(expandableIds));
  const allCollapsed =
    parentIds.length > 0 && parentIds.every((id) => collapsedAlbums.includes(id));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
      collapsed && "justify-center px-0",
      isActive
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    );

  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col gap-1 bg-card/40 p-3 transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "drag-region flex items-center gap-2 px-2 pb-3",
          collapsed && "justify-center px-0",
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <Aperture className="h-4 w-4 text-white" />
        </div>
        {!collapsed ? (
          <span className="text-base font-semibold tracking-tight text-foreground">Lumina</span>
        ) : null}
      </div>

      {/* Primary nav */}
      <div className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          // Total media count shown to the right of the Library entry.
          const count = item.to === "/" ? stats?.total : undefined;
          const link = (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed ? (
                <>
                  <span className="flex-1 truncate">{label}</span>
                  {count !== undefined ? (
                    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  ) : null}
                </>
              ) : null}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </div>

      {/* Scrollable groups */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!collapsed && smartAlbums.length > 0 ? (
          <SidebarGroup label={t("shell.smartAlbums")}>
            {smartAlbums.map((album) => {
              const Icon = albumIcon(album.icon);
              return (
                <NavLink key={album.id} to={`/albums/${album.id}`} className={linkClass}>
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">{albumLabel(album, t)}</span>
                  <span className="text-xs text-muted-foreground">{album.count}</span>
                </NavLink>
              );
            })}
          </SidebarGroup>
        ) : null}

        {!collapsed ? (
          <SidebarGroup
            label={t("shell.myAlbums")}
            action={
              <div className="flex items-center gap-0.5">
                {parentIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setCollapsedAlbums(allCollapsed ? [] : parentIds)}
                    aria-label={allCollapsed ? t("shell.expandAll") : t("shell.collapseAll")}
                    title={allCollapsed ? t("shell.expandAll") : t("shell.collapseAll")}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    {allCollapsed ? (
                      <ChevronsUpDown className="h-4 w-4" />
                    ) : (
                      <ChevronsDownUp className="h-4 w-4" />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  aria-label={t("shell.createAlbum")}
                  title={t("shell.createAlbum")}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            }
          >
            <AlbumTree albums={albums} />
          </SidebarGroup>
        ) : null}

        {!collapsed && tags.length > 0 ? (
          <SidebarGroup label={t("shell.tags")}>
            {tags.slice(0, 8).map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => navigate(`/?q=${encodeURIComponent(tag.name)}`)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <TagIcon className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1 truncate text-left">{tag.name}</span>
                <span className="text-xs text-muted-foreground">{tag.count}</span>
              </button>
            ))}
          </SidebarGroup>
        ) : null}
      </div>

      {/* Quick album creation */}
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
                    {" ".repeat(o.depth * 2) + o.name}
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
    </nav>
  );
}

/** Small titled group wrapper used inside the sidebar, with an optional header
 * action pinned to the right of the title (same line). */
function SidebarGroup({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <Separator className="mb-2" />
      <div className="flex items-center justify-between px-3 pb-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {action}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}


import type { ComponentType, DragEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Aperture,
  Calendar,
  CalendarDays,
  FolderHeart,
  FolderInput,
  Heart,
  Images,
  Search,
  Settings,
  Sun,
  Tag as TagIcon,
  Video,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAddToAlbum, useAlbums } from "@/hooks/useAlbums";
import { useScanControls } from "@/hooks/useScan";
import { useTags } from "@/hooks/useTags";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import type { Album } from "@/types";

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

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Library", icon: Images, end: true },
  { to: "/timeline", label: "Timeline", icon: CalendarDays },
  { to: "/search", label: "Search", icon: Search },
  { to: "/albums", label: "Albums", icon: FolderHeart, end: true },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Read dragged Lumina photo ids off a drag event, or null when absent. */
function readIds(e: DragEvent): string[] | null {
  const raw = e.dataTransfer.getData("application/x-lumina-ids");
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Left navigation rail. Collapses to a 64px icon-only rail. Lists primary nav,
 * smart albums, manual albums (droppable — dropping photos adds them), and the
 * first handful of tags. An import action sits at the bottom.
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const navigate = useNavigate();
  const { data: albums = [] } = useAlbums();
  const { data: tags = [] } = useTags();
  const { importFolders } = useScanControls();
  const addToAlbum = useAddToAlbum();

  const smartAlbums = albums.filter((a) => a.kind === "smart");
  const manualAlbums = albums.filter((a) => a.kind === "manual");

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
      collapsed && "justify-center px-0",
      isActive
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    );

  const onDropAlbum = (album: Album) => (e: DragEvent) => {
    e.preventDefault();
    const ids = readIds(e);
    if (ids && ids.length > 0) addToAlbum.mutate({ albumId: album.id, photoIds: ids });
  };

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
          "drag-region flex items-center gap-2 px-2 py-3",
          collapsed && "justify-center px-0",
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Aperture className="h-4 w-4" />
        </div>
        {!collapsed ? (
          <span className="text-base font-semibold tracking-tight text-foreground">Lumina</span>
        ) : null}
      </div>

      {/* Primary nav */}
      <div className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const link = (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </div>

      {/* Scrollable groups */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!collapsed && smartAlbums.length > 0 ? (
          <SidebarGroup label="Smart Albums">
            {smartAlbums.map((album) => {
              const Icon = albumIcon(album.icon);
              return (
                <NavLink key={album.id} to={`/albums/${album.id}`} className={linkClass}>
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">{album.name}</span>
                  <span className="text-xs text-muted-foreground">{album.count}</span>
                </NavLink>
              );
            })}
          </SidebarGroup>
        ) : null}

        {!collapsed && manualAlbums.length > 0 ? (
          <SidebarGroup label="My Albums">
            {manualAlbums.map((album) => {
              const Icon = albumIcon(album.icon);
              return (
                <NavLink
                  key={album.id}
                  to={`/albums/${album.id}`}
                  className={linkClass}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropAlbum(album)}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">{album.name}</span>
                  <span className="text-xs text-muted-foreground">{album.count}</span>
                </NavLink>
              );
            })}
          </SidebarGroup>
        ) : null}

        {!collapsed && tags.length > 0 ? (
          <SidebarGroup label="Tags">
            {tags.slice(0, 8).map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => navigate("/search")}
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

      {/* Import */}
      <div className="pt-1">
        <ImportButton
          collapsed={collapsed}
          onClick={() => importFolders.mutate()}
          icon={FolderInput}
        />
      </div>
    </nav>
  );
}

/** Small titled group wrapper used inside the sidebar. */
function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <Separator className="mb-2" />
      <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** Import action button, adapting to the collapsed rail. */
function ImportButton({
  collapsed,
  onClick,
  icon: Icon,
}: {
  collapsed: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" className="w-full" onClick={onClick}>
            <Icon className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Import folders</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button variant="secondary" className="w-full justify-start gap-2" onClick={onClick}>
      <Icon className="h-[18px] w-[18px]" />
      Import folders
    </Button>
  );
}

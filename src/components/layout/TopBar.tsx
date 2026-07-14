import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { FolderInput, PanelLeft, Search } from "lucide-react";

import { ThemeToggle } from "@/components/common/ThemeToggle";
import { UpdateBadge } from "@/components/updater/UpdateBadge";
import { WindowControls } from "@/components/layout/WindowControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScanControls } from "@/hooks/useScan";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";

/** Derive a translation key for the page title, or null for the product name. */
function pageTitleKey(pathname: string): string | null {
  if (pathname === "/") return "nav.library";
  if (pathname.startsWith("/timeline")) return "nav.timeline";
  if (pathname.startsWith("/search")) return "nav.search";
  if (pathname.startsWith("/albums")) return "nav.albums";
  if (pathname.startsWith("/settings")) return "nav.settings";
  return null;
}

/**
 * Slim, airy top bar. The whole strip is a window drag region except the
 * interactive controls. Hosts the page title, a command-palette search pill,
 * theme toggle and sidebar collapse control.
 */
export function TopBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const selectedCount = useSelectionStore((s) => s.selected.size);
  const { importFolders } = useScanControls();

  const titleKey = pageTitleKey(location.pathname);
  const title = titleKey ? t(titleKey) : "Lumina";

  return (
    <header className="drag-region flex h-12 shrink-0 items-center gap-3 px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="no-drag"
            aria-label={t("shell.toggleSidebar")}
            onClick={toggleSidebar}
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("shell.toggleSidebar")}</TooltipContent>
      </Tooltip>

      <h1 className="text-sm font-medium text-foreground">{title}</h1>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="no-drag ml-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
      >
        <Search className="h-4 w-4" />
        <span>{t("shell.searchPill")}</span>
        <kbd className="ml-6 rounded bg-background/60 px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>

      <Button
        variant="secondary"
        size="sm"
        className="no-drag gap-2"
        onClick={() => importFolders.mutate()}
      >
        <FolderInput className="h-4 w-4" />
        {t("shell.importFolders")}
      </Button>

      <div className="ml-auto flex items-center gap-1">
        {selectedCount > 0 ? (
          <Badge variant="secondary" className="no-drag mr-1">
            {t("shell.selectedCount", { n: selectedCount })}
          </Badge>
        ) : null}
        <UpdateBadge />
        <ThemeToggle />
      </div>

      {/* Custom window controls (frameless window) pinned to the top-right corner. */}
      <div className="-mr-3 self-stretch">
        <WindowControls />
      </div>
    </header>
  );
}

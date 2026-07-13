import { useLocation } from "react-router-dom";
import { PanelLeft, Search } from "lucide-react";

import { ThemeToggle } from "@/components/common/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";

/** Derive a human page title from the current pathname. */
function pageTitle(pathname: string): string {
  if (pathname === "/") return "Library";
  if (pathname.startsWith("/timeline")) return "Timeline";
  if (pathname.startsWith("/search")) return "Search";
  if (pathname.startsWith("/albums")) return "Albums";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Lumina";
}

/**
 * Slim, airy top bar. The whole strip is a window drag region except the
 * interactive controls. Hosts the page title, a command-palette search pill,
 * theme toggle and sidebar collapse control.
 */
export function TopBar() {
  const location = useLocation();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const selectedCount = useSelectionStore((s) => s.selected.size);

  return (
    <header className="drag-region flex h-12 shrink-0 items-center gap-3 px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="no-drag"
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle sidebar</TooltipContent>
      </Tooltip>

      <h1 className="text-sm font-medium text-foreground">{pageTitle(location.pathname)}</h1>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="no-drag ml-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
      >
        <Search className="h-4 w-4" />
        <span>Search…</span>
        <kbd className="ml-6 rounded bg-background/60 px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {selectedCount > 0 ? (
          <Badge variant="secondary" className="no-drag mr-1">
            {selectedCount} selected
          </Badge>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}

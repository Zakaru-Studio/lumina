import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  FolderHeart,
  FolderInput,
  Images,
  Search,
  Settings,
} from "lucide-react";

import { Thumbnail } from "@/components/library/Thumbnail";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import * as api from "@/lib/api";
import { formatCamera } from "@/lib/format";
import { buildQuery } from "@/lib/query";
import { useScanControls } from "@/hooks/useScan";
import { useUiStore } from "@/stores/uiStore";

/**
 * Global command palette (Ctrl/Cmd+K). Offers quick navigation, folder import,
 * and an instant, debounced photo search. Selecting any item closes the palette.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const { importFolders } = useScanControls();

  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 150);
    return () => clearTimeout(t);
  }, [text]);

  // Reset the query when the palette closes.
  useEffect(() => {
    if (!open) {
      setText("");
      setDebounced("");
    }
  }, [open]);

  const results = useQuery({
    queryKey: ["command", "search", debounced],
    queryFn: () => api.listPhotos(buildQuery({ filter: { text: debounced }, limit: 12 })),
    enabled: open && debounced.trim().length > 0,
  });

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const photos = results.data?.items ?? [];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search photos or jump to…"
        value={text}
        onValueChange={setText}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/")}>
            <Images className="mr-2 h-4 w-4" /> Library
          </CommandItem>
          <CommandItem onSelect={() => go("/timeline")}>
            <CalendarDays className="mr-2 h-4 w-4" /> Timeline
          </CommandItem>
          <CommandItem onSelect={() => go("/search")}>
            <Search className="mr-2 h-4 w-4" /> Search
          </CommandItem>
          <CommandItem onSelect={() => go("/albums")}>
            <FolderHeart className="mr-2 h-4 w-4" /> Albums
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings className="mr-2 h-4 w-4" /> Settings
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              importFolders.mutate();
            }}
          >
            <FolderInput className="mr-2 h-4 w-4" /> Import folders…
          </CommandItem>
        </CommandGroup>

        {photos.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Photos">
              {photos.map((photo) => (
                <CommandItem
                  key={photo.id}
                  value={`${photo.id}-${photo.filename}`}
                  onSelect={() => go(`/search?q=${encodeURIComponent(debounced)}`)}
                >
                  <div className="mr-2 h-8 w-8 shrink-0 overflow-hidden rounded">
                    <Thumbnail photo={photo} />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{photo.filename}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatCamera(photo)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

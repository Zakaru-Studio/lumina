/**
 * Shared wiring for a windowed photo view. The library and search pages both
 * need the same machinery around a {@link PhotoQuery}: the full ordered id list
 * (sizes the scrollbar), the detail window (fetches only the visible range), a
 * lightbox index, and grid-scoped keyboard shortcuts. This hook owns all of it
 * and hands back ready-to-spread `grid` / `lightbox` props, so a page only
 * supplies the query and its own header / empty states.
 *
 * (The timeline uses a bespoke date-sectioned grid, and album detail pages a
 * cursor-paginated infinite query — neither fits this windowed model, so they
 * wire their data directly.)
 */
import { useState } from "react";

import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { usePhotoIds, usePhotoWindow } from "@/hooks/useWindowedPhotos";
import type { PhotoQuery } from "@/types";

export function usePhotoBrowser(query: PhotoQuery, enabled = true) {
  const { data: ids = [], isLoading: idsLoading } = usePhotoIds(query, enabled);
  const win = usePhotoWindow(query, enabled);
  const [index, setIndex] = useState<number | null>(null);
  // Grid shortcuts are disabled while the lightbox is open.
  useGlobalShortcuts(ids, { onOpen: setIndex, enabled: index === null });

  return {
    /** The full ordered id list for the query (`total = ids.length`). */
    ids,
    /** Total matching photos, per the window's first page. */
    total: win.total,
    /** The ordered id list is still loading. */
    idsLoading,
    /** The first detail window is still loading. */
    windowLoading: win.isLoading,
    /** Open the lightbox at a flat photo index (also the grid's `onOpen`). */
    openAt: setIndex,
    /** Spread into `<PhotoGrid>`. */
    grid: {
      ids,
      getPhoto: win.getPhoto,
      onOpen: setIndex,
      onVisibleRangeChange: win.setRange,
    },
    /** Spread into `<Lightbox>`. */
    lightbox: {
      ids,
      index,
      getPhoto: win.getPhoto,
      onClose: () => setIndex(null),
      onIndexChange: setIndex,
    },
  };
}

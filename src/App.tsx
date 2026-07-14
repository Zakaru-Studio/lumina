import { Suspense, lazy, useEffect } from "react";
import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { UpdatePrompt } from "@/components/updater/UpdatePrompt";
import { dismissSplashscreen } from "@/lib/splash";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryPage } from "@/pages/LibraryPage";
import { TimelinePage } from "@/pages/TimelinePage";
import { SearchPage } from "@/pages/SearchPage";

// The map pulls in bundled world-geometry vectors + d3-geo; load it on demand
// so those bytes never weigh down the initial (non-map) app start.
const MapPage = lazy(() =>
  import("@/pages/MapPage").then((m) => ({ default: m.MapPage })),
);
import { AlbumsPage } from "@/pages/AlbumsPage";
import { AlbumDetailPage } from "@/pages/AlbumDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";

/**
 * Route table. All pages render inside the persistent {@link AppShell}, which
 * owns the sidebar, top bar, command palette, scan-progress bar and global
 * side-effects (theme sync, scan-event subscription, keyboard shortcuts).
 */
export default function App() {
  // Once the shell has painted, swap the splashscreen for the main window.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void dismissSplashscreen());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <UpdatePrompt />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LibraryPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route
            path="map"
            element={
              <Suspense fallback={<div className="h-full p-6"><Skeleton className="h-full w-full rounded-2xl" /></div>}>
                <MapPage />
              </Suspense>
            }
          />
          <Route path="search" element={<SearchPage />} />
          <Route path="albums" element={<AlbumsPage />} />
          <Route path="albums/:albumId" element={<AlbumDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}

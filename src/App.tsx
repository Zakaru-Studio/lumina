import { lazy, useEffect } from "react";
import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { UpdatePrompt } from "@/components/updater/UpdatePrompt";
import { dismissSplashscreen } from "@/lib/splash";
import { LibraryPage } from "@/pages/LibraryPage";

// Only the initial Library route ships in the main bundle. Every other page is
// code-split and loaded on demand — including the map's bundled world-geometry
// vectors + d3-geo. A shared <Suspense> lives in AppShell around the routed
// <Outlet>, so no per-route boilerplate is needed here.
const TimelinePage = lazy(() => import("@/pages/TimelinePage").then((m) => ({ default: m.TimelinePage })));
const SearchPage = lazy(() => import("@/pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const MapPage = lazy(() => import("@/pages/MapPage").then((m) => ({ default: m.MapPage })));
const AlbumsPage = lazy(() => import("@/pages/AlbumsPage").then((m) => ({ default: m.AlbumsPage })));
const AlbumDetailPage = lazy(() => import("@/pages/AlbumDetailPage").then((m) => ({ default: m.AlbumDetailPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

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
          <Route path="map" element={<MapPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="albums" element={<AlbumsPage />} />
          <Route path="albums/:albumId" element={<AlbumDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}

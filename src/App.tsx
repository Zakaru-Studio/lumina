import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { LibraryPage } from "@/pages/LibraryPage";
import { TimelinePage } from "@/pages/TimelinePage";
import { SearchPage } from "@/pages/SearchPage";
import { AlbumsPage } from "@/pages/AlbumsPage";
import { AlbumDetailPage } from "@/pages/AlbumDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";

/**
 * Route table. All pages render inside the persistent {@link AppShell}, which
 * owns the sidebar, top bar, command palette, scan-progress bar and global
 * side-effects (theme sync, scan-event subscription, keyboard shortcuts).
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LibraryPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="albums" element={<AlbumsPage />} />
        <Route path="albums/:albumId" element={<AlbumDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

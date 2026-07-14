import { Suspense, lazy } from "react";
import { Outlet } from "react-router-dom";

import { BackupDeviceDialog } from "@/components/backup/BackupDeviceDialog";
import { DeleteMirrorAlbumDialog } from "@/components/library/DeleteMirrorAlbumDialog";
import { DeletePhotosDialog } from "@/components/library/DeletePhotosDialog";
import { FolderSyncModePrompt } from "@/components/library/FolderSyncModePrompt";
import { ImportAlbumsDialog } from "@/components/library/ImportAlbumsDialog";
import { RenamePhotoDialog } from "@/components/library/RenamePhotoDialog";
import { ScanProgressBar } from "@/components/layout/ScanProgressBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useBackupEvents } from "@/hooks/useBackup";
import { useScanEvents } from "@/hooks/useScan";
import { useThemeSync } from "@/hooks/useSettings";
import { useAppShortcuts } from "@/hooks/useKeyboard";

// Heavy, on-demand surfaces kept out of the initial bundle: the image editor
// (canvas render pipeline) only mounts once a photo is opened for editing, and
// the command palette (cmdk) only on Ctrl+K — both are toggled via stores, so
// lazy-loading doesn't affect their triggers.
const CommandPalette = lazy(() =>
  import("@/components/command/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const ImageEditor = lazy(() =>
  import("@/components/editor/ImageEditor").then((m) => ({ default: m.ImageEditor })),
);

/**
 * The persistent application shell: sidebar + top bar + routed content, with the
 * command palette and scan-progress bar mounted once. Owns global side-effects
 * (scan events, theme sync, global keyboard shortcuts).
 */
export function AppShell() {
  useScanEvents();
  useBackupEvents();
  useThemeSync();
  useAppShortcuts();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="relative flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="h-full p-6">
                  <Skeleton className="h-full w-full rounded-2xl" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
            <ScanProgressBar />
          </main>
        </div>
        <Suspense fallback={null}>
          <CommandPalette />
          <ImageEditor />
        </Suspense>
        <DeletePhotosDialog />
        <ImportAlbumsDialog />
        <FolderSyncModePrompt />
        <RenamePhotoDialog />
        <DeleteMirrorAlbumDialog />
        <BackupDeviceDialog />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

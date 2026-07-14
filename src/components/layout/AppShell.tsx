import { Outlet } from "react-router-dom";

import { BackupDeviceDialog } from "@/components/backup/BackupDeviceDialog";
import { CommandPalette } from "@/components/command/CommandPalette";
import { ImageEditor } from "@/components/editor/ImageEditor";
import { DeleteMirrorAlbumDialog } from "@/components/library/DeleteMirrorAlbumDialog";
import { DeletePhotosDialog } from "@/components/library/DeletePhotosDialog";
import { FolderSyncModePrompt } from "@/components/library/FolderSyncModePrompt";
import { ImportAlbumsDialog } from "@/components/library/ImportAlbumsDialog";
import { RenamePhotoDialog } from "@/components/library/RenamePhotoDialog";
import { ScanProgressBar } from "@/components/layout/ScanProgressBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useBackupEvents } from "@/hooks/useBackup";
import { useScanEvents } from "@/hooks/useScan";
import { useThemeSync } from "@/hooks/useSettings";
import { useAppShortcuts } from "@/hooks/useKeyboard";

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
            <Outlet />
            <ScanProgressBar />
          </main>
        </div>
        <CommandPalette />
        <ImageEditor />
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

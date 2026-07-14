import { useTranslation } from "react-i18next";
import { FolderSync, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfig, useUpdateConfig } from "@/hooks/useSettings";
import { useFolderSyncMode } from "@/stores/folderSyncModeStore";

/**
 * First-import choice modal. Asked once (when `folderSyncMode` is still unset)
 * before the very first import, it lets the user pick between two folder
 * philosophies:
 *
 *  - **mirror** — albums ARE the on-disk folders; renaming/moving/deleting an
 *    album changes the real folders, and Explorer changes sync back.
 *  - **virtual** — albums are app-only; files and folders are never touched.
 *
 * The chosen mode is persisted to {@link import("@/types").AppConfig}; the
 * pending import then resumes via the store's continuation. Mounted once in the
 * app shell.
 */
export function FolderSyncModePrompt() {
  const { t } = useTranslation();
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();

  const open = useFolderSyncMode((s) => s.open);
  const continuation = useFolderSyncMode((s) => s.continuation);
  const close = useFolderSyncMode((s) => s.close);

  const choose = (mode: "mirror" | "virtual") => {
    if (!config) return;
    const resume = continuation;
    updateConfig.mutate(
      { ...config, folderSyncMode: mode },
      {
        onSuccess: () => {
          close();
          resume?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("folderSync.title")}</DialogTitle>
          <DialogDescription>{t("folderSync.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          <button
            type="button"
            disabled={updateConfig.isPending}
            onClick={() => choose("mirror")}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
          >
            <FolderSync className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">{t("folderSync.mirror.title")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("folderSync.mirror.description")}
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={updateConfig.isPending}
            onClick={() => choose("virtual")}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
          >
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">{t("folderSync.virtual.title")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("folderSync.virtual.description")}
              </span>
            </span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">{t("folderSync.changeLater")}</p>
      </DialogContent>
    </Dialog>
  );
}

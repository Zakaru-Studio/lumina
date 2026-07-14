import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDriveDownload, FolderOpen, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfig, useUpdateConfig } from "@/hooks/useSettings";
import * as api from "@/lib/api";
import { useBackupDevice } from "@/stores/backupDeviceStore";

/**
 * Store-driven prompt shown when a removable device holding photos is connected.
 * Previews how many photos are new vs already backed up (content-deduped by the
 * backend), then copies only the new ones onto the configured external drive and
 * shows live progress. Mounted once in the app shell.
 */
export function BackupDeviceDialog() {
  const { t } = useTranslation();
  const device = useBackupDevice((s) => s.device);
  const status = useBackupDevice((s) => s.status);
  const progress = useBackupDevice((s) => s.progress);
  const summary = useBackupDevice((s) => s.summary);
  const close = useBackupDevice((s) => s.close);
  const begin = useBackupDevice((s) => s.begin);

  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const dest = config?.backupDestination ?? null;

  const open = device !== null;
  const copying = status === "copying";
  const done = status === "done";

  const preview = useQuery({
    queryKey: ["backupPreview", device?.path, dest],
    queryFn: () => api.previewBackup(device!.path, dest!),
    enabled: open && !!dest && status === "idle",
  });

  // Surface the completion as a toast, once, when a run finishes.
  useEffect(() => {
    if (done && summary) {
      toast.success(t("backup.doneToast"), {
        description: t("backup.doneSummary", {
          count: summary.copied,
          copied: summary.copied,
          skipped: summary.skipped,
        }),
      });
    }
  }, [done, summary, t]);

  const chooseDestination = async () => {
    const picked = await api.pickFolders();
    if (picked[0] && config) {
      updateConfig.mutate({ ...config, backupDestination: picked[0] });
    }
  };

  const start = async () => {
    if (!device || !dest) return;
    begin();
    try {
      await api.startBackup(device.path, dest);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      close();
    }
  };

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : null;

  const toCopy = preview.data?.toCopy ?? 0;
  const nothingNew = preview.isSuccess && toCopy === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !copying && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("backup.title", { label: device?.label ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("backup.description", {
              count: device?.mediaCount ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Destination row */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {dest ?? t("backup.noDestination")}
          </span>
          {!copying && !done ? (
            <Button variant="ghost" size="sm" onClick={chooseDestination}>
              {dest ? t("backup.changeDestination") : t("backup.chooseDestination")}
            </Button>
          ) : null}
        </div>

        {/* Preview / progress / summary */}
        {dest && !copying && !done ? (
          <div className="min-h-[1.5rem] text-sm text-muted-foreground">
            {preview.isFetching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("backup.analyzing")}
              </span>
            ) : nothingNew ? (
              t("backup.nothingNew")
            ) : preview.data ? (
              <span>
                <span className="font-medium text-foreground">
                  {t("backup.previewNew", { count: preview.data.toCopy })}
                </span>
                {" · "}
                {t("backup.previewSkip", { count: preview.data.toSkip })}
              </span>
            ) : null}
          </div>
        ) : null}

        {copying ? (
          <div className="space-y-1.5 py-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: pct === null ? "40%" : `${pct}%` }}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {progress
                ? t("backup.copyingProgress", {
                    done: progress.copied,
                    total: progress.total,
                  })
                : t("backup.copying")}
            </p>
          </div>
        ) : null}

        {done && summary ? (
          <div className="text-sm text-muted-foreground">
            {t("backup.doneSummary", {
              count: summary.copied,
              copied: summary.copied,
              skipped: summary.skipped,
            })}
          </div>
        ) : null}

        <DialogFooter>
          {done ? (
            <Button onClick={close}>{t("backup.close")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={copying}>
                {t("backup.skip")}
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => void start()}
                disabled={copying || !dest || preview.isFetching || nothingNew}
              >
                {copying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-4 w-4" />
                )}
                {t("backup.start")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, HardDriveDownload, Loader2 } from "lucide-react";
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
 * Store-driven prompt to back up the photo library onto the external drive.
 * Previews how many photos are new vs already archived (content-deduped by the
 * backend), copies only the new ones — verified and additively, never deleting
 * anything on the drive — and shows live, cancellable progress. Mounted once in
 * the app shell; opened automatically when the backup drive reconnects, or
 * manually from Settings.
 */
export function BackupDeviceDialog() {
  const { t } = useTranslation();
  const isOpen = useBackupDevice((s) => s.isOpen);
  const device = useBackupDevice((s) => s.device);
  const status = useBackupDevice((s) => s.status);
  const progress = useBackupDevice((s) => s.progress);
  const summary = useBackupDevice((s) => s.summary);
  const close = useBackupDevice((s) => s.close);
  const begin = useBackupDevice((s) => s.begin);

  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  // A detected backup drive carries the destination resolved on its current
  // drive letter; a manual run falls back to the configured destination.
  const dest = device?.path || config?.backupDestination || null;

  const copying = status === "copying";
  const terminal = status === "done" || status === "cancelled" || status === "error";

  const preview = useQuery({
    queryKey: ["backupPreview", dest],
    queryFn: () => api.previewBackup(dest!),
    enabled: isOpen && !!dest && status === "idle",
  });

  // Surface the outcome as a toast once per finished run. Keyed on `status` (not
  // `t`) via a ref so switching language while the dialog is open never re-fires
  // it — the effect still re-runs, but the guard short-circuits.
  const toastedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!terminal || !summary) {
      if (status === "idle" || status === "copying") toastedFor.current = null;
      return;
    }
    if (toastedFor.current === status) return;
    toastedFor.current = status;
    if (status === "error") {
      toast.error(t("backup.errorToast"), { description: summary.error ?? undefined });
    } else if (status === "cancelled") {
      toast(t("backup.cancelledToast"), { description: summarize(summary, t) });
    } else {
      toast.success(t("backup.doneToast"), { description: summarize(summary, t) });
    }
  }, [status, summary, terminal, t]);

  const chooseDestination = async () => {
    const picked = await api.pickFolders();
    if (picked[0] && config) {
      updateConfig.mutate({ ...config, backupDestination: picked[0] });
    }
  };

  const start = async () => {
    if (!dest) return;
    begin();
    try {
      await api.startBackup(dest);
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
    <Dialog open={isOpen} onOpenChange={(o) => !o && !copying && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("backup.title")}</DialogTitle>
          <DialogDescription>{t("backup.description")}</DialogDescription>
        </DialogHeader>

        {/* Destination row */}
        {!copying && !terminal ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {dest ?? t("backup.noDestination")}
            </span>
            <Button variant="ghost" size="sm" onClick={chooseDestination}>
              {dest ? t("backup.changeDestination") : t("backup.chooseDestination")}
            </Button>
          </div>
        ) : null}

        {/* Preview */}
        {dest && !copying && !terminal ? (
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

        {/* Progress */}
        {copying ? (
          <div className="space-y-1.5 py-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={
                  pct === null
                    ? "h-full w-full animate-pulse rounded-full bg-primary/60"
                    : "h-full rounded-full bg-primary transition-[width] duration-150"
                }
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {progress
                ? t("backup.copyingProgress", {
                    done: progress.processed,
                    total: progress.total,
                  })
                : t("backup.copying")}
            </p>
          </div>
        ) : null}

        {/* Terminal summary */}
        {terminal && summary ? (
          <div className="text-sm text-muted-foreground">
            {status === "error" ? (
              <span className="inline-flex items-start gap-1.5 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {summary.error ?? t("backup.errorToast")}
              </span>
            ) : (
              <span>
                {status === "cancelled" ? `${t("backup.stopped")} · ` : ""}
                {summarize(summary, t)}
              </span>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {terminal ? (
            <Button onClick={close}>{t("backup.close")}</Button>
          ) : copying ? (
            <Button variant="ghost" onClick={() => void api.cancelBackup()}>
              {t("backup.stop")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                {t("backup.skip")}
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => void start()}
                disabled={!dest || preview.isFetching || nothingNew}
              >
                <HardDriveDownload className="h-4 w-4" />
                {t("backup.start")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One-line "N copied · M skipped [· K failed]" summary line. */
function summarize(
  s: { copied: number; skipped: number; failed: number },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts = [t("backup.doneSummary", { copied: s.copied, skipped: s.skipped })];
  if (s.failed > 0) parts.push(t("backup.failedCount", { count: s.failed }));
  return parts.join(" · ");
}

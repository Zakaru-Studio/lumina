import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdaterStore } from "@/stores/updaterStore";

/** Delay before the silent startup check, so it never competes with first paint. */
const STARTUP_CHECK_DELAY_MS = 4000;

/**
 * Mounted once at the app root. Silently checks for an update shortly after
 * launch and, when one is available, offers to install and relaunch. The same
 * dialog is reused by the manual "Check for updates" button in Settings (both
 * read {@link useUpdaterStore}). Downloads only ever apply signed bundles.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const progress = useUpdaterStore((s) => s.progress);
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const check = useUpdaterStore((s) => s.check);
  const install = useUpdaterStore((s) => s.installAndRestart);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  // One silent check per launch.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const timer = setTimeout(() => void check({ manual: false }), STARTUP_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [check]);

  const downloading = status === "downloading";
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <Dialog open={dialogOpen} onOpenChange={(o) => !o && !downloading && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("updater.title")}</DialogTitle>
          <DialogDescription>
            {t("updater.available", { version: version ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {notes ? (
          <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
            {notes}
          </div>
        ) : null}

        {downloading ? (
          <div className="space-y-1.5 py-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: pct === null ? "40%" : `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {pct === null ? t("updater.downloading") : `${t("updater.downloading")} ${pct}%`}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={dismiss} disabled={downloading}>
            {t("updater.later")}
          </Button>
          <Button className="gap-1.5" onClick={() => void install()} disabled={downloading}>
            {downloading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("updater.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

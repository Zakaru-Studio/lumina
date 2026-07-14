/**
 * "Smart dedupe" entry point for the Duplicates page.
 *
 * Clicking computes a proposal on the backend ({@link api.dedupePlan}): for each
 * set of byte-identical copies it keeps the best one (richest metadata, then the
 * cleanest filename, then the shallowest folder / oldest import) and marks the
 * rest for removal. The proposal is previewed in a dialog where the user picks
 * how the extra copies go away — removed from the catalog (undoable) or sent to
 * the OS trash — and confirms. Nothing is touched until they confirm.
 */
import { type ReactNode, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, Trash2, Undo2, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDedupeRemove } from "@/hooks/usePhotoMutations";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DedupePlan, Photo } from "@/types";

type Mode = "catalog" | "trash";

/**
 * @param ids   When set, the dedupe is scoped to just these photos ("test on a
 *              selection"); when omitted it spans the whole catalog.
 * @param onDone Called after copies are actually removed (e.g. to clear a
 *              selection).
 * @param trigger Custom trigger renderer; defaults to an outline button. Gets
 *              the start callback and the analyzing state.
 */
export function DedupeButton({
  ids,
  onDone,
  trigger,
}: {
  ids?: string[];
  onDone?: () => void;
  trigger?: (start: () => void, analyzing: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<DedupePlan | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("catalog");

  const compute = useMutation({
    mutationFn: () => api.dedupePlan(ids),
    onSuccess: (p) => {
      if (p.totalRemove === 0) {
        toast.info(t("dedupe.nothingToDo"));
        return;
      }
      setPlan(p);
      setMode("catalog");
      setOpen(true);
    },
    onError: (err) =>
      toast.error(t("dedupe.planError"), {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const dedupeRemove = useDedupeRemove();
  const busy = dedupeRemove.isPending;

  const removeIds = useMemo(
    () => plan?.groups.flatMap((g) => g.remove.map((r) => r.id)) ?? [],
    [plan],
  );

  const confirm = () => {
    if (removeIds.length === 0) return;
    dedupeRemove.mutate(
      { ids: removeIds, mode },
      {
        onSuccess: () => {
          setOpen(false);
          onDone?.();
        },
      },
    );
  };

  const start = () => compute.mutate();

  return (
    <>
      {trigger ? (
        trigger(start, compute.isPending)
      ) : (
        <Button variant="outline" size="sm" onClick={start} disabled={compute.isPending}>
          <Wand2 className="h-4 w-4" />
          {compute.isPending ? t("dedupe.analyzing") : t("dedupe.button")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => (busy ? null : setOpen(o))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dedupe.title")}</DialogTitle>
            <DialogDescription>
              {t("dedupe.summary", {
                remove: plan?.totalRemove ?? 0,
                groups: plan?.groups.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>

          {/* Per-group preview: the kept copy plus the ones to be removed. */}
          <ScrollArea className="max-h-64 rounded-md border">
            <ul className="divide-y">
              {plan?.groups.map((g) => (
                <li key={g.keep.id} className="flex flex-col gap-1.5 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {t("dedupe.kept")}
                    </Badge>
                    <span className="truncate text-sm text-foreground" title={g.keep.path}>
                      {g.keep.filename}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {t("dedupe.copyCount", { count: g.remove.length })}
                    </span>
                  </div>
                  {g.remove.map((r: Photo) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 pl-1 text-xs text-muted-foreground"
                    >
                      <Trash2 className="h-3 w-3 shrink-0" />
                      <span className="truncate line-through" title={r.path}>
                        {r.filename}
                      </span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </ScrollArea>

          {/* How the extra copies are removed. */}
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("dedupe.removalMode")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "catalog"}
                onClick={() => setMode("catalog")}
                icon={<Undo2 className="h-4 w-4" />}
                label={t("dedupe.modeCatalog")}
              />
              <ModeButton
                active={mode === "trash"}
                onClick={() => setMode("trash")}
                icon={<Trash2 className="h-4 w-4" />}
                label={t("dedupe.modeTrash")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "catalog" ? t("dedupe.modeCatalogHint") : t("dedupe.modeTrashHint")}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={mode === "trash" ? "destructive" : "default"}
              onClick={confirm}
              disabled={busy || removeIds.length === 0}
            >
              {busy
                ? t("dedupe.working")
                : t("dedupe.confirm", { count: removeIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A segmented-control button for the removal-mode choice. */
function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

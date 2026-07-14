import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useDeletePhotosFromDisk, useRemovePhotos } from "@/hooks/usePhotoMutations";
import { useDeleteDialog } from "@/stores/deleteDialogStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * Shared confirmation for deleting photos, offering two distinct actions:
 * remove from the library only (keeps the files, undoable) or delete from disk
 * (sends the originals to the OS trash). Store-driven so every entry point opens
 * the same dialog. Mounted
 * once in the app shell.
 *
 * A "don't ask again" toggle persists the chosen action as the delete
 * preference (see {@link useUiStore}); once set, later deletes skip this dialog
 * and run the remembered action directly. The choice is editable in Settings.
 */
export function DeletePhotosDialog() {
  const { t } = useTranslation();
  const ids = useDeleteDialog((s) => s.payload);
  const close = useDeleteDialog((s) => s.close);
  const clearSelection = useSelectionStore((s) => s.clear);
  const preference = useUiStore((s) => s.deletePreference);
  const setPreference = useUiStore((s) => s.setDeletePreference);

  const remove = useRemovePhotos();
  const deleteFromDisk = useDeletePhotosFromDisk();

  const [remember, setRemember] = useState(false);

  const count = ids?.length ?? 0;

  const runRemove = (persist: boolean) => {
    if (persist) setPreference("library");
    if (ids) remove.mutate(ids, { onSuccess: () => clearSelection() });
    close();
  };

  const runDelete = (persist: boolean) => {
    if (persist) setPreference("disk");
    if (ids) deleteFromDisk.mutate(ids, { onSuccess: () => clearSelection() });
    close();
  };

  // Honour a saved preference: when a delete is requested and the user has
  // opted out of the dialog, run the remembered action instead of showing it.
  useEffect(() => {
    if (ids === null) return;
    if (preference === "library") runRemove(false);
    else if (preference === "disk") runDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, preference]);

  // Reset the toggle for the next time the dialog opens.
  useEffect(() => {
    if (ids === null) setRemember(false);
  }, [ids]);

  const open = ids !== null && preference === "ask";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("gallery.deleteTitle", { count })}</DialogTitle>
          <DialogDescription>{t("gallery.deleteQuestion")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          <button
            type="button"
            onClick={() => runRemove(remember)}
            className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
          >
            <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">{t("gallery.removeFromLibrary")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("gallery.removeFromLibraryHint")}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => runDelete(remember)}
            className="flex w-full items-start gap-3 rounded-lg border border-destructive/40 p-3 text-left transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              <span className="block text-sm font-medium text-destructive">
                {t("gallery.deleteFromDisk")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("gallery.deleteFromDiskHint")}
              </span>
            </span>
          </button>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={remember} onCheckedChange={setRemember} />
            {t("gallery.dontAskAgain")}
          </label>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

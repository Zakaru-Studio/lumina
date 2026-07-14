import { AlertTriangle } from "lucide-react";
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
import { useDeleteAlbum } from "@/hooks/useAlbums";
import { useAlbumDelete } from "@/stores/albumDeleteStore";

/**
 * Strong confirmation for deleting a *mirror* album, whose backing folder and
 * all of its contents are moved to the Recycle Bin. Store-driven so every album
 * delete entry point (sidebar tree, albums grid, album detail) can funnel
 * mirror-album deletions through the same explicit warning. Mounted once in the
 * app shell. (`@/components/ui` ships no AlertDialog, so this uses Dialog.)
 */
export function DeleteMirrorAlbumDialog() {
  const { t } = useTranslation();
  const target = useAlbumDelete((s) => s.target);
  const close = useAlbumDelete((s) => s.close);
  const deleteAlbum = useDeleteAlbum();

  const confirm = () => {
    if (!target) return;
    const onDeleted = target.onDeleted;
    deleteAlbum.mutate(target.id, {
      onSuccess: () => {
        close();
        onDeleted?.();
      },
    });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <DialogTitle>{t("mirrorDelete.title")}</DialogTitle>
          </div>
          <DialogDescription>
            {t("mirrorDelete.description", { name: target?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={deleteAlbum.isPending}
          >
            {t("mirrorDelete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

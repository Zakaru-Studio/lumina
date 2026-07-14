import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useDeleteAlbum } from "@/hooks/useAlbums";
import { useAlbumDelete } from "@/stores/albumDeleteStore";

/**
 * Strong confirmation for deleting a *mirror* album, whose backing folder and
 * all of its contents are moved to the Recycle Bin. Store-driven so every album
 * delete entry point (sidebar tree, albums grid, album detail) can funnel
 * mirror-album deletions through the same explicit warning. Mounted once in the
 * app shell.
 */
export function DeleteMirrorAlbumDialog() {
  const { t } = useTranslation();
  const target = useAlbumDelete((s) => s.payload);
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
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && close()}
      icon={<AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />}
      title={t("mirrorDelete.title")}
      description={t("mirrorDelete.description", { name: target?.name ?? "" })}
      confirmLabel={t("mirrorDelete.confirm")}
      cancelLabel={t("common.cancel")}
      variant="destructive"
      isPending={deleteAlbum.isPending}
      onConfirm={confirm}
    />
  );
}

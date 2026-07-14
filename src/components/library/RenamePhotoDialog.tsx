import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import { errorMessage, qk } from "@/lib/query";
import { useRenamePhoto } from "@/stores/renamePhotoStore";

/** Split a filename into its base (without extension) and extension (with dot,
 * or empty). Dotfiles and extensionless names keep their whole name as base. */
function splitExtension(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

/**
 * Shared "rename media" dialog. Pre-fills the current filename WITHOUT its
 * extension (the extension is preserved and re-appended on submit, so the file
 * keeps its type). Store-driven so both the photo grid context menu and the
 * lightbox open the same dialog. Mounted once in the app shell.
 */
export function RenamePhotoDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const target = useRenamePhoto((s) => s.payload);
  const close = useRenamePhoto((s) => s.close);

  const [name, setName] = useState("");
  const { ext } = target ? splitExtension(target.filename) : { ext: "" };

  // Seed the input with the current base name each time a photo opens.
  useEffect(() => {
    if (target) setName(splitExtension(target.filename).base);
  }, [target]);

  const rename = useMutation({
    mutationFn: (newName: string) => api.renamePhoto(target!.id, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.photos });
      close();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    if (!target) return;
    const base = name.trim();
    if (!base) return;
    const newName = base + ext;
    if (newName === target.filename) {
      close();
      return;
    }
    rename.mutate(newName);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rename.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={t("rename.placeholder")}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {ext ? <span className="shrink-0 text-sm text-muted-foreground">{ext}</span> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || rename.isPending}>
            {t("common.rename")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

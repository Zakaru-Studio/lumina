import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/hooks/useSettings";
import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import { useImportAlbumsDialog } from "@/stores/importAlbumsDialogStore";
import type { FolderPreview } from "@/types";

/** A muted count of the media directly assigned to a node. */
function MediaCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {t("importDialog.mediaCount", { count })}
    </span>
  );
}

interface TreeNodeProps {
  node: FolderPreview;
  depth: number;
  /** When set, this root node renders an editable name input. */
  rootIndex?: number;
  rootNames: string[];
  onRootNameChange: (index: number, name: string) => void;
}

/** Recursive, read-only tree row. Root nodes render an editable name input. */
function TreeNode({ node, depth, rootIndex, rootNames, onRootNameChange }: TreeNodeProps) {
  const isRoot = rootIndex !== undefined;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1"
        style={{ paddingLeft: depth * 18 }}
      >
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        {isRoot ? (
          <Input
            value={rootNames[rootIndex] ?? node.name}
            onChange={(e) => onRootNameChange(rootIndex, e.target.value)}
            className="h-7 flex-1 text-sm"
          />
        ) : (
          <span className="flex-1 truncate text-sm">{node.name}</span>
        )}
        <MediaCount count={node.mediaCount} />
      </div>
      {node.children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          rootNames={rootNames}
          onRootNameChange={onRootNameChange}
        />
      ))}
    </div>
  );
}

/**
 * Store-driven dialog shown after the user picks folders to import. It previews
 * the folder trees as a proposed album hierarchy (with per-album media counts)
 * and offers two paths: create the albums, or just import the media in place.
 * Mounted once in the app shell.
 */
export function ImportAlbumsDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const paths = useImportAlbumsDialog((s) => s.payload);
  const close = useImportAlbumsDialog((s) => s.close);

  const [rootNames, setRootNames] = useState<string[]>([]);
  const [mirror, setMirror] = useState(false);

  const preview = useQuery({
    queryKey: ["importPreview", paths],
    queryFn: () => api.previewImportTree(paths!),
    enabled: paths !== null,
  });

  // Seed the editable root names from the loaded preview (one per root).
  useEffect(() => {
    if (preview.data) setRootNames(preview.data.map((n) => n.name));
  }, [preview.data]);

  // Reset local state when the dialog closes; when it opens, default the mirror
  // switch to the user's chosen folder-management mode.
  useEffect(() => {
    if (paths === null) setRootNames([]);
    else setMirror(config?.folderSyncMode === "mirror");
  }, [paths, config?.folderSyncMode]);

  const createAlbums = useMutation({
    mutationFn: () => api.importAsAlbums(paths!, rootNames, mirror),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.albums });
      qc.invalidateQueries({ queryKey: qk.watchedFolders });
      toast.success(t("importDialog.createdToast"));
      close();
    },
  });

  const importOnly = useMutation({
    mutationFn: () => api.scanFolders(paths!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.watchedFolders });
      close();
    },
  });

  const busy = preview.isLoading || createAlbums.isPending || importOnly.isPending;

  const onRootNameChange = (index: number, name: string) =>
    setRootNames((prev) => {
      const next = [...prev];
      next[index] = name;
      return next;
    });

  return (
    <Dialog open={paths !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("importDialog.title")}</DialogTitle>
          <DialogDescription>{t("importDialog.description")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] rounded-lg border p-2">
          {preview.isLoading ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            (preview.data ?? []).map((node, i) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                rootIndex={i}
                rootNames={rootNames}
                onRootNameChange={onRootNameChange}
              />
            ))
          )}
        </ScrollArea>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t("importDialog.mirrorLabel")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("importDialog.mirrorHint")}
            </span>
          </span>
          <Switch checked={mirror} onCheckedChange={setMirror} />
        </label>

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => importOnly.mutate()}
              disabled={busy}
            >
              {t("importDialog.importOnly")}
            </Button>
            <Button onClick={() => createAlbums.mutate()} disabled={busy}>
              {t("importDialog.createAlbums")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

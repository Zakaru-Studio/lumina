import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, EyeOff, GitMerge, MoreHorizontal, Trash2 } from "lucide-react";

import { FaceCrop } from "@/components/people/FaceCrop";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterBar } from "@/components/library/FilterBar";
import { Lightbox } from "@/components/library/Lightbox";
import { PhotoGrid } from "@/components/library/PhotoGrid";
import { SelectionToolbar } from "@/components/library/SelectionToolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlbums } from "@/hooks/useAlbums";
import {
  useDeletePerson,
  useMergePeople,
  usePeople,
  usePerson,
  useRenamePerson,
  useSetPersonHidden,
} from "@/hooks/useFaces";
import { useGlobalShortcuts } from "@/hooks/useKeyboard";
import { usePhotoIds, usePhotoWindow } from "@/hooks/useWindowedPhotos";
import { buildQuery } from "@/lib/query";
import { useUiStore } from "@/stores/uiStore";
import type { PhotoQuery } from "@/types";

/** Person detail: the person's photos as a windowed grid, with rename / hide /
 * merge controls. Reuses the full library grid + filter bar via the `personId`
 * photo filter, so favorites/rating/date/sort all work within a person. */
export function PersonDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { personId } = useParams();
  const { data: person, isLoading: personLoading } = usePerson(personId);

  const [query, setQuery] = useState<PhotoQuery>(() =>
    buildQuery({ filter: { personId } }),
  );
  // Keep the personId filter pinned even if the id in the URL changes.
  useEffect(() => {
    setQuery((q) => ({ ...q, filter: { ...q.filter, personId }, offset: 0 }));
  }, [personId]);

  const { data: ids = [] } = usePhotoIds(query, !!personId);
  const win = usePhotoWindow(query, !!personId);
  const { data: albums = [] } = useAlbums();
  const [index, setIndex] = useState<number | null>(null);
  useGlobalShortcuts(ids, { onOpen: setIndex, enabled: index === null });

  const loading = win.isLoading && ids.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PersonHeader />

      <div className="shrink-0 border-b border-border">
        <FilterBar query={query} onChange={setQuery} />
      </div>

      {loading ? (
        <GridSkeleton />
      ) : ids.length === 0 ? (
        <EmptyState
          icon={<EyeOff className="h-6 w-6" />}
          title={t("personPage.emptyTitle")}
          description={t("personPage.emptyDescription")}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <PhotoGrid
            ids={ids}
            getPhoto={win.getPhoto}
            onOpen={setIndex}
            onVisibleRangeChange={win.setRange}
          />
        </div>
      )}

      <Lightbox
        ids={ids}
        index={index}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
        getPhoto={win.getPhoto}
      />
      <SelectionToolbar albums={albums} />
    </div>
  );

  /** The person header: back, avatar, editable name, count, actions. */
  function PersonHeader() {
    const rename = useRenamePerson();
    const setHidden = useSetPersonHidden();
    const deletePerson = useDeletePerson();
    const [name, setName] = useState(person?.name ?? "");
    const [mergeOpen, setMergeOpen] = useState(false);

    useEffect(() => setName(person?.name ?? ""), [person?.name]);

    if (personLoading || !person) {
      return (
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      );
    }

    const commit = () => {
      const next = name.trim();
      if (next === (person.name ?? "")) return;
      rename.mutate({ id: person.id, name: next || null });
    };

    return (
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => navigate("/people")}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FaceCrop
          face={person.cover}
          alt={person.name ?? ""}
          className="h-11 w-11 shrink-0 rounded-full ring-1 ring-border"
        />
        <div className="min-w-0 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder={t("people.addName")}
            className="h-8 max-w-xs border-transparent bg-transparent px-1 text-base font-medium hover:border-input focus:border-input"
          />
          <p className="px-1 text-xs text-muted-foreground">
            {t("people.photoCount", { count: person.faceCount })}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setMergeOpen(true)} className="gap-2">
              <GitMerge className="h-4 w-4" />
              {t("people.merge")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setHidden.mutate({ id: person.id, hidden: !person.isHidden })}
              className="gap-2"
            >
              <EyeOff className="h-4 w-4" />
              {person.isHidden ? t("people.unhide") : t("people.hide")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-destructive"
              onSelect={() => {
                if (
                  confirm(
                    t("people.deleteConfirm", {
                      name: person.name ?? t("people.unnamed"),
                    }),
                  )
                ) {
                  deletePerson.mutate(person.id, { onSuccess: () => navigate("/people") });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          sourceId={person.id}
          onMerged={(target) => navigate(`/people/${target}`)}
        />
      </div>
    );
  }
}

/** Compact skeleton grid shown while the first window loads. */
function GridSkeleton() {
  const cellSize = useUiStore((s) => s.cellSize);
  return (
    <div
      className="grid gap-2.5 p-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
    >
      {Array.from({ length: 18 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}

/** Pick another person to merge the current one into. */
function MergeDialog({
  open,
  onOpenChange,
  sourceId,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sourceId: string;
  onMerged: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const merge = useMergePeople();
  const { data: people = [] } = usePeople({
    includeHidden: true,
    namedOnly: false,
    minFaces: 1,
  });
  const candidates = useMemo(
    () => people.filter((p) => p.id !== sourceId),
    [people, sourceId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("people.mergeTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("people.mergeHint")}</p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("people.mergeNone")}
            </p>
          ) : (
            candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  merge.mutate(
                    { sources: [sourceId], into: p.id },
                    {
                      onSuccess: () => {
                        onOpenChange(false);
                        onMerged(p.id);
                      },
                    },
                  )
                }
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <FaceCrop face={p.cover} className="h-9 w-9 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {p.name ?? t("people.unnamed")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("people.photoCount", { count: p.faceCount })}
                </span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

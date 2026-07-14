import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  ScanFace,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

import { FaceCrop } from "@/components/people/FaceCrop";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeletePerson,
  useFaceStatus,
  useIndexFacesNow,
  usePeople,
  useRenamePerson,
  useSetPersonHidden,
  type PeopleFilters,
} from "@/hooks/useFaces";
import { cn } from "@/lib/utils";
import { useFaceStore } from "@/stores/faceStore";
import type { PersonSummary } from "@/types";

/**
 * People view: a grid of face clusters. Users name people inline, filter to
 * named/hidden/large groups, and open a person to browse their photos.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: status } = useFaceStatus();
  const [filters, setFilters] = useState<PeopleFilters>({
    includeHidden: false,
    namedOnly: false,
    minFaces: 2,
  });
  const { data: people = [], isLoading } = usePeople(filters);
  const indexFaces = useIndexFacesNow();
  const progress = useFaceStore((s) => s.progress);
  const running = useFaceStore((s) => s.running);

  const patch = (p: Partial<PeopleFilters>) => setFilters((f) => ({ ...f, ...p }));

  // Feature off → point the user at Settings to enable it.
  if (status && !status.enabled) {
    return (
      <EmptyState
        icon={<Sparkles className="h-6 w-6" />}
        title={t("people.disabledTitle")}
        description={t("people.disabledDescription")}
        action={
          <Button onClick={() => navigate("/settings")}>{t("people.openSettings")}</Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter / status bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="mr-2 text-sm font-medium text-foreground">{t("nav.people")}</span>

        <Button
          size="sm"
          variant={filters.namedOnly ? "secondary" : "ghost"}
          aria-pressed={filters.namedOnly}
          onClick={() => patch({ namedOnly: !filters.namedOnly })}
        >
          {t("people.namedOnly")}
        </Button>
        <Button
          size="sm"
          variant={filters.includeHidden ? "secondary" : "ghost"}
          aria-pressed={filters.includeHidden}
          onClick={() => patch({ includeHidden: !filters.includeHidden })}
          className="gap-1.5"
        >
          {filters.includeHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {t("people.showHidden")}
        </Button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("people.minSize")}</span>
          <Select
            value={String(filters.minFaces)}
            onValueChange={(v) => patch({ minFaces: Number(v) })}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1+</SelectItem>
              <SelectItem value="2">2+</SelectItem>
              <SelectItem value="5">5+</SelectItem>
              <SelectItem value="10">10+</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5"
          disabled={running}
          onClick={() => indexFaces.mutate()}
        >
          <ScanFace className="h-4 w-4" />
          {t("people.analyze")}
        </Button>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {running && progress ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("people.indexing", {
                processed: progress.processed,
                total: progress.total,
              })}
            </span>
          ) : (
            <span>{t("people.count", { count: people.length })}</span>
          )}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-5 p-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-28 w-28 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={running ? t("people.buildingTitle") : t("people.emptyTitle")}
          description={
            running ? t("people.buildingDescription") : t("people.emptyDescription")
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-5 p-6">
            {people.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A single person: avatar (→ detail), inline name, count, hide toggle. */
function PersonCard({ person }: { person: PersonSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rename = useRenamePerson();
  const setHidden = useSetPersonHidden();
  const deletePerson = useDeletePerson();
  const [name, setName] = useState(person.name ?? "");

  useEffect(() => setName(person.name ?? ""), [person.name]);

  const commit = () => {
    const next = name.trim();
    if (next === (person.name ?? "")) return;
    rename.mutate({ id: person.id, name: next || null });
  };

  return (
    <div className="group flex flex-col items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => navigate(`/people/${person.id}`)}
          className="block"
          aria-label={person.name ?? t("people.unnamed")}
        >
          <FaceCrop
            face={person.cover}
            alt={person.name ?? ""}
            className={cn(
              "h-28 w-28 rounded-full ring-1 ring-border transition group-hover:ring-2 group-hover:ring-primary",
              person.isHidden && "opacity-50",
            )}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-7 w-7 rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={t("common.actions")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => setHidden.mutate({ id: person.id, hidden: !person.isHidden })}
            >
              {person.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {person.isHidden ? t("people.unhide") : t("people.hide")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-destructive"
              onSelect={() => {
                if (confirm(t("people.deleteConfirm", { name: person.name ?? t("people.unnamed") })))
                  deletePerson.mutate(person.id);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder={t("people.addName")}
        className="h-8 w-32 border-transparent bg-transparent text-center text-sm hover:border-input focus:border-input"
      />
      <p className="text-xs text-muted-foreground">
        {t("people.photoCount", { count: person.faceCount })}
      </p>
    </div>
  );
}

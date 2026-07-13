import { useEffect, useState } from "react";
import {
  FolderOpen,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useAiStatus, useConfig, useUpdateConfig } from "@/hooks/useSettings";
import { useLibraryStats } from "@/hooks/usePhotos";
import { useScanControls, useWatchedFolders } from "@/hooks/useScan";
import * as api from "@/lib/api";
import { useUiStore } from "@/stores/uiStore";
import type { AppConfig, Theme } from "@/types";

/** A titled settings section rendered as a borderless card. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-0 bg-card">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

/** A single label + control row. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-sm text-foreground">{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A compact library statistic. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xl font-semibold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Application settings: appearance, thumbnails, performance, watched folders,
 * library statistics and a preview of forthcoming AI features. All persisted
 * config changes send the full {@link AppConfig}.
 */
export function SettingsPage() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();
  const { data: folders = [] } = useWatchedFolders();
  const { data: ai } = useAiStatus();
  const { data: stats } = useLibraryStats();
  const { importFolders, removeFolder, rescan } = useScanControls();
  const setTheme = useUiStore((s) => s.setTheme);

  const [thumbSize, setThumbSize] = useState(256);
  const [workers, setWorkers] = useState(0);

  useEffect(() => {
    if (config) {
      setThumbSize(config.thumbnailSize);
      setWorkers(config.workerThreads);
    }
  }, [config]);

  /** Persist a partial change on top of the current config. */
  const save = (partial: Partial<AppConfig>) => {
    if (!config) return;
    updateConfig.mutate({ ...config, ...partial });
  };

  if (isLoading || !config) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  const aiDisabled = !ai?.enabled;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        {/* Appearance */}
        <Section title="Appearance" description="Theme and language.">
          <Row label="Theme">
            <Select
              value={config.theme}
              onValueChange={(v) => {
                setTheme(v as Theme);
                save({ theme: v as Theme });
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Language">
            <Select value={config.language} onValueChange={(v) => save({ language: v })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="fr">Français</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        {/* Thumbnails */}
        <Section title="Thumbnails" description="How previews are generated and cached.">
          <Row label="Thumbnail size" hint={`${thumbSize} px`}>
            <Slider
              className="w-48"
              min={128}
              max={512}
              step={16}
              value={[thumbSize]}
              onValueChange={(v) => setThumbSize(v[0])}
              onValueCommit={(v) => save({ thumbnailSize: v[0] })}
            />
          </Row>
          <Separator />
          <Row label="Cache location" hint={config.cacheDir ?? "Default location"}>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const picked = await api.pickFolders();
                if (picked[0]) save({ cacheDir: picked[0] });
              }}
            >
              <FolderOpen className="h-4 w-4" />
              Change…
            </Button>
          </Row>
          <Separator />
          <Row label="Rebuild library" hint="Re-index and regenerate all thumbnails.">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => rescan.mutate()}
            >
              <RefreshCw className="h-4 w-4" />
              Rebuild
            </Button>
          </Row>
        </Section>

        {/* Performance */}
        <Section title="Performance" description="Background processing.">
          <Row label="Worker threads" hint={workers === 0 ? "Auto" : `${workers} threads`}>
            <Slider
              className="w-48"
              min={0}
              max={16}
              step={1}
              value={[workers]}
              onValueChange={(v) => setWorkers(v[0])}
              onValueCommit={(v) => save({ workerThreads: v[0] })}
            />
          </Row>
        </Section>

        {/* Watched folders */}
        <Section title="Watched Folders" description="Folders Lumina indexes and monitors.">
          <div className="space-y-2">
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No folders yet.</p>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {folder.path}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label="Remove folder"
                    onClick={() => removeFolder.mutate(folder.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => importFolders.mutate()}
          >
            <Plus className="h-4 w-4" />
            Add folder…
          </Button>
        </Section>

        {/* Library stats */}
        <Section title="Library" description="At a glance.">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Photos" value={stats?.total ?? 0} />
            <Stat label="Favorites" value={stats?.favorites ?? 0} />
            <Stat label="RAW" value={stats?.raw ?? 0} />
            <Stat label="Videos" value={stats?.videos ?? 0} />
            <Stat label="Pending thumbs" value={stats?.pendingThumbs ?? 0} />
            <Stat label="Tags" value={stats?.tags ?? 0} />
          </div>
        </Section>

        {/* AI (coming soon) */}
        <Card className="border-0 bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Intelligence</CardTitle>
              {aiDisabled ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Coming soon
                </span>
              ) : null}
            </div>
            <CardDescription>
              On-device AI features, planned for a future release.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={aiDisabled ? "pointer-events-none space-y-3 opacity-60" : "space-y-3"}
              aria-disabled={aiDisabled}
            >
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">Face recognition</p>
                <p className="text-xs text-muted-foreground">
                  Group photos by the people in them, computed locally.
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">Natural-language search</p>
                <p className="text-xs text-muted-foreground">
                  Find photos by description using CLIP embeddings.
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">Text in images (OCR)</p>
                <p className="text-xs text-muted-foreground">
                  Search for words that appear inside your photos.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

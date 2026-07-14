import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getVersion } from "@tauri-apps/api/app";
import {
  FolderOpen,
  HardDriveDownload,
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
import { Switch } from "@/components/ui/switch";
import { Row, Section, Stat } from "@/components/common/SettingsLayout";
import { useAiStatus, useConfig, useUpdateConfig } from "@/hooks/useSettings";
import { useLibraryStats } from "@/hooks/usePhotos";
import { useScanControls, useWatchedFolders } from "@/hooks/useScan";
import * as api from "@/lib/api";
import { normalizeLanguage } from "@/i18n";
import { useBackupDevice } from "@/stores/backupDeviceStore";
import { useUiStore, type DeletePreference } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import type { AppConfig, Theme } from "@/types";

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
  const { importFolders, removeFolder } = useScanControls();
  const { t } = useTranslation();
  const setTheme = useUiStore((s) => s.setTheme);
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  const deletePreference = useUiStore((s) => s.deletePreference);
  const setDeletePreference = useUiStore((s) => s.setDeletePreference);

  const [thumbSize, setThumbSize] = useState(256);
  const [workers, setWorkers] = useState(0);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const updaterStatus = useUpdaterStore((s) => s.status);
  const checkForUpdates = useUpdaterStore((s) => s.check);

  useEffect(() => {
    if (config) {
      setThumbSize(config.thumbnailSize);
      setWorkers(config.workerThreads);
    }
  }, [config]);

  // Resolve the running app version (from tauri.conf.json) once.
  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  /** Manual update check: the store opens the dialog if one is found; here we
   * only surface the "already up to date" / failure outcomes as toasts. */
  const runUpdateCheck = async () => {
    await checkForUpdates({ manual: true });
    const { status, error } = useUpdaterStore.getState();
    if (status === "upToDate") toast.success(t("updater.upToDate"));
    else if (status === "error") toast.error(error ?? t("updater.checkFailed"));
  };

  /** Persist a partial change on top of the current config. */
  const save = (partial: Partial<AppConfig>) => {
    if (!config) return;
    updateConfig.mutate({ ...config, ...partial });
  };

  /** Manually look for a connected device and open the backup prompt for it.
   * Discoverable fallback when auto-detection missed the arrival (e.g. the
   * device was plugged in before launch). */
  const backUpDeviceNow = async () => {
    const devices = await api.listRemovableDevices().catch(() => []);
    if (devices.length === 0) {
      toast(t("settings.backup.noDevice"));
      return;
    }
    useBackupDevice.getState().open(devices[0]);
  };

  /** Regenerate all thumbnails at the current configured size (progress shown
   * by the scan bar). */
  const regenerateThumbs = () => {
    void api.regenerateThumbnails();
    toast(t("settings.thumbnails.regenerating"));
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
        <Section title={t("settings.appearance.title")} description={t("settings.appearance.description")}>
          <Row label={t("settings.appearance.theme")}>
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
                <SelectItem value="light">{t("settings.appearance.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.appearance.themeDark")}</SelectItem>
                <SelectItem value="system">{t("settings.appearance.themeSystem")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.appearance.language")}>
            <Select
              value={language}
              onValueChange={(v) => {
                setLanguage(normalizeLanguage(v));
                save({ language: v });
              }}
            >
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

        {/* Deletion */}
        <Section
          title={t("settings.deletion.title")}
          description={t("settings.deletion.description")}
        >
          <Row label={t("settings.deletion.behavior")}>
            <Select
              value={deletePreference}
              onValueChange={(v) => setDeletePreference(v as DeletePreference)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">{t("settings.deletion.ask")}</SelectItem>
                <SelectItem value="library">{t("settings.deletion.library")}</SelectItem>
                <SelectItem value="disk">{t("settings.deletion.disk")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        {/* Thumbnails */}
        <Section title={t("settings.thumbnails.title")} description={t("settings.thumbnails.description")}>
          <Row label={t("settings.thumbnails.size")} hint={t("settings.thumbnails.sizeHint", { size: thumbSize })}>
            <Slider
              className="w-48"
              min={128}
              max={512}
              step={16}
              value={[thumbSize]}
              onValueChange={(v) => setThumbSize(v[0])}
              onValueCommit={(v) => {
                if (v[0] === config.thumbnailSize) return;
                save({ thumbnailSize: v[0] });
                regenerateThumbs();
              }}
            />
          </Row>
          <Separator />
          <Row label={t("settings.thumbnails.cacheLocation")} hint={config.cacheDir ?? t("settings.thumbnails.cacheDefault")}>
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
              {t("common.change")}
            </Button>
          </Row>
          <Separator />
          <Row label={t("settings.thumbnails.rebuild")} hint={t("settings.thumbnails.rebuildHint")}>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={regenerateThumbs}
            >
              <RefreshCw className="h-4 w-4" />
              {t("settings.thumbnails.rebuildAction")}
            </Button>
          </Row>
        </Section>

        {/* Performance */}
        <Section title={t("settings.performance.title")} description={t("settings.performance.description")}>
          <Row
            label={t("settings.performance.workers")}
            hint={workers === 0 ? t("settings.performance.workersAuto") : t("settings.performance.workersCount", { n: workers })}
          >
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

        {/* Folder management */}
        <Section
          title={t("settings.folderSync.title")}
          description={t("settings.folderSync.description")}
        >
          <Row label={t("settings.folderSync.mode")} hint={t("settings.folderSync.modeHint")}>
            <Select
              value={config.folderSyncMode ?? undefined}
              onValueChange={(v) => save({ folderSyncMode: v })}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder={t("settings.folderSync.modeUnset")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mirror">{t("settings.folderSync.mirror")}</SelectItem>
                <SelectItem value="virtual">{t("settings.folderSync.virtual")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        {/* Watched folders */}
        <Section title={t("settings.folders.title")} description={t("settings.folders.description")}>
          <div className="space-y-2">
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.folders.empty")}</p>
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
                    aria-label={t("settings.folders.removeAria")}
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
            {t("settings.folders.add")}
          </Button>
        </Section>

        {/* Device backup */}
        <Section title={t("settings.backup.title")} description={t("settings.backup.description")}>
          <Row
            label={t("settings.backup.destination")}
            hint={config.backupDestination ?? t("settings.backup.destinationUnset")}
          >
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const picked = await api.pickFolders();
                if (picked[0]) save({ backupDestination: picked[0] });
              }}
            >
              <FolderOpen className="h-4 w-4" />
              {t("settings.backup.choose")}
            </Button>
          </Row>
          <Separator />
          <Row label={t("settings.backup.autoPrompt")} hint={t("settings.backup.autoPromptHint")}>
            <Switch
              checked={config.autoBackupPrompt}
              onCheckedChange={(v) => save({ autoBackupPrompt: v })}
            />
          </Row>
          <Separator />
          <Row label={t("settings.backup.manual")} hint={t("settings.backup.manualHint")}>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => void backUpDeviceNow()}
            >
              <HardDriveDownload className="h-4 w-4" />
              {t("settings.backup.backupNow")}
            </Button>
          </Row>
        </Section>

        {/* Library stats */}
        <Section title={t("settings.library.title")} description={t("settings.library.description")}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t("settings.library.photos")} value={stats?.total ?? 0} />
            <Stat label={t("settings.library.favorites")} value={stats?.favorites ?? 0} />
            <Stat label={t("settings.library.raw")} value={stats?.raw ?? 0} />
            <Stat label={t("settings.library.videos")} value={stats?.videos ?? 0} />
            <Stat label={t("settings.library.pendingThumbs")} value={stats?.pendingThumbs ?? 0} />
            <Stat label={t("settings.library.tags")} value={stats?.tags ?? 0} />
          </div>
        </Section>

        {/* AI (coming soon) */}
        <Card className="border-0 bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">{t("settings.ai.title")}</CardTitle>
              {aiDisabled ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {t("settings.ai.comingSoon")}
                </span>
              ) : null}
            </div>
            <CardDescription>
              {t("settings.ai.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={aiDisabled ? "pointer-events-none space-y-3 opacity-60" : "space-y-3"}
              aria-disabled={aiDisabled}
            >
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">{t("settings.ai.faceTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.ai.faceDescription")}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">{t("settings.ai.nlSearchTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.ai.nlSearchDescription")}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">{t("settings.ai.ocrTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.ai.ocrDescription")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About / updates */}
        <Section title={t("settings.about.title")} description={t("settings.about.description")}>
          <Row label={t("settings.about.version")}>
            <span className="text-sm tabular-nums text-muted-foreground">
              {appVersion ?? "—"}
            </span>
          </Row>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            disabled={updaterStatus === "checking" || updaterStatus === "downloading"}
            onClick={() => void runUpdateCheck()}
          >
            <RefreshCw
              className={`h-4 w-4 ${updaterStatus === "checking" ? "animate-spin" : ""}`}
            />
            {t("updater.checkForUpdates")}
          </Button>
        </Section>
      </div>
    </div>
  );
}

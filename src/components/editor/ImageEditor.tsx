/**
 * Non-destructive, canvas-based image editor ("Photoshop-lite").
 *
 * Mounted once in the app shell. It watches {@link useEditorStore}; when a
 * `photoId` is set it takes over the screen with a full-resolution editor —
 * Adjust / Crop / Transform tabs, a live downscaled preview, and two save modes.
 *
 * "Save a copy" writes a NEW file via {@link saveEditedImage} and leaves the
 * original untouched. "Save to original" overwrites the source file in place via
 * {@link overwriteOriginal} — destructive, and gated behind a confirmation. The
 * on-screen edit is otherwise ephemeral working state.
 */
import * as React from "react";
import {
  CircleDot,
  Contrast,
  Droplet,
  FlipHorizontal,
  FlipVertical,
  Focus,
  type LucideIcon,
  Palette,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Sparkles,
  Sun,
  SunMedium,
  Thermometer,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePhoto } from "@/hooks/usePhotos";
import {
  originalSrc,
  overwriteOriginal,
  pickSavePath,
  revealInExplorer,
  saveEditedImage,
} from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";

import { CropOverlay } from "./CropOverlay";
import {
  type AdjustParams,
  type AspectKey,
  type EditParams,
  aspectValue,
  croppedNaturalSize,
  DEFAULT_ADJUST,
  defaultParams,
  transformedSize,
} from "./params";
import { mimeForPath, PREVIEW_MAX_EDGE, renderTo } from "./render";

/**
 * Declarative config for the Adjust tab sliders. `labelKey` is resolved against
 * the `editor` i18n namespace at render time.
 */
const ADJUST_FIELDS: {
  key: keyof AdjustParams;
  labelKey: string;
  min: number;
  max: number;
  Icon: LucideIcon;
}[] = [
  { key: "exposure", labelKey: "editor.exposure", min: -100, max: 100, Icon: Sun },
  { key: "brightness", labelKey: "editor.brightness", min: -100, max: 100, Icon: SunMedium },
  { key: "contrast", labelKey: "editor.contrast", min: -100, max: 100, Icon: Contrast },
  { key: "saturation", labelKey: "editor.saturation", min: -100, max: 100, Icon: Droplet },
  { key: "vibrance", labelKey: "editor.vibrance", min: -100, max: 100, Icon: Palette },
  { key: "warmth", labelKey: "editor.warmth", min: -100, max: 100, Icon: Thermometer },
  { key: "clarity", labelKey: "editor.clarity", min: -100, max: 100, Icon: Sparkles },
  { key: "sharpness", labelKey: "editor.sharpness", min: 0, max: 100, Icon: Focus },
  { key: "vignette", labelKey: "editor.vignette", min: 0, max: 100, Icon: CircleDot },
];

const ASPECT_OPTIONS: { value: AspectKey; labelKey: string }[] = [
  { value: "free", labelKey: "editor.aspectFree" },
  { value: "1:1", labelKey: "editor.aspectSquare" },
  { value: "4:3", labelKey: "editor.aspect43" },
  { value: "3:2", labelKey: "editor.aspect32" },
  { value: "16:9", labelKey: "editor.aspect169" },
  { value: "original", labelKey: "editor.aspectOriginal" },
];

/** Public entry point — renders nothing unless the editor store holds a photo. */
export function ImageEditor() {
  const photoId = useEditorStore((s) => s.photoId);
  if (!photoId) return null;
  return <EditorShell photoId={photoId} />;
}

/** The mounted editor for a specific photo id. */
function EditorShell({ photoId }: { photoId: string }) {
  const { t } = useTranslation();
  const { data: photo } = usePhoto(photoId);
  const close = React.useCallback(() => useEditorStore.getState().close(), []);

  const [params, setParams] = React.useState<EditParams>(() => defaultParams());
  const [fullSource, setFullSource] = React.useState<HTMLImageElement | null>(null);
  const [previewSource, setPreviewSource] = React.useState<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const [tab, setTab] = React.useState("adjust");

  const previewCanvasRef = React.useRef<HTMLCanvasElement>(null);

  // --- Escape to close -----------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useEditorStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Load the original + build a downscaled preview source ---------------
  React.useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    setLoading(true);
    setFullSource(null);
    setPreviewSource(null);
    setParams(defaultParams());

    const img = new Image();
    img.crossOrigin = "anonymous"; // defensive; asset protocol is same-origin.
    img.onload = () => {
      if (cancelled) return;
      const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const scale = Math.min(1, PREVIEW_MAX_EDGE / longest);
      const pc = document.createElement("canvas");
      pc.width = Math.max(1, Math.round(img.naturalWidth * scale));
      pc.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const pctx = pc.getContext("2d");
      if (pctx) {
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(img, 0, 0, pc.width, pc.height);
      }
      setFullSource(img);
      setPreviewSource(pc);
      setLoading(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoading(false);
      toast.error(t("editor.loadError"), { description: photo.filename });
    };
    img.src = originalSrc(photo);
    return () => {
      cancelled = true;
    };
  }, [photo?.id, photo?.path]);

  // --- Debounced (≈80ms + rAF) live preview render -------------------------
  React.useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!previewSource || !canvas) return;
    let raf = 0;
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        // On the Crop tab, show the *uncropped* frame so the overlay can be
        // dragged over the full image; adjustments still apply.
        const p: EditParams =
          tab === "crop"
            ? {
                ...params,
                crop: { x: 0, y: 0, w: 1, h: 1, aspect: params.crop.aspect },
                resize: { width: null, height: null, lockAspect: params.resize.lockAspect },
                // While cropping, only the geometry changes — skip the expensive
                // convolution/vignette pixel passes so dragging the crop rect
                // stays responsive. The final render (and the Adjust tab) still
                // applies them in full.
                adjust: { ...params.adjust, clarity: 0, sharpness: 0, vignette: 0 },
              }
            : params;
        try {
          renderTo(canvas, previewSource, p, false);
        } catch {
          /* transient draw failure — next change re-renders */
        }
      });
    }, 80);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [params, previewSource, tab]);

  // --- Derived geometry ----------------------------------------------------
  const tsize = previewSource ? transformedSize(previewSource, params.transform) : null;
  const imageAspect = tsize ? tsize.bw / tsize.bh : 1;
  const targetAspect = tsize ? aspectValue(params.crop.aspect, tsize.bw, tsize.bh) : null;
  const natSize = fullSource
    ? croppedNaturalSize(fullSource, params)
    : { width: 0, height: 0 };

  // --- Mutators ------------------------------------------------------------
  const setAdjust = (key: keyof AdjustParams, value: number) =>
    setParams((p) => ({ ...p, adjust: { ...p.adjust, [key]: value } }));

  const resetAdjust = () => setParams((p) => ({ ...p, adjust: { ...DEFAULT_ADJUST } }));

  const rotate = (dir: -1 | 1) =>
    setParams((p) => ({
      ...p,
      transform: { ...p.transform, rotate90: (p.transform.rotate90 + dir + 4) % 4 },
    }));

  const setAspect = (key: AspectKey) => {
    const ts = previewSource ? transformedSize(previewSource, params.transform) : null;
    const ia = ts ? ts.bw / ts.bh : 1;
    const target = ts ? aspectValue(key, ts.bw, ts.bh) : null;
    setParams((p) => {
      if (target == null) return { ...p, crop: { ...p.crop, aspect: key } };
      const na = target / ia;
      const w = na >= 1 ? 1 : na;
      const h = na >= 1 ? 1 / na : 1;
      return {
        ...p,
        crop: { x: (1 - w) / 2, y: (1 - h) / 2, w, h, aspect: key },
      };
    });
  };

  const resetCrop = () =>
    setParams((p) => ({ ...p, crop: { x: 0, y: 0, w: 1, h: 1, aspect: "free" } }));

  const setResize = (dim: "width" | "height", raw: string) => {
    const parsed = parseInt(raw, 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    setParams((p) => {
      const ratio = natSize.height > 0 ? natSize.width / natSize.height : 1;
      const next = { ...p.resize, [dim]: value };
      if (p.resize.lockAspect && value != null) {
        if (dim === "width") next.height = Math.max(1, Math.round(value / ratio));
        else next.width = Math.max(1, Math.round(value * ratio));
      }
      return { ...p, resize: next };
    });
  };

  const toggleLockAspect = (locked: boolean) =>
    setParams((p) => ({ ...p, resize: { ...p.resize, lockAspect: locked } }));

  // Render the full-resolution edited image to a data URL in the given format.
  // Yields a macrotask first so React can paint the "Saving…" state before the
  // synchronous pipeline (renderTo → getImageData → toDataURL) freezes the
  // main thread.
  const renderFullDataUrl = async (mime: string): Promise<string> => {
    if (!fullSource) throw new Error("image not loaded");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const exportCanvas = document.createElement("canvas");
    renderTo(exportCanvas, fullSource, params, true);
    return exportCanvas.toDataURL(mime, 0.92);
  };

  // --- Save a copy ---------------------------------------------------------
  const onSave = async () => {
    if (!fullSource || !photo) return;
    setSaving(true);
    try {
      const base = photo.filename.replace(/\.[^.]+$/, "");
      const dest = await pickSavePath(`${base}-edited.jpg`);
      if (!dest) return;

      const dataUrl = await renderFullDataUrl(mimeForPath(dest));
      const saved = await saveEditedImage(dest, dataUrl);

      toast.success(t("editor.savedCopy"), {
        description: saved,
        action: { label: t("editor.reveal"), onClick: () => revealInExplorer(saved) },
      });
    } catch (err) {
      toast.error(t("editor.saveCopyError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  // --- Save to original (destructive: overwrites the source file) ----------
  const onOverwrite = async () => {
    if (!fullSource || !photo) return;
    setConfirmOverwrite(false);
    setSaving(true);
    try {
      // Re-encode in the original's own format so the file keeps its extension.
      const dataUrl = await renderFullDataUrl(mimeForPath(photo.filename));
      await overwriteOriginal(photo.id, dataUrl);

      // Refresh everything derived from this photo (detail, lists, timeline,
      // map). The cache-busted src (fileModified) makes the new pixels show.
      await queryClient.invalidateQueries({ queryKey: qk.photos });
      await queryClient.invalidateQueries({ queryKey: qk.photo(photo.id) });

      toast.success(t("editor.savedToOriginal"), { description: photo.filename });
      close();
    } catch (err) {
      toast.error(t("editor.overwriteError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="truncate text-sm font-medium" title={photo?.filename}>
          {photo?.filename ?? t("editor.editing")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmOverwrite(true)}
            disabled={saving || !fullSource}
          >
            <SaveAll className="size-4" />
            {t("editor.saveToOriginal")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !fullSource}>
            <Save className="size-4" />
            {saving ? t("editor.saving") : t("editor.saveCopy")}
          </Button>
          <Button size="icon" variant="ghost" onClick={close} aria-label={t("editor.closeEditor")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* Destructive confirm: overwriting replaces the source file in place. */}
      <Dialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.overwriteTitle")}</DialogTitle>
            <DialogDescription>
              {t("editor.overwriteDescription", { filename: photo?.filename ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOverwrite(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={onOverwrite} disabled={saving}>
              {saving ? t("editor.saving") : t("editor.overwriteOriginal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 flex-1">
        {/* Preview stage */}
        <main className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-6">
          {loading ? (
            <Skeleton className="h-[70%] w-[70%] rounded-lg" />
          ) : (
            <div className="relative inline-block max-h-full max-w-full leading-none">
              <canvas
                ref={previewCanvasRef}
                className="block h-auto max-h-[calc(100vh-3.5rem-3rem)] w-auto max-w-full rounded-md shadow-lg"
              />
              {tab === "crop" && previewSource && (
                <CropOverlay
                  rect={params.crop}
                  imageAspect={imageAspect}
                  targetAspect={targetAspect}
                  onChange={(rect) => setParams((p) => ({ ...p, crop: { ...p.crop, ...rect } }))}
                />
              )}
            </div>
          )}
        </main>

        {/* Controls */}
        <aside className="flex w-80 shrink-0 flex-col border-l">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <div className="p-3">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="adjust">{t("editor.adjust")}</TabsTrigger>
                <TabsTrigger value="crop">{t("editor.crop")}</TabsTrigger>
                <TabsTrigger value="transform">{t("editor.transform")}</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              {/* ADJUST */}
              <TabsContent value="adjust" className="mt-0 space-y-5">
                {ADJUST_FIELDS.map((f) => (
                  <AdjustSlider
                    key={f.key}
                    label={t(f.labelKey)}
                    Icon={f.Icon}
                    min={f.min}
                    max={f.max}
                    value={params.adjust[f.key]}
                    onChange={(v) => setAdjust(f.key, v)}
                  />
                ))}
                <Button variant="outline" size="sm" className="w-full" onClick={resetAdjust}>
                  {t("editor.resetAll")}
                </Button>
              </TabsContent>

              {/* CROP */}
              <TabsContent value="crop" className="mt-0 space-y-5">
                <div className="space-y-2">
                  <Label>{t("editor.aspectRatio")}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASPECT_OPTIONS.map((o) => (
                      <Button
                        key={o.value}
                        variant={params.crop.aspect === o.value ? "default" : "outline"}
                        size="sm"
                        aria-pressed={params.crop.aspect === o.value}
                        onClick={() => setAspect(o.value)}
                      >
                        {t(o.labelKey)}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("editor.cropHint")}
                </p>
                <Button variant="outline" size="sm" className="w-full" onClick={resetCrop}>
                  {t("editor.resetCrop")}
                </Button>
              </TabsContent>

              {/* TRANSFORM */}
              <TabsContent value="transform" className="mt-0 space-y-6">
                <div className="space-y-2">
                  <Label>{t("editor.rotate")}</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => rotate(-1)}>
                      <RotateCcw className="size-4" /> {t("editor.left")}
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => rotate(1)}>
                      <RotateCw className="size-4" /> {t("editor.right")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("editor.flip")}</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={params.transform.flipH ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() =>
                        setParams((p) => ({
                          ...p,
                          transform: { ...p.transform, flipH: !p.transform.flipH },
                        }))
                      }
                    >
                      <FlipHorizontal className="size-4" /> {t("editor.horizontal")}
                    </Button>
                    <Button
                      variant={params.transform.flipV ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() =>
                        setParams((p) => ({
                          ...p,
                          transform: { ...p.transform, flipV: !p.transform.flipV },
                        }))
                      }
                    >
                      <FlipVertical className="size-4" /> {t("editor.vertical")}
                    </Button>
                  </div>
                </div>

                <AdjustSlider
                  label={t("editor.straighten")}
                  min={-45}
                  max={45}
                  suffix="°"
                  value={params.transform.straighten}
                  onChange={(v) =>
                    setParams((p) => ({ ...p, transform: { ...p.transform, straighten: v } }))
                  }
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t("editor.resize")}</Label>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("editor.lockAspect")}
                      <Switch
                        checked={params.resize.lockAspect}
                        onCheckedChange={toggleLockAspect}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">{t("editor.width")}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={(params.resize.width ?? natSize.width) || ""}
                        onChange={(e) => setResize("width", e.target.value)}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">{t("editor.height")}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={(params.resize.height ?? natSize.height) || ""}
                        onChange={(e) => setResize("height", e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("editor.outputSize", {
                      width: params.resize.width ?? natSize.width,
                      height: params.resize.height ?? natSize.height,
                    })}
                  </p>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

/** A labelled slider with a live numeric readout and double-click-to-reset. */
function AdjustSlider({
  label,
  Icon,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  Icon?: LucideIcon;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const { t } = useTranslation();
  // Neutral value: 0 for bipolar controls, the min for unipolar ones.
  const neutral = min < 0 ? 0 : min;
  return (
    <div
      className="space-y-2"
      onDoubleClick={() => onChange(neutral)}
      title={t("editor.doubleClickReset")}
    >
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
          {label}
        </Label>
        <span className={cn("text-xs tabular-nums", value === neutral ? "text-muted-foreground" : "text-foreground")}>
          {value > 0 && min < 0 ? "+" : ""}
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? neutral)}
      />
    </div>
  );
}

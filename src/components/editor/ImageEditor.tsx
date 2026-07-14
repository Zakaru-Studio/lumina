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
  Droplets,
  Eye,
  FlipHorizontal,
  FlipVertical,
  Focus,
  type LucideIcon,
  Maximize,
  Minus,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Sparkles,
  Sun,
  SunDim,
  SunMedium,
  Sunrise,
  Sunset,
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
  assetSrc,
  displayPreview,
  originalSrc,
  overwriteOriginal,
  pickSavePath,
  revealInExplorer,
  saveAvif,
  saveEditedImage,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { qk, queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";

import { CropOverlay } from "./CropOverlay";
import {
  type AdjustParams,
  type AspectKey,
  type EditParams,
  aspectValue,
  clamp,
  croppedNaturalSize,
  DEFAULT_ADJUST,
  defaultParams,
  transformedSize,
} from "./params";
import { mimeForPath, PREVIEW_MAX_EDGE, renderTo } from "./render";

/** One Adjust-tab slider descriptor. `labelKey` resolves against `editor`. */
interface AdjustField {
  key: keyof AdjustParams;
  labelKey: string;
  min: number;
  max: number;
  Icon: LucideIcon;
}

/**
 * Declarative config for the Adjust tab, grouped into Light / Colour / Effects
 * sections. Each group renders under a small heading so related controls sit
 * together. Labels/headings resolve against the `editor` i18n namespace.
 */
const ADJUST_GROUPS: { titleKey: string; fields: AdjustField[] }[] = [
  {
    titleKey: "editor.groupLight",
    fields: [
      { key: "exposure", labelKey: "editor.exposure", min: -100, max: 100, Icon: Sun },
      { key: "brightness", labelKey: "editor.brightness", min: -100, max: 100, Icon: SunMedium },
      { key: "contrast", labelKey: "editor.contrast", min: -100, max: 100, Icon: Contrast },
      { key: "highlights", labelKey: "editor.highlights", min: -100, max: 100, Icon: SunDim },
      { key: "shadows", labelKey: "editor.shadows", min: -100, max: 100, Icon: Moon },
      { key: "whites", labelKey: "editor.whites", min: -100, max: 100, Icon: Sunrise },
      { key: "blacks", labelKey: "editor.blacks", min: -100, max: 100, Icon: Sunset },
    ],
  },
  {
    titleKey: "editor.groupColor",
    fields: [
      { key: "saturation", labelKey: "editor.saturation", min: -100, max: 100, Icon: Droplet },
      { key: "vibrance", labelKey: "editor.vibrance", min: -100, max: 100, Icon: Palette },
      { key: "warmth", labelKey: "editor.warmth", min: -100, max: 100, Icon: Thermometer },
      { key: "tint", labelKey: "editor.tint", min: -100, max: 100, Icon: Droplets },
    ],
  },
  {
    titleKey: "editor.groupEffects",
    fields: [
      { key: "clarity", labelKey: "editor.clarity", min: -100, max: 100, Icon: Sparkles },
      { key: "sharpness", labelKey: "editor.sharpness", min: 0, max: 100, Icon: Focus },
      { key: "vignette", labelKey: "editor.vignette", min: 0, max: 100, Icon: CircleDot },
    ],
  },
];

const ASPECT_OPTIONS: { value: AspectKey; labelKey: string }[] = [
  { value: "free", labelKey: "editor.aspectFree" },
  { value: "1:1", labelKey: "editor.aspectSquare" },
  { value: "4:3", labelKey: "editor.aspect43" },
  { value: "3:2", labelKey: "editor.aspect32" },
  { value: "16:9", labelKey: "editor.aspect169" },
  { value: "original", labelKey: "editor.aspectOriginal" },
];

/** Preview zoom bounds. `1` is fit-to-stage; the user zooms in to inspect. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/** Output format for the "Export a copy" dialog. */
type ExportFormat = "jpeg" | "png" | "webp" | "avif";

/** Selectable export formats. `lossy` drives whether the quality slider shows;
 * AVIF is encoded backend-side (browsers can't encode it from a canvas). */
const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string; lossy: boolean }[] = [
  { value: "jpeg", label: "JPEG", ext: "jpg", lossy: true },
  { value: "png", label: "PNG", ext: "png", lossy: false },
  { value: "webp", label: "WebP", ext: "webp", lossy: true },
  { value: "avif", label: "AVIF", ext: "avif", lossy: true },
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
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>("jpeg");
  const [exportQuality, setExportQuality] = React.useState(92);
  const [estimatedBytes, setEstimatedBytes] = React.useState<number | null>(null);
  const [tab, setTab] = React.useState("adjust");
  // While held, the preview drops all Adjust edits so the user can peek at the
  // reference (original tones/colour) without leaving the current framing.
  const [comparing, setComparing] = React.useState(false);

  const previewCanvasRef = React.useRef<HTMLCanvasElement>(null);

  // --- Preview zoom / pan --------------------------------------------------
  // The canvas itself is transformed (scale + translate); the wrapper keeps its
  // fit-size so the compare button and crop overlay stay anchored. Refs mirror
  // the live values so the native wheel handler avoids re-binding.
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [panning, setPanning] = React.useState(false);
  const zoomRef = React.useRef(1);
  const panRef = React.useRef({ x: 0, y: 0 });
  const panStart = React.useRef<{ x: number; y: number } | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  // Read the live tab inside the native wheel handler without re-binding it.
  const tabRef = React.useRef(tab);
  tabRef.current = tab;

  /** Commit a zoom+pan to both refs (handlers) and state (render). */
  const applyZoom = React.useCallback(
    (nextZoom: number, nextPan: { x: number; y: number }) => {
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [],
  );

  const resetZoom = React.useCallback(
    () => applyZoom(1, { x: 0, y: 0 }),
    [applyZoom],
  );

  /** Keep the panned image from drifting entirely out of the stage. */
  const clampPan = React.useCallback(
    (p: { x: number; y: number }, z: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || z <= 1) return { x: 0, y: 0 };
      const limX = ((z - 1) * rect.width) / 2 + rect.width * 0.1;
      const limY = ((z - 1) * rect.height) / 2 + rect.height * 0.1;
      return { x: clamp(p.x, -limX, limX), y: clamp(p.y, -limY, limY) };
    },
    [],
  );

  // Crop is always framed at fit, so zoom/pan are suppressed on that tab.
  const viewZoom = tab === "crop" ? 1 : zoom;
  const viewPan = tab === "crop" ? { x: 0, y: 0 } : pan;
  const canPan = zoom > 1 && tab !== "crop";

  // --- Escape to close -----------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useEditorStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset the view whenever a different photo is opened.
  React.useEffect(() => {
    resetZoom();
  }, [photo?.id, resetZoom]);

  // Wheel-to-zoom toward the cursor over the preview stage. Native + non-passive
  // so we can preventDefault the page scroll. Disabled on Crop (always fit).
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (tabRef.current === "crop") return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const s = zoomRef.current;
      const next = clamp(s * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      const o = panRef.current;
      const np =
        next <= 1
          ? { x: 0, y: 0 }
          : clampPan(
              { x: cx - (cx - o.x) * (next / s), y: cy - (cy - o.y) * (next / s) },
              next,
            );
      applyZoom(next, np);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, clampPan]);

  // Estimate the exported file size for the chosen format/quality while the
  // export dialog is open. Encodes the current edit at PREVIEW resolution (cheap)
  // and scales the byte size up by the full-res / preview-res pixel-area ratio.
  // AVIF can't be encoded client-side, so it's approximated from a WebP encode.
  React.useEffect(() => {
    if (!exportOpen || !previewSource || !fullSource) {
      setEstimatedBytes(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      const pc = document.createElement("canvas");
      try {
        renderTo(pc, previewSource, params, false);
      } catch {
        if (!cancelled) setEstimatedBytes(null);
        return;
      }
      const previewArea = pc.width * pc.height;
      const nat = croppedNaturalSize(fullSource, params);
      const fullArea = Math.max(1, nat.width * nat.height);
      const ratio = previewArea > 0 ? fullArea / previewArea : 1;
      const isAvif = exportFormat === "avif";
      const mime = isAvif
        ? "image/webp"
        : exportFormat === "png"
          ? "image/png"
          : `image/${exportFormat}`;
      const q = exportFormat === "png" ? undefined : exportQuality / 100;
      pc.toBlob(
        (blob) => {
          if (cancelled) return;
          if (!blob) return setEstimatedBytes(null);
          // AVIF runs ~45% smaller than WebP at a matched quality.
          setEstimatedBytes(Math.round(blob.size * ratio * (isAvif ? 0.55 : 1)));
        },
        mime,
        q,
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [exportOpen, exportFormat, exportQuality, previewSource, fullSource, params]);

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
    // RAW files aren't webview-decodable — edit their rendered preview instead
    // (resolved + cached backend-side), exactly as the lightbox does.
    void (async () => {
      let src: string;
      try {
        src = photo.isRaw ? assetSrc(await displayPreview(photo.id)) : originalSrc(photo);
      } catch {
        if (!cancelled) {
          setLoading(false);
          toast.error(t("editor.loadError"), { description: photo.filename });
        }
        return;
      }
      if (!cancelled) img.src = src;
    })();
    return () => {
      cancelled = true;
    };
  }, [photo?.id, photo?.path, photo?.isRaw]);

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
            : comparing
              ? // Hold-to-compare: same crop/transform, adjustments reset.
                { ...params, adjust: { ...DEFAULT_ADJUST } }
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
  }, [params, previewSource, tab, comparing]);

  // --- Derived geometry ----------------------------------------------------
  const tsize = previewSource ? transformedSize(previewSource, params.transform) : null;
  const imageAspect = tsize ? tsize.bw / tsize.bh : 1;
  const targetAspect = tsize ? aspectValue(params.crop.aspect, tsize.bw, tsize.bh) : null;
  const natSize = fullSource
    ? croppedNaturalSize(fullSource, params)
    : { width: 0, height: 0 };

  // Human-readable estimated export size + savings vs the original, for the
  // export dialog. Recomputed cheaply from `estimatedBytes` on each render.
  const exportSizeHint = ((): string => {
    if (estimatedBytes == null) return t("editor.estimating");
    const size = formatBytes(estimatedBytes);
    if (!photo?.fileSize) return `≈ ${size}`;
    const pct = Math.round((1 - estimatedBytes / photo.fileSize) * 100);
    return `≈ ${size} · ${pct >= 0 ? "−" : "+"}${Math.abs(pct)} % ${t("editor.vsOriginal")}`;
  })();

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

  // --- Zoom / pan handlers -------------------------------------------------
  /** Step the zoom in/out about the current center, clamping to bounds. */
  const zoomBy = (factor: number) => {
    const next = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
    applyZoom(next, next <= 1 ? { x: 0, y: 0 } : clampPan(panRef.current, next));
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canPan) return;
    e.preventDefault();
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    panStart.current = { x: e.clientX, y: e.clientY };
    applyZoom(
      zoomRef.current,
      clampPan(
        { x: panRef.current.x + dx, y: panRef.current.y + dy },
        zoomRef.current,
      ),
    );
  };

  const endCanvasPan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    panStart.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Render the full-resolution edited image to a data URL in the given format.
  // Yields a macrotask first so React can paint the "Saving…" state before the
  // synchronous pipeline (renderTo → getImageData → toDataURL) freezes the
  // main thread.
  const renderFullDataUrl = async (mime: string, quality = 0.92): Promise<string> => {
    if (!fullSource) throw new Error("image not loaded");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const exportCanvas = document.createElement("canvas");
    renderTo(exportCanvas, fullSource, params, true);
    return exportCanvas.toDataURL(mime, quality);
  };

  // --- Export a copy in a chosen format / quality --------------------------
  const onExport = async () => {
    if (!fullSource || !photo) return;
    const fmt = EXPORT_FORMATS.find((f) => f.value === exportFormat)!;
    setExportOpen(false);
    setSaving(true);
    try {
      const base = photo.filename.replace(/\.[^.]+$/, "");
      const dest = await pickSavePath(`${base}-edited.${fmt.ext}`);
      if (!dest) return;

      let saved: string;
      if (exportFormat === "avif") {
        // Canvas can't encode AVIF — hand the backend a lossless PNG to re-encode.
        const png = await renderFullDataUrl("image/png");
        saved = await saveAvif(dest, png, exportQuality);
      } else {
        const mime = exportFormat === "png" ? "image/png" : `image/${exportFormat}`;
        const dataUrl = await renderFullDataUrl(mime, exportQuality / 100);
        saved = await saveEditedImage(dest, dataUrl);
      }

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
            disabled={saving || !fullSource || photo?.isRaw}
            title={photo?.isRaw ? t("editor.rawNoOverwrite") : undefined}
          >
            <SaveAll className="size-4" />
            {t("editor.saveToOriginal")}
          </Button>
          <div className="flex items-center">
            <Button
              size="sm"
              className="rounded-r-none"
              onClick={onSave}
              disabled={saving || !fullSource}
            >
              <Save className="size-4" />
              {saving ? t("editor.saving") : t("editor.saveCopy")}
            </Button>
            <Button
              size="icon"
              className="h-8 w-8 rounded-l-none border-l border-primary-foreground/20"
              onClick={() => setExportOpen(true)}
              disabled={saving || !fullSource}
              aria-label={t("editor.exportCopy")}
              title={t("editor.exportCopy")}
            >
              <Plus className="size-4" />
            </Button>
          </div>
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

      {/* Export a copy: pick a file format and (for lossy formats) a quality. */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.exportTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>{t("editor.format")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {EXPORT_FORMATS.map((f) => (
                  <Button
                    key={f.value}
                    type="button"
                    variant={exportFormat === f.value ? "default" : "outline"}
                    size="sm"
                    aria-pressed={exportFormat === f.value}
                    onClick={() => setExportFormat(f.value)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
            {EXPORT_FORMATS.find((f) => f.value === exportFormat)?.lossy ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("editor.quality")}</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {exportQuality}
                  </span>
                </div>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[exportQuality]}
                  onValueChange={(v) => setExportQuality(v[0] ?? 92)}
                />
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{exportSizeHint}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onExport} disabled={saving || !fullSource}>
              {saving ? t("editor.saving") : t("editor.export")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 flex-1">
        {/* Preview stage */}
        <main
          ref={stageRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-6"
        >
          {loading ? (
            <Skeleton className="h-[70%] w-[70%] rounded-lg" />
          ) : (
            <div className="relative inline-block max-h-full max-w-full leading-none">
              <canvas
                ref={previewCanvasRef}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={endCanvasPan}
                onPointerCancel={endCanvasPan}
                style={{
                  transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
                  transformOrigin: "center center",
                  transition: panning ? "none" : "transform 150ms ease",
                  cursor: canPan ? (panning ? "grabbing" : "grab") : "default",
                  touchAction: "none",
                }}
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

              {/* Hold-to-compare with the reference. Adjust tab only — that's
                  where tonal/colour edits live. Pointer capture keeps the peek
                  active even if the cursor slides off the button while held. */}
              {tab === "adjust" && previewSource ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={cn(
                      "absolute left-3 top-3 z-10 gap-2 bg-background/80 shadow-md backdrop-blur-sm hover:bg-background/90",
                      comparing && "ring-2 ring-primary",
                    )}
                    title={t("editor.compareHint")}
                    aria-label={t("editor.compareHint")}
                    aria-pressed={comparing}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setComparing(true);
                    }}
                    onPointerUp={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      setComparing(false);
                    }}
                    onPointerCancel={() => setComparing(false)}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        setComparing(true);
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        setComparing(false);
                      }
                    }}
                    onBlur={() => setComparing(false)}
                  >
                    <Eye className="size-4" />
                    {t("editor.compare")}
                  </Button>
                  {comparing ? (
                    <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1 text-xs font-medium shadow-md backdrop-blur-sm">
                      {t("editor.original")}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}

          {/* Zoom controls (bottom-center). Hidden on Crop, which is always
              framed at fit. */}
          {!loading && tab !== "crop" ? (
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-background/70 px-1 py-1 shadow-md backdrop-blur">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("editor.zoomOut")}
                disabled={zoom <= MIN_ZOOM + 0.001}
                onClick={() => zoomBy(1 / 1.5)}
              >
                <Minus className="size-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("editor.zoomIn")}
                disabled={zoom >= MAX_ZOOM - 0.001}
                onClick={() => zoomBy(1.5)}
              >
                <Plus className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("editor.fitToScreen")}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                onClick={resetZoom}
              >
                <Maximize className="size-4" />
              </Button>
            </div>
          ) : null}
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
              <TabsContent value="adjust" className="mt-0 space-y-6">
                {ADJUST_GROUPS.map((group) => (
                  <div key={group.titleKey} className="space-y-4">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t(group.titleKey)}
                    </h3>
                    {group.fields.map((f) => (
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
                  </div>
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

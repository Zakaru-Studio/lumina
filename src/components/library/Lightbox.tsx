import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Maximize,
  Minus,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { DateTimeEditor } from "@/components/common/DateTimeEditor";
import { StarRating } from "@/components/common/StarRating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

import { assetSrc, displayPreview, originalSrc, revealInExplorer, thumbnailSrc } from "@/lib/api";
import {
  formatBytes,
  formatCamera,
  formatExposure,
  formatTaken,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePhoto } from "@/hooks/usePhotos";
import { useAttachTag, useCreateTag, useDetachTag, useTags } from "@/hooks/useTags";
import {
  useSetCaptureDate,
  useSetFavorite,
  useSetRating,
} from "@/hooks/usePhotoMutations";
import { useEditorStore } from "@/stores/editorStore";
import type { Photo } from "@/types";

/** Props for {@link Lightbox}. */
export interface LightboxProps {
  /** The FULL ordered id list the viewer navigates over. */
  ids: string[];
  /** Index into `ids`, or null when closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  /** Resolve a nearby photo's loaded detail (used for the filmstrip). */
  getPhoto?: (index: number) => Photo | undefined;
}

/** A 2D translation offset (in CSS pixels, relative to the fit position). */
interface Point {
  x: number;
  y: number;
}

/** Minimum/maximum zoom factors for the viewer. `1` is "fit". */
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
/** Number of neighbouring thumbnails rendered on each side in the filmstrip. */
const FILMSTRIP_WINDOW = 12;

/** Clamp a number into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rough pan clamp: keep at least a slice of the image on screen. Uses the
 * container box (not the exact rendered image box) which is good enough for a
 * viewer whose image is `object-contain`.
 */
function clampOffset(offset: Point, scale: number, rect: DOMRect | null): Point {
  if (!rect || scale <= 1) return { x: 0, y: 0 };
  const limitX = Math.max(0, (rect.width * scale - rect.width) / 2) + rect.width * 0.15;
  const limitY = Math.max(0, (rect.height * scale - rect.height) / 2) + rect.height * 0.15;
  return { x: clamp(offset.x, -limitX, limitX), y: clamp(offset.y, -limitY, limitY) };
}

/** A labelled metadata row. */
function MetaRow({
  label,
  value,
  onClick,
  title,
}: {
  label: string;
  value: string;
  /** When set, the value renders as a button invoking this on click. */
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          title={title}
          className="truncate text-left text-sm text-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          {value}
        </button>
      ) : (
        <span className="text-sm text-foreground" title={title}>
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * Full-screen viewer for a single photo, navigating over the whole id list.
 * Shows the original at object-contain with a right-hand metadata + editing
 * panel (rating, favorite, tags). Supports wheel/double-click zoom,
 * drag-to-pan, and a filmstrip of neighbours resolved lazily via `getPhoto`.
 * All edits are catalog metadata; the original file is never modified.
 */
export function Lightbox({ ids, index, onClose, onIndexChange, getPhoto }: LightboxProps) {
  const { t } = useTranslation();
  const open = index !== null && index >= 0 && index < ids.length;
  const currentId = open ? ids[index] ?? null : null;

  // Fresh detail (tags) for the current photo; fall back to any windowed copy so
  // the image can appear immediately while the detail request resolves.
  const detail = usePhoto(currentId);
  const photo: Photo | undefined =
    detail.data ?? (open && index !== null ? getPhoto?.(index) : undefined);

  /** Videos render in a <video> player instead of the zoomable <img>. */
  const isVideo = photo?.mediaType === "video";
  /** RAW files aren't webview-decodable — display a rendered preview instead. */
  const isRaw = photo?.isRaw === true && !isVideo;

  // Resolve a displayable source for RAW originals (rendered + cached backend
  // side). Only runs for RAW; standard images display straight from disk.
  const rawPreview = useQuery({
    queryKey: ["displayPreview", photo?.id],
    queryFn: () => displayPreview(photo!.id),
    enabled: open && isRaw && !!photo?.id,
    staleTime: 5 * 60_000,
  });

  const [imgLoaded, setImgLoaded] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [dateEditorOpen, setDateEditorOpen] = useState(false);

  // --- Zoom & pan state ---
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  /** Whether transform changes should animate (snapping) vs. track live (pan/wheel). */
  const [smooth, setSmooth] = useState(false);
  const [panning, setPanning] = useState(false);

  // Latest transform in refs so the native wheel/pan handlers avoid re-binding.
  const scaleRef = useRef(1);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const panStart = useRef<Point | null>(null);
  const imageAreaRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Read inside the native wheel handler to skip zoom math for videos.
  const isVideoRef = useRef(false);
  isVideoRef.current = isVideo;

  const { data: tags = [] } = useTags();
  const setRating = useSetRating();
  const setFavorite = useSetFavorite();
  const setCaptureDate = useSetCaptureDate();
  const createTag = useCreateTag();
  const attachTag = useAttachTag();
  const detachTag = useDetachTag();

  /** Commit a new transform to both refs (for handlers) and state (for render). */
  const applyView = useCallback((nextScale: number, nextOffset: Point, animate: boolean) => {
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setScale(nextScale);
    setOffset(nextOffset);
    setSmooth(animate);
  }, []);

  /** Reset zoom/pan back to fit (scale 1, no offset). */
  const resetView = useCallback(
    (animate: boolean) => applyView(1, { x: 0, y: 0 }, animate),
    [applyView],
  );

  // Reset fade + zoom/pan whenever the shown photo changes (watch photo.id).
  useEffect(() => {
    setImgLoaded(false);
    resetView(false);
  }, [photo?.id, resetView]);

  // Auto-play the video as soon as it's shown (opening the viewer via a
  // double-click is the user gesture). If the webview blocks autoplay-with-sound
  // the native controls remain, so the user can start it manually.
  useEffect(() => {
    if (!open || !isVideo) return;
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  }, [open, isVideo, photo?.id]);

  // Native, non-passive wheel handler so we can preventDefault the page scroll
  // and zoom toward the cursor.
  useEffect(() => {
    if (!open) return;
    const el = imageAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (isVideoRef.current) return; // videos are not zoomable
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const s = scaleRef.current;
      const nextScale = clamp(s * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
      const o = offsetRef.current;
      // Keep the point under the cursor fixed while scaling.
      let next: Point = {
        x: cx - (cx - o.x) * (nextScale / s),
        y: cy - (cy - o.y) * (nextScale / s),
      };
      next = nextScale <= 1 ? { x: 0, y: 0 } : clampOffset(next, nextScale, rect);
      applyView(nextScale, next, false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, applyView]);

  // Keyboard navigation.
  useEffect(() => {
    if (!open || index === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && !typing) {
        e.preventDefault();
        onIndexChange(Math.max(0, index - 1));
      } else if (e.key === "ArrowRight" && !typing) {
        e.preventDefault();
        onIndexChange(Math.min(ids.length - 1, index + 1));
      } else if (e.key === " " && !typing && videoRef.current) {
        // Space toggles play/pause on the current video.
        e.preventDefault();
        const v = videoRef.current;
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, ids.length, onClose, onIndexChange]);

  // Auto-scroll the active filmstrip thumb into view when the index changes.
  useEffect(() => {
    if (!open) return;
    activeThumbRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [open, index]);

  // Only the truly-closed state unmounts the overlay. When the current photo's
  // detail is momentarily unavailable (its windowed page hasn't loaded yet), we
  // keep the chrome mounted and show a loading placeholder in the image area.
  if (!open || index === null) return null;

  /** Ids the metadata mutations act on: just the currently viewed photo. */
  const targetIds = photo ? [photo.id] : [];

  /** Source shown in the <img>: a rendered preview for RAW (null while it
   * resolves), the original file otherwise. */
  const imgSrc = !photo
    ? null
    : isRaw
      ? rawPreview.data
        ? assetSrc(rawPreview.data)
        : null
      : originalSrc(photo);

  /** Toggle between fit and 2× at the double-clicked point. */
  const onImageDoubleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = imageAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (scaleRef.current > 1.01) {
      resetView(true);
      return;
    }
    const target = 2;
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const next = clampOffset({ x: cx * (1 - target), y: cy * (1 - target) }, target, rect);
    applyView(target, next, true);
  };

  const onImagePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (scaleRef.current <= 1) return;
    e.preventDefault();
    setPanning(true);
    setSmooth(false);
    panStart.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onImagePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    panStart.current = { x: e.clientX, y: e.clientY };
    const rect = imageAreaRef.current?.getBoundingClientRect() ?? null;
    const next = clampOffset(
      { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy },
      scaleRef.current,
      rect,
    );
    applyView(scaleRef.current, next, false);
  };

  const endPan = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!panStart.current) return;
    panStart.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /** Zoom in/out by a step, keeping the current center and clamping. */
  const zoomBy = (factor: number) => {
    const rect = imageAreaRef.current?.getBoundingClientRect() ?? null;
    const nextScale = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE);
    const next = nextScale <= 1 ? { x: 0, y: 0 } : clampOffset(offsetRef.current, nextScale, rect);
    applyView(nextScale, next, true);
  };

  const canPan = scale > 1;

  const commitTag = () => {
    const name = tagInput.trim();
    if (!name) return;
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      attachTag.mutate({ tagId: existing.id, photoIds: targetIds });
      setTagInput("");
      return;
    }
    createTag.mutate(
      { name },
      {
        onSuccess: (tag) => attachTag.mutate({ tagId: tag.id, photoIds: targetIds }),
      },
    );
    setTagInput("");
  };

  const filmStart = Math.max(0, index - FILMSTRIP_WINDOW);
  const filmEnd = Math.min(ids.length - 1, index + FILMSTRIP_WINDOW);
  const filmIndices: number[] = [];
  for (let i = filmStart; i <= filmEnd; i++) filmIndices.push(i);

  return (
    <div className="fixed inset-0 z-50 flex bg-background/95 backdrop-blur animate-fade-in">
      {/* Top-right toolbar: edit + close */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.edit")}
          disabled={!photo}
          onClick={() => photo && useEditorStore.getState().open(photo.id)}
        >
          <SlidersHorizontal className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Image area */}
      <div
        ref={imageAreaRef}
        className={cn(
          "relative flex flex-1 items-center justify-center overflow-hidden p-8",
          // Videos expose a native control bar at their bottom edge. When a
          // filmstrip is present it sits above that edge and would cover the
          // controls for tall (portrait) videos, so reserve room to lift the
          // video clear of the strip.
          isVideo && ids.length > 1 && "pb-28",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("lightbox.previous")}
          disabled={index === 0}
          onClick={() => onIndexChange(Math.max(0, index - 1))}
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>

        {!photo || !imgLoaded ? (
          <Skeleton className="absolute h-2/3 w-2/3 rounded-xl" />
        ) : null}
        {!photo ? null : isVideo ? (
          <video
            key={photo.id}
            ref={videoRef}
            src={originalSrc(photo)}
            controls
            autoPlay
            playsInline
            onLoadedData={() => setImgLoaded(true)}
            className={cn(
              "max-h-full max-w-full object-contain outline-none transition-opacity duration-200",
              imgLoaded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : (
          <img
            key={photo.id}
            src={imgSrc ?? undefined}
            alt={photo.filename}
            onLoad={() => setImgLoaded(true)}
            onDoubleClick={onImageDoubleClick}
            onPointerDown={onImagePointerDown}
            onPointerMove={onImagePointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: "center",
              transition: smooth
                ? "transform 200ms ease, opacity 200ms ease"
                : "opacity 200ms ease",
              cursor: canPan ? (panning ? "grabbing" : "grab") : "default",
              touchAction: "none",
            }}
            className={cn(
              "max-h-full max-w-full select-none object-contain",
              imgLoaded ? "opacity-100" : "opacity-0",
            )}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label={t("lightbox.next")}
          disabled={index === ids.length - 1}
          onClick={() => onIndexChange(Math.min(ids.length - 1, index + 1))}
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {/* Zoom controls (bottom-left). Marked so they never trigger image pan.
            Hidden for videos, which use their own native player controls. */}
        <div
          className={cn(
            "absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl bg-background/60 px-1 py-1 backdrop-blur",
            isVideo && "hidden",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("lightbox.zoomOut")}
            disabled={scale <= MIN_SCALE + 0.001}
            onClick={() => zoomBy(1 / 1.5)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("lightbox.zoomIn")}
            disabled={scale >= MAX_SCALE - 0.001}
            onClick={() => zoomBy(1.5)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("lightbox.fitToScreen")}
            disabled={scale === 1 && offset.x === 0 && offset.y === 0}
            onClick={() => resetView(true)}
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        {/* Filmstrip (bottom-center), only when there is more than one photo. */}
        {ids.length > 1 ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-4 z-0 flex justify-center px-20"
            aria-label={t("lightbox.filmstrip")}
          >
            <div
              className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded-xl bg-background/60 p-1.5 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {filmIndices.map((realIndex) => {
                const active = realIndex === index;
                const p = getPhoto?.(realIndex);
                const thumb = p ? thumbnailSrc(p) : null;
                return (
                  <button
                    key={ids[realIndex] ?? realIndex}
                    ref={active ? activeThumbRef : undefined}
                    type="button"
                    aria-label={p?.filename ?? t("lightbox.photo")}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onIndexChange(realIndex)}
                    className={cn(
                      "relative h-12 w-12 shrink-0 overflow-hidden rounded-md ring-offset-2 ring-offset-background transition-all",
                      active
                        ? "h-14 w-14 ring-2 ring-primary"
                        : "opacity-70 hover:opacity-100",
                    )}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={p?.filename ?? ""}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Metadata panel */}
      <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto bg-card/60 p-6">
        {!photo ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : (
          <>
        <div className="flex flex-col gap-1">
          <h2 className="truncate text-base font-medium text-foreground" title={photo.filename}>
            {photo.filename}
          </h2>
          <p className="text-xs text-muted-foreground">{formatCamera(photo)}</p>
        </div>

        {/* Editable controls */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{t("lightbox.rating")}</span>
            <StarRating
              value={photo.rating}
              onChange={(rating) => setRating.mutate({ ids: targetIds, rating })}
              size={18}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{t("lightbox.favorite")}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("lightbox.toggleFavorite")}
              className={cn(photo.isFavorite && "text-red-500")}
              onClick={() =>
                setFavorite.mutate({ ids: targetIds, favorite: !photo.isFavorite })
              }
            >
              <Heart className={cn("h-4 w-4", photo.isFavorite && "fill-current")} />
            </Button>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{t("lightbox.tags")}</span>
          <div className="flex flex-wrap gap-1.5">
            {photo.tags.map((name) => {
              const tag = tags.find((t) => t.name === name);
              return (
                <Badge
                  key={name}
                  variant="secondary"
                  className="cursor-pointer gap-1"
                  onClick={() =>
                    tag && detachTag.mutate({ tagId: tag.id, photoIds: targetIds })
                  }
                >
                  {name}
                  <X className="h-3 w-3" />
                </Badge>
              );
            })}
            {photo.tags.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t("lightbox.noTags")}</span>
            ) : null}
          </div>
          <Input
            list="lumina-tag-suggestions"
            placeholder={t("lightbox.addTagPlaceholder")}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTag();
              }
            }}
          />
          <datalist id="lumina-tag-suggestions">
            {tags.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </div>

        {/* Read-only metadata */}
        <div className="flex flex-col gap-3">
          {formatExposure(photo) ? <MetaRow label={t("lightbox.exposure")} value={formatExposure(photo)} /> : null}
          <MetaRow
            label={t("lightbox.taken")}
            value={formatTaken(photo)}
            onClick={() => setDateEditorOpen(true)}
            title={t("lightbox.editDate")}
          />
          <MetaRow label={t("lightbox.dimensions")} value={`${photo.width} × ${photo.height}`} />
          <MetaRow label={t("lightbox.size")} value={formatBytes(photo.fileSize)} />
          <MetaRow
            label={t("lightbox.folder")}
            value={photo.folder}
            title={photo.path}
            onClick={() => revealInExplorer(photo.path)}
          />
        </div>

        <DateTimeEditor
          open={dateEditorOpen}
          onOpenChange={setDateEditorOpen}
          initial={photo.takenAt ?? photo.fileCreated ?? photo.importedAt}
          onSubmit={(timestamp) => {
            setCaptureDate.mutate({ ids: [photo.id], timestamp });
            setDateEditorOpen(false);
          }}
          pending={setCaptureDate.isPending}
        />
          </>
        )}
      </aside>
    </div>
  );
}

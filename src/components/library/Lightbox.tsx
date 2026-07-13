import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Maximize,
  Minus,
  Plus,
  X,
} from "lucide-react";

import { ColorLabelPicker } from "@/components/common/ColorLabelPicker";
import { StarRating } from "@/components/common/StarRating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { originalSrc, thumbnailSrc } from "@/lib/api";
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
  useSetColor,
  useSetFavorite,
  useSetRating,
} from "@/hooks/usePhotoMutations";
import type { Photo } from "@/types";

/** Props for {@link Lightbox}. */
export interface LightboxProps {
  photos: Photo[];
  /** Flat index into `photos`, or null when closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
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
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

/**
 * Full-screen viewer for a single photo. Shows the original at object-contain
 * with a right-hand metadata + editing panel (rating, color, favorite, tags).
 * Supports wheel/double-click zoom, drag-to-pan, and a filmstrip of neighbours.
 * All edits are catalog metadata; the original file is never modified.
 */
export function Lightbox({ photos, index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null && index >= 0 && index < photos.length;
  const base = open ? photos[index] : null;

  // Fresh detail (tags) for the current photo; fall back to the grid copy.
  const detail = usePhoto(base ? base.id : null);
  const photo: Photo | null = detail.data ?? base;

  const [imgLoaded, setImgLoaded] = useState(false);
  const [tagInput, setTagInput] = useState("");

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

  const { data: tags = [] } = useTags();
  const setRating = useSetRating();
  const setColor = useSetColor();
  const setFavorite = useSetFavorite();
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

  // Native, non-passive wheel handler so we can preventDefault the page scroll
  // and zoom toward the cursor.
  useEffect(() => {
    if (!open) return;
    const el = imageAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
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
        onIndexChange(Math.min(photos.length - 1, index + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, photos.length, onClose, onIndexChange]);

  // Auto-scroll the active filmstrip thumb into view when the index changes.
  useEffect(() => {
    if (!open) return;
    activeThumbRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [open, index]);

  if (!open || index === null || !photo) return null;

  const ids = [photo.id];

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
      attachTag.mutate({ tagId: existing.id, photoIds: ids });
      setTagInput("");
      return;
    }
    createTag.mutate(
      { name },
      {
        onSuccess: (tag) => attachTag.mutate({ tagId: tag.id, photoIds: ids }),
      },
    );
    setTagInput("");
  };

  const filmStart = Math.max(0, index - FILMSTRIP_WINDOW);
  const filmEnd = Math.min(photos.length - 1, index + FILMSTRIP_WINDOW);

  return (
    <div className="fixed inset-0 z-50 flex bg-background/95 backdrop-blur animate-fade-in">
      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10"
      >
        <X className="h-5 w-5" />
      </Button>

      {/* Image area */}
      <div
        ref={imageAreaRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden p-8"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous"
          disabled={index === 0}
          onClick={() => onIndexChange(Math.max(0, index - 1))}
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>

        {!imgLoaded ? <Skeleton className="absolute h-2/3 w-2/3 rounded-xl" /> : null}
        <img
          key={photo.id}
          src={originalSrc(photo)}
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

        <Button
          variant="ghost"
          size="icon"
          aria-label="Next"
          disabled={index === photos.length - 1}
          onClick={() => onIndexChange(Math.min(photos.length - 1, index + 1))}
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {/* Zoom controls (bottom-left). Marked so they never trigger image pan. */}
        <div
          className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl bg-background/60 px-1 py-1 backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
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
            aria-label="Zoom in"
            disabled={scale >= MAX_SCALE - 0.001}
            onClick={() => zoomBy(1.5)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fit to screen"
            disabled={scale === 1 && offset.x === 0 && offset.y === 0}
            onClick={() => resetView(true)}
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        {/* Filmstrip (bottom-center), only when there is more than one photo. */}
        {photos.length > 1 ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-4 z-0 flex justify-center px-20"
            aria-label="Filmstrip"
          >
            <div
              className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded-xl bg-background/60 p-1.5 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {photos.slice(filmStart, filmEnd + 1).map((p, i) => {
                const realIndex = filmStart + i;
                const active = realIndex === index;
                const thumb = thumbnailSrc(p);
                return (
                  <button
                    key={p.id}
                    ref={active ? activeThumbRef : undefined}
                    type="button"
                    aria-label={p.filename}
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
                        alt={p.filename}
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
        <div className="flex flex-col gap-1">
          <h2 className="truncate text-base font-medium text-foreground" title={photo.filename}>
            {photo.filename}
          </h2>
          <p className="text-xs text-muted-foreground">{formatCamera(photo)}</p>
        </div>

        {/* Editable controls */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Rating</span>
            <StarRating
              value={photo.rating}
              onChange={(rating) => setRating.mutate({ ids, rating })}
              size={18}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Color</span>
            <ColorLabelPicker
              value={photo.colorLabel}
              onChange={(color) => setColor.mutate({ ids, color })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Favorite</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle favorite"
              className={cn(photo.isFavorite && "text-red-500")}
              onClick={() =>
                setFavorite.mutate({ ids, favorite: !photo.isFavorite })
              }
            >
              <Heart className={cn("h-4 w-4", photo.isFavorite && "fill-current")} />
            </Button>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {photo.tags.map((name) => {
              const tag = tags.find((t) => t.name === name);
              return (
                <Badge
                  key={name}
                  variant="secondary"
                  className="cursor-pointer gap-1"
                  onClick={() =>
                    tag && detachTag.mutate({ tagId: tag.id, photoIds: ids })
                  }
                >
                  {name}
                  <X className="h-3 w-3" />
                </Badge>
              );
            })}
            {photo.tags.length === 0 ? (
              <span className="text-xs text-muted-foreground">No tags</span>
            ) : null}
          </div>
          <Input
            list="lumina-tag-suggestions"
            placeholder="Add a tag…"
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
          {formatExposure(photo) ? <MetaRow label="Exposure" value={formatExposure(photo)} /> : null}
          <MetaRow label="Taken" value={formatTaken(photo)} />
          <MetaRow label="Dimensions" value={`${photo.width} × ${photo.height}`} />
          <MetaRow label="Size" value={formatBytes(photo.fileSize)} />
          <MetaRow label="Folder" value={photo.folder} />
        </div>
      </aside>
    </div>
  );
}

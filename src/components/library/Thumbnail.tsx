import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileImage, ImageOff, Play, Video as VideoIcon } from "lucide-react";

import { assetSrc, ensureThumbnail, thumbnailSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useUiStore } from "@/stores/uiStore";
import type { Photo } from "@/types";

/** Props for {@link Thumbnail}. */
export interface ThumbnailProps {
  photo: Photo;
  className?: string;
}

/** Centered play glyph overlaid on video cells to signal they're playable. */
function PlayBadge() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/60 backdrop-blur-sm transition group-hover:bg-black/60">
        <Play className="h-4 w-4 translate-x-[1px] fill-current" />
      </div>
    </div>
  );
}

/**
 * A photo thumbnail that never causes layout shift. Shows a `Skeleton` while the
 * image decodes or is being generated, fades the image in on load, and renders a
 * muted placeholder only when generation truly failed.
 *
 * RAW and video carry generated thumbnails (embedded preview / OS poster frame).
 * Entries that were catalogued before thumbnailing was available (status
 * `failed`, no stored path) are regenerated **on demand** the first time they
 * scroll into view — no re-import needed.
 */
export function Thumbnail({ photo, className }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const isVideo = photo.mediaType === "video";
  const thumbCacheBust = useUiStore((s) => s.thumbCacheBust);
  const storedSrc = thumbnailSrc(photo, thumbCacheBust);

  // Lazily (re)generate when nothing is cached yet and the scanner won't do it
  // (status `failed` — RAW/video/previously-unsupported). `pending` is left to
  // the scan pipeline so we don't compete with an in-flight scan.
  const needsGen = storedSrc === null && photo.thumbStatus === "failed" && !errored;
  const gen = useQuery({
    queryKey: ["ensureThumb", photo.id],
    queryFn: () => ensureThumbnail(photo.id),
    enabled: needsGen,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const src = storedSrc ?? (gen.data ? assetSrc(gen.data) : null);
  const generating = src === null && needsGen && gen.isPending;
  const failed = errored || (storedSrc === null && !generating && src === null);

  // No displayable source yet: skeleton while generating, placeholder if failed.
  if (src === null) {
    if (generating) {
      return (
        <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
          <Skeleton className="absolute inset-0 h-full w-full" />
          {isVideo ? <PlayBadge /> : null}
        </div>
      );
    }
    return (
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center bg-muted text-muted-foreground",
          isVideo && "bg-gradient-to-b from-neutral-800 to-neutral-900 text-white/70",
          className,
        )}
      >
        {isVideo ? (
          <>
            <VideoIcon className="h-6 w-6 opacity-40" />
            <PlayBadge />
          </>
        ) : failed ? (
          <ImageOff className="h-6 w-6" />
        ) : (
          <FileImage className="h-6 w-6" />
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
      {!loaded ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
      <img
        src={src}
        alt={photo.filename}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity",
          loaded ? "animate-fade-in opacity-100" : "opacity-0",
        )}
      />
      {isVideo ? <PlayBadge /> : null}
    </div>
  );
}

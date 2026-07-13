import { useState } from "react";
import { FileImage, ImageOff } from "lucide-react";

import { thumbnailSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Photo } from "@/types";

/** Props for {@link Thumbnail}. */
export interface ThumbnailProps {
  photo: Photo;
  className?: string;
}

/**
 * A photo thumbnail that never causes layout shift. Shows a `Skeleton` while the
 * image decodes, fades the image in on load, and renders a muted icon
 * placeholder for RAW files, failed thumbnails, or missing sources.
 */
export function Thumbnail({ photo, className }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const src = thumbnailSrc(photo);
  const isFailed = photo.thumbStatus === "failed" || errored;
  const placeholder = isFailed || photo.isRaw || src === null;

  if (placeholder) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
      >
        {isFailed ? (
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
    </div>
  );
}

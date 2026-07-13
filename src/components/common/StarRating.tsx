import { useState } from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Props for {@link StarRating}. */
export interface StarRatingProps {
  /** Current rating 0..5. */
  value: number;
  /** Called with the new rating; clicking the current value clears to 0. */
  onChange?: (v: number) => void;
  /** Star pixel size. */
  size?: number;
  /** Render statically (no interaction). */
  readOnly?: boolean;
  className?: string;
}

/**
 * Five-star rating control. Filled up to `value` using the accent/primary
 * color, with a hover preview. Clicking the active star clears the rating.
 */
export function StarRating({
  value,
  onChange,
  size = 16,
  readOnly = false,
  className,
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = !readOnly && !!onChange;
  const shown = hover ?? value;

  return (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= shown;
        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            className={cn(
              "rounded transition-colors",
              interactive ? "cursor-pointer hover:scale-110" : "cursor-default",
              "transition-transform",
            )}
            onMouseEnter={() => interactive && setHover(star)}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onChange?.(star === value ? 0 : star);
            }}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(
                filled ? "fill-primary text-primary" : "fill-transparent text-muted-foreground/50",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

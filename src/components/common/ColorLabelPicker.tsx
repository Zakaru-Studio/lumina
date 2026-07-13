import { Ban } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ColorLabel } from "@/types";

/** Props for {@link ColorLabelPicker}. */
export interface ColorLabelPickerProps {
  /** Currently selected color label. */
  value: ColorLabel;
  /** Called with the chosen color. */
  onChange: (c: ColorLabel) => void;
  className?: string;
}

/** Ordered swatches; "none" renders as a clear/reset dot. */
const LABELS: { value: ColorLabel; className: string; title: string }[] = [
  { value: "none", className: "", title: "None" },
  { value: "red", className: "label-red", title: "Red" },
  { value: "yellow", className: "label-yellow", title: "Yellow" },
  { value: "green", className: "label-green", title: "Green" },
  { value: "blue", className: "label-blue", title: "Blue" },
  { value: "purple", className: "label-purple", title: "Purple" },
];

/**
 * A row of small swatch dots for the color-label taxonomy. The selected swatch
 * gets a ring. Uses the shared `label-*` utility classes (which set `color`),
 * rendered as filled dots via `bg-current`.
 */
export function ColorLabelPicker({ value, onChange, className }: ColorLabelPickerProps) {
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)} role="radiogroup">
      {LABELS.map((label) => {
        const selected = value === label.value;
        const isNone = label.value === "none";
        return (
          <button
            key={label.value}
            type="button"
            title={label.title}
            aria-label={label.title}
            aria-checked={selected}
            role="radio"
            onClick={(e) => {
              e.stopPropagation();
              onChange(label.value);
            }}
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full transition-transform hover:scale-110",
              !isNone && label.className,
              !isNone && "bg-current",
              isNone && "bg-muted text-muted-foreground",
              selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
          >
            {isNone ? <Ban className="h-2.5 w-2.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}

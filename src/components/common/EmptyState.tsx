import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** Optional decorative icon rendered above the title. */
  icon?: ReactNode;
  /** Primary message. */
  title: string;
  /** Optional supporting copy. */
  description?: string;
  /** Optional call-to-action node (e.g. a button). */
  action?: ReactNode;
  className?: string;
}

/**
 * Centered, muted placeholder for empty views (no photos, no results, etc.).
 * Spacious and calm — no borders, generous padding.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-16 text-center animate-fade-in",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

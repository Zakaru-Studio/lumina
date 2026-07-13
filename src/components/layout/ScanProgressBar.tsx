import { useEffect, useRef, useState } from "react";

import { useScanStore } from "@/stores/scanStore";

/** Human labels for each scan phase. */
const PHASE_LABEL: Record<string, string> = {
  discovering: "Discovering",
  indexing: "Indexing",
  thumbnailing: "Generating thumbnails",
  idle: "Idle",
};

/** Format a seconds duration as `m:ss` (or `<1m`). */
function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `~${m}m ${s.toString().padStart(2, "0")}s left`;
}

/**
 * Slim, determinate progress bar pinned to the bottom of the content area while
 * a scan is running. Combines indexing + thumbnailing into a single 0–100%
 * measure and derives a smoothed throughput (items/s) and ETA. No spinner.
 */
export function ScanProgressBar() {
  const progress = useScanStore((s) => s.progress);

  // Smoothed throughput (processed units per second) via an EMA over samples.
  const rateRef = useRef(0);
  const lastRef = useRef<{ t: number; processed: number } | null>(null);
  const [rate, setRate] = useState(0);

  const processed = progress ? progress.indexed + progress.thumbnailed : 0;

  useEffect(() => {
    if (!progress || progress.phase === "idle") {
      lastRef.current = null;
      rateRef.current = 0;
      setRate(0);
      return;
    }
    const now = performance.now();
    const last = lastRef.current;
    if (last) {
      const dt = (now - last.t) / 1000;
      const dp = processed - last.processed;
      if (dt > 0.2 && dp >= 0) {
        const inst = dp / dt;
        // Exponential moving average keeps the number stable and readable.
        rateRef.current = rateRef.current === 0 ? inst : rateRef.current * 0.7 + inst * 0.3;
        setRate(rateRef.current);
      }
    }
    lastRef.current = { t: now, processed };
  }, [progress, processed]);

  if (!progress || progress.phase === "idle") return null;

  const { phase, indexed, total } = progress;
  const totalWork = total * 2;
  const pct = totalWork > 0 ? Math.max(0, Math.min(100, (processed / totalWork) * 100)) : 0;

  const detail =
    phase === "discovering"
      ? `${progress.discovered.toLocaleString()} found`
      : `${indexed.toLocaleString()} / ${total.toLocaleString()}`;

  const remaining = Math.max(0, totalWork - processed);
  const eta = rate > 0 ? formatEta(remaining / rate) : "";
  const rateLabel = rate >= 1 ? `${Math.round(rate)}/s` : "";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 animate-fade-in-up">
      <div className="mx-3 mb-3 rounded-xl bg-card px-4 py-2.5 shadow-lg">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{PHASE_LABEL[phase] ?? phase}</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            {rateLabel ? <span>{rateLabel}</span> : null}
            {eta ? <span>· {eta}</span> : null}
            <span>{detail}</span>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.current ? (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{progress.current}</p>
        ) : null}
      </div>
    </div>
  );
}

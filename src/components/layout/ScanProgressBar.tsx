import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { useScanStore } from "@/stores/scanStore";

/** Format a seconds duration as an ETA label using the current translations. */
function formatEta(seconds: number, t: TFunction): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return t("scan.etaSeconds", { s: Math.ceil(seconds) });
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return t("scan.etaMinutes", { m, s: s.toString().padStart(2, "0") });
}

/**
 * Slim, determinate progress bar pinned to the bottom of the content area while
 * a scan is running. Combines indexing + thumbnailing into a single 0–100%
 * measure and derives a smoothed throughput (items/s) and ETA. No spinner.
 */
export function ScanProgressBar() {
  const { t } = useTranslation();
  const progress = useScanStore((s) => s.progress);
  const setBarHeight = useScanStore((s) => s.setBarHeight);

  // Report the bar's live height (0 when hidden) so bottom-anchored overlays can
  // position themselves relative to it. Runs after every render — cheap, and
  // `setBarHeight` no-ops when the value is unchanged.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    setBarHeight(el ? el.offsetHeight : 0);
  });
  useEffect(() => () => setBarHeight(0), [setBarHeight]);

  // Smoothed throughput (processed units per second) via an EMA over samples.
  const rateRef = useRef(0);
  const lastRef = useRef<{ t: number; processed: number } | null>(null);
  const [rate, setRate] = useState(0);

  // `processed` counts completed tasks (index *or* thumbnail) and reaches
  // `total` exactly — unlike `indexed + thumbnailed`, which double-counts index
  // tasks (they also emit a thumbnail) and so never matched `total`.
  const processed = progress ? progress.processed : 0;

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

  const { phase, total } = progress;
  const pct = total > 0 ? Math.max(0, Math.min(100, (processed / total) * 100)) : 0;

  const detail =
    phase === "discovering"
      ? t("scan.foundCount", { n: progress.discovered.toLocaleString() })
      : `${processed.toLocaleString()} / ${total.toLocaleString()}`;

  const remaining = Math.max(0, total - processed);
  const eta = rate > 0 ? formatEta(remaining / rate, t) : "";
  const rateLabel = rate >= 1 ? `${Math.round(rate)}/s` : "";

  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 animate-fade-in-up"
    >
      <div className="border-t border-border bg-card px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">
            {t(`scan.phase.${phase}`, { defaultValue: phase })}
          </span>
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

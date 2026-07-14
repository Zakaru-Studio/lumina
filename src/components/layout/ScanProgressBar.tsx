import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { BottomProgressBar } from "@/components/common/BottomProgressBar";
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
  const hint = [rateLabel, eta].filter(Boolean).join(" · ");

  return (
    <BottomProgressBar
      label={t(`scan.phase.${phase}`, { defaultValue: phase })}
      pct={pct}
      detail={detail}
      hint={hint}
      current={progress.current}
      onHeightChange={setBarHeight}
    />
  );
}

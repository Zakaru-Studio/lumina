import { useTranslation } from "react-i18next";

import { BottomProgressBar } from "@/components/common/BottomProgressBar";
import { useFaceStore } from "@/stores/faceStore";
import { useScanStore } from "@/stores/scanStore";

/**
 * Bottom progress bar for the on-device face indexer. Reuses the same
 * {@link BottomProgressBar} as the scan pipeline, and stacks above the scan bar
 * when both run at once.
 */
export function FaceProgressBar() {
  const { t } = useTranslation();
  const progress = useFaceStore((s) => s.progress);
  const running = useFaceStore((s) => s.running);
  const scanBarHeight = useScanStore((s) => s.barHeight);

  if (!running || !progress || progress.total <= 0) return null;

  const pct = (progress.processed / progress.total) * 100;
  return (
    <BottomProgressBar
      label={t("people.analyzeTitle")}
      pct={pct}
      detail={`${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`}
      hint={t("people.analyzeMeta", { faces: progress.faces, people: progress.people })}
      bottomOffset={scanBarHeight}
    />
  );
}

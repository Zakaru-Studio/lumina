/**
 * Typed wrappers around Tauri's event system. Event names mirror the backend
 * `events::names` module.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScanProgress, ScanSummary } from "@/types";

export const EVENTS = {
  scanProgress: "scan://progress",
  scanDone: "scan://done",
  libraryChanged: "library://changed",
  thumbReady: "thumb://ready",
  thumbsRegenerated: "thumb://regenerated",
} as const;

export function onScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>(EVENTS.scanProgress, (e) => cb(e.payload));
}

export function onScanDone(cb: (s: ScanSummary) => void): Promise<UnlistenFn> {
  return listen<ScanSummary>(EVENTS.scanDone, (e) => cb(e.payload));
}

export function onLibraryChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(EVENTS.libraryChanged, () => cb());
}

export function onThumbsRegenerated(cb: () => void): Promise<UnlistenFn> {
  return listen(EVENTS.thumbsRegenerated, () => cb());
}

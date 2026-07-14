/**
 * Typed wrappers around Tauri's event system. Event names mirror the backend
 * `events::names` module.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BackupProgress,
  BackupSummary,
  DeviceInfo,
  FaceProgress,
  FaceSummary,
  ScanProgress,
  ScanSummary,
} from "@/types";

export const EVENTS = {
  scanProgress: "scan://progress",
  scanDone: "scan://done",
  libraryChanged: "library://changed",
  thumbReady: "thumb://ready",
  thumbsRegenerated: "thumb://regenerated",
  deviceConnected: "device://connected",
  backupProgress: "backup://progress",
  backupDone: "backup://done",
  faceProgress: "face://progress",
  faceDone: "face://done",
  peopleChanged: "people://changed",
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

export function onDeviceConnected(cb: (d: DeviceInfo) => void): Promise<UnlistenFn> {
  return listen<DeviceInfo>(EVENTS.deviceConnected, (e) => cb(e.payload));
}

export function onBackupProgress(cb: (p: BackupProgress) => void): Promise<UnlistenFn> {
  return listen<BackupProgress>(EVENTS.backupProgress, (e) => cb(e.payload));
}

export function onBackupDone(cb: (s: BackupSummary) => void): Promise<UnlistenFn> {
  return listen<BackupSummary>(EVENTS.backupDone, (e) => cb(e.payload));
}

export function onFaceProgress(cb: (p: FaceProgress) => void): Promise<UnlistenFn> {
  return listen<FaceProgress>(EVENTS.faceProgress, (e) => cb(e.payload));
}

export function onFaceDone(cb: (s: FaceSummary) => void): Promise<UnlistenFn> {
  return listen<FaceSummary>(EVENTS.faceDone, (e) => cb(e.payload));
}

export function onPeopleChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(EVENTS.peopleChanged, () => cb());
}

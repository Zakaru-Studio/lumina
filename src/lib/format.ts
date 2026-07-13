/** Presentation helpers for formatting metadata (pure, no side effects). */
import { format, fromUnixTime } from "date-fns";
import type { Photo } from "@/types";

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format a Unix-seconds timestamp, or a dash when absent. */
export function formatDate(ts: number | null, pattern = "PP"): string {
  if (!ts) return "—";
  return format(fromUnixTime(ts), pattern);
}

/** Format the best-known capture date/time of a photo. */
export function formatTaken(photo: Photo): string {
  const ts = photo.takenAt ?? photo.fileCreated ?? photo.importedAt;
  return format(fromUnixTime(ts), "PPpp");
}

/** Compact EXIF exposure summary, e.g. "50mm · f/1.8 · 1/250 · ISO 100". */
export function formatExposure(photo: Photo): string {
  const parts: string[] = [];
  if (photo.focalLength) parts.push(`${Math.round(photo.focalLength)}mm`);
  if (photo.aperture) parts.push(`f/${photo.aperture.toFixed(1)}`);
  if (photo.shutterSpeed) parts.push(photo.shutterSpeed);
  if (photo.iso) parts.push(`ISO ${photo.iso}`);
  return parts.join(" · ");
}

/** Camera label from make/model. */
export function formatCamera(photo: Photo): string {
  const bits = [photo.cameraMake, photo.cameraModel].filter(Boolean);
  return bits.join(" ") || "Unknown camera";
}

/** Aspect ratio (w/h) with a sane fallback for undecoded/RAW entries. */
export function aspectRatio(photo: Photo): number {
  if (photo.width > 0 && photo.height > 0) return photo.width / photo.height;
  return 1;
}

/** Presentation helpers for formatting metadata (pure, no side effects). */
import { format, fromUnixTime } from "date-fns";
import { enUS } from "date-fns/locale";
import type { Locale } from "date-fns";

import i18n from "@/i18n";
import type { Photo } from "@/types";

/**
 * date-fns locales. `enUS` is the synchronous fallback baked into the main
 * bundle; every other locale is code-split and preloaded on demand so its bytes
 * (and date-fns' full locale data) stay out of the initial parse.
 */
const localeLoaders: Record<string, () => Promise<Locale>> = {
  fr: () => import("date-fns/locale/fr").then((m) => m.fr),
};
const loadedLocales: Record<string, Locale> = { en: enUS };

/** Map an i18n language tag to a locale bucket (`fr-CA` → `fr`, etc.). */
function localeKey(lang: string | undefined): string {
  return lang?.startsWith("fr") ? "fr" : "en";
}

/** Preload (once) the date-fns locale for a language, so it's ready by the time
 * a date is formatted. Called at startup and on every language change. */
export function preloadDateLocale(lang: string | undefined = i18n.language): void {
  const key = localeKey(lang);
  if (loadedLocales[key] || !localeLoaders[key]) return;
  void localeLoaders[key]!().then((locale) => {
    loadedLocales[key] = locale;
  });
}

// Keep the active language's locale warm: preload now and whenever it changes.
preloadDateLocale();
i18n.on("languageChanged", (lng: string) => preloadDateLocale(lng));

/**
 * The date-fns locale matching the active UI language, so weekday/month names in
 * formatted dates are localized (e.g. "lundi 3 mars 2025" in French). Read from
 * the i18next singleton at call time so it always reflects the current language;
 * falls back to English until a code-split locale has finished preloading.
 */
export function dateLocale(): Locale {
  return loadedLocales[localeKey(i18n.language)] ?? enUS;
}

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
  return format(fromUnixTime(ts), pattern, { locale: dateLocale() });
}

/** Format the best-known capture date/time of a photo. */
export function formatTaken(photo: Photo): string {
  const ts = photo.takenAt ?? photo.fileCreated ?? photo.importedAt;
  return format(fromUnixTime(ts), "PPpp", { locale: dateLocale() });
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

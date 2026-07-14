import type { TFunction } from "i18next";

import type { Album } from "@/types";

/**
 * Display label for an album. Smart albums are seeded with English names in the
 * database, so they're translated by their rule `preset` (falling back to the
 * stored name for unknown presets). Manual albums use their user-given name.
 */
export function albumLabel(album: Album, t: TFunction): string {
  if (album.kind === "smart") {
    const preset = (album.rule?.preset as string | undefined) ?? "";
    if (preset) return t(`smartAlbums.${preset}`, { defaultValue: album.name });
  }
  return album.name;
}

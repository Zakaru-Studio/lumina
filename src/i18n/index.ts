/**
 * i18n bootstrap. English is the source/fallback language; French is the second
 * locale. The active language is owned by the UI store (persisted to
 * localStorage) so it applies instantly on boot with no flash — see
 * {@link file://../stores/uiStore.ts}. The Settings selector mirrors the choice
 * into the backend `AppConfig` as well.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const SUPPORTED_LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Narrow an arbitrary string to a supported language, falling back to English. */
export function normalizeLanguage(value: string | null | undefined): Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "")
    ? (value as Language)
    : "en";
}

/**
 * Best-effort detection of the OS display language, from the WebView's reported
 * locale (WebView2 mirrors the Windows user language here). Used *only* as the
 * first-launch default — once the user has a persisted choice, that wins. Every
 * French locale (fr, fr-FR, fr-CA, fr-BE, fr-CH, …) maps to French; anything
 * else falls back to English.
 */
export function detectOsLanguage(): Language {
  const primary =
    typeof navigator !== "undefined"
      ? navigator.languages?.[0] ?? navigator.language ?? ""
      : "";
  return primary.toLowerCase().startsWith("fr") ? "fr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

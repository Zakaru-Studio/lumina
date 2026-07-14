/**
 * Platform detection for the webview.
 *
 * Tauri runs the UI in the OS webview (Chromium on Windows/Linux, WebKit on
 * macOS), so a plain `navigator` probe is enough to tell macOS from the rest —
 * no async OS plugin needed. Used to show the right modifier in shortcut hints
 * (⌘ on macOS, Ctrl elsewhere).
 */

/** True when running on macOS. */
export const isMac: boolean = (() => {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
})();

/** The command/meta modifier label for the current platform. */
export const modKey = isMac ? "⌘" : "Ctrl";

/**
 * Build a keyboard-shortcut hint for the primary (command) modifier, e.g.
 * `shortcutHint("K")` → `"⌘K"` on macOS, `"Ctrl+K"` elsewhere.
 */
export function shortcutHint(key: string): string {
  return isMac ? `${modKey}${key}` : `${modKey}+${key}`;
}

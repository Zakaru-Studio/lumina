import { getCurrentWindow, Window } from "@tauri-apps/api/window";

/**
 * Dismiss the startup splashscreen and reveal the main window.
 *
 * The main window boots hidden (`visible: false` in tauri.conf.json) behind a
 * lightweight `splashscreen` window so the user never sees the webview's blank
 * flash. Once React has painted, we show the main window and close the splash.
 * Runs only inside the Tauri shell; it's a no-op in a plain browser (dev).
 */
export async function dismissSplashscreen(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    await getCurrentWindow().show();
    await Window.getByLabel("splashscreen").then((w) => w?.close());
  } catch {
    // Never let a splash-teardown hiccup block the app from being usable.
  }
}

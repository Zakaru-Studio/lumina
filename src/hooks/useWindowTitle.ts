import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Default window title (the app name, as configured in `tauri.conf.json`). */
const BASE_TITLE = "Lumina";

/**
 * Overrides the native window title (shown in the taskbar / Alt+Tab / task view)
 * while the calling component is mounted, restoring {@link BASE_TITLE} on unmount.
 * The window is frameless, so this is the only surface the OS-level title reaches.
 *
 * Pass an already-translated string — the title updates whenever it changes (e.g.
 * when the user switches language while the page is open).
 */
export function useWindowTitle(title: string) {
  useEffect(() => {
    const win = getCurrentWindow();
    void win.setTitle(title || BASE_TITLE);
    return () => {
      void win.setTitle(BASE_TITLE);
    };
  }, [title]);
}

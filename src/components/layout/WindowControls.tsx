import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "@/lib/utils";

/** The frameless-window titlebar buttons (minimize / maximize-restore / close).
 *
 * The window runs with `decorations: false`; these replace the native controls.
 * Window dragging itself is handled by the CSS drag region on the top bar
 * (`-webkit-app-region`), so these buttons only need to be `no-drag` and call
 * the window API. Sits flush in the top-right corner. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let active = true;
    void win.isMaximized().then((m) => active && setMaximized(m));
    void win
      .onResized(() => {
        void win.isMaximized().then((m) => active && setMaximized(m));
      })
      .then((u) => {
        if (active) unlisten = u;
        else u();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="no-drag flex h-12 items-stretch">
      <TitlebarButton label="Minimize" onClick={() => void win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <line x1="0" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </TitlebarButton>

      <TitlebarButton
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </TitlebarButton>

      <TitlebarButton label="Close" onClick={() => void win.close()} danger>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </TitlebarButton>
    </div>
  );
}

function TitlebarButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex w-11 items-center justify-center text-muted-foreground transition-colors",
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

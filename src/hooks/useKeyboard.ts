/**
 * Keyboard shortcuts, split into two scopes so listeners never double-fire:
 *
 *  useAppShortcuts()  — mounted once in the shell:
 *      Ctrl/Cmd+K  toggle command palette · Escape close palette / clear selection
 *
 *  useGlobalShortcuts(order, opts) — mounted once per visible grid page:
 *      Ctrl/Cmd+A  select all         Delete/Backspace  delete (opens dialog)
 *      0–5         set star rating     ←/→               move selection cursor
 *      F / Shift+F favorite / unfav    Enter/Space       open in lightbox
 *
 * Rating/favorite apply to the current selection, or the cursor (anchor)
 * when nothing is selected and are non-destructive. Delete opens the shared
 * confirmation to choose between removing from the library and deleting the
 * files from disk — nothing is deleted without that choice.
 */
import { useEffect } from "react";

import { useSetFavorite, useSetRating } from "@/hooks/usePhotoMutations";
import { useDeleteDialog } from "@/stores/deleteDialogStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";

/** True when focus is in a text-entry surface (so we don't hijack typing). */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/** App-wide shortcuts (palette + escape). Mount once in the shell. */
export function useAppShortcuts() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const clear = useSelectionStore((s) => s.clear);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!useUiStore.getState().commandOpen);
        return;
      }
      if (e.key === "Escape" && !useUiStore.getState().commandOpen) {
        clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, clear]);
}

/** Options for {@link useGlobalShortcuts}. */
export interface GridShortcutOptions {
  /** Open a photo (by flat index) in the lightbox. */
  onOpen?: (index: number) => void;
  /** Disable grid shortcuts (e.g. while the lightbox is open). */
  enabled?: boolean;
}

/** Grid-scoped shortcuts. `order` is the current, ordered visible photo ids. */
export function useGlobalShortcuts(order: string[], opts: GridShortcutOptions = {}) {
  const { onOpen, enabled = true } = opts;
  const selectAll = useSelectionStore((s) => s.selectAll);
  const select = useSelectionStore((s) => s.select);
  const selectRange = useSelectionStore((s) => s.selectRange);
  const setRating = useSetRating();
  const setFavorite = useSetFavorite();

  useEffect(() => {
    if (!enabled) return;

    /** Ids the quick actions apply to: selection, else the cursor. */
    const targets = (): string[] => {
      const st = useSelectionStore.getState();
      if (st.selected.size > 0) return Array.from(st.selected);
      return st.anchor ? [st.anchor] : [];
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll(order);
        return;
      }
      if (isTyping() || mod) return;

      // Star rating 0–5.
      if (/^[0-5]$/.test(e.key)) {
        const ids = targets();
        if (ids.length) {
          e.preventDefault();
          setRating.mutate({ ids, rating: Number(e.key) });
        }
        return;
      }
      // Favorite (F) / unfavorite (Shift+F).
      if (e.key.toLowerCase() === "f") {
        const ids = targets();
        if (ids.length) {
          e.preventDefault();
          setFavorite.mutate({ ids, favorite: !e.shiftKey });
        }
        return;
      }
      // Cursor navigation.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (order.length === 0) return;
        e.preventDefault();
        const st = useSelectionStore.getState();
        const cur = st.anchor ? order.indexOf(st.anchor) : -1;
        const next =
          e.key === "ArrowLeft"
            ? Math.max(0, (cur < 0 ? 0 : cur) - 1)
            : Math.min(order.length - 1, cur + 1);
        const id = order[next];
        if (!id) return;
        if (e.shiftKey) selectRange(id, order);
        else select(id);
        return;
      }
      // Open in lightbox.
      if ((e.key === "Enter" || e.key === " ") && onOpen) {
        const st = useSelectionStore.getState();
        const idx = st.anchor ? order.indexOf(st.anchor) : -1;
        if (idx >= 0) {
          e.preventDefault();
          onOpen(idx);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = Array.from(useSelectionStore.getState().selected);
        if (ids.length > 0) {
          e.preventDefault();
          // Open the shared dialog so the user picks library-only vs disk delete.
          useDeleteDialog.getState().open(ids);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, enabled, onOpen, selectAll, select, selectRange, setRating, setFavorite]);
}

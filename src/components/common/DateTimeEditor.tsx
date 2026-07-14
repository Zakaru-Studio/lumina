/**
 * Shared capture-date editor. A small modal wrapping a native
 * `datetime-local` input, used by both the Lightbox (single photo) and the
 * SelectionToolbar (batch). All times are LOCAL — the value maps directly to the
 * Unix-seconds timestamp the backend bakes into EXIF.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Format Unix seconds as a local `YYYY-MM-DDTHH:mm` string for the input. */
function toLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export interface DateTimeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial value in Unix seconds (local), or null to default to now. */
  initial: number | null;
  /** Number of photos affected (drives the title copy). */
  count?: number;
  /** Called with the chosen Unix-seconds timestamp on confirm. */
  onSubmit: (timestamp: number) => void;
  pending?: boolean;
}

export function DateTimeEditor({
  open,
  onOpenChange,
  initial,
  count = 1,
  onSubmit,
  pending,
}: DateTimeEditorProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  // Re-seed the field each time the dialog opens (from the photo's date, or now).
  useEffect(() => {
    if (!open) return;
    const seed = initial ?? Math.floor(Date.now() / 1000);
    setValue(toLocalInput(seed));
  }, [open, initial]);

  const submit = () => {
    if (!value) return;
    const ms = new Date(value).getTime(); // parsed as local time
    if (Number.isNaN(ms)) return;
    onSubmit(Math.floor(ms / 1000));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dateEditor.title", { count })}</DialogTitle>
        </DialogHeader>
        <Input
          type="datetime-local"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!value || pending}>
            {t("common.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

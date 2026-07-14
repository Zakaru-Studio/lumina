import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdaterStore } from "@/stores/updaterStore";

/**
 * Header indicator shown only while an update is available: a pulsing,
 * accent-coloured download icon. Clicking it re-opens the update dialog (which
 * also appears automatically on the startup check). Renders nothing otherwise.
 */
export function UpdateBadge() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const openDialog = useUpdaterStore((s) => s.openDialog);

  if (status !== "available") return null;

  const label = t("updater.available", { version: version ?? "" });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="no-drag text-primary hover:text-primary"
          aria-label={label}
          onClick={openDialog}
        >
          <Download className="h-[18px] w-[18px] animate-pulse" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

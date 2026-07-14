import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUiStore } from "@/stores/uiStore";
import type { Theme } from "@/types";

const ORDER: Theme[] = ["light", "dark", "system"];
const LABEL_KEY: Record<Theme, string> = {
  light: "themeToggle.light",
  dark: "themeToggle.dark",
  system: "themeToggle.system",
};

/**
 * Icon button that cycles the app theme light → dark → system. Theme is applied
 * globally via `useThemeSync` in the shell, so this only updates the store.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const themeLabel = t("themeToggle.label", { name: t(LABEL_KEY[theme]) });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          aria-label={themeLabel}
          onClick={() => setTheme(next)}
        >
          {theme === "light" ? (
            <Sun className="h-[18px] w-[18px]" />
          ) : theme === "dark" ? (
            <Moon className="h-[18px] w-[18px]" />
          ) : (
            <Monitor className="h-[18px] w-[18px]" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{themeLabel}</TooltipContent>
    </Tooltip>
  );
}

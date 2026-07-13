/** Application configuration and AI capability hooks, plus theme application. */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import { applyTheme, useUiStore } from "@/stores/uiStore";
import type { AppConfig } from "@/types";

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.getConfig });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: AppConfig) => api.updateConfig(config),
    onSuccess: (config) => {
      qc.setQueryData(qk.config, config);
    },
  });
}

export function useAiStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: api.aiStatus });
}

/**
 * Apply the current theme to <html> and keep it in sync with OS changes when
 * the user selects "system". Mount once in the app shell.
 */
export function useThemeSync() {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
}

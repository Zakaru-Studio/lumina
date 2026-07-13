import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useUiStore } from "@/stores/uiStore";

/**
 * App toast host. Resolves the sonner theme from the app theme so toasts match
 * light/dark. Mounted once in the app shell.
 */
export function Toaster(props: ToasterProps) {
  const theme = useUiStore((s) => s.theme);
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group rounded-xl border-border bg-card text-card-foreground shadow-lg",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground rounded-md",
          cancelButton: "bg-muted text-muted-foreground rounded-md",
        },
      }}
      {...props}
    />
  );
}

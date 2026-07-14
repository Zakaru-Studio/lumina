import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import i18n, { normalizeLanguage } from "@/i18n";
import { queryClient } from "@/lib/query";
import { applyTheme, useUiStore } from "@/stores/uiStore";
import "./index.css";

// Apply the persisted theme and language before first paint to avoid a flash.
applyTheme(useUiStore.getState().theme);
void i18n.changeLanguage(normalizeLanguage(useUiStore.getState().language));

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

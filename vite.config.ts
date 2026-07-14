import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri expects a fixed dev-server port and ignores the `src-tauri` folder for HMR.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tell Vite to ignore watching `src-tauri`.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce assets compatible with the Tauri webview.
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the big, rarely-changing vendor libraries into their own
        // cacheable chunks so an app-code change doesn't re-download them, and
        // the initial route parses less JS. Route-level code-splitting (see
        // App.tsx) does the heavier lifting.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("react-router"))
            return "react";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack")) return "query";
        },
      },
    },
  },
}));

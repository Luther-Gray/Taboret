import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Port must match tauri.conf.json `build.devUrl` (http://localhost:5173).
    // Tauri dev mode connects its webview to this port; the browser preview
    // at 8080 was a mismatch — pnpm tauri dev loaded the wrong origin.
    port: 5173,
    // Do not auto-open the browser: Tauri opens its own native window.
    open: false,
    strictPort: true, // Fail immediately if 5173 is taken instead of silently shifting
  },
});

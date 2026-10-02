import { defineConfig } from "vite";

// Two pages: index.html is the public play page (everything runs in the browser); fair.html is
// the booth display, whose brain lives in the Python backend (flypoker.server). In dev, Vite
// proxies the backend for fair.html.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { index: "index.html", fair: "fair.html" },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
});

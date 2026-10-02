import { defineConfig } from "vite";

// The Python backend (flypoker.server) owns the brain; Vite only serves the page in dev.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api/terminal": {
        target: "ws://localhost:8788",
        ws: true,
      },
      "/api/ws": {
        target: "ws://localhost:8788",
        ws: true,
      },
      "/api": {
        target: "http://localhost:8788",
      },
    },
  },
});
